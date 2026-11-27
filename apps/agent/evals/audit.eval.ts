import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { headers, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "Questions about recent changes read the audit log.",
  async test(t) {
    const started = Date.now();
    const turn = await t.send("What changes were made to my inventory recently, and by whom?", {
      headers: headers(t),
    });
    turn.calledTool("getAuditLog");
    t.noFailedActions();
    t.succeeded();
    await report(t, turn.sessionId, started);
  },
});
