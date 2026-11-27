import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { getAuth } from "./auth";
import { httpsHost, parseScopes, redirectTarget, type ConsentLoad } from "@/shared/oauth/consent";

// Verifies the signed OAuth query on the consent URL and loads the client it names. The
// signature only proves the parameters were not changed or expired; it does not prove the client
// exists or who runs it, so the client's own claims are passed on as text to be labelled
// "unverified" in the UI. Without a session getOAuthClientPublic throws, which maps to
// "unavailable" (the sign-in gate is shown instead).
export async function loadConsentRequest(
  searchParams: Record<string, string | string[] | undefined>,
  headers: Headers,
): Promise<ConsentLoad> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams))
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      params.append(key, item);
  const signed = new Set(["sig", "ba_param", ...params.getAll("ba_param")]);
  const query = new URLSearchParams([...params].filter(([key]) => signed.has(key)));
  const auth = getAuth();
  const { secret } = await auth.$context;
  if (!(await verifyOAuthQueryParams(query.toString(), secret)))
    return { ok: false, reason: "expired" };
  const clientId = query.get("client_id");
  if (!clientId) return { ok: false, reason: "unavailable" };
  try {
    const client = await auth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers,
    });
    return {
      ok: true,
      request: {
        clientId,
        clientHost: httpsHost(clientId),
        clientName: client.client_name?.trim().slice(0, 120) || null,
        clientUri: httpsHost(client.client_uri) ? (client.client_uri ?? null) : null,
        redirectTarget: redirectTarget(query.get("redirect_uri")),
        scopes: parseScopes(query.get("scope")),
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
