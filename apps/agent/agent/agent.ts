import { defineAgent, defineDynamic } from "eve";
import { selectModel, sessionBudgetReached } from "./lib/model-selection";

export default defineAgent({
  // Eve 1 runs this function before every ordinary model call (it replaced the step.started event).
  model: defineDynamic((ctx) => selectModel(ctx)),
  compaction: { threshold: 0.75 },
  // Eve 1 pauses the turn with a budget prompt (continue or stop) when this returns true.
  limits: {
    sessionUsage: ({ window }) => sessionBudgetReached(window),
  },
  defaultTools: false,
});
