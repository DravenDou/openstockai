import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
export default defineTool({
  description:
    "List the available units of measure with code, symbol and decimals. Use these codes when creating products; never invent conversions.",
  inputSchema: z.object({ refresh: z.boolean().default(false) }).strict(),
  execute: (input, ctx) => call(ctx, "/v1/units", "get", undefined, { fresh: input.refresh }),
});
