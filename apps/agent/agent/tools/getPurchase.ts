import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
export default defineTool({
  description:
    "Get one purchase receipt with its header (warehouse, supplier, total) and every line.",
  inputSchema: z.object({ id: z.uuid() }).strict(),
  execute: (input, ctx) => call(ctx, "/v1/purchases/{id}", "get", undefined, { id: input.id }),
});
