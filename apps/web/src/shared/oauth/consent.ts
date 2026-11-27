// Shapes and wording shared by the server loader and the consent view.
// What the server has verified about an authorization request and hands to the consent view.
// Everything about the client (name, links) is a claim the client makes about itself.
export type ConsentRequest = {
  clientId: string;
  // Host of an HTTPS client_id (Client ID Metadata Document clients), shown so the owner can
  // check the request comes from the application they expect.
  clientHost: string | null;
  clientName: string | null;
  // Only https links are offered as links; anything else is dropped.
  clientUri: string | null;
  // Where the browser goes next: the host, or the whole URI for private-use schemes.
  redirectTarget: string;
  scopes: string[];
};
export type ConsentLoad =
  { ok: true; request: ConsentRequest } | { ok: false; reason: "expired" | "unavailable" };

const scopeCopy: Record<string, string> = {
  "inventory:read": "See your products, stock, purchases and reports",
  "inventory:write": "Propose stock changes and catalog edits; each one still needs your approval",
  openid: "Confirm that it is you",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected until you revoke access",
};
export function describeScope(scope: string) {
  return scopeCopy[scope] ?? `Access named "${scope}"`;
}
// Splits a space-separated OAuth scope string into unique, non-empty names.
export function parseScopes(value: string | null | undefined) {
  return [...new Set((value ?? "").split(/\s+/).filter(Boolean))];
}
// Returns the host for an https URL and null for anything else.
export function httpsHost(value: string | undefined | null) {
  const url = value ? URL.parse(value) : null;
  return url?.protocol === "https:" ? url.host : null;
}
// Shows where the response goes: the host for web URLs, the whole URI for private-use schemes.
export function redirectTarget(value: string | null | undefined) {
  const url = value ? URL.parse(value) : null;
  if (!url) return "an unknown address";
  return url.protocol === "http:" || url.protocol === "https:" ? url.host : value!;
}
