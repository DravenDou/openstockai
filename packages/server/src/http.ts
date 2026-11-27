import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env";
import { APIError } from "@openstockai/api-client/client";

export class HTTPError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function boundedBody(request: Request, limit: number) {
  let size = 0;
  return request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > limit)
          throw new HTTPError(413, "BODY_TOO_LARGE", "The request body exceeds the allowed size.");
        controller.enqueue(chunk);
      },
    }),
  );
}
export function checkService(request: Request) {
  const a = Buffer.from(request.headers.get("X-Agent-Secret") || "");
  const b = Buffer.from(serverEnv().AGENT_SERVICE_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new HTTPError(403, "FORBIDDEN", "Service not authorized.");
}
export function checkOrigin(request: Request) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.get("origin") !== new URL(serverEnv().BETTER_AUTH_URL).origin
  )
    throw new HTTPError(403, "INVALID_ORIGIN", "Origin not allowed.");
}
export function apiFailure(error: unknown) {
  const e =
    error instanceof HTTPError || error instanceof APIError
      ? error
      : new HTTPError(
          503,
          "SERVICE_UNAVAILABLE",
          "The service is unavailable. Check PostgreSQL, the API and the AI provider configuration.",
        );
  return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
}
