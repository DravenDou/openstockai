import { z } from "zod";
import { goHeaders, identity } from "@/server/http";
import { apiFailure, HTTPError } from "@openstockai/server/http";
import { serverEnv } from "@openstockai/server/env";
import {
  configuredPrices,
  enrichDetail,
  enrichList,
  pricesConfigured,
} from "@openstockai/server/ai/runs";
import type { RunAction } from "@openstockai/api-client/agent-runs";
import {
  traceDetailSchema,
  traceListSchema,
  traceQuerySchema,
} from "@openstockai/api-client/agent-traces";

export const runtime = "nodejs";
const actionsSchema = z.array(
  z.object({
    id: z.string(),
    conversation_id: z.string(),
    tool_name: z.string(),
    tool_input: z.unknown(),
    status: z.string(),
    approval_status: z.string(),
    started_at: z.string(),
    error: z.string().nullable(),
  }),
);
// Go agent actions add arguments and approval state. If they are unavailable, the run
// still renders from the trace alone.
async function goActions(request: Request): Promise<RunAction[]> {
  try {
    const response = await fetch(`${serverEnv().API_BASE_URL}/v1/agent-actions`, {
      headers: await goHeaders(request.headers),
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      redirect: "error",
    });
    return response.ok ? actionsSchema.parse(await response.json()) : [];
  } catch {
    return [];
  }
}
export async function GET(request: Request) {
  try {
    const env = serverEnv();
    await identity(request.headers);
    const query = traceQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success)
      throw new HTTPError(422, "INVALID_TRACE_QUERY", "Check the trace ID and page.");
    const params = new URLSearchParams({ offset: String(query.data.offset) });
    if (query.data.traceId) params.set("traceId", query.data.traceId);
    const response = await fetch(`${env.EVE_BASE_URL}/internal/observability/traces?${params}`, {
      headers: { "X-Agent-Secret": env.AGENT_SERVICE_SECRET },
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
      redirect: "error",
    });
    if (response.status === 404)
      throw new HTTPError(
        404,
        "TRACE_NOT_FOUND",
        "The trace is no longer available. Refresh the list.",
      );
    if (!response.ok)
      throw new HTTPError(
        503,
        "TRACES_UNAVAILABLE",
        "Could not load agent runs. Try again in a few seconds.",
      );
    const [actions, prices] = [await goActions(request), configuredPrices()];
    const body: unknown = await response.json();
    const payload = query.data.traceId
      ? enrichDetail(traceDetailSchema.parse(body), actions, prices)
      : (() => {
          const list = traceListSchema.parse(body);
          return {
            ...list,
            items: enrichList(list.items, actions, prices),
            pricesConfigured: pricesConfigured(prices),
          };
        })();
    return Response.json(payload, {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
