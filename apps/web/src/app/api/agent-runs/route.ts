import { identity } from "@/server/http";
import { apiFailure, HTTPError } from "@openstockai/server/http";
import { serverEnv } from "@openstockai/server/env";
import { traceDetailSchema, traceListSchema, traceQuerySchema } from "@openstockai/api-client/agent-traces";

export const runtime = "nodejs";
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
    const schema = query.data.traceId ? traceDetailSchema : traceListSchema;
    return Response.json(schema.parse(await response.json()), {
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
