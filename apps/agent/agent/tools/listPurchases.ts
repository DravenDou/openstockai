import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { modelPage } from "../lib/model-output";
import { cursor } from "../lib/schemas";
export default defineTool({
  description:
    "List purchase receipts, newest first, with warehouse, supplier and total. Search by reference or supplier. Page with the returned next cursor until next is null. Use getPurchase for the lines.",
  inputSchema: z
    .object({
      query: z.string().max(160).default(""),
      limit: z.number().int().min(1).max(50).default(20),
      ...cursor,
    })
    .strict(),
  async execute(input, ctx) {
    const result = await call(ctx, "/v1/purchases-page", "get", undefined, {
      query: Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
      ),
    });
    return result.ok
      ? ({
          ok: true,
          data: {
            items: result.data.items,
            next: result.data.next,
            hasMore: result.data.next !== null,
          },
        } as const)
      : result;
  },
  toModelOutput: modelPage,
});
