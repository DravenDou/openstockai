import { z } from "zod";
import { defineAgent, defineDynamic } from "eve";
import { principal } from "./lib/api";
import { llmModel, inputTokenLimit, stepLimit } from "@openstockai/server/ai/model";
import { APIError } from "@openstockai/api-client/client";
import { availableTools } from "./lib/tool-selection";

export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": (event, ctx) => {
        principal(ctx.session);
        const turn = z
          .object({
            data: z.object({
              turnId: z.string().max(200),
              stepIndex: z.number().int().nonnegative().optional(),
            }),
          })
          .parse(event).data;
        if ((turn.stepIndex ?? 0) >= stepLimit())
          throw new APIError(
            "AI_STEP_LIMIT",
            "Step limit reached. Check Agent runs: some operations may have completed. Do not repeat writes without checking their result.",
            422,
          );
        return {
          model: llmModel({
            allowedToolNames: availableTools(ctx.session, turn.turnId),
          }),
          modelContextWindowTokens: inputTokenLimit(),
        };
      },
    },
  }),
  compaction: { thresholdPercent: 0.75 },
  limits: { maxInputTokensPerSession: 200_000, maxOutputTokensPerSession: 10_000 },
  defaultTools: false,
});
