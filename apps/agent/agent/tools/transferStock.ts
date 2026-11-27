import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { amount } from "../lib/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description: "Transfiere stock entre dos almacenes en una sola transacción.",
  inputSchema: z
    .object({
      productId: z.uuid(),
      fromWarehouseId: z.uuid(),
      toWarehouseId: z.uuid(),
      quantity: amount.positive(),
    })
    .strict(),
  approval: approval(() => "POST /v1/inventory/transfers"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/inventory/transfers", "post", input);
  },
});
