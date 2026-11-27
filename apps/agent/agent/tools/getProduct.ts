import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
export default defineTool({
  description: "Consulta un producto por su ID real.",
  inputSchema: z.object({ id: z.uuid() }).strict(),
  execute: (input, ctx) => call(ctx, "/v1/products/{id}", "get", undefined, { id: input.id }),
});
