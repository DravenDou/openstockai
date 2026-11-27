import { defineWorkflowTool } from "eve/tools";
import { product } from "../lib/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Create a product with SKU and decimal prices. Optional initial stock needs a real warehouse ID; categoryName creates or reuses a category.",
  inputSchema: product,
  approval: approval(() => "POST /v1/products"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/products", "post", input);
  },
});
