import { defineTool } from "eve/tools";
import { z } from "zod";
import { page, query } from "../lib/schemas";
import { call } from "../lib/api";
import { pageResult, productSummary } from "../lib/results";
import { enableToolGroups, toolGroupNames } from "../lib/tool-selection";
import { modelPage } from "../lib/model-output";
export default defineTool({
  description:
    "Search products by name, SKU or barcode, with optional category, warehouse, stock (low/out) and status filters. nextAction enables a tool group during this search; getProduct returns full details.",
  inputSchema: query
    .extend(page.shape)
    .extend({
      category: z.uuid().optional(),
      warehouse: z.uuid().optional(),
      stock: z.enum(["low", "out"]).optional(),
      status: z.enum(["active", "archived"]).optional(),
      nextAction: z.enum(toolGroupNames).optional(),
    })
    .strict(),
  async execute(input, ctx) {
    const { nextAction, ...filters } = input;
    const result = await call(ctx, "/v1/products", "get", undefined, {
      query: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)),
    });
    if (result.ok && nextAction) enableToolGroups(ctx.session, [nextAction]);
    return result.ok
      ? ({
          ok: true,
          data: pageResult(result.data.items, input, result.data.total),
        } as const)
      : result;
  },
  toModelOutput(output) {
    return modelPage(
      output.ok
        ? { ...output, data: { ...output.data, items: output.data.items.map(productSummary) } }
        : output,
    );
  },
});
