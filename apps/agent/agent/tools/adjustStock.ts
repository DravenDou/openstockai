import { defineWorkflowTool } from "eve/tools";
import { adjustment } from "../lib/schemas";
import { approval } from "../lib/api";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Registra una entrada o salida transaccional; cantidades grandes requieren aprobación humana.",
  inputSchema: adjustment,
  approval: approval(() => "POST /v1/inventory/adjustments"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/inventory/adjustments", "post", input);
  },
});
