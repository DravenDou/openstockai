import assert from "node:assert/strict";
import { test } from "node:test";
import { chatError, chatSessionKey, savedChatSession } from "../src/features/assistant/lib/session";
import { turnFailures, toolPresentation } from "../src/features/assistant/lib/chat";
import {
  conversationReducer,
  EveAgentStore,
  type EveDynamicToolPart,
  type MessageStreamEvent,
} from "eve/client";

test("a failed turn remains visible when Eve waits for the next free-form message", () => {
  const meta = { id: "error-event", at: "2026-10-12T20:00:00Z" };
  const failed: MessageStreamEvent = {
    type: "turn.failed",
    data: {
      code: "MODEL_CALL_FAILED",
      message: "The provider is rate limiting calls.",
      sequence: 1,
      turnId: "turn_0",
    },
    meta,
  };
  const waiting: MessageStreamEvent = {
    type: "session.waiting",
    data: { continuationToken: "session-test", wait: "next-user-message" },
    meta: { ...meta, id: "waiting-event" },
  };
  assert.equal(chatError([]), undefined);
  assert.equal(chatError([failed, waiting]), failed.data.message);
  for (const type of ["turn.started", "turn.completed", "turn.cancelled"] as const)
    assert.equal(
      chatError([
        failed,
        waiting,
        { type, data: { sequence: 2, turnId: "turn_1" }, meta: { ...meta, id: type } },
      ]),
      undefined,
    );
  const terminal: MessageStreamEvent = {
    type: "session.failed",
    data: { code: "FAILED", message: "No se pudo continuar.", sessionId: "session-test" },
    meta: { ...meta, id: "terminal-event" },
  };
  assert.equal(chatError([terminal]), terminal.data.message);
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

test("a durable turn failure stays visible when Eve returns ready without error, including replay", () => {
  const failed = {
    type: "turn.failed",
    data: {
      turnId: "turn_0",
      code: "MODEL_CALL_FAILED",
      message: "Your account cannot use the assistant right now.",
    },
    meta: { id: "failure", at: new Date().toISOString() },
  } as MessageStreamEvent;
  const events = [
    { type: "turn.started", data: { turnId: "turn_0" } },
    failed,
    { type: "session.waiting", data: {} },
  ] as MessageStreamEvent[];
  const store = new EveAgentStore({ reducer: conversationReducer, initialEvents: events });
  assert.equal(store.snapshot.error, undefined);
  assert.equal(store.snapshot.status, "ready");
  assert.equal(
    turnFailures(store.snapshot.events).get("turn_0")?.message,
    "Your account cannot use the assistant right now.",
  );
  assert.equal(turnFailures(events).get("turn_0")?.code, "MODEL_CALL_FAILED");
  assert.equal(turnFailures([]).size, 0);
  store.reset();
});

test("tool trace never labels a Go failure or pending approval as a completed write", () => {
  const part = {
    type: "dynamic-tool",
    toolName: "adjustStock",
    toolCallId: "call",
    state: "output-available",
    input: { quantity: 0.5 },
    output: { ok: false, error: { message: "Insufficient stock" } },
  } satisfies EveDynamicToolPart;
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
  assert.equal(
    toolPresentation({
      type: "dynamic-tool",
      toolName: "adjustStock",
      toolCallId: "call",
      state: "output-denied",
      input: { quantity: 0.5 },
      approval: { id: "approval", approved: false },
    }).state,
    "output-denied",
  );
});
