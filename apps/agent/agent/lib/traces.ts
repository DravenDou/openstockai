import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  traceDetailSchema,
  traceListSchema,
  traceQuerySchema,
  traceSummarySchema,
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
  const text = (attributes: Record<string, unknown>, ...keys: string[]) => {
    const value = keys.map((key) => attributes[key]).find((value) => typeof value === "string");
    return typeof value === "string" ? value.slice(0, 200) : null;
  };
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
    errorSpanCount: trace.spans.filter((span) => span.statusCode === 2).length,
    // Model spans repeat step usage; only step counters contribute to the total.
    inputTokens: tokenTotal("agent.usage.input_tokens"),
    outputTokens: tokenTotal("agent.usage.output_tokens"),
  });
}

export async function readAgentTraces(
  query: z.infer<typeof traceQuerySchema>,
  appRoot = process.cwd(),
) {
  const { traceId, offset } = traceQuerySchema.parse(query);
  const args = traceId ? ["traces", "show", traceId, "--json"] : ["traces", "list", "--json"];
  let stdout: string;
  try {
    ({ stdout } = await execute(process.execPath, [cli, ...args], {
      cwd: appRoot,
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, EVE_TELEMETRY_DISABLED: "1" },
    }));
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
      "No se pudieron leer las trazas locales. Reintenta en unos segundos.",
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
  return traceListSchema.parse({
    items: items.slice(offset, offset + 20),
    total: items.length,
    nextOffset: offset + 20 < items.length ? offset + 20 : null,
  });
}
