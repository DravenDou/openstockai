import test, { beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type {
  ToolContext,
  ToolDefinition,
  WorkflowToolContext,
  WorkflowExecuteToolDefinition,
} from "eve/tools";
import { z } from "zod";
import { actionID, principal } from "../agent/lib/api";
import { catalogCache } from "../agent/lib/catalog-cache";
import { toolSelection, availableTools, enableToolGroups } from "../agent/lib/tool-selection";
import { product, adjustment } from "../agent/lib/schemas";
import createProduct from "../agent/tools/createProduct";
import config from "../agent/agent";
import { emptySessionView } from "eve/events";
import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import clearHook, { writeTools } from "../agent/hooks/clear-catalog-cache";
import {
  selectModel,
  SESSION_INPUT_TOKENS,
  SESSION_OUTPUT_TOKENS,
  sessionBudgetReached,
} from "../agent/lib/model-selection";

const DYNAMIC = Symbol.for("eve.dynamic");
import getInventory from "../agent/tools/getInventory";
import getInventorySummary from "../agent/tools/getInventorySummary";
import getWarehouses from "../agent/tools/getWarehouses";
import getMeasurementUnits from "../agent/tools/getMeasurementUnits";
import getStockMovements from "../agent/tools/getStockMovements";
import searchProducts from "../agent/tools/searchProducts";
import searchCategories from "../agent/tools/searchCategories";
import searchSuppliers from "../agent/tools/searchSuppliers";
import selectTools from "../agent/tools/selectTools";
import type { Schemas } from "@openstockai/api-client/client";

const userId = "550e8400-e29b-41d4-a716-446655440000",
  warehouseId = "550e8400-e29b-41d4-a716-446655440001",
  sessionId = "550e8400-e29b-41d4-a716-446655440002";
const auth = {
  authenticator: "openstockai:better-auth",
  principalType: "user",
  principalId: userId,
  attributes: { sessionId },
};
const ctx = {
  session: { id: "conversation", turn: { id: "turn_0" }, auth: { current: auth, initiator: auth } },
  callId: "call_1",
  toolName: "createProduct",
  abortSignal: new AbortController().signal,
  messages: [],
  getSandbox: () => {
    throw new Error("Sandbox forbidden");
  },
  getToken: () => {
    throw new Error("Use Better Auth");
  },
  requireAuth: () => {
    throw new Error("Auth required");
  },
  agents: {},
  agent: () => {
    throw new Error("Subagents forbidden");
  },
  ask: () => {
    throw new Error("Use the registered Go approval");
  },
} as unknown as ToolContext & WorkflowToolContext;

beforeEach((t) => {
  if (!("mock" in t)) return;
  let state: ReturnType<typeof catalogCache.get> = { scope: "", entries: {} };
  t.mock.method(catalogCache, "get", () => state);
  t.mock.method(catalogCache, "update", (update: (value: typeof state) => typeof state) => {
    state = update(state);
  });
  let selection: ReturnType<typeof toolSelection.get> = { scope: "", groups: [] };
  t.mock.method(toolSelection, "get", () => selection);
  t.mock.method(
    toolSelection,
    "update",
    (update: (value: typeof selection) => typeof selection) => {
      selection = update(selection);
    },
  );
});

test("tools have no SQL or foreign-scope input; identity and retry keys are pinned", () => {
  assert.equal(config.defaultTools, false);
  assert.deepEqual(principal(ctx.session), { userId, sessionId });
  const input = { name: "Coca-Cola 2L", sku: "CC-2L", costPrice: "10.10", salePrice: "14.99" };
  // Negative test: a removed multi-tenant field must be rejected by the strict schema.
  assert.equal(product.safeParse({ ...input, organization_id: "foreign" }).success, false);
  assert.equal(product.safeParse({ ...input, costPrice: 10.1 }).success, false);
  assert.equal(
    adjustment.safeParse({
      productId: userId,
      warehouseId: warehouseId,
      quantity: 1,
      type: "executeSQL",
    }).success,
    false,
  );
  assert.equal(
    adjustment.safeParse({
      productId: userId,
      warehouseId: warehouseId,
      quantity: -1.5,
      type: "sale",
    }).success,
    true,
  );
  assert.equal(
    adjustment.safeParse({
      productId: userId,
      warehouseId: warehouseId,
      quantity: 0.0001,
      type: "purchase",
    }).success,
    false,
  );
  assert.equal(actionID(ctx), actionID(ctx));
  assert.notEqual(actionID(ctx), actionID({ ...ctx, callId: "call_2" }));
  assert.throws(() =>
    principal({
      ...ctx.session,
      auth: {
        ...ctx.session.auth,
        current: { ...auth, principalId: sessionId },
      },
    }),
  );
});

function mockAPI(t: TestContext) {
  const keys = [
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "API_BASE_URL",
    "AGENT_SERVICE_SECRET",
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    DATABASE_URL: "postgres://test:test@localhost/test",
    BETTER_AUTH_URL: "http://test.invalid",
    BETTER_AUTH_SECRET: "b".repeat(32),
    API_BASE_URL: "http://test.invalid",
    AGENT_SERVICE_SECRET: "s".repeat(32),
  });
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  const calls: { url: URL; method: string; body: Record<string, unknown> }[] = [];
  const state = {
    forbidden: false,
    failWrite: false,
    stock: 1.5,
    products: [] as Schemas["Product"][],
  };
  const lookups = Array.from({ length: 45 }, (_, index) => ({ id: userId, name: `Name ${index}` }));
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = options.method || "GET";
      const body = options.body
        ? (JSON.parse(String(options.body)) as Record<string, unknown>)
        : {};
      calls.push({ url, method, body });
      const reply = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url.pathname === "/api/internal/agent-token") return reply({ token: "verified-token" });
      const headers = new Headers(options.headers);
      assert.equal(headers.get("Authorization"), "Bearer verified-token");
      assert.equal(headers.get("X-Agent-Secret"), "s".repeat(32));
      // Negative test: no multi-tenant header is ever sent.
      assert.equal(headers.get("X-Organization-ID"), null);
      if (state.forbidden)
        return reply({ error: { code: "FORBIDDEN", message: "Permission denied." } }, 403);
      if (url.pathname === "/v1/agent-actions")
        return reply({ id: body.id, approvalStatus: "not_required" });
      if (url.pathname.startsWith("/v1/agent-actions/") && method === "PATCH") {
        assert(
          Buffer.byteLength(JSON.stringify(body.result)) <= 65536,
          "Go rejects audit results larger than 64 KiB",
        );
        return reply({ ok: true });
      }
      if (url.pathname === "/v1/products" && method === "POST")
        return state.failWrite
          ? reply({ error: { code: "FORBIDDEN", message: "Write denied." } }, 403)
          : reply({ id: userId });
      if (url.pathname === "/v1/products")
        return reply({ items: state.products, total: state.products.length });
      if (url.pathname === "/v1/inventory")
        return reply([{ product_id: userId, warehouse_id: warehouseId, quantity: state.stock }]);
      if (url.pathname === "/v1/inventory/summary")
        return reply({ products: 20, low: 3, empty: 1, stock_value: "120.30" });
      if (url.pathname === "/v1/warehouses")
        return reply([{ id: warehouseId, name: "Main warehouse" }]);
      if (url.pathname === "/v1/units")
        return reply([{ code: "kg", name: "Kilogram", symbol: "kg", decimals: 3, active: true }]);
      if (url.pathname === "/v1/stock-movements") return reply([]);
      if (url.pathname === "/v1/identity")
        return reply({
          name: "Test",
          email: "test@example.test",
          user_id: userId,
        });
      if (url.pathname === "/v1/categories" || url.pathname === "/v1/suppliers") {
        const offset = Number(url.searchParams.get("offset"));
        return reply(lookups.slice(offset, offset + Number(url.searchParams.get("limit"))));
      }
      throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
    },
  );
  return { calls, state };
}

function nextCall(base: ToolContext = ctx): ToolContext & WorkflowToolContext {
  return { ...ctx, ...base, callId: crypto.randomUUID() };
}

function schema<I>(tool: Pick<ToolDefinition<I>, "inputSchema">): z.ZodType<I> {
  assert(tool.inputSchema instanceof z.ZodType);
  return tool.inputSchema as z.ZodType<I>;
}

async function execute<I, O extends { ok: boolean }>(
  tool: ToolDefinition<I, O> | WorkflowExecuteToolDefinition<I, O>,
  input: unknown,
  context = nextCall(),
) {
  const result = await tool.execute(schema(tool).parse(input), context);
  assert("ok" in result, "HTTP inventory tools return a single structured result");
  return result;
}

test("inventory reads use one JWT, four HTTP requests, filters and live stock", async (t) => {
  const { calls, state } = mockAPI(t);
  const input = { product: userId, warehouse: warehouseId };
  const first = await execute(getInventory, input);
  assert(first.ok);
  assert.equal(first.data.items[0].quantity, 1.5);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((call) => call.url.pathname === "/api/internal/agent-token").length, 1);
  assert(!calls.some((call) => call.url.pathname === "/v1/warehouses"));
  const request = calls.find((call) => call.url.pathname === "/v1/inventory");
  assert(request);
  assert.equal(request.url.searchParams.get("product"), userId);
  assert.equal(request.url.searchParams.get("warehouse"), warehouseId);
  state.stock = 2.75;
  const second = await execute(getInventory, input);
  assert(second.ok);
  assert.equal(second.data.items[0].quantity, 2.75);
  assert.equal(calls.filter((call) => call.url.pathname === "/v1/inventory").length, 2);
});

test("global inventory totals use Go's exact aggregate in one read and reject contradictory filters", async (t) => {
  const { calls } = mockAPI(t);
  const result = await execute(getInventorySummary, {});
  assert(result.ok);
  assert.deepEqual(result.data, { products: 20, low: 3, empty: 1, stock_value: "120.30" });
  assert.equal(calls.filter((c) => c.url.pathname === "/v1/inventory/summary").length, 1);
  assert(!calls.some((c) => c.url.pathname === "/v1/inventory"));
  assert.equal(schema(getInventorySummary).safeParse({ warehouse: warehouseId }).success, false);
});

test("tool selection expands during a real search, scopes identity/turn and never sends routing hints to Go", async (t) => {
  const { calls } = mockAPI(t);
  const initial = availableTools(ctx.session, "turn_0")!;
  assert(initial.includes("selectTools"));
  assert(!initial.includes("adjustStock"));
  assert(!initial.includes("createProduct"));
  assert((await execute(searchProducts, { query: "Arroz", nextAction: "stock" })).ok);
  assert(!calls.find((c) => c.url.pathname === "/v1/products")!.url.searchParams.has("nextAction"));
  assert(availableTools(ctx.session, "turn_0")!.includes("adjustStock"));
  enableToolGroups(ctx.session, ["catalog"]);
  assert(availableTools(ctx.session, "turn_0")!.includes("createProduct"));
  assert.deepEqual(availableTools(ctx.session, "turn_1"), initial);
  const other = { ...auth, attributes: { ...auth.attributes, sessionId: crypto.randomUUID() } };
  assert.deepEqual(
    availableTools({ ...ctx.session, auth: { current: other, initiator: other } }, "turn_0"),
    initial,
  );
  t.mock.property(process, "env", { ...process.env, AI_TOOL_SELECTION: "all" });
  assert.equal(availableTools(ctx.session, "turn_0"), undefined);
});

test("large product results stay successful, audited and compact for the model", async (t) => {
  t.mock.property(process, "env", { ...process.env, AI_TOOL_RESULT_FORMAT: "json" });
  const { calls, state } = mockAPI(t);
  state.products = Array.from({ length: 20 }, (_, i) => ({
    id: userId,
    name: `Arroz ${i}`,
    sku: `SKU-${i}`,
    barcode: "",
    description: "á".repeat(4000),
    location: "",
    icon: "package",
    minimum: 0,
    category_id: null,
    category: "",
    cost_price: "1.00",
    sale_price: "2.00",
    stock: 1.5,
    unit_code: "kg",
    unit_symbol: "kg",
    unit_name: "Kilogram",
    unit_decimals: 3,
  }));
  const result = await execute(searchProducts, { query: "Arroz" });
  assert(result.ok);
  assert.equal(result.data.items.length, 20);
  assert.equal(result.data.total, 20);
  assert.equal(result.data.hasMore, false);
  assert.equal(result.data.items[0].stock, 1.5);
  assert.equal(result.data.items[0].description, state.products[0].description);
  assert(searchProducts.toModelOutput);
  const projection = await searchProducts.toModelOutput(result);
  assert(projection.type === "json");
  assert(!JSON.stringify(projection.value).includes(state.products[0].description));
  assert(
    Buffer.byteLength(JSON.stringify(projection.value)) <
      Buffer.byteLength(JSON.stringify(state.products)) / 10,
  );
  const audit = calls.find((call) => call.method === "PATCH");
  assert(audit);
  assert.equal(audit.body.status, "completed");
  const summary = audit.body.result as { summarized: boolean; sha256: string; itemCount: number };
  assert.equal(summary.summarized, true);
  assert.equal(summary.itemCount, 20);
  assert.match(summary.sha256, /^[a-f0-9]{64}$/);
});

test("explicit tool preparation supports compound tasks and cannot bypass revoked access", async (t) => {
  const { state } = mockAPI(t);
  assert.equal(schema(selectTools).safeParse({ groups: ["executeSQL"] }).success, false);
  state.forbidden = true;
  await assert.rejects(execute(selectTools, { groups: ["catalog", "stock"] }), {
    code: "FORBIDDEN",
  });
  assert(!availableTools(ctx.session, "turn_0")!.includes("createProduct"));
  state.forbidden = false;
  const result = await execute(selectTools, { groups: ["catalog", "stock"] });
  assert(result.ok);
  assert(availableTools(ctx.session, "turn_0")!.includes("createProduct"));
  assert(availableTools(ctx.session, "turn_0")!.includes("adjustStock"));
  for (const session of [
    { ...ctx.session, id: "another-conversation" },
    {
      ...ctx.session,
      auth: {
        current: { ...auth, principalId: sessionId },
        initiator: { ...auth, principalId: sessionId },
      },
    },
    {
      ...ctx.session,
      auth: {
        current: { ...auth, attributes: { ...auth.attributes, sessionId: warehouseId } },
        initiator: { ...auth, attributes: { ...auth.attributes, sessionId: warehouseId } },
      },
    },
  ])
    assert(!availableTools(session, "turn_0")!.includes("adjustStock"));
});

test("catalog cache skips only the domain GET; auth and audit still run, refresh bypasses it", async (t) => {
  const { calls, state } = mockAPI(t);
  const input = {};
  assert((await execute(getWarehouses, input)).ok);
  assert((await execute(getWarehouses, input)).ok);
  assert.equal(calls.length, 7);
  assert.equal(calls.filter((call) => call.url.pathname === "/v1/warehouses").length, 1);
  assert.equal(calls.filter((call) => call.url.pathname === "/v1/agent-actions").length, 2);
  assert(
    calls.some(
      (call) =>
        call.method === "PATCH" &&
        (call.body.result as { source?: string }).source === "turn-cache",
    ),
  );
  assert((await execute(getWarehouses, { ...input, refresh: true })).ok);
  assert.equal(calls.filter((call) => call.url.pathname === "/v1/warehouses").length, 2);
  state.forbidden = true;
  await assert.rejects(execute(getWarehouses, input), { code: "FORBIDDEN" });
  assert.equal(calls.filter((call) => call.url.pathname === "/v1/warehouses").length, 2);
});

test("catalog cache is isolated by user, auth session and turn, and expires", async (t) => {
  const { calls } = mockAPI(t);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const input = {};
  const run = (context: ToolContext) => execute(getMeasurementUnits, input, nextCall(context));
  assert((await run(ctx)).ok);
  assert((await run(ctx)).ok);
  for (const field of ["sessionId"] as const) {
    const identity = { ...auth, attributes: { ...auth.attributes, [field]: crypto.randomUUID() } };
    assert(
      (
        await run({
          ...ctx,
          session: { ...ctx.session, auth: { current: identity, initiator: identity } },
        })
      ).ok,
    );
  }
  const identity = { ...auth, principalId: crypto.randomUUID() };
  assert(
    (
      await run({
        ...ctx,
        session: { ...ctx.session, auth: { current: identity, initiator: identity } },
      })
    ).ok,
  );
  assert(
    (
      await run({
        ...ctx,
        session: { ...ctx.session, turn: { ...ctx.session.turn, id: "turn_1" } },
      })
    ).ok,
  );
  assert((await run(ctx)).ok);
  now += 15_001;
  assert((await run(ctx)).ok);
  assert.equal(calls.filter((call) => call.url.pathname === "/v1/units").length, 6);
});

test("writes leave the catalog cache to the call.settled hook", async (t) => {
  const { calls, state } = mockAPI(t);
  const input = {};
  const productInput = product.parse({
    name: "Arroz",
    sku: "AR",
    costPrice: "1.00",
    salePrice: "2.00",
  });
  // Writes run in a workflow step where defineState is unavailable: they must not touch it.
  assert((await execute(getMeasurementUnits, input)).ok);
  const cached = catalogCache.get();
  t.mock.method(catalogCache, "update", () => {
    throw new Error("defineState() is unavailable inside a 'use step' function");
  });
  assert((await execute(createProduct, productInput)).ok);
  state.failWrite = true;
  assert.equal((await execute(createProduct, productInput)).ok, false);
  assert.equal(catalogCache.get(), cached);
  assert((await execute(getMeasurementUnits, input)).ok);
  assert.equal(calls.filter((call) => call.url.pathname === "/v1/units").length, 1);
  t.mock.restoreAll();
  // The hook knows every tool that writes: the ones whose files use the write() step helper.
  const writers = (await readdir(new URL("../agent/tools/", import.meta.url)))
    .filter((file) => file.endsWith(".ts"))
    .filter((file) =>
      readFileSync(new URL(`../agent/tools/${file}`, import.meta.url), "utf8").includes(
        "lib/write",
      ),
    )
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
  assert.deepEqual([...writeTools].sort(), writers);
  assert(typeof clearHook.events?.["call.settled"] === "function");
});

test("filters go to Go, lookups paginate beyond their first page and schemas stay strict", async (t) => {
  const { calls } = mockAPI(t);
  const movement = {
    product: userId,
    warehouse: warehouseId,
    kind: "sale",
    since: "2026-10-05T00:00:00-04:00",
  };
  assert((await execute(getStockMovements, movement)).ok);
  const request = calls.find((call) => call.url.pathname === "/v1/stock-movements");
  assert(request);
  for (const field of ["product", "warehouse", "kind", "since"] as const)
    assert.equal(request.url.searchParams.get(field), movement[field]);
  assert.equal(request.url.searchParams.get("limit"), "20");
  for (const tool of [searchCategories, searchSuppliers]) {
    const first = await execute(tool, {});
    assert(first.ok);
    assert.equal(first.data.hasMore, true);
    assert.equal(first.data.nextOffset, 20);
    const last = await execute(tool, { offset: 40 });
    assert(last.ok);
    assert.equal(last.data.items.length, 5);
    assert.equal(last.data.hasMore, false);
    assert.equal(last.data.nextOffset, null);
  }
  assert.equal(schema(searchProducts).safeParse({ limit: 51 }).success, false);
  // Negative test: a removed multi-tenant field must be rejected by the strict schema.
  assert.equal(schema(getInventory).safeParse({ organization_id: warehouseId }).success, false);
  assert.equal(schema(getStockMovements).safeParse({ since: "yesterday" }).success, false);
});

test("the session budget counts new input only, not prompt-cache reads", () => {
  const w = (inputTokens: number, cacheReadTokens: number, outputTokens = 0) => ({
    inputTokens,
    cacheReadTokens,
    outputTokens,
  });
  assert.equal(sessionBudgetReached(w(900_000, 800_000)), false);
  assert.equal(sessionBudgetReached(w(900_000, 700_000)), true);
  assert.equal(sessionBudgetReached(w(SESSION_INPUT_TOKENS - 1, 0)), false);
  assert.equal(sessionBudgetReached(w(SESSION_INPUT_TOKENS, 0)), true);
  assert.equal(sessionBudgetReached(w(0, 0, SESSION_OUTPUT_TOKENS - 1)), false);
  assert.equal(sessionBudgetReached(w(0, 0, SESSION_OUTPUT_TOKENS)), true);
});

test("Eve resolves the configured provider with explicit budgets", async (t) => {
  t.mock.property(process, "env", {
    ...process.env,
    LLM_PROVIDER: "openai-compatible",
    LLM_BASE_URL: "https://llm.example.test/v1",
    LLM_API_KEY: "test-key",
    LLM_MODEL: "test-model",
  });
  const limit = config.limits?.sessionUsage;
  assert(typeof limit === "function");
  const usage = (inputTokens: number, outputTokens: number) => ({
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(limit({ total: usage(0, 0), window: usage(199_999, 9_999) }), false);
  assert.equal(limit({ total: usage(0, 0), window: usage(SESSION_INPUT_TOKENS, 0) }), true);
  assert.equal(limit({ total: usage(0, 0), window: usage(0, SESSION_OUTPUT_TOKENS) }), true);
  assert(config.model && typeof config.model === "object" && DYNAMIC in config.model);
  const frame = { session: ctx.session, turn: { id: "test-turn" }, view: emptySessionView() };
  const selection = selectModel(frame as never);
  assert(typeof selection.model !== "string");
  assert.equal(selection.model.modelId, "test-model");
  assert.equal(selection.model.provider, "openai-compatible.chat");
  assert.equal(selection.modelContextWindowTokens, 65536);
  assert.throws(() => selectModel(frame as never, 32), { code: "AI_STEP_LIMIT" });
  assert.throws(() => selectModel({ ...frame, turn: null } as never), {
    code: "AI_TURN_REQUIRED",
  });
});

test("tool calls Go with scoped JWT, stops at approval, never invents success", async () => {
  const calls: { path: string; body: Record<string, unknown>; key: string | undefined }[] = [];
  let pending = false;
  let denied = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({
      path: req.url || "",
      body,
      key: req.headers["idempotency-key"] as string | undefined,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/internal/agent-token") {
      assert.equal(req.headers["x-agent-secret"], "s".repeat(32));
      res.end(JSON.stringify({ token: "verified-token" }));
      return;
    }
    assert.equal(req.headers.authorization, "Bearer verified-token");
    // Negative test: no multi-tenant header is ever sent.
    assert.equal(req.headers["x-organization-id"], undefined);
    if (req.url === "/v1/agent-actions") {
      res.end(
        JSON.stringify({ id: body.id, approvalStatus: pending ? "pending" : "not_required" }),
      );
      return;
    }
    if (req.url === "/v1/products") {
      if (denied) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: { code: "FORBIDDEN", message: "Permission denied." } }));
        return;
      }
      res.end(JSON.stringify({ id: userId }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const keys = [
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "API_BASE_URL",
    "AGENT_SERVICE_SECRET",
  ] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    DATABASE_URL: "postgres://test:test@localhost/test",
    BETTER_AUTH_URL: base,
    BETTER_AUTH_SECRET: "b".repeat(32),
    API_BASE_URL: base,
    AGENT_SERVICE_SECRET: "s".repeat(32),
  });
  try {
    const input = product.parse({
      name: "Coca-Cola 2L",
      sku: "CC-2L",
      costPrice: "10.10",
      salePrice: "14.99",
    });
    const result = await createProduct.execute(input, ctx);
    assert("ok" in result);
    assert.equal(result.ok, true);
    assert.equal(calls.find((c) => c.path === "/v1/products")?.key, actionID(ctx));
    assert(!JSON.stringify(result).includes("verified-token"));
    pending = true;
    calls.length = 0;
    const waiting = await createProduct.execute(input, { ...ctx, callId: "large" });
    assert("ok" in waiting);
    assert.equal(waiting.ok, false);
    assert.equal("approvalRequired" in waiting && waiting.approvalRequired, true);
    assert(!calls.some((c) => c.path === "/v1/products"));
    pending = false;
    denied = true;
    const failure = await createProduct.execute(input, { ...ctx, callId: "denied" });
    assert("ok" in failure);
    assert.equal(failure.ok, false);
    assert.equal("error" in failure && failure.error?.code, "FORBIDDEN");
    assert(
      calls.some((c) => c.path.startsWith("/v1/agent-actions/") && c.body.status === "failed"),
    );
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
