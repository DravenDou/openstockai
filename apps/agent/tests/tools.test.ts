import test, { beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolContext, WorkflowToolContext } from "eve/tools";
import { z } from "zod";
import { catalogCache } from "../agent/lib/catalog-cache";
import { coreTools, toolGroupNames, toolGroups } from "../agent/lib/tool-selection";
import { lookupName, purchase, settingsPatch, stockCount, unit } from "@openstockai/schemas";
import { mergeSettings } from "../agent/lib/settings";
import { exportLink } from "../agent/lib/export";
import archiveProduct from "../agent/tools/archiveProduct";
import countStock from "../agent/tools/countStock";
import deleteCategory from "../agent/tools/deleteCategory";
import deleteSupplier from "../agent/tools/deleteSupplier";
import deleteWarehouse from "../agent/tools/deleteWarehouse";
import exportProductsCsv from "../agent/tools/exportProductsCsv";
import getAuditLog from "../agent/tools/getAuditLog";
import getProductBySku from "../agent/tools/getProductBySku";
import listPurchases from "../agent/tools/listPurchases";
import recordPurchase from "../agent/tools/recordPurchase";
import restoreProduct from "../agent/tools/restoreProduct";
import updateCategory from "../agent/tools/updateCategory";
import updateSettings from "../agent/tools/updateSettings";
import updateSupplier from "../agent/tools/updateSupplier";
import type { Schemas } from "@openstockai/api-client/client";

const userId = "550e8400-e29b-41d4-a716-446655440000",
  warehouseId = "550e8400-e29b-41d4-a716-446655440001",
  sessionId = "550e8400-e29b-41d4-a716-446655440002",
  targetId = "550e8400-e29b-41d4-a716-446655440003";
const auth = {
  authenticator: "openstockai:better-auth",
  principalType: "user",
  principalId: userId,
  attributes: { sessionId },
};
const ctx = {
  session: { id: "conversation", turn: { id: "turn_0" }, auth: { current: auth, initiator: auth } },
  callId: "call_1",
  toolName: "test",
  abortSignal: new AbortController().signal,
  messages: [],
} as unknown as ToolContext & WorkflowToolContext;

beforeEach((t) => {
  if (!("mock" in t)) return;
  let state: ReturnType<typeof catalogCache.get> = { scope: "", entries: {} };
  t.mock.method(catalogCache, "get", () => state);
  t.mock.method(catalogCache, "update", (update: (value: typeof state) => typeof state) => {
    state = update(state);
  });
});

function mockAPI(
  t: TestContext,
  options: { approval?: string; settings?: Schemas["Settings"] } = {},
) {
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
  const calls: {
    url: URL;
    method: string;
    body: Record<string, unknown>;
    key: string | null;
  }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method || "GET";
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, method, body, key: new Headers(init.headers).get("Idempotency-Key") });
      const reply = (value: unknown) =>
        new Response(JSON.stringify(value), {
          headers: { "Content-Type": "application/json" },
        });
      if (url.pathname === "/api/internal/agent-token") return reply({ token: "verified-token" });
      if (url.pathname === "/v1/agent-actions")
        return reply({
          id: body.id,
          approvalStatus: options.approval ?? "not_required",
          ownerApprovalRequired: false,
        });
      if (url.pathname.startsWith("/v1/agent-actions/")) return reply({ ok: true });
      if (url.pathname === "/v1/settings" && method === "GET") return reply(options.settings);
      if (url.pathname === "/v1/settings") return reply(body);
      if (url.pathname === "/v1/products" && method === "GET")
        return reply({ items: [], total: 42 });
      if (url.pathname === "/v1/audit-page")
        return reply({
          items: [
            {
              id: userId,
              user_id: userId,
              actor_type: "ai",
              user_name: "Owner",
              action: "POST /v1/products",
              resource_type: "products",
              resource_id: targetId,
              before: { secret: "x".repeat(500) },
              after: { big: "y".repeat(500) },
              metadata: {},
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
          next: null,
        });
      if (method === "PATCH" && url.pathname.startsWith("/v1/suppliers/"))
        return reply({ id: targetId, name: String(body.name) });
      if (url.pathname === "/v1/purchases-page") return reply({ items: [], next: null });
      return reply({ ok: true });
    },
  );
  return calls;
}

const settings: Schemas["Settings"] = {
  store: "Hardware Co",
  email: "owner@example.test",
  currency: "USD",
  timezone: "UTC",
  automatic: true,
  lowStock: true,
  voice: false,
};
function approvalOf(tool: { approval?: unknown }) {
  const policy = tool.approval;
  assert(policy && typeof policy === "object" && "request" in policy);
  return policy as { request(context: unknown): Promise<unknown> };
}
function parse<T>(tool: { inputSchema: unknown }, input: unknown) {
  return (tool.inputSchema as z.ZodType<T>).safeParse(input);
}

test("every tool file belongs to exactly one place in the selection tables", () => {
  const files = readdirSync(resolve("agent/tools"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
  const listed = [...coreTools, ...Object.values(toolGroups).flat()];
  assert.equal(new Set(listed).size, listed.length, "no tool is listed twice");
  assert.deepEqual([...listed].sort(), files);
  assert.deepEqual(toolGroups.analytics, [
    "getStockValuation",
    "getProductTurnover",
    "getSupplierSpend",
  ]);
  assert.ok(toolGroupNames.includes("purchases") && toolGroupNames.includes("settings"));
});

test("new write schemas are strict and validated", () => {
  const line = { productId: targetId, quantity: 5, costPrice: "9.50" };
  const valid = { warehouseId, reference: "Purchase order 42", items: [line] };
  assert.equal(purchase.safeParse(valid).success, true);
  assert.equal(purchase.safeParse({ ...valid, items: [] }).success, false);
  assert.equal(purchase.safeParse({ ...valid, reference: " " }).success, false);
  assert.equal(
    purchase.safeParse({ ...valid, items: [{ ...line, costPrice: 9.5 }] }).success,
    false,
    "money is a decimal string",
  );
  assert.equal(purchase.safeParse({ ...valid, items: [{ ...line, quantity: -1 }] }).success, false);
  assert.equal(purchase.safeParse({ ...valid, userId }).success, false);
  assert.equal(
    stockCount.parse({ productId: targetId, warehouseId, counted: 3, expected: 4 }).reference,
    "Stock count",
  );
  assert.equal(
    stockCount.safeParse({ productId: targetId, warehouseId, counted: -1, expected: 4 }).success,
    false,
  );
  assert.equal(
    unit.safeParse({ code: "Kg", name: "Kilogram", symbol: "kg", decimals: 3 }).success,
    false,
  );
  assert.equal(
    unit.parse({ code: "kg", name: "Kilogram", symbol: "kg", decimals: 3 }).active,
    true,
  );
  assert.equal(settingsPatch.safeParse({}).success, false);
  assert.equal(settingsPatch.safeParse({ currency: "JPY" }).success, false);
  assert.equal(settingsPatch.safeParse({ automatic: false }).success, true);
  assert.equal(settingsPatch.safeParse({ voice: true }).success, false);
  assert.equal(lookupName.safeParse("   ").success, false);
});

test("settings merge keeps every field Go requires", () => {
  const merged = mergeSettings(settings, { automatic: false, store: "New name" });
  assert.deepEqual(merged, { ...settings, automatic: false, store: "New name" });
  assert.deepEqual(mergeSettings(settings, {}), settings);
});

test("destructive tools take only an ID and send an empty body", async (t) => {
  for (const tool of [
    deleteCategory,
    deleteSupplier,
    deleteWarehouse,
    archiveProduct,
    restoreProduct,
  ]) {
    assert.equal(parse(tool, { id: targetId }).success, true);
    assert.equal(parse(tool, { id: targetId, force: true }).success, false);
    assert.match(tool.description ?? "", /ALWAYS requires/);
  }
  const calls = mockAPI(t, { approval: "pending" });
  const cases = [
    [deleteCategory, "DELETE /v1/categories/"],
    [deleteSupplier, "DELETE /v1/suppliers/"],
    [deleteWarehouse, "DELETE /v1/warehouses/"],
    [archiveProduct, "DELETE /v1/products/"],
    [restoreProduct, "POST /v1/products/"],
  ] as const;
  for (const [tool, operation] of cases) {
    calls.length = 0;
    const decision = await approvalOf(tool).request({
      ...ctx,
      toolInput: { id: targetId },
      approvedTools: new Set(),
    } as never);
    assert.equal(decision, "user-approval");
    const registered = calls.find((c) => c.url.pathname === "/v1/agent-actions");
    assert(registered);
    assert.ok(String(registered.body.operation).startsWith(operation));
    assert.deepEqual(registered.body.toolInput, {});
  }
});

test("a delete executes as DELETE on the real route with an idempotency key", async (t) => {
  const calls = mockAPI(t);
  // Writes run in a workflow step, where Eve 1 makes defineState get()/update() throw. A write
  // that touched the state after the API call would fail although Go had already applied it.
  const unavailable = () => {
    throw new Error("defineState() is unavailable inside a 'use step' function");
  };
  t.mock.method(catalogCache, "get", unavailable);
  t.mock.method(catalogCache, "update", unavailable);
  const result = await deleteSupplier.execute({ id: targetId }, ctx);
  assert("ok" in result && result.ok);
  const sent = calls.find((c) => c.method === "DELETE");
  assert(sent);
  assert.equal(sent.url.pathname, `/v1/suppliers/${targetId}`);
  assert.ok(sent.key);
  assert.equal(
    calls.find((c) => c.url.pathname === "/v1/agent-actions")?.body.operation,
    `DELETE /v1/suppliers/${targetId}`,
  );
});

test("update tools register the body without the ID", async (t) => {
  const calls = mockAPI(t);
  const result = await updateSupplier.execute(
    { id: targetId, name: "Acme Ltd", email: "sales@acme.test" },
    ctx,
  );
  assert("ok" in result && result.ok);
  const sent = calls.find(
    (c) => c.method === "PATCH" && c.url.pathname.startsWith("/v1/suppliers"),
  );
  assert.deepEqual(sent?.body, { name: "Acme Ltd", email: "sales@acme.test" });
  assert.equal(parse(updateCategory, { id: targetId, name: "" }).success, false);
  assert.equal(
    parse(updateCategory, { id: targetId, name: "Tools", email: "x@y.z" }).success,
    false,
  );
});

test("recordPurchase posts the receipt through the approval flow", async (t) => {
  const calls = mockAPI(t, { approval: "pending" });
  const input = purchase.parse({
    warehouseId,
    reference: "Purchase order 42",
    items: [{ productId: targetId, quantity: 5, costPrice: "9.50" }],
  });
  const waiting = await recordPurchase.execute(input, ctx);
  assert("ok" in waiting && !waiting.ok && "approvalRequired" in waiting);
  assert(!calls.some((c) => c.url.pathname === "/v1/purchases"));
  assert.equal(
    calls.find((c) => c.url.pathname === "/v1/agent-actions")?.body.operation,
    "POST /v1/purchases",
  );
});

test("countStock is registered as a write", async (t) => {
  const calls = mockAPI(t, { approval: "pending" });
  const result = await countStock.execute(
    stockCount.parse({ productId: targetId, warehouseId, counted: 8, expected: 10 }),
    ctx,
  );
  assert("ok" in result && !result.ok);
  assert.equal(
    calls.find((c) => c.url.pathname === "/v1/agent-actions")?.body.operation,
    "POST /v1/inventory/counts",
  );
});

test("updateSettings registers and sends the merged document", async (t) => {
  const calls = mockAPI(t, { approval: "pending", settings });
  const decision = await approvalOf(updateSettings).request({
    ...ctx,
    toolInput: { automatic: false },
    approvedTools: new Set(),
  } as never);
  assert.equal(decision, "user-approval");
  const registered = calls.find((c) => c.url.pathname === "/v1/agent-actions");
  assert.deepEqual(registered?.body.toolInput, { ...settings, automatic: false });
  assert.equal(registered?.body.operation, "PATCH /v1/settings");
  calls.length = 0;
  const approved = mockAPI(t, { settings });
  const result = await updateSettings.execute({ automatic: false, currency: "EUR" }, ctx);
  assert("ok" in result && result.ok);
  assert.equal(approved.length > 0, true);
  const sent = approved.find((c) => c.method === "PATCH" && c.url.pathname === "/v1/settings");
  assert.deepEqual(sent?.body, { ...settings, automatic: false, currency: "EUR" });
});

test("exportProductsCsv returns a clickable link and never the file", async (t) => {
  const calls = mockAPI(t);
  const result = await exportProductsCsv.execute(
    { query: "bolt", stock: "low", status: "active" },
    ctx,
  );
  assert("ok" in result && result.ok);
  assert.equal(result.data.matchingProducts, 42);
  assert.equal(result.data.url, "/api/exports/products?query=bolt&stock=low&status=active");
  assert.equal(result.data.format, "csv");
  assert(calls.some((c) => c.url.pathname === "/v1/products"));
  assert.equal(exportLink({}), "/api/exports/products");
  assert.equal(exportLink({ query: "a&b" }), "/api/exports/products?query=a%26b");
});

test("audit log results are compact metadata", async (t) => {
  mockAPI(t);
  const result = await getAuditLog.execute({ query: "", limit: 20, actor: "ai" } as never, ctx);
  assert("ok" in result && result.ok);
  const [row] = result.data.items;
  assert.equal(row.action, "POST /v1/products");
  assert.equal("before" in row, false);
  assert.equal("after" in row, false);
  assert.equal(result.data.hasMore, false);
  assert.equal(parse(getAuditLog, { actor: "root" }).success, false);
});

test("purchase history and SKU lookup use their dedicated routes", async (t) => {
  const calls = mockAPI(t);
  const history = await listPurchases.execute({ query: "inv", limit: 10 } as never, ctx);
  assert("ok" in history && history.ok);
  assert.equal(
    calls.find((c) => c.url.pathname === "/v1/purchases-page")?.url.searchParams.get("query"),
    "inv",
  );
  await getProductBySku.execute({ sku: "CC-2L" }, ctx);
  assert.equal(
    calls.find((c) => c.url.pathname === "/v1/products/by-sku")?.url.searchParams.get("sku"),
    "CC-2L",
  );
});
