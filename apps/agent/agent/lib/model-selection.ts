import { runs } from "eve/events";
import type { DynamicModelContext } from "eve/tools";
import { APIError } from "@openstockai/api-client/client";
import { llmModel, inputTokenLimit, stepLimit } from "@openstockai/server/ai/model";
import { principal } from "./api";
import { availableTools } from "./tool-selection";

export const SESSION_INPUT_TOKENS = 200_000;
export const SESSION_OUTPUT_TOKENS = 10_000;

// Eve's `window.inputTokens` includes prompt-cache reads, which are about 90% of the input in a
// long chat, so only new input counts against the session budget.
export function sessionBudgetReached(window: {
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}) {
  return (
    window.inputTokens - window.cacheReadTokens >= SESSION_INPUT_TOKENS ||
    window.outputTokens >= SESSION_OUTPUT_TOKENS
  );
}

// Eve runs the dynamic model function before every ordinary model call, so the step budget
// is the number of model runs the current turn has already settled.
export function selectModel(
  ctx: Pick<DynamicModelContext, "session" | "turn" | "view">,
  completedSteps?: number,
) {
  principal(ctx.session);
  const turnId = ctx.turn?.id;
  if (!turnId)
    throw new APIError("AI_TURN_REQUIRED", "A turn is required to select the model.", 422);
  const steps =
    completedSteps ?? runs(ctx.view, { turnId }).filter((run) => run.status === "settled").length;
  if (steps >= stepLimit())
    throw new APIError(
      "AI_STEP_LIMIT",
      "Step limit reached. Check Agent runs: some operations may have completed. Do not repeat writes without checking their result.",
      422,
    );
  return {
    model: llmModel({ allowedToolNames: availableTools(ctx.session, turnId) }),
    modelContextWindowTokens: inputTokenLimit(),
  };
}
