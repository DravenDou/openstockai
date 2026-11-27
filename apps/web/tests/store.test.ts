import assert from "node:assert/strict";
import { test } from "node:test";
import { clearInventory, inventoryActions } from "../src/shared/state/store";
import { stockCost, euro, setCurrency } from "../src/shared/state/inventory";

test("a committed stock change succeeds even if refreshing the view fails", async (t) => {
  clearInventory();
  const writes: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") {
      writes.push(init);
      return Response.json({ id: crypto.randomUUID() });
    }
    throw new Error("Read unavailable after commit");
  });
  await assert.doesNotReject(inventoryActions.movement("product", 2, "Stock in", undefined, "warehouse"));
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(String(writes[0].body)).quantity, 2);
});

test("failed writes still reject and do not trigger a refresh", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls.push(String(init.method));
    return Response.json({ error: { code: "INSUFFICIENT_STOCK", message: "Insufficient stock" } }, { status: 409 });
  });
  await assert.rejects(inventoryActions.movement("product", -2, "Sale", undefined, "warehouse"), /Insufficient stock/);
  assert.deepEqual(calls, ["POST"]);
});

test("clearing a category sends an explicit empty category ID", async (t) => {
  let body: unknown;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "PATCH") {
      body = JSON.parse(String(init.body));
      return Response.json({ id: crypto.randomUUID() });
    }
    throw new Error("Read unavailable after commit");
  });
  await inventoryActions.editProduct("product", { category: "" });
  assert.deepEqual(body, { categoryId: "",categoryName:"" });
});

test("stock cost uses exact decimal arithmetic and money formatting follows the currency", () => {
  assert.equal(stockCost("3", "10.10"), "30.30");
  assert.equal(stockCost("3", "9999999999999999.99"), "29999999999999999.97");
  setCurrency("BOB");
  assert(euro("10.10").includes("10.10"));
});
