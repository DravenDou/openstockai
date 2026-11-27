import assert from "node:assert/strict";
import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { backend, headers, named, report, sku } from "./fixtures";
export default defineEval<typeof config>({
  description: "A delivery is recorded as a purchase receipt that raises stock.",
  async test(t) {
    const started = Date.now(),
      bolt = sku(t, "EVAL-BOLT").id;
    const before = await backend(t, `products/${bolt}`);
    const turn = await t.send(
      "Record a purchase with reference EVAL-INV-1001: 12 units of EVAL-BOLT at 0.15 each into Central from Acme Supply.",
      { headers: headers(t) },
    );
    turn.calledTool("recordPurchase");
    t.noFailedActions();
    t.succeeded();
    const page = await backend(t, "purchases-page?query=EVAL-INV-1001");
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].warehouse, named(t.context.warehouses, "Central").name);
    assert.equal(page.items[0].total, "1.80");
    const after = await backend(t, `products/${bolt}`);
    assert.equal(after.stock, before.stock + 12);
    await report(t, turn.sessionId, started);
  },
});
