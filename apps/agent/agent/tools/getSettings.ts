import { defineTool } from "eve/tools";
import { call } from "../lib/api";
import { z } from "zod";
export default defineTool({
  description:
    "Read the app settings: store name, contact email, currency, time zone and the automatic (auto-approve low-risk writes) switch.",
  inputSchema: z.object({}).strict(),
  execute: (_input, ctx) => call(ctx, "/v1/settings", "get", undefined),
});
