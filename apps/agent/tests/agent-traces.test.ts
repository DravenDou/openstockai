import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { traceMetadata, readAgentTraces } from "../agent/lib/traces";
import observability from "../agent/channels/observability";
import { traceQuerySchema } from "@openstockai/api-client/agent-traces";

const traceId = "a".repeat(32);
const secret = "private-prompt-response-token-and-inventory-payload";
const raw = {
  traceId,
  agentName: "openstockai",
  conversationId: "conversation-test",
  startedAt: "2026-10-16T12:00:00.000Z",
  durationMs: 100,
  spanCount: 3,
  spans: [
    {
      spanId: "1".repeat(16),
      parentSpanId: null,
      name: "agent.step",
      durationMs: 100,
      startTimeNs: "1000000000",
      statusCode: 1,
      attributes: {
        "agent.usage.input_tokens": 42,
        "agent.usage.output_tokens": 12,
        "gen_ai.input.messages": secret,
        "gen_ai.output.messages": secret,
      },
    },
    {
      spanId: "2".repeat(16),
      parentSpanId: "1".repeat(16),
      name: "chat test-model",
      durationMs: 40,
      startTimeNs: "1010000000",
      statusCode: 1,
      attributes: {
        "gen_ai.request.model": "test-model",
        "gen_ai.usage.input_tokens": 42,
        "gen_ai.usage.output_tokens": 12,
        "ai.prompt": secret,
        "ai.response.reasoning": secret,
      },
    },
    {
      spanId: "3".repeat(16),
      parentSpanId: "1".repeat(16),
      name: "execute_tool getInventory",
      durationMs: 50,
      startTimeNs: "1050000000",
      statusCode: 2,
      statusMessage: secret,
      events: [{ name: "exception", attributes: { "exception.message": secret } }],
      attributes: {
        "gen_ai.tool.name": "getInventory",
        "gen_ai.tool.call.arguments": secret,
        "gen_ai.tool.call.result": secret,
        authorization: secret,
        cookie: secret,
      },
    },
  ],
};

test("trace projection preserves relationships and counts step tokens once without exporting content", () => {
  const trace = traceMetadata(raw);
  assert.equal(trace.inputTokens, 42);
  assert.equal(trace.outputTokens, 12);
  assert.equal(trace.errorSpanCount, 1);
  assert.equal(trace.spans[1].parentSpanId, trace.spans[0].spanId);
  assert.equal(trace.spans[1].model, "test-model");
  assert.equal(trace.spans[2].tool, "getInventory");
  assert.equal(trace.spans[2].offsetMs, 50);
  assert.equal(trace.spans[2].statusCode, 2);
  assert(!JSON.stringify(trace).includes(secret));
  assert(!("attributes" in trace.spans[0]));
  assert(!("events" in trace.spans[2]));
  assert(!("statusMessage" in trace.spans[2]));
  const noUsage = traceMetadata({ ...raw, spans: raw.spans.slice(1) });
  assert.equal(noUsage.inputTokens, null);
  assert.equal(noUsage.outputTokens, null);
});

test("trace queries reject paths, shell arguments, unknown filters and invalid pages", () => {
  for (const query of [
    { traceId: "../secret" },
    { traceId: "--json" },
    { offset: -1 },
    { offset: 0.5 },
    { offset: 100001 },
    { ownerId: "foreign" },
  ])
    assert.equal(traceQuerySchema.safeParse(query).success, false);
});

test("the internal trace reader rejects a browser without a service credential before reading files", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://unused:unused@unavailable/unused",
    BETTER_AUTH_URL: "http://localhost:3017",
    BETTER_AUTH_SECRET: "x".repeat(32),
    API_BASE_URL: "http://127.0.0.1:8087",
    AGENT_SERVICE_SECRET: "y".repeat(32),
  });
  try {
    const route = observability.routes[0];
    assert(route.transport !== "websocket");
    const response = await route.handler(
      new Request("http://localhost/internal/observability/traces"),
      {} as never,
    );
    assert.equal(response.status, 403);
    assert(!JSON.stringify(await response.json()).includes(secret));
  } finally {
    process.env = saved;
  }
});

test("the public Eve CLI reads real synthetic segments with pagination and sanitized detail", async (t) => {
  const directoryRoot = resolve(".cache");
  await mkdir(directoryRoot, { recursive: true });
  const root = await mkdtemp(join(directoryRoot, "openstockai-traces-"));
  t.after(async () => {
    assert(root.startsWith(join(directoryRoot, "openstockai-traces-")));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  await mkdir(join(root, "agent"));
  await writeFile(join(root, "agent/instructions.md"), "Synthetic trace reader test.");
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { eve: "0.71.2" } }));
  for (let i = 1; i <= 25; i++) {
    const id = i.toString(16).padStart(32, "0");
    const directory = join(root, ".eve/traces/v1", id, "segments");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${"1".repeat(16)}.otlp.json`),
      JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: id,
                    spanId: "1".repeat(16),
                    name: "agent.step",
                    startTimeUnixNano: String(BigInt(1_000_000_000) * BigInt(i)),
                    endTimeUnixNano: String(
                      BigInt(1_000_000_000) * BigInt(i) + BigInt(100_000_000),
                    ),
                    attributes: [
                      {
                        key: "gen_ai.conversation.id",
                        value: { stringValue: `conversation-${i}` },
                      },
                      { key: "gen_ai.agent.name", value: { stringValue: "openstockai" } },
                      { key: "agent.usage.input_tokens", value: { intValue: 42 } },
                      { key: "ai.prompt", value: { stringValue: secret } },
                    ],
                    status: { code: 1 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    await writeFile(join(directory, "corrupt.otlp.json"), "not JSON");
  }
  const first = await readAgentTraces({ offset: 0 }, root);
  assert("items" in first);
  assert.equal(first.total, 25);
  assert.equal(first.items.length, 20);
  assert.equal(first.nextOffset, 20);
  assert.equal(first.items[0].conversationId, "conversation-25");
  const second = await readAgentTraces({ offset: 20 }, root);
  assert("items" in second);
  assert.equal(second.items.length, 5);
  assert.equal(second.nextOffset, null);
  const detail = await readAgentTraces({ offset: 0, traceId: first.items[0].traceId }, root);
  assert("spans" in detail);
  assert.equal(detail.inputTokens, 42);
  assert(!JSON.stringify([first, second, detail]).includes(secret));
  await assert.rejects(readAgentTraces({ offset: 0, traceId }, root), { status: 404 });
});

test("no traces yet is an empty page, and an unknown trace is still a 404", async (t) => {
  const directoryRoot = resolve(".cache");
  await mkdir(directoryRoot, { recursive: true });
  const root = await mkdtemp(join(directoryRoot, "openstockai-empty-traces-"));
  t.after(async () => {
    assert(root.startsWith(join(directoryRoot, "openstockai-empty-traces-")));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  await mkdir(join(root, "agent"));
  await writeFile(join(root, "agent/instructions.md"), "Synthetic empty trace test.");
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { eve: "0.71.2" } }));
  const empty = { items: [], total: 0, nextOffset: null, pricesConfigured: false };
  // The real CLI with no .eve/traces directory at all.
  assert.deepEqual(await readAgentTraces({ offset: 0 }, root), empty);
  await assert.rejects(readAgentTraces({ offset: 0, traceId }, root), { status: 404 });

  // A CLI that reports "No local traces found" instead of an empty JSON array.
  const stub = join(root, "stub-cli.mjs");
  await writeFile(
    stub,
    'console.error("No local traces found under .eve/traces/v1."); process.exit(1);',
  );
  const saved = process.env.EVE_CLI_PATH;
  process.env.EVE_CLI_PATH = stub;
  t.after(() => {
    if (saved === undefined) delete process.env.EVE_CLI_PATH;
    else process.env.EVE_CLI_PATH = saved;
  });
  assert.deepEqual(await readAgentTraces({ offset: 0 }, root), empty);
  await assert.rejects(readAgentTraces({ offset: 0, traceId }, root), { status: 404 });
  // An unreadable CLI is still an unavailable service, not an empty list.
  process.env.EVE_CLI_PATH = join(root, "missing.mjs");
  await assert.rejects(readAgentTraces({ offset: 0 }, root), { status: 503 });
});
