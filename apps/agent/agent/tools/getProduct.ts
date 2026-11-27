import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
export default defineTool({
  description: "Get one product with full details by its real ID.",
  inputSchema: z.object({ id: z.uuid() }).strict(),
  execute: (input, ctx) => call(ctx, "/v1/products/{id}", "get", undefined, { id: input.id }),
});
