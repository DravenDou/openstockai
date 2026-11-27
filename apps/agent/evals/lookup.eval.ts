import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { headers, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "An exact SKU is looked up directly and the answer follows the user's language.",
  async test(t) {
    const started = Date.now();
    const turn = await t.send("¿Cuántas unidades tengo del producto con SKU EVAL-COLA?", {
      headers: headers(t),
    });
    turn.calledTool("getProductBySku", { input: { sku: "EVAL-COLA" } }).soft();
    turn.messageIncludes(/unidades|stock|tienes|tiene/i);
    t.noFailedActions();
    t.succeeded();
    await report(t, turn.sessionId, started);
  },
});
