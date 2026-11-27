import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { backend, headers, prompt, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "Creación completa y stock inicial confirmados por Go.",
  async test(t) {
    const sku = `MAT-EVAL-${randomUUID()}`,
      started = Date.now();
    const turn = await t.send(
      prompt(
        t,
        "create",
        `Crea Producto Fixture, SKU ${sku}, unidad pcs, coste 10.00 y venta 14.00, con 7 unidades iniciales en Central. No hace falta categoría.`,
        { sku },
      ),
      { headers: headers(t) },
    );
    turn.calledTool("createProduct");
    t.noFailedActions();
    t.succeeded();
    const stored = await backend(t, `products/by-sku?sku=${encodeURIComponent(sku)}`);
    assert.equal(stored.sku, sku);
    assert.equal(stored.stock, 7);
    assert.equal(stored.sale_price, "14.00");
    await report(t, turn.sessionId, started);
  },
});
