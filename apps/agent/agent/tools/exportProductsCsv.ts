import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { exportLink } from "../lib/export";
export default defineTool({
  description:
    "Prepare a CSV export of products (name, SKU, barcode, category, unit, stock, cost, sale price) and return a download link for the user to click in the web app. The file is not sent through the model. Accepts the same filters as searchProducts; tell the user how many products match and give them the link as a markdown link.",
  inputSchema: z
    .object({
      query: z.string().max(160).default(""),
      category: z.uuid().optional(),
      warehouse: z.uuid().optional(),
      stock: z.enum(["low", "out"]).optional(),
      status: z.enum(["active", "archived"]).default("active"),
    })
    .strict(),
  async execute(input, ctx) {
    const filters = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
    ) as Record<string, string>;
    const result = await call(ctx, "/v1/products", "get", undefined, {
      query: { ...filters, limit: 1 },
    });
    return result.ok
      ? ({
          ok: true,
          data: { url: exportLink(filters), matchingProducts: result.data.total, format: "csv" },
        } as const)
      : result;
  },
});
