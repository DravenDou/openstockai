import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { headers, prompt, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "Búsqueda y stock bajo confirmados mediante Go en datos sintéticos.",
  async test(t) {
    const started = Date.now();
    const turn = await t.send(
      prompt(
        t,
        "stock",
        "Busca MAT-COCA y consulta qué productos tienen poco stock en mi organización.",
      ),
      { headers: headers(t) },
    );
    turn.calledTool("searchProducts");
    turn.calledTool("getLowStockProducts");
    t.maxToolCalls(8);
    t.noFailedActions();
    t.succeeded();
    await report(t, turn.sessionId, started);
  },
});
