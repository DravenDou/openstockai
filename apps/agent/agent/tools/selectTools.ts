import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { enableToolGroups } from "../lib/tool-selection";

export default defineTool({
  description:
    "Habilita tools para catálogo, ajustes/transferencias o proveedores. No modifica inventario. Combina grupos si la tarea lo necesita.",
  inputSchema: z
    .object({
      groups: z
        .array(z.enum(["catalog", "stock", "suppliers"]))
        .min(1)
        .max(3),
    })
    .strict(),
  async execute(input, ctx) {
    const identity = await call(ctx, "/v1/identity", "get", undefined);
    return identity.ok
      ? ({
          ok: true,
          data: { availableTools: enableToolGroups(ctx.session, input.groups) },
        } as const)
      : identity;
  },
});
