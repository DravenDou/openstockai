import { z } from "zod";
import { APIError, request } from "@openstockai/api-client/client";
import type { paths } from "@openstockai/api-client/generated";
import type { Deps } from "./deps";

// A failure whose message is safe and useful for the model; it becomes an `isError` tool result.
export class ToolFailure extends Error {}

export type Session = {
  headers: Record<string, string>;
  userId: string;
  clientId: string;
  clientName: string | null;
  scopes: string[];
};

const exchange = z.object({
  token: z.string(),
  userId: z.uuid(),
  clientId: z.string(),
  clientName: z.string().nullable(),
  scopes: z.array(z.string()),
});
const exchangeError: Record<string, string> = {
  GRANT_REVOKED: "The owner no longer allows this application. Reconnect it in OpenStock.",
  INVALID_TOKEN: "The access token is no longer valid. Sign in again.",
  MCP_DISABLED: "The MCP integration is disabled on this OpenStock server.",
  FORBIDDEN: "The MCP service is not authorized by OpenStock. Check MCP_SERVICE_SECRET.",
};
type Methods = "get" | "post" | "patch" | "delete";
type Options<P extends keyof paths, M extends Methods & keyof paths[P]> = Omit<
  NonNullable<Parameters<typeof request<P, M>>[2]>,
  "baseURL" | "fetch"
>;

export function upstream({ config, fetch }: Deps) {
  return {
    // Exchanges the OAuth access token for a short-lived Go token on every call (no caching,
    // so revoking a connected app takes effect immediately). The access token never goes to Go.
    async session(accessToken: string): Promise<Session> {
      let response: Response;
      try {
        response = await fetch(`${config.authUrl}/api/internal/mcp-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-MCP-Secret": config.serviceSecret },
          body: JSON.stringify({ accessToken }),
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
      } catch {
        throw new ToolFailure("OpenStock could not be reached. Try again in a moment.");
      }
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = z.object({ code: z.string() }).safeParse(data);
        throw new ToolFailure(
          (code.success && exchangeError[code.data.code]) ||
            "OpenStock refused the request. Try again in a moment.",
        );
      }
      const body = exchange.parse(data);
      return {
        headers: {
          Authorization: `Bearer ${body.token}`,
          "X-MCP-Secret": config.serviceSecret,
        },
        userId: body.userId,
        clientId: body.clientId,
        clientName: body.clientName,
        scopes: body.scopes,
      };
    },
    go<P extends keyof paths, M extends Methods & keyof paths[P]>(
      session: Session,
      path: P,
      method: M,
      options: Options<P, M> = {} as Options<P, M>,
    ) {
      return request(path, method, {
        ...options,
        baseURL: config.apiUrl,
        fetch,
        // A write's key is its registered action ID: it is both the idempotency key and the
        // action Go binds the approval to.
        headers: {
          ...session.headers,
          ...(options.key ? { "X-Agent-Action-ID": options.key } : {}),
          ...(options.headers as Record<string, string>),
        },
        signal: options.signal ?? AbortSignal.timeout(30_000),
      });
    },
  };
}
export type Upstream = ReturnType<typeof upstream>;

// Go domain errors, in words an external model can act on. No stack traces, no internals.
const known: Record<string, string> = {
  INSUFFICIENT_SCOPE: "The connected application does not have the scope this operation needs.",
  NOT_FOUND: "Not found.",
  ACTION_REJECTED: "Rejected by the owner.",
  OWNER_APPROVAL_REQUIRED: "This change must be approved by the owner in OpenStock.",
  APPROVAL_REQUIRED: "This change is still waiting for approval.",
};
export function describeError(error: unknown) {
  if (error instanceof ToolFailure) return error.message;
  if (error instanceof APIError)
    return error.code === "INVALID_RESPONSE" || error.code === "API_ERROR"
      ? error.message
      : `${error.code}: ${known[error.code] ?? error.message}`;
  return "The OpenStock API did not respond. Check the state before repeating a change.";
}
