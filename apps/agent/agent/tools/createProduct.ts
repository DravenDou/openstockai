import { defineWorkflowTool } from "eve/tools";
import { product } from "../lib/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Crea un producto con SKU y precios decimales. Stock inicial opcional con almacén real.",
  inputSchema: product,
  approval: approval(() => "POST /v1/products"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/products", "post", input);
  },
});
