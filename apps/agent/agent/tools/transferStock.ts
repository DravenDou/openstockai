import { defineWorkflowTool } from "eve/tools";
import { transfer } from "@openstockai/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Transfer stock between two warehouses in a single transaction (both movements are confirmed together).",
  inputSchema: transfer,
  approval: approval(() => "POST /v1/inventory/transfers"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/inventory/transfers", "post", input);
  },
});
