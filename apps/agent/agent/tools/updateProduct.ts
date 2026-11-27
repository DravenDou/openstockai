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
  description:
    "Edit catalog data of a product (name, category, unit, prices, minimum, location, barcode, description). Never changes stock or SKU; use the stock tools for stock.",
  inputSchema: schema,
  approval: approval((input) => `PATCH /v1/products/${input.id}`, payload),
  async execute(input, ctx) {
    "use workflow";
    const { id, ...body } = input;
    return write(ctx, "/v1/products/{id}", "patch", body, { id });
  },
});
