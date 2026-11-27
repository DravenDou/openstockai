import { defineChannel, GET } from "eve/channels";
import { apiFailure, checkService, HTTPError } from "@openstockai/server/http";
import { traceQuerySchema } from "@openstockai/api-client/agent-traces";
import { readAgentTraces } from "../lib/traces";

export default defineChannel({
  routes: [
    GET("/internal/observability/traces", async (request) => {
      try {
        checkService(request);
        const query = traceQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!query.success)
          throw new HTTPError(422, "INVALID_TRACE_QUERY", "Check the trace ID and page.");
        return Response.json(await readAgentTraces(query.data), {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        const response = apiFailure(error);
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
    }),
  ],
});
