import { defineInstrumentation } from "eve/instrumentation";

// Content-free structured logs. Eve 1 reports one final event per operation, so success and
// failure share call.settled / model.call.settled and are told apart by their outcome.
export default defineInstrumentation({
  tracePolicy: () => ({ emit: true, recordInputs: false, recordOutputs: false }),
  events: {
    "call.requested": (event, ctx) => {
      ctx.state.set({ name: event.toolName, startedAt: Date.now() });
    },
    "call.settled": (event, ctx) => {
      const state = ctx.state.get() as { name: string; startedAt: number } | undefined;
      const common = {
        eventId: event.idempotencyKey,
        conversationId: event.scope.sessionId,
        turnId: event.scope.turnId,
        runId: event.scope.runId,
        attempt: event.scope.attempt,
      };
      if (event.outcome === "completed") {
        if (state)
          console.info(
            JSON.stringify({
              event: "agent_action",
              ...common,
              action: state.name,
              durationMs: event.durationMs ?? Date.now() - state.startedAt,
              outcome: event.outcome,
            }),
          );
        return;
      }
      console.info(
        JSON.stringify({
          event: "agent_action_failed",
          ...common,
          action: state?.name,
          outcome: event.outcome,
          errorCode: event.errorCode,
        }),
      );
    },
    "model.call.started": (event, ctx) => {
      ctx.state.set({ startedAt: Date.now() });
      console.info(
        JSON.stringify({
          event: "model_started",
          eventId: event.idempotencyKey,
          conversationId: event.scope.sessionId,
          turnId: event.scope.turnId,
          runId: event.scope.runId,
          attempt: event.scope.attempt,
          model: event.model,
        }),
      );
    },
    "model.call.settled": (event, ctx) => {
      const common = {
        eventId: event.idempotencyKey,
        conversationId: event.scope.sessionId,
        turnId: event.scope.turnId,
        runId: event.scope.runId,
        attempt: event.scope.attempt,
      };
      if (event.outcome !== "completed") {
        console.info(JSON.stringify({ event: "model_failed", ...common }));
        return;
      }
      const state = ctx.state.get() as { startedAt: number } | undefined;
      console.info(
        JSON.stringify({
          event: "model_completed",
          ...common,
          durationMs: state ? Date.now() - state.startedAt : undefined,
          usage: event.usage,
          cachedInputTokens: event.usage.inputTokenDetails?.cacheReadTokens,
          cacheWriteTokens: event.usage.inputTokenDetails?.cacheWriteTokens,
        }),
      );
    },
  },
});
