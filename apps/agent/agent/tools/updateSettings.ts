import { defineWorkflowTool } from "eve/tools";
import { approval, readSettings } from "../lib/api";
import { settingsPatch } from "../lib/schemas";
import { mergeSettings, saveSettings } from "../lib/settings";
export default defineWorkflowTool({
  description:
    "Change app settings (store, email, currency, time zone, automatic = auto-approve low-risk writes, confirm, lowStock). Send only the fields to change. Turning auto-approval on needs confirmation while it is off. Deletes, archives and restores always need approval whatever this setting is.",
  inputSchema: settingsPatch,
  approval: approval(
    () => "PATCH /v1/settings",
    async (input, ctx) => mergeSettings(await readSettings(ctx), input),
  ),
  async execute(input, ctx) {
    "use workflow";
    return saveSettings(ctx, input);
  },
});
