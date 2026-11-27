import assert from "node:assert/strict";
import test from "node:test";
import { traceMetadata } from "../agent/lib/traces";
import {
  actionIdFor,
  compactArgs,
  joinActions,
  operationLabel,
  runWindow,
  type RunAction,
} from "@openstockai/api-client/agent-runs";
import { enrichDetail, enrichList, configuredPrices } from "@openstockai/server/ai/runs";
import { runSummarySchema } from "@openstockai/api-client/agent-traces";

const conversationId = "conv-1";
let n = 0;
const span = (
  name: string,
  startMs: number,
  durationMs: number,
  attributes: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  spanId: (++n).toString(16).padStart(16, "0"),
  parentSpanId: null,
  name,
  durationMs,
  startTimeNs: String(BigInt(startMs) * BigInt(1_000_000) + BigInt(1_000_000_000)),
  statusCode: 1,
  attributes,
  ...extra,
});
const trace = (spans: ReturnType<typeof span>[]) => ({
  traceId: "b".repeat(32),
  agentName: "openstockai",
  conversationId,
  startedAt: "2026-10-16T12:00:00.000Z",
  durationMs: 500,
  spanCount: spans.length,
  spans,
});
const private_ = "private-inventory-payload";
const raw = trace([
  span("agent.step", 0, 200, {
    "agent.usage.input_tokens": 1000,
    "agent.usage.output_tokens": 100,
    "gen_ai.request.model": "test-model",
    "agent.step.index": 0,
  }),
  span("agent.step", 250, 200, {
    "agent.usage.input_tokens": 3000,
    "agent.usage.output_tokens": 300,
    "agent.step.index": 1,
  }),
  span("agent.action", 20, 30, {
    "agent.action.name": "searchProducts",
    "agent.action.call_id": "call-read",
    "agent.action.outcome": "completed",
    "agent.step.index": 0,
    "gen_ai.tool.call.arguments": private_,
  }),
  span("agent.action", 260, 10, {
    "agent.action.name": "createProduct",
    "agent.action.call_id": "call-write",
    "agent.action.outcome": "abandoned",
    "agent.step.index": 1,
  }),
  span("agent.action", 300, 10, {
    "agent.action.name": "deleteProduct",
    "agent.action.call_id": "call-del",
    "agent.action.outcome": "rejected",
    "agent.step.index": 1,
  }),
  span("agent.approval", 305, 5, {
    "agent.action.call_id": "call-del",
    "agent.action.name": "deleteProduct",
    "agent.approval.outcome": "denied",
  }),
]);

test("traceMetadata builds a status, model, step count and tool timeline without content", () => {
  const run = traceMetadata(raw);
  assert.equal(run.steps, 2);
  assert.equal(run.model, "test-model");
  assert.equal(run.toolCalls, 3);
  assert.equal(run.inputTokens, 4000);
  assert.equal(run.status, "awaiting_approval");
  assert.deepEqual(
    run.timeline.map((event) => [event.name, event.approval, event.outcome]),
    [
      ["searchProducts", null, "completed"],
      ["createProduct", "pending", "abandoned"],
      ["deleteProduct", "rejected", "rejected"],
    ],
  );
  assert.equal(run.timeline[0].stepIndex, 0);
  assert(!JSON.stringify(run).includes(private_));
});

test("failing spans make the run an error and expose only a safe error code", () => {
  const failing = trace([
    span("agent.step", 0, 100, { "agent.step.index": 0 }, { statusCode: 2 }),
    span(
      "chat test-model",
      10,
      50,
      { "error.type": "AI_PROVIDER_AUTH", "gen_ai.request.model": "m" },
      { statusCode: 2, parentSpanId: "0".repeat(15) + "1" },
    ),
    span(
      "agent.action",
      20,
      5,
      { "agent.action.name": "getInventory", "error.type": "bad type with spaces " + private_ },
      { statusCode: 2 },
    ),
  ]);
  failing.spans[0].spanId = "0".repeat(15) + "1";
  const run = traceMetadata(failing);
  assert.equal(run.status, "error");
  const codes = run.timeline.map((event) => [event.kind, event.errorCode]);
  assert.deepEqual(codes, [
    ["error", "AI_PROVIDER_AUTH"],
    ["tool", null],
  ]);
  assert(!JSON.stringify(run).includes(private_));
});

const action = (callId: string | null, over: Partial<RunAction> = {}): RunAction => ({
  id: callId ? actionIdFor(conversationId, callId) : "11111111-1111-4111-8111-111111111111",
  conversation_id: conversationId,
  tool_name: "POST /v1/products",
  tool_input: { name: "Hammer", sku: "H-1", apiKey: "sk-secret", token: "t" },
  status: "pending",
  approval_status: "pending",
  started_at: "2026-10-16T12:00:01.000Z",
  error: null,
  ...over,
});

test("action ids are deterministic UUIDs matching the agent derivation", () => {
  assert.match(
    actionIdFor("c", "k"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(actionIdFor("c", "k"), actionIdFor("c", "k"));
  assert.notEqual(actionIdFor("c", "k"), actionIdFor("c", "k2"));
});

test("compactArgs drops secret-looking keys and truncates", () => {
  const text = compactArgs({
    name: "Hammer",
    apiKey: "x",
    Authorization: "y",
    password: "z",
    qty: 3,
  });
  assert.equal(text, "name=Hammer, qty=3");
  assert.equal(
    compactArgs(Object.fromEntries("abcdefgh".split("").map((k) => [k, "x".repeat(30)])))!.length,
    140,
  );
  assert.equal(compactArgs({ items: [1, 2], nested: { a: 1 } }), "items=[2 items], nested={…}");
  assert.equal(compactArgs({ secret: "x" }), null);
});

test("operationLabel names operations", () => {
  assert.equal(operationLabel("PATCH /v1/products/abc"), "Update product");
  assert.equal(operationLabel("DELETE /v1/categories/abc"), "Delete category");
  assert.equal(operationLabel("DELETE /v1/products/abc"), "Archive product");
  assert.equal(operationLabel("DELETE /v1/suppliers/abc"), "Delete supplier");
  assert.equal(operationLabel("POST /v1/inventory/adjustments"), "Adjust stock");
  assert.equal(operationLabel("POST /v1/products/abc/restore"), "Restore product");
  assert.equal(operationLabel("GET /v1/low-stock"), "Read low stock");
});

test("joinActions matches by id, falls back to order, and appends API-only writes", () => {
  const run = traceMetadata(raw);
  const joined = joinActions(
    run.timeline,
    conversationId,
    [
      action("call-write"),
      action("call-del", {
        tool_name: "DELETE /v1/products/x",
        approval_status: "rejected",
        status: "failed",
        error: "Rejected by user.",
      }),
      action(null, { tool_name: "POST /v1/categories", approval_status: "pending" }),
      action(null, {
        id: "22222222-2222-4222-8222-222222222222",
        tool_name: "GET /v1/products",
        approval_status: "not_required",
      }),
      action("call-write", { conversation_id: "other" }),
    ],
    runWindow(run),
  );
  const write = joined.find((event) => event.callId === "call-write")!;
  assert.equal(write.args, "name=Hammer, sku=H-1");
  assert.equal(write.label, "Create product");
  assert.equal(write.approval, "pending");
  const del = joined.find((event) => event.callId === "call-del")!;
  assert.equal(del.approval, "rejected");
  assert.equal(del.errorMessage, "Rejected by user.");
  const extra = joined.filter((event) => event.source === "api");
  assert.equal(extra.length, 1);
  assert.equal(extra[0].label, "Create category");
  assert(!JSON.stringify(joined).includes("sk-secret"));

  const fallback = joinActions(
    run.timeline.slice(1, 2),
    conversationId,
    [action(null)],
    runWindow(run),
  );
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].label, "Create product");
});

test("cost and status enrichment use configured prices and pending actions", () => {
  const prices = configuredPrices({
    LLM_PRICE_INPUT_PER_MTOK: "1",
    LLM_PRICE_OUTPUT_PER_MTOK: "2",
  });
  assert.deepEqual(prices, { priceInputPerMTok: 1, priceOutputPerMTok: 2 });
  const run = traceMetadata(raw);
  const detail = enrichDetail(run, [], prices);
  assert(Math.abs(detail.costUsd! - 0.0048) < 1e-9);
  assert.equal(enrichDetail(run, [], configuredPrices({})).costUsd, null);
  const summary = runSummarySchema.parse({ ...run, status: "ok" });
  const [listed] = enrichList([summary], [action("x")], prices);
  assert.equal(listed.status, "awaiting_approval");
  assert.equal(
    enrichList([{ ...summary, status: "error" }], [action("x")], prices)[0].status,
    "error",
  );
});

test("each turn of a conversation only shows its own actions and status", () => {
  const prices = configuredPrices({});
  const turn = (traceId: string, startedAt: string, durationMs: number) => ({
    ...traceMetadata(raw),
    status: "ok" as const,
    traceId,
    startedAt,
    durationMs,
    timeline: [] as ReturnType<typeof traceMetadata>["timeline"],
  });
  const t1 = turn("a".repeat(32), "2026-10-16T18:03:22.000Z", 5000);
  const t2 = turn("b".repeat(32), "2026-10-16T18:03:29.000Z", 8700);
  const t3 = turn("c".repeat(32), "2026-10-16T18:03:42.000Z", 6000);
  const stock = action(null, {
    id: "33333333-3333-4333-8333-333333333333",
    tool_name: "POST /v1/inventory/adjustments",
    status: "completed",
    approval_status: "approved",
    started_at: "2026-10-16T18:03:32.000Z",
  });
  const archive = action(null, {
    id: "44444444-4444-4444-8444-444444444444",
    tool_name: "DELETE /v1/products/x",
    status: "pending",
    approval_status: "rejected",
    started_at: "2026-10-16T18:03:46.000Z",
  });
  const actions = [stock, archive];
  const labels = (t: typeof t1) =>
    enrichDetail(t, actions, prices).timeline.map((e) => [e.label, e.approval, e.outcome]);
  assert.deepEqual(labels(t1), []);
  assert.deepEqual(labels(t2), [["Adjust stock", "approved", "completed"]]);
  assert.deepEqual(labels(t3), [["Archive product", "rejected", "rejected"]]);
  for (const t of [t1, t2, t3]) assert.equal(enrichDetail(t, actions, prices).status, "ok");
  assert.deepEqual(
    enrichList(
      [t1, t2, t3].map((t) => runSummarySchema.parse({ ...t, status: "ok" })),
      actions,
      prices,
    ).map((r) => r.status),
    ["ok", "ok", "ok"],
  );
});

test("a pending approval inside the run window keeps that run awaiting approval", () => {
  const prices = configuredPrices({});
  const t = {
    ...traceMetadata(raw),
    status: "ok" as const,
    startedAt: "2026-10-16T18:04:00.000Z",
    durationMs: 3000,
    timeline: [],
  };
  const pending = action(null, { started_at: "2026-10-16T18:04:02.000Z" });
  const earlier = { ...t, startedAt: "2026-10-16T18:03:00.000Z" };
  assert.equal(enrichDetail(t, [pending], prices).status, "awaiting_approval");
  assert.equal(enrichDetail(t, [pending], prices).timeline.length, 1);
  assert.equal(enrichDetail(earlier, [pending], prices).status, "ok");
  assert.equal(enrichDetail(earlier, [pending], prices).timeline.length, 0);
});
