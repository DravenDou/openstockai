import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { Deps } from "./deps";

export const scopes = { read: "inventory:read", write: "inventory:write" } as const;

// Verifies the OAuth access token locally against the web app's signing keys. The token is
// resource-bound: EdDSA, typ at+jwt, iss and aud pinned (aud may be a list), exp and azp required.
export function tokenVerifier({ config, fetch, now }: Deps): OAuthTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(`${config.authUrl}/api/auth/jwks`), {
    [customFetch]: (url, init) => fetch(url, init),
    timeoutDuration: 5_000,
  });
  return {
    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.resourceUrl,
          algorithms: ["EdDSA"],
          typ: "at+jwt",
          requiredClaims: ["exp", "azp"],
          currentDate: new Date(now()),
        });
        if (typeof payload.azp !== "string" || !payload.azp || payload.azp.length > 512)
          throw new Error("azp");
        return {
          token,
          clientId: payload.azp,
          scopes:
            typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [],
          expiresAt: payload.exp,
          // jwtVerify has already required aud to contain this resource.
          resource: new URL(config.resourceUrl),
        };
      } catch {
        // Never echo the token or the verifier's reason.
        throw new OAuthError(OAuthErrorCode.InvalidToken, "The access token is not valid.");
      }
    },
  };
}
