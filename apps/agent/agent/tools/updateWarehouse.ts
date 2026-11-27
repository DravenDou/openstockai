import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { lookupName, withoutId } from "@openstockai/schemas";
import { write } from "../lib/write";

export default defineWorkflowTool({
  description:
    "Rename a warehouse. Needs a real warehouse ID from the search tools. Needs approval unless auto-approval is on.",
  inputSchema: z.object({ id: z.uuid(), name: lookupName }).strict(),
  approval: approval((input) => `PATCH /v1/warehouses/${input.id}`, withoutId),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/warehouses/{id}", "patch", withoutId(input), {
      id: input.id,
    });
  },
});
