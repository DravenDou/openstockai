import { defineTool } from "eve/tools";
import { z } from "zod";
import { call } from "../lib/api";
import { modelPage } from "../lib/model-output";
import { cursor } from "@openstockai/schemas";
export default defineTool({
  description:
    "Read the audit log, newest first: who (human, ai or system) did what to which resource and when. Filter by text or actor. Page with the returned next cursor until next is null. Returns metadata only, not the full before/after documents.",
  inputSchema: z
    .object({
      query: z.string().max(160).default(""),
      actor: z.enum(["human", "ai", "system"]).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      ...cursor,
    })
    .strict(),
  async execute(input, ctx) {
    const result = await call(ctx, "/v1/audit-page", "get", undefined, {
      query: Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
      ),
    });
    return result.ok
      ? ({
          ok: true,
          data: {
            items: result.data.items.map(
              ({ id, created_at, actor_type, user_name, action, resource_type, resource_id }) => ({
                id,
                created_at,
                actor_type,
                user_name,
                action,
                resource_type,
                resource_id,
              }),
            ),
            next: result.data.next,
            hasMore: result.data.next !== null,
          },
        } as const)
      : result;
  },
  toModelOutput: modelPage,
});
