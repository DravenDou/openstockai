import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
export default defineTool({
  description:
    "Look up one active or archived product by its exact SKU. Returns the same details as getProduct, or a NOT_FOUND error.",
  inputSchema: z.object({ sku: z.string().trim().min(1).max(80) }).strict(),
  execute: (input, ctx) =>
    call(ctx, "/v1/products/by-sku", "get", undefined, { query: { sku: input.sku } }),
});
