import { defineInstrumentation } from "eve/instrumentation";
export default defineInstrumentation({
  tracePolicy: () => ({ emit: true, recordInputs: false, recordOutputs: false }),
  events: {
    "action.started": (event, ctx) => {
      ctx.state.set({ name: event.name, startedAt: Date.now() });
    },
    "action.completed": (event, ctx) => {
      const state = ctx.state.get() as { name: string; startedAt: number } | undefined;
      if (state)
        console.info(
          JSON.stringify({
            event: "agent_action",
            eventId: event.idempotencyKey,
            conversationId: event.scope.sessionId,
            turnId: event.scope.turnId,
            attemptId: event.scope.attemptId,
            action: state.name,
            durationMs: Date.now() - state.startedAt,
            outcome: event.outcome,
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
          attemptId: event.scope.attemptId,
          model: event.model,
        }),
      );
    },
    "model.call.completed": (event, ctx) => {
      const state = ctx.state.get() as { startedAt: number } | undefined;
      console.info(
        JSON.stringify({
          event: "model_completed",
          eventId: event.idempotencyKey,
          conversationId: event.scope.sessionId,
          turnId: event.scope.turnId,
          attemptId: event.scope.attemptId,
          durationMs: state ? Date.now() - state.startedAt : undefined,
          usage: event.usage,
          cachedInputTokens: event.usage.inputTokenDetails?.cacheReadTokens,
          cacheWriteTokens: event.usage.inputTokenDetails?.cacheWriteTokens,
        }),
      );
    },
    "model.call.failed": (event) => {
      console.info(
        JSON.stringify({
          event: "model_failed",
          eventId: event.idempotencyKey,
          conversationId: event.scope.sessionId,
          turnId: event.scope.turnId,
          attemptId: event.scope.attemptId,
        }),
      );
    },
    "action.failed": (event) => {
      console.info(
        JSON.stringify({
          event: "agent_action_failed",
          eventId: event.idempotencyKey,
          conversationId: event.scope.sessionId,
          turnId: event.scope.turnId,
          attemptId: event.scope.attemptId,
          outcome: event.outcome,
          errorCode: event.errorCode,
        }),
      );
    },
  },
});
