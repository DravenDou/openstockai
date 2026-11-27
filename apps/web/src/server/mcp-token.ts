import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { z } from "zod";
import { serverEnv } from "@openstockai/server/env";
import { apiFailure, checkService, HTTPError } from "@openstockai/server/http";

const input = z.object({ accessToken: z.string().min(1).max(8192) }).strict();
const uuid = z.uuid();

// Everything the exchange needs from the outside world, so the logic is testable without a
// database or a running auth server.
export type McpTokenDeps = {
  jwks: () => Promise<JSONWebKeySet>;
  // The owner's stored consent for this client, or null when it was revoked or never given.
  grant: (
    userId: string,
    clientId: string,
  ) => Promise<{ scopes: string[]; clientName: string | null } | null>;
  // Mints the short-lived Go API token for the MCP actor. Go enforces the scopes it carries.
  sign: (payload: { sub: string; act: "mcp"; cid: string; scope: string }) => Promise<string>;
};

function invalid(message = "The access token is not valid.") {
  return new HTTPError(401, "INVALID_TOKEN", message);
}
// The access token must be a resource-bound OAuth access token issued by this server for the MCP
// resource: signed with our EdDSA keys, typ at+jwt, azp (the client) present, iss and aud pinned.
async function verifyAccessToken(token: string, jwks: JSONWebKeySet) {
  const env = serverEnv();
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: env.BETTER_AUTH_URL,
      audience: env.MCP_RESOURCE_URL,
      algorithms: ["EdDSA"],
      typ: "at+jwt",
      requiredClaims: ["sub", "exp", "azp"],
    });
    if (typeof payload.sub !== "string" || !uuid.safeParse(payload.sub).success) throw invalid();
    if (typeof payload.azp !== "string" || !payload.azp || payload.azp.length > 512)
      throw invalid();
    // With the openid scope Better Auth adds its userinfo endpoint to aud, so aud can be a list;
    // jwtVerify has already required it to contain the MCP resource.
    return {
      sub: payload.sub,
      azp: payload.azp,
      scopes: typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [],
    };
  } catch (error) {
    throw error instanceof HTTPError ? error : invalid();
  }
}

// Exchanges an OAuth access token for a Go API token (never passthrough). The caller must be
// the MCP service; the token is verified again here and the owner's grant must still exist.
export async function handleMcpToken(request: Request, deps: McpTokenDeps) {
  try {
    checkService(request, "mcp");
    let body: z.infer<typeof input>;
    try {
      body = input.parse(await request.json());
    } catch {
      throw new HTTPError(400, "INVALID_REQUEST", "Send a JSON body with an accessToken.");
    }
    const access = await verifyAccessToken(body.accessToken, await deps.jwks());
    const grant = await deps.grant(access.sub, access.azp);
    if (!grant)
      throw new HTTPError(403, "GRANT_REVOKED", "The owner no longer allows this application.");
    // Never hand out more than the owner currently allows.
    const scopes = access.scopes.filter((scope) => grant.scopes.includes(scope));
    const token = await deps.sign({
      sub: access.sub,
      act: "mcp",
      cid: access.azp,
      scope: scopes.join(" "),
    });
    const exp = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString() || "{}",
    ).exp;
    const expiresAt = new Date(typeof exp === "number" ? exp * 1000 : Date.now() + 5 * 60_000);
    return Response.json(
      {
        token,
        expiresAt: expiresAt.toISOString(),
        userId: access.sub,
        clientId: access.azp,
        clientName: grant.clientName,
        scopes,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const response = apiFailure(error);
    const { error: detail } = (await response.json()) as {
      error: { code: string; message: string };
    };
    // The MCP service branches on the top-level code; the message is for logs.
    return Response.json(detail, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
