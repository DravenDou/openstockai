import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { lookupName } from "../lib/schemas";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description: "Create a warehouse (stock location). Search warehouses first to avoid duplicates.",
  inputSchema: z.object({ name: lookupName }).strict(),
  approval: approval(() => "POST /v1/warehouses"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/warehouses", "post", input);
  },
});
