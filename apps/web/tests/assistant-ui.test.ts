import assert from "node:assert/strict";
import { test } from "node:test";
import { chatError, chatSessionKey, savedChatSession } from "../src/features/assistant/lib/session";
import { turnFailures, toolPresentation } from "../src/features/assistant/lib/chat";
import type { EveToolPart, SessionStreamEvent } from "eve/client";

const event = (type: string, data: Record<string, unknown>, id = type) =>
  ({ type, data, meta: { id, at: "2026-10-12T20:00:00Z" } }) as unknown as SessionStreamEvent;
const failedTurn = (turnId: string, code: string, message: string) =>
  event("turn.settled", { turnId, outcome: "failed", error: { code, message } }, `failed-${turnId}`);

test("a failed turn remains visible until a later turn starts or settles", () => {
  const failed = failedTurn("turn_0", "MODEL_CALL_FAILED", "The provider is rate limiting calls.");
  assert.equal(chatError([]), undefined);
  assert.equal(chatError([failed]), "The provider is rate limiting calls.");
  assert.equal(chatError([failed, event("delivery.settled", {})]), "The provider is rate limiting calls.");
  for (const later of [
    event("turn.started", { turnId: "turn_1" }),
    event("turn.settled", { turnId: "turn_1", outcome: "completed" }),
    event("turn.settled", { turnId: "turn_1", outcome: "cancelled" }),
  ])
    assert.equal(chatError([failed, later]), undefined);
  const terminal = event("session.ended", {
    outcome: "failed",
    error: { code: "FAILED", message: "No se pudo continuar." },
  });
  assert.equal(chatError([terminal]), "No se pudo continuar.");
});

test("only a valid cursor is restored; the durable stream is replayed from zero", () => {
  assert.deepEqual(
    savedChatSession('{"sessionId":"wrun_test","streamIndex":123,"messages":["secret"]}'),
    { sessionId: "wrun_test", streamIndex: 0 },
  );
  for (const raw of [
    null,
    "bad JSON",
    '{"sessionId":"../another-user","streamIndex":0}',
    '{"sessionId":"wrun_test","streamIndex":-1}',
  ])
    assert.equal(savedChatSession(raw), undefined);
  const key = chatSessionKey("user", "auth-session");
  assert.notEqual(key, chatSessionKey("other-user", "auth-session"));
  assert.notEqual(key, chatSessionKey("user", "new-login"));
});

test("a durable turn failure stays visible, including on replay", () => {
  const events = [
    event("turn.started", { turnId: "turn_0" }),
    failedTurn("turn_0", "MODEL_CALL_FAILED", "Your account cannot use the assistant right now."),
    event("turn.settled", { turnId: "turn_1", outcome: "completed" }),
  ];
  assert.equal(
    turnFailures(events).get("turn_0")?.message,
    "Your account cannot use the assistant right now.",
  );
  assert.equal(turnFailures(events).get("turn_0")?.code, "MODEL_CALL_FAILED");
  assert.equal(turnFailures(events).has("turn_1"), false);
  assert.equal(turnFailures([]).size, 0);
});

test("tool trace never labels a Go failure or pending approval as a completed write", () => {
  const part = {
    type: "tool",
    name: "adjustStock",
    callId: "call",
    kind: "tool",
    label: "adjustStock",
    stepIndex: 0,
    state: "completed",
    input: { quantity: 0.5 },
    output: { ok: false, error: { message: "Insufficient stock" } },
  } satisfies EveToolPart;
  assert.deepEqual(toolPresentation(part), {
    state: "output-error",
    errorText: "Insufficient stock",
  });
  assert.equal(
    toolPresentation({ ...part, output: { ok: false, approvalRequired: true } }).state,
    "approval-requested",
  );
  assert.equal(
    toolPresentation({ ...part, output: { ok: true, data: { after: 5.5 } } }).state,
    "output-available",
  );
  assert.equal(toolPresentation({ ...part, state: "rejected", output: undefined }).state, "output-denied");
  assert.equal(toolPresentation({ ...part, state: "approval", output: undefined }).state, "approval-requested");
  assert.deepEqual(
    toolPresentation({
      ...part,
      state: "failed",
      output: undefined,
      error: { code: "TOOL_FAILED", message: "Go is down" },
    }),
    { state: "output-error", errorText: "Go is down" },
  );
});
