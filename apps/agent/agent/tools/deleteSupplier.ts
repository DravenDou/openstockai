import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "DESTRUCTIVE: permanently delete a supplier. Existing purchases keep their history. ALWAYS requires explicit user approval, even when auto-approval is on. Confirm the target with the user before calling.",
  inputSchema: z.object({ id: z.uuid() }).strict(),
  approval: approval(
    (input) => `DELETE /v1/suppliers/${input.id}`,
    () => ({}),
  ),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/suppliers/{id}", "delete", undefined, { id: input.id });
  },
});
