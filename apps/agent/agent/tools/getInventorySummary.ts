import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";

export default defineTool({
  description:
    "Totales globales actuales: productos, stock bajo, agotados y valor exacto, calculados por Go en una lectura. No admite filtros.",
  inputSchema: z.object({}).strict(),
  execute: (_input, ctx) => call(ctx, "/v1/inventory/summary", "get", undefined),
});
