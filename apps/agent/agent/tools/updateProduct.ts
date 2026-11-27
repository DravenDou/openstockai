import { defineWorkflowTool } from "eve/tools";
import { productPatch, withoutId } from "@openstockai/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
// productPatch has no defaults: a field the model leaves out is never sent, so it is never reset.
export default defineWorkflowTool({
  description:
    "Edit catalog data of a product (name, category, unit, prices, minimum, location, barcode, description). Never changes stock or SKU; use the stock tools for stock.",
  inputSchema: productPatch,
  approval: approval((input) => `PATCH /v1/products/${input.id}`, withoutId),
  async execute(input, ctx) {
    "use workflow";
    const { id, ...body } = input;
    return write(ctx, "/v1/products/{id}", "patch", body, { id });
  },
});
