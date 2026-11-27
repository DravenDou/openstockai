import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Restore an archived product to the active catalog. Find it with searchProducts status=archived. ALWAYS requires explicit user approval, even when auto-approval is on.",
  inputSchema: z.object({ id: z.uuid() }).strict(),
  approval: approval(
    (input) => `POST /v1/products/${input.id}/restore`,
    () => ({}),
  ),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/products/{id}/restore", "post", undefined, { id: input.id });
  },
});
