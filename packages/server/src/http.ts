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
// Shared-secret guard for service-to-service routes. The agent secret is required and
// carried in X-Agent-Secret; the MCP secret is optional (unset disables the MCP path with
// 503 MCP_DISABLED) and carried in X-MCP-Secret.
const services = {
  agent: { header: "X-Agent-Secret", secret: () => serverEnv().AGENT_SERVICE_SECRET },
  mcp: { header: "X-MCP-Secret", secret: () => serverEnv().MCP_SERVICE_SECRET },
} as const;
export function checkService(request: Request, service: keyof typeof services = "agent") {
  const { header, secret } = services[service];
  const expected = secret();
  if (!expected)
    throw new HTTPError(503, "MCP_DISABLED", "The MCP server integration is not enabled.");
  const a = Buffer.from(request.headers.get(header) || "");
  const b = Buffer.from(expected);
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
