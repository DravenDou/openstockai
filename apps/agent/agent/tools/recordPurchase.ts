import { defineWorkflowTool } from "eve/tools";
import { purchase } from "../lib/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Record a purchase receipt: adds stock to one warehouse for every line in a single transaction, at the given unit cost. Lines need real product IDs (search first; create missing products before recording). Needs approval unless auto-approval is on.",
  inputSchema: purchase,
  approval: approval(() => "POST /v1/purchases"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/purchases", "post", input);
  },
});
