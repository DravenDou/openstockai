import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";

export default defineTool({
  description:
    "Product turnover over a recent window: top movers (most units sold or written off) and slow movers (products with stock on hand but little or no outbound movement, with days since the last outbound movement). Use it to spot best sellers, dead stock and overstock.",
  inputSchema: z
    .object({
      days: z.number().int().min(1).max(365).optional().describe("Window in days (default 90)."),
      limit: z.number().int().min(1).max(50).optional().describe("Rows per list (default 10)."),
    })
    .strict(),
  execute: (input, ctx) =>
    call(ctx, "/v1/analytics/turnover", "get", undefined, {
      query: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    }),
});
