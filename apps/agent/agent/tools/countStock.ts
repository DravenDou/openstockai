import { defineWorkflowTool } from "eve/tools";
import { approval } from "../lib/api";
import { stockCount } from "../lib/schemas";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Record a physical stock count for one product in one warehouse. expected must be the stock currently on record (read it with getInventory just before); counted is what was physically found. If expected no longer matches, the API rejects the count instead of overwriting newer movements. The difference is booked as a stock movement.",
  inputSchema: stockCount,
  approval: approval(() => "POST /v1/inventory/counts"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/inventory/counts", "post", input);
  },
});
