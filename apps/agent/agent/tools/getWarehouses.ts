import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { page, query } from "../lib/schemas";
import { pageResult } from "../lib/results";

export default defineTool({
  description:
    "Busca nombres e IDs reales de almacenes. Reutiliza el catálogo durante este turno; refresh fuerza una lectura nueva.",
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
