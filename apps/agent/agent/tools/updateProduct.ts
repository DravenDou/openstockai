import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { product } from "../lib/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
const schema = product
  .omit({ sku: true, initialStock: true, warehouseId: true, icon: true })
  .partial()
  .extend({ id: z.uuid() })
  .strict();
const payload = (input: z.infer<typeof schema>) => schema.omit({ id: true }).strip().parse(input);
export default defineWorkflowTool({
  description: "Edita datos del catálogo sin modificar stock ni SKU.",
  inputSchema: schema,
  approval: approval((input) => `PATCH /v1/products/${input.id}`, payload),
  async execute(input, ctx) {
    "use workflow";
    const { id, ...body } = input;
    return write(ctx, "/v1/products/{id}", "patch", body, { id });
  },
});
