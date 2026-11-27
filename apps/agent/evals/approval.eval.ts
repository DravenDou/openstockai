import assert from "node:assert/strict";
import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { backend, headers, report, sku } from "./fixtures";
export default [true, false].map((approve) =>
  defineEval<typeof config>({
    description: `A large adjustment sends the exact payload for approval: ${approve ? "approve" : "reject"}.`,
    async test(t) {
      const started = Date.now(),
        id = sku(t, "EVAL-COLA").id;
      const before = await backend(t, `products/${id}`);
      const first = await t.send(
        "Add exactly 1500 units of EVAL-COLA to Central with reference EVAL-APPROVAL as an adjustment_in. Wait for my approval.",
        { headers: headers(t) },
      );
      const input = first.session.requireInteraction({ toolName: "adjustStock" });
      assert.equal((input.call?.input as { quantity: number }).quantity, 1500);
      const option = input.request.options?.find((option) =>
        approve ? option.id === "approve" : option.id !== "approve",
      );
      assert(option, "An explicit approval/rejection option is required.");
      await first.session.respond([{ interactionId: input.interactionId, optionId: option.id }], {
        headers: headers(t),
      });
      const after = await backend(t, `products/${id}`);
      assert.equal(after.stock, before.stock + (approve ? 1500 : 0));
      t.succeeded();
      await report(t, first.sessionId, started);
    },
  }),
);
