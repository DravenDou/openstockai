import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAgentAction } from "../src/server/agent-approval";

const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("the agent relay approves only actions registered by the agent", async () => {
  await assertAgentAction("http://api", "t", "a", reply(200, { actorType: "ai" }));
  for (const f of [reply(200, { actorType: "mcp" }), reply(200, {}), reply(404, {})]) {
    await assert.rejects(assertAgentAction("http://api", "t", "a", f), { status: 403 });
  }
});
