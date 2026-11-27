import assert from "node:assert/strict";
import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { backend, headers, prompt, report } from "./fixtures";
export default [true, false].map((approve) =>
  defineEval<typeof config>({
    description: `Payload de ajuste exacto: ${approve ? "aprobar" : "rechazar"}`,
    async test(t) {
      const started = Date.now(),
        id = t.context.products.find((row) => row.sku === "MAT-COCA")!.id;
      const before = await backend(t, `products/${id}`);
      const first = await t.send(
        prompt(
          t,
          "adjust",
          "Agrega exactamente 1500 unidades de MAT-COCA en Central con referencia MAT-APPROVAL y tipo adjustment_in. Espera mi aprobación.",
        ),
        { headers: headers(t) },
      );
      const input = first.session.requireInputRequest();
      assert.equal((input.action.input as { quantity: number }).quantity, 1500);
      const option = input.options?.find((option) =>
        approve ? option.id === "approve" : option.id !== "approve",
      );
      assert(option, "An explicit approval/rejection option is required.");
      await first.session.respond([{ requestId: input.requestId, optionId: option.id }]);
      const after = await backend(t, `products/${id}`);
      assert.equal(after.stock, before.stock + (approve ? 1500 : 0));
      t.succeeded();
      await report(t, first.sessionId, started);
    },
  }),
);
