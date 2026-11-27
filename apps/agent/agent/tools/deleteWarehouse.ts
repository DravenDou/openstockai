import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "DESTRUCTIVE: permanently delete a warehouse. Go refuses while the warehouse still holds stock. ALWAYS requires explicit user approval, even when auto-approval is on. Confirm the target with the user before calling.",
  inputSchema: z.object({ id: z.uuid() }).strict(),
  approval: approval(
    (input) => `DELETE /v1/warehouses/${input.id}`,
    () => ({}),
  ),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/warehouses/{id}", "delete", undefined, { id: input.id });
  },
});
