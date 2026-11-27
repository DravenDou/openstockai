import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description: "Crea un proveedor con nombre y correo opcional.",
  inputSchema: z
    .object({ name: z.string().trim().min(1).max(120), email: z.email().optional() })
    .strict(),
  approval: approval(() => "POST /v1/suppliers"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/suppliers", "post", input);
  },
});
