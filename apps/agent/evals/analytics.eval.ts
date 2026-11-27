import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { headers, report } from "./fixtures";
export default [
  { tool: "getStockValuation", text: "How much is my inventory worth right now, by category?" },
  {
    tool: "getProductTurnover",
    text: "Which products are slow movers that I should stop restocking?",
  },
  {
    tool: "getSupplierSpend",
    text: "How much have I spent with each supplier in the last 90 days?",
  },
].map(({ tool, text }) =>
  defineEval<typeof config>({
    description: `An analytics question is routed to ${tool}.`,
    async test(t) {
      const started = Date.now();
      const turn = await t.send(text, { headers: headers(t) });
      turn.calledTool(tool);
      t.noFailedActions();
      t.maxToolCalls(8);
      t.succeeded();
      await report(t, turn.sessionId, started);
    },
  }),
);
