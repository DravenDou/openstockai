import { defineWorkflowTool } from "eve/tools";
import { approval } from "../lib/api";
import { unit } from "@openstockai/schemas";
import { write } from "../lib/write";
export default defineWorkflowTool({
  description:
    "Create a unit of measure. code is a lowercase identifier (for example kg), symbol is shown in the UI, decimals (0-3) is how many decimals quantities allow. Check getMeasurementUnits first. Units cannot be edited or deleted afterwards.",
  inputSchema: unit,
  approval: approval(() => "POST /v1/units"),
  async execute(input, ctx) {
    "use workflow";
    return write(ctx, "/v1/units", "post", input);
  },
});
