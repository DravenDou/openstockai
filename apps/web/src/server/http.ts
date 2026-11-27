import { getAuth } from "./auth";
import { boundedBody, checkOrigin, HTTPError } from "@openstockai/server/http";
import { serverEnv } from "@openstockai/server/env";

export async function identity(headers: Headers) {
  const data = await getAuth().api.getSession({ headers });
  if (!data) throw new HTTPError(401, "UNAUTHORIZED", "Sign in to continue.");
  return { userId: data.user.id, sessionId: data.session.id };
}
export async function goHeaders(headers: Headers, agent = false) {
  await identity(headers);
  const { token } = await getAuth().api.getToken({ headers });
  const forwarded = new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  if (agent) forwarded.set("X-Agent-Secret", serverEnv().AGENT_SERVICE_SECRET);
  return forwarded;
}
export async function forwardGo(request: Request, path: string) {
  checkOrigin(request);
  const headers = await goHeaders(request.headers);
  const key = request.headers.get("Idempotency-Key");
  if (key) headers.set("Idempotency-Key", key);
  const url = new URL(request.url);
  const response = await fetch(`${serverEnv().API_BASE_URL}/v1/${path}${url.search}`, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await new Response(boundedBody(request, 256 * 1024)).text(),
    cache: "no-store",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    redirect: "error",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
