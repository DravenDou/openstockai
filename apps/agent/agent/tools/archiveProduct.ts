import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "DESTRUCTIVE: archive a product so it leaves the active catalog (its history is kept and it can be restored). ALWAYS requires explicit user approval, even when auto-approval is on. Confirm the exact product with the user before calling.",
  inputSchema: z.object({ id: z.uuid() }).strict(),
  approval: approval(
    (input) => `DELETE /v1/products/${input.id}`,
    () => ({}),
  ),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/products/{id}", "delete", undefined, { id: input.id });
  },
});
