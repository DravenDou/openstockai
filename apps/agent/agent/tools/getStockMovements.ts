import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { page, query } from "@openstockai/schemas";
import { pageResult } from "../lib/results";
import { modelPage } from "../lib/model-output";
export default defineTool({
  description:
    "List stock movements filtered by product, warehouse, kind and an RFC 3339 start date; page until hasMore=false.",
  inputSchema: query
    .extend(page.shape)
    .extend({
      product: z.uuid().optional(),
      warehouse: z.uuid().optional(),
      kind: z
        .enum(["in", "out", "adjustment", "return", "transfer"])
        .describe(
          "in: entries (positive quantity). out: exits (negative quantity). adjustment, return and transfer: movements of that type, both directions.",
        )
        .optional(),
      since: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  async execute(input, ctx) {
    const result = await call(ctx, "/v1/stock-movements", "get", undefined, {
      query: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    });
    return result.ok ? ({ ok: true, data: pageResult(result.data, input) } as const) : result;
  },
  toModelOutput: modelPage,
});
