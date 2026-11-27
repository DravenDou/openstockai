import assert from "node:assert/strict";
import { test } from "node:test";
import { decode } from "@toon-format/toon";
import { modelPage } from "../agent/lib/model-output";

test("TOON model projections round-trip IDs, decimal strings, fractions and pagination without mutating the UI result", () => {
  const output = {
    ok: true,
    data: {
      items: Array.from({ length: 8 }, (_, i) => ({
        id: `550e8400-e29b-41d4-a716-44665544000${i}`,
        name: `Rice, \"extra\"\nline ${i}`,
        sku: `00${i}`,
        cost_price: "1234567890123456.99",
        quantity: 0.125,
        unit_code: "kg",
        category_id: null,
      })),
      total: 16,
      hasMore: true,
      nextOffset: 8,
    },
  };
  const before = structuredClone(output);
  const projection = modelPage(output);
  assert.equal(projection.type, "text");
  assert.deepEqual(decode(String(projection.value).split("\n").slice(1).join("\n")), output);
  assert.deepEqual(output, before);
  assert(Buffer.byteLength(String(projection.value)) < Buffer.byteLength(JSON.stringify(output)));
});

test("errors, approvals, short/irregular pages and JSON mode preserve structured results", (t) => {
  for (const value of [
    { ok: false, error: { code: "FORBIDDEN" } },
    { ok: false, approvalRequired: true },
    { ok: true, data: { items: [{ quantity: 1.5 }], hasMore: false, nextOffset: null } },
    { ok: true, data: { items: [{ a: 1 }, { b: 2 }, { a: 3 }, { nested: { x: 1 } }] } },
  ])
    assert.deepEqual(modelPage(value), { type: "json", value });
  t.mock.property(process, "env", { ...process.env, AI_TOOL_RESULT_FORMAT: "json" });
  const value = {
    ok: true,
    data: { items: Array.from({ length: 20 }, (_, id) => ({ id, name: "Product" })) },
  };
  assert.deepEqual(modelPage(value), { type: "json", value });
});
