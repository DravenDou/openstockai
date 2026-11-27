import assert from "node:assert/strict";
import { test } from "node:test";
import { actorLabel } from "../src/shared/state/inventory";

test("actorLabel maps every actor type to a fixed label", () => {
  assert.equal(actorLabel("ai", { name: "Ana" }), "OpenStock AI");
  assert.equal(actorLabel("system", { name: "Ana" }), "System");
  assert.equal(actorLabel("mcp", { name: "Ana" }), "MCP client");
  assert.equal(actorLabel("human", { name: "Ana" }), "Ana");
});

test("actorLabel falls back to Owner when identity is missing", () => {
  assert.equal(actorLabel("human", null), "Owner");
  assert.equal(actorLabel("human", undefined), "Owner");
  assert.equal(actorLabel("human", { name: "  " }), "Owner");
  assert.equal(actorLabel(undefined, null), "Owner");
});
