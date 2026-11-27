import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";

export default defineTool({
  description:
    "Current global totals: products, low stock, out of stock and exact stock value, computed by the API in one read. No filters.",
  inputSchema: z.object({}).strict(),
  execute: (_input, ctx) => call(ctx, "/v1/inventory/summary", "get", undefined),
});
