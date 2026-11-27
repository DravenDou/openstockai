import assert from "node:assert/strict";
import test from "node:test";
import otel from "../agent/instrumentation/otel";
import agentRuns from "../agent/instrumentation/agent-runs";

test("OpenTelemetry never captures user content, including public and development sessions", () => {
  for (const audience of ["public", "private", "unknown"] as const) {
    for (const environment of ["development", "preview", "production"] as const) {
      assert.deepEqual(
        otel.options.tracePolicy?.({
          agentName: "openstockai",
          channel: { kind: "http", name: "eve" },
          audience,
          environment,
          principalType: "user",
        }),
        { emit: true, recordInputs: false, recordOutputs: false },
      );
    }
  }
});

test("Agent Runs exports trace metadata and usage without content or exception details", async (t) => {
  const requestContext = Symbol.for("@vercel/request-context");
  const previous = Object.getOwnPropertyDescriptor(globalThis, requestContext);
  const reports: unknown[] = [];
  Object.defineProperty(globalThis, requestContext, {
    configurable: true,
    value: {
      get: () => ({ telemetry: { reportSpans: (report: unknown) => reports.push(report) } }),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, requestContext, previous);
    else Reflect.deleteProperty(globalThis, requestContext);
  });

  const secret = "private-inventory-content";
  const attributes = {
    "gen_ai.conversation.id": "conversation-test",
    "agent.run.id": "session-test",
    "gen_ai.request.model": "test-model",
    "gen_ai.tool.name": "getInventory",
    "gen_ai.usage.input_tokens": 42,
    "gen_ai.usage.output_tokens": 12,
    "agent.trace.content.input": true,
    "agent.trace.content.output": true,
    "agent.session.title": secret,
    "agent.channel.delivery.input": secret,
    "agent.approval.request": secret,
    "agent.approval.response": secret,
    "gen_ai.input.messages": secret,
    "gen_ai.output.messages": secret,
    "gen_ai.system_instructions": secret,
    "gen_ai.tool.call.arguments": secret,
    "gen_ai.tool.call.result": secret,
    "ai.prompt": secret,
    "ai.prompt.tools": secret,
    "ai.response.text": secret,
    "ai.response.reasoning": secret,
    "ai.toolCall.args": secret,
    "ai.toolCall.result": secret,
  };
  const span = {
    name: "chat test-model",
    kind: 0,
    spanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }),
    startTime: [1, 0],
    endTime: [1, 100_000_000],
    duration: [0, 100_000_000],
    status: { code: 2, message: secret },
    attributes,
    events: [
      { name: "exception", time: [1, 0], attributes: { "exception.message": secret } },
      { name: "tool.completed", time: [1, 0], attributes: { result: secret } },
    ],
    links: [],
    resource: { attributes: { "service.name": "openstockai" } },
    instrumentationScope: { name: "agent-runs-test" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };

  for (const processor of agentRuns.spanProcessors) {
    assert(typeof processor !== "string");
    processor.onEnd(span);
    await processor.forceFlush();
  }

  assert.equal(reports.length, 1);
  const exported = JSON.stringify(reports[0]);
  assert(!exported.includes(secret));
  for (const metadata of ["conversation-test", "session-test", "test-model", "getInventory"]) {
    assert(exported.includes(metadata));
  }
  assert(exported.includes('"intValue":42'));
  assert(exported.includes('"intValue":12'));
  assert(exported.includes('"agent.trace.content.input","value":{"boolValue":false}'));
  assert(exported.includes('"agent.trace.content.output","value":{"boolValue":false}'));
  assert.equal(span.attributes["ai.prompt"], secret);
  assert.equal(span.status.message, secret);
});

test("Agent Runs is harmless outside the Vercel request transport", () => {
  assert.equal(Reflect.get(globalThis, Symbol.for("@vercel/request-context")), undefined);
  for (const processor of agentRuns.spanProcessors) {
    assert(typeof processor !== "string");
    assert.doesNotThrow(() =>
      processor.onEnd({
        spanContext: () => ({ traceFlags: 1 }),
        attributes: {},
      }),
    );
  }
});
