import { defineTool } from "eve/tools";
import { page, query } from "@openstockai/schemas";
import { call } from "../lib/api";
import { pageResult } from "../lib/results";
export default defineTool({
  description: "Search suppliers by name or email.",
  inputSchema: query.extend(page.shape).strict(),
  async execute(input, ctx) {
    const result = await call(ctx, "/v1/suppliers", "get", undefined, { query: input });
    return result.ok ? ({ ok: true, data: pageResult(result.data, input) } as const) : result;
  },
});
