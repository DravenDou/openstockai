import assert from "node:assert/strict";
import { defineEval } from "eve/evals";
import type config from "./evals.config";
import { baseSettings } from "./seed";
import { backend, headers, report } from "./fixtures";
export default defineEval<typeof config>({
  description: "Settings are changed with a merged update that keeps the other fields.",
  async test(t) {
    const started = Date.now();
    try {
      const turn = await t.send(
        "Change my store name to Eval Hardware Store and the currency to EUR.",
        {
          headers: headers(t),
        },
      );
      turn.calledTool("updateSettings");
      t.noFailedCalls();
      t.succeeded();
      const after = await backend(t, "settings");
      assert.equal(after.store, "Eval Hardware Store");
      assert.equal(after.currency, "EUR");
      assert.equal(after.timezone, baseSettings.timezone, "Untouched fields are preserved.");
      assert.equal(after.automatic, true);
      await report(t, turn.sessionId, started);
    } finally {
      // The fixture guard identifies the stack by its store name: always restore it.
      await backend(t, "settings", "PATCH", baseSettings);
    }
  },
});
