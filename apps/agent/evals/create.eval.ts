import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { backend, headers, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "A complete product with initial stock is created and confirmed by the API.",
  async test(t) {
    const sku = `EVAL-NEW-${randomUUID()}`,
      started = Date.now();
    const turn = await t.send(
      `Create the product Fixture Widget, SKU ${sku}, unit pcs, cost 10.00 and sale price 14.00, with 7 units of initial stock in Central. No category needed.`,
      { headers: headers(t) },
    );
    turn.calledTool("createProduct");
    t.noFailedCalls();
    t.succeeded();
    const stored = await backend(t, `products/by-sku?sku=${encodeURIComponent(sku)}`);
    assert.equal(stored.sku, sku);
    assert.equal(stored.stock, 7);
    assert.equal(stored.sale_price, "14.00");
    await report(t, turn.sessionId, started);
  },
});
