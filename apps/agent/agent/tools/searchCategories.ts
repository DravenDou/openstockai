import { defineTool } from "eve/tools";
import { page, query } from "@openstockai/schemas";
import { call } from "../lib/api";
import { pageResult } from "../lib/results";
export default defineTool({
  description: "Search categories by name.",
  inputSchema: query.extend(page.shape).strict(),
  async execute(input, ctx) {
    const result = await call(ctx, "/v1/categories", "get", undefined, { query: input });
    return result.ok ? ({ ok: true, data: pageResult(result.data, input) } as const) : result;
  },
});
