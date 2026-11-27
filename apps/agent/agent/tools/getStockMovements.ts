import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { page, query } from "../lib/schemas";
import { pageResult } from "../lib/results";
import { modelPage } from "../lib/model-output";
export default defineTool({
  description:
    "Consulta movimientos filtrados por producto, almacén, tipo y fecha de inicio RFC3339; pagina hasta hasMore=false.",
  inputSchema: query
    .extend(page.shape)
    .extend({
      product: z.uuid().optional(),
      warehouse: z.uuid().optional(),
      kind: z
        .enum([
          "initial",
          "purchase",
          "sale",
          "adjustment_in",
          "adjustment_out",
          "transfer_in",
          "transfer_out",
          "return_in",
          "return_out",
        ])
        .optional(),
      since: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  async execute(input, ctx) {
    const result = await call(ctx, "/v1/stock-movements", "get", undefined, {
      query: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    });
    return result.ok ? ({ ok: true, data: pageResult(result.data, input) } as const) : result;
  },
  toModelOutput: modelPage,
});
