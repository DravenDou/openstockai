import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { lookupName, withoutId } from "@openstockai/schemas";
import { write } from "../lib/write";

export default defineWorkflowTool({
  description:
    "Rename a category. Needs a real category ID from the search tools. Needs approval unless auto-approval is on.",
  inputSchema: z.object({ id: z.uuid(), name: lookupName }).strict(),
  approval: approval((input) => `PATCH /v1/categories/${input.id}`, withoutId),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/categories/{id}", "patch", withoutId(input), {
      id: input.id,
    });
  },
});
