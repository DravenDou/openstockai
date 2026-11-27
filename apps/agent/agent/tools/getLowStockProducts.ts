import { defineTool } from "eve/tools";
import { call } from "../lib/api";
import { page } from "@openstockai/schemas";
import { pageResult } from "../lib/results";
import { modelPage } from "../lib/model-output";
export default defineTool({
  description: "List products whose stock is at or below their minimum.",
  inputSchema: page,
  async execute(input, ctx) {
    const result = await call(ctx, "/v1/low-stock", "get", undefined, { query: input });
    return result.ok ? ({ ok: true, data: pageResult(result.data, input) } as const) : result;
  },
  toModelOutput: modelPage,
});
