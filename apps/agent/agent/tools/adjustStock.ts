import { defineWorkflowTool } from "eve/tools";
import { adjustment } from "../lib/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Record a stock entry or exit as one transaction. Quantity is positive for entries and negative for exits. Large quantities always need human approval.",
  inputSchema: adjustment,
  approval: approval(() => "POST /v1/inventory/adjustments"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/inventory/adjustments", "post", input);
  },
});
