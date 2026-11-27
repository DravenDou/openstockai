import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
export default defineTool({
  description:
    "Consulta códigos, símbolos y decimales de unidades de medida disponibles. Usa estos códigos al crear productos; no inventes conversiones.",
  inputSchema: z.object({ refresh: z.boolean().default(false) }).strict(),
  execute: (input, ctx) => call(ctx, "/v1/units", "get", undefined, { fresh: input.refresh }),
});
