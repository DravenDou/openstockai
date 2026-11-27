import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { headers, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "Product search and low-stock reads are answered from the API.",
  async test(t) {
    const started = Date.now();
    const turn = await t.send("Find EVAL-COLA and tell me which products are low on stock.", {
      headers: headers(t),
    });
    turn.calledTool("searchProducts");
    turn.calledTool("getLowStockProducts");
    turn.messageIncludes(/bolt/i);
    t.maxToolCalls(8);
    t.noFailedActions();
    t.succeeded();
    await report(t, turn.sessionId, started);
  },
});
