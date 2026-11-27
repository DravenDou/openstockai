import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { headers, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "An ambiguous product and warehouse lead to a clarifying question, not a guess.",
  async test(t) {
    const started = Date.now();
    const turn = await t.send("Add 10 bottles of Water 500ml to the North warehouse.", {
      headers: headers(t),
    });
    turn.calledTool("searchProducts");
    for (const tool of [
      "adjustStock",
      "recordPurchase",
      "createProduct",
      "transferStock",
      "countStock",
    ])
      t.notCalledTool(tool);
    turn.messageIncludes("?");
    t.succeeded();
    await report(t, turn.sessionId, started);
  },
});
