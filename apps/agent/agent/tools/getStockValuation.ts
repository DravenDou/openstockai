import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";

export default defineTool({
  description:
    "Stock valuation at cost (on-hand quantity x cost price, active products): the total plus a breakdown by category and by warehouse. Optionally filter by warehouse and/or category UUID. Money values are decimal strings in the store currency.",
  inputSchema: z
    .object({
      warehouse: z.uuid().optional().describe("Only value stock held in this warehouse."),
      category: z.uuid().optional().describe("Only value products in this category."),
    })
    .strict(),
  execute: (input, ctx) =>
    call(ctx, "/v1/analytics/stock-valuation", "get", undefined, {
      query: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    }),
});
