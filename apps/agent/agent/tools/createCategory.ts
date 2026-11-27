import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description: "Crea una categoría.",
  inputSchema: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
  approval: approval(() => "POST /v1/categories"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/categories", "post", input);
  },
});
