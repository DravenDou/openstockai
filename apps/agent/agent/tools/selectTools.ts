import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { enableToolGroups, groupDescriptions, toolGroupNames } from "../lib/tool-selection";

export default defineTool({
  description: `Enable more tools for this turn by group: ${toolGroupNames.map((name) => `${name} (${groupDescriptions[name]})`).join("; ")}. Does not change any data. Combine groups when the task needs it.`,
  inputSchema: z
    .object({
      groups: z.array(z.enum(toolGroupNames)).min(1).max(toolGroupNames.length),
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
