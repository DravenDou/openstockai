import { z } from "zod";
import { goHeaders } from "@/server/http";
import { apiFailure, boundedBody, checkOrigin, HTTPError } from "@openstockai/server/http";
import { serverEnv } from "@openstockai/server/env";
import { llmConfigProblem } from "@openstockai/server/ai/config";
export const runtime = "nodejs";
export const maxDuration = 75;
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    checkOrigin(request);
    const env = serverEnv();
    const headers = await goHeaders(request.headers, true);
    const problem = llmConfigProblem();
    if (problem)
      throw new HTTPError(503, "AI_NOT_CONFIGURED", `${problem} Update .env and run docker compose up -d.`);
    const { path } = await context.params;
    const create = path.length === 1 && path[0] === "session" && request.method === "POST";
    if (!create) {
      if (
        path[0] !== "session" ||
        !/^[-\w]{1,200}$/.test(path[1] || "") ||
        path.length > 3 ||
        (path.length === 3 && !["stream", "cancel", "compact", "clear", "reset"].includes(path[2]))
      )
        throw new HTTPError(404, "NOT_FOUND", "Unknown route.");
      const owner = await fetch(
        `${env.API_BASE_URL}/v1/agent-sessions/${encodeURIComponent(path[1])}`,
        { headers, cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "error" },
      );
      if (!owner.ok)
        throw new HTTPError(
          404,
          "NOT_FOUND",
          "The conversation does not belong to your user.",
        );
    }
    let body: string | undefined;
    if (request.method === "POST")
      body = await new Response(boundedBody(request, 64 * 1024)).text();
    const forwarded = new Headers({
      "X-Agent-Secret": env.AGENT_SERVICE_SECRET,
      Cookie: request.headers.get("cookie") || "",
      "Content-Type": "application/json",
    });
    const response = await fetch(
      `${env.EVE_BASE_URL}/eve/v1/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`,
      {
        method: request.method,
        headers: forwarded,
        body,
        signal: request.signal,
        cache: "no-store",
        redirect: "error",
      },
    );
    if (create && response.ok) {
      const data = z
        .object({ sessionId: z.string().min(1).max(200) })
        .passthrough()
        .parse(await response.json());
      const bound = await fetch(`${env.API_BASE_URL}/v1/agent-sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId: data.sessionId }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      if (!bound.ok)
        throw new HTTPError(503, "SESSION_BIND_FAILED", "Could not register the conversation.");
      return Response.json(data, {
        status: response.status,
        headers: { "Cache-Control": "no-store", "X-Eve-Session-Id": data.sessionId },
      });
    }
    const responseHeaders = new Headers({
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    for (const name of ["X-Eve-Stream-Version", "X-Eve-Stream-Tail-Index", "X-Eve-Session-Id"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (error) {
    return apiFailure(error);
  }
}
export { handle as GET, handle as POST };
