import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { lookupName, withoutId } from "../lib/schemas";
import { write } from "../lib/write";

export default defineWorkflowTool({
  description:
    "Rename a supplier, optional contact email (empty string clears it). Needs a real supplier ID from the search tools. Needs approval unless auto-approval is on.",
  inputSchema: z
    .object({
      id: z.uuid(),
      name: lookupName,
      email: z.union([z.literal(""), z.email().max(254)]).optional(),
    })
    .strict(),
  approval: approval((input) => `PATCH /v1/suppliers/${input.id}`, withoutId),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/suppliers/{id}", "patch", withoutId(input), {
      id: input.id,
    });
  },
});
