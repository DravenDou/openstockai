import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { headers, prompt, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "Producto y almacén ambiguos requieren aclaración sin modificar stock.",
  async test(t) {
    const started = Date.now();
    const turn = await t.send(
      prompt(
        t,
        "ambiguous",
        "Agrega 10 Agua Fixture al almacén Norte. Hay variantes y almacenes de nombres similares: aclara cuáles, no adivines.",
      ),
      { headers: headers(t) },
    );
    turn.calledTool("searchProducts");
    t.notCalledTool("adjustStock");
    t.notCalledTool("createProduct");
    t.notCalledTool("transferStock");
    turn.messageIncludes("?");
    t.succeeded();
    await report(t, turn.sessionId, started);
  },
});
