import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";

const date = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);

export default defineTool({
  description:
    "Purchase spend per supplier (cost of received purchases) with purchase counts and the overall total, highest spend first. Defaults to the last 90 days; 'to' given as a plain date includes that whole day.",
  inputSchema: z
    .object({
      from: date
        .optional()
        .describe("Start (RFC3339 or YYYY-MM-DD). Default: 90 days before 'to'."),
      to: date.optional().describe("End (RFC3339 or YYYY-MM-DD). Default: now."),
    })
    .strict(),
  execute: (input, ctx) =>
    call(ctx, "/v1/analytics/supplier-spend", "get", undefined, {
      query: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    }),
});
