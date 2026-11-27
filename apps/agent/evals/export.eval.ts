import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { headers, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "A CSV export request returns a download link instead of file contents.",
  async test(t) {
    const started = Date.now();
    const turn = await t.send("Export my low-stock products to a CSV file.", {
      headers: headers(t),
    });
    turn.calledTool("exportProductsCsv");
    turn.messageIncludes("/api/exports/products");
    t.noFailedCalls();
    t.succeeded();
    await report(t, turn.sessionId, started);
  },
});
