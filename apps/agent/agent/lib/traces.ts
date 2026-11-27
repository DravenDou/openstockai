import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  runSummarySchema,
  traceDetailSchema,
  traceListSchema,
  traceQuerySchema,
  traceSummarySchema,
  type TimelineEvent,
} from "@openstockai/api-client/agent-traces";
import { HTTPError } from "@openstockai/server/http";

const execute = promisify(execFile);
const cli = resolve("node_modules/eve/bin/eve.js");
const cliSpanSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  durationMs: z.number().nonnegative(),
  startTimeNs: z.string().regex(/^\d{1,30}$/),
  statusCode: z.number().int().min(0).max(2),
  attributes: z.record(z.string(), z.unknown()),
});
const cliTraceSchema = traceSummarySchema.extend({ spans: z.array(cliSpanSchema) });

type CliSpan = z.infer<typeof cliSpanSchema>;

const text = (attributes: Record<string, unknown>, ...keys: string[]) => {
  const value = keys.map((key) => attributes[key]).find((value) => typeof value === "string");
  return typeof value === "string" ? value.slice(0, 200) : null;
};
const count = (attributes: Record<string, unknown>, key: string) => {
  const value = attributes[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
};
// Error types are class names or codes; anything else could carry content, so drop it.
const errorCode = (attributes: Record<string, unknown>) => {
  const value = text(attributes, "error.type");
  return value && /^[\w.:-]{1,80}$/.test(value) ? value : null;
};
const approvalOutcome = (outcome: string | null): TimelineEvent["approval"] =>
  outcome === "approved" ? "approved" : outcome ? "rejected" : null;

// Build the turn timeline from action and approval spans: one row per tool call (with its
// approval state), plus rows for approvals without an action and for other failing spans.
export function traceTimeline(spans: CliSpan[], start: bigint): TimelineEvent[] {
  const offset = (span: CliSpan) => Math.max(0, Number(BigInt(span.startTimeNs) - start) / 1e6);
  const events: TimelineEvent[] = [];
  const byCall = new Map<string, TimelineEvent>();
  const ordered = [...spans].sort((a, b) =>
    BigInt(a.startTimeNs) < BigInt(b.startTimeNs) ? -1 : 1,
  );
  for (const span of ordered.filter((item) => item.name === "agent.action")) {
    const attributes = span.attributes;
    const callId = text(attributes, "agent.action.call_id");
    const outcome = text(attributes, "agent.action.outcome");
    const event: TimelineEvent = {
      id: span.spanId,
      kind: "tool",
      source: "trace",
      name: text(attributes, "agent.action.name", "gen_ai.tool.name") ?? "tool",
      label: null,
      stepIndex: count(attributes, "agent.step.index"),
      offsetMs: offset(span),
      durationMs: span.durationMs,
      startedAt: null,
      outcome: outcome ?? (span.statusCode === 2 ? "failed" : null),
      // An abandoned call with no approval span is waiting for the user.
      approval: outcome === "abandoned" ? "pending" : null,
      callId,
      actionId: null,
      args: null,
      errorCode: span.statusCode === 2 ? errorCode(attributes) : null,
      errorMessage: null,
    };
    events.push(event);
    if (callId) byCall.set(callId, event);
  }
  for (const span of ordered.filter((item) => item.name === "agent.approval")) {
    const attributes = span.attributes;
    const callId = text(attributes, "agent.action.call_id");
    const approval = approvalOutcome(text(attributes, "agent.approval.outcome"));
    const target = callId ? byCall.get(callId) : undefined;
    if (target) {
      target.approval = approval;
      continue;
    }
    events.push({
      id: span.spanId,
      kind: "approval",
      source: "trace",
      name: text(attributes, "agent.action.name") ?? "approval",
      label: null,
      stepIndex: count(attributes, "agent.step.index"),
      offsetMs: offset(span),
      durationMs: span.durationMs,
      startedAt: null,
      outcome: text(attributes, "agent.approval.outcome"),
      approval,
      callId,
      actionId: null,
      args: null,
      errorCode: span.statusCode === 2 ? errorCode(attributes) : null,
      errorMessage: null,
    });
  }
  // Errors recorded on other spans (model calls, steps). Tool failures already appear above.
  for (const span of ordered) {
    if (span.statusCode !== 2 || ["agent.action", "agent.approval"].includes(span.name)) continue;
    // Parent spans repeat the failure of their children; keep the deepest ones.
    if (spans.some((child) => child.parentSpanId === span.spanId && child.statusCode === 2))
      continue;
    events.push({
      id: span.spanId,
      kind: "error",
      source: "trace",
      name: span.name.slice(0, 200),
      label: null,
      stepIndex: count(span.attributes, "agent.step.index"),
      offsetMs: offset(span),
      durationMs: span.durationMs,
      startedAt: null,
      outcome: "failed",
      approval: null,
      callId: null,
      actionId: null,
      args: null,
      errorCode: errorCode(span.attributes),
      errorMessage: null,
    });
  }
  return events.sort((a, b) => (a.offsetMs ?? 0) - (b.offsetMs ?? 0)).slice(0, 500);
}

// Select metadata explicitly: old local traces may still contain conversation content.
export function traceMetadata(value: unknown) {
  const trace = cliTraceSchema.parse(value);
  const start = trace.spans.reduce(
    (earliest, span) => (BigInt(span.startTimeNs) < earliest ? BigInt(span.startTimeNs) : earliest),
    BigInt(trace.spans[0]?.startTimeNs || "0"),
  );
  const tokenTotal = (key: string) => {
    const counts = trace.spans
      .filter((span) => span.name === "agent.step")
      .map((span) => span.attributes[key])
      .filter(
        (count): count is number =>
          typeof count === "number" && Number.isFinite(count) && count >= 0,
      );
    return counts.length ? counts.reduce((sum, count) => sum + count, 0) : null;
  };
  const timeline = traceTimeline(trace.spans, start);
  const errorSpanCount = trace.spans.filter((span) => span.statusCode === 2).length;
  const models = trace.spans.flatMap((span) => {
    const model = text(span.attributes, "gen_ai.request.model", "gen_ai.response.model");
    return model ? [model] : [];
  });
  return traceDetailSchema.parse({
    ...traceSummarySchema.parse(trace),
    spans: trace.spans.slice(0, 2000).map((span) => ({
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name.slice(0, 200),
      durationMs: span.durationMs,
      offsetMs: Math.max(0, Number(BigInt(span.startTimeNs) - start) / 1e6),
      statusCode: span.statusCode,
      model: text(span.attributes, "gen_ai.request.model", "gen_ai.response.model"),
      tool: text(span.attributes, "gen_ai.tool.name", "agent.action.name"),
    })),
    truncated: trace.spans.length > 2000,
    errorSpanCount,
    // Model spans repeat step usage; only step counters contribute to the total.
    inputTokens: tokenTotal("agent.usage.input_tokens"),
    outputTokens: tokenTotal("agent.usage.output_tokens"),
    model: models[0] ?? null,
    steps: trace.spans.filter((span) => span.name === "agent.step").length,
    toolCalls: timeline.filter((event) => event.kind === "tool").length,
    status: errorSpanCount
      ? "error"
      : timeline.some((event) => event.approval === "pending")
        ? "awaiting_approval"
        : "ok",
    timeline,
  });
}

// Bounded parallelism for the per-page enrichment.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

async function runCli(args: string[], appRoot: string) {
  const { stdout } = await execute(process.execPath, [cli, ...args], {
    cwd: appRoot,
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, EVE_TELEMETRY_DISABLED: "1" },
  });
  return stdout;
}

export async function readAgentTraces(
  query: z.infer<typeof traceQuerySchema>,
  appRoot = process.cwd(),
) {
  const { traceId, offset } = traceQuerySchema.parse(query);
  const args = traceId ? ["traces", "show", traceId, "--json"] : ["traces", "list", "--json"];
  let stdout: string;
  try {
    stdout = await runCli(args, appRoot);
  } catch (error) {
    // A pruned ID is a normal miss; failures never expose CLI output or file paths.
    const stderr = (error as { stderr?: string }).stderr || "";
    if (traceId && /No local trace matches|No local traces found/.test(stderr))
      throw new HTTPError(
        404,
        "TRACE_NOT_FOUND",
        "The trace is no longer available. Refresh the list.",
      );
    throw new HTTPError(
      503,
      "TRACES_UNAVAILABLE",
      "Could not read the local traces. Try again in a few seconds.",
    );
  }
  const data: unknown = JSON.parse(stdout);
  if (traceId) {
    const traces = z.array(cliTraceSchema).parse(data);
    const trace = traces.find((item) => item.traceId === traceId);
    if (!trace) throw new HTTPError(404, "TRACE_NOT_FOUND", "The trace is no longer available.");
    return traceMetadata(trace);
  }
  const items = z.array(traceSummarySchema).parse(data);
  // The list lacks usage and status, so enrich only the visible page (bounded concurrency).
  const page = await mapLimit(items.slice(offset, offset + 20), 4, async (item) => {
    try {
      const shown = z
        .array(cliTraceSchema)
        .parse(JSON.parse(await runCli(["traces", "show", item.traceId, "--json"], appRoot)));
      const found = shown.find((trace) => trace.traceId === item.traceId);
      if (!found) return item;
      // The schema drops spans and timeline, keeping only list fields.
      return runSummarySchema.parse(traceMetadata(found));
    } catch {
      return item;
    }
  });
  return traceListSchema.parse({
    items: page,
    total: items.length,
    nextOffset: offset + 20 < items.length ? offset + 20 : null,
  });
}
