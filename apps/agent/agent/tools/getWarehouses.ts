import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { page, query } from "../lib/schemas";
import { pageResult } from "../lib/results";

export default defineTool({
  description:
    "Look up real warehouse names and IDs. The catalog is reused within a turn; refresh forces a new read.",
  inputSchema: query
    .extend(page.shape)
    .extend({ refresh: z.boolean().default(false) })
    .strict(),
  async execute({ refresh, ...input }, ctx) {
    const result = await call(ctx, "/v1/warehouses", "get", undefined, {
      query: input,
      fresh: refresh,
    });
    return result.ok ? ({ ok: true, data: pageResult(result.data, input) } as const) : result;
  },
});
