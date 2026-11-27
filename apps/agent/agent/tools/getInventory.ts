import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { page } from "../lib/schemas";
import { pageResult } from "../lib/results";
import { modelPage } from "../lib/model-output";
export default defineTool({
  description:
    "Consulta saldos actuales por producto y almacén. Filtra por IDs; getInventorySummary obtiene totales globales sin listar saldos.",
  inputSchema: page
    .extend({ product: z.uuid().optional(), warehouse: z.uuid().optional() })
    .strict(),
  async execute(input, ctx) {
    const result = await call(ctx, "/v1/inventory", "get", undefined, {
      query: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    });
    return result.ok ? ({ ok: true, data: pageResult(result.data, input) } as const) : result;
  },
  toModelOutput: modelPage,
});
