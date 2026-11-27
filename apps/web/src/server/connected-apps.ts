import type { ConnectedApp } from "@/shared/oauth/connected-apps";
import { httpsHost } from "@/shared/oauth/consent";

export type Queryable = {
  query: (text: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

// The owner's stored consent for one client, or null when it was revoked, never given or the
// client is disabled. The MCP token exchange asks this on every call.
export async function findGrant(db: Queryable, userId: string, clientId: string) {
  const result = await db.query(
    `SELECT c."scopes", o."name"
       FROM auth."oauthConsent" c
       JOIN auth."oauthClient" o ON o."clientId" = c."clientId"
      WHERE c."userId" = $1::uuid AND c."clientId" = $2 AND o."disabled" IS NOT TRUE
      LIMIT 1`,
    [userId, clientId],
  );
  const row = result.rows[0] as { scopes: string[]; name: string | null } | undefined;
  return row ? { scopes: row.scopes, clientName: row.name } : null;
}
export async function listConnectedApps(db: Queryable, userId: string): Promise<ConnectedApp[]> {
  const result = await db.query(
    `SELECT c."clientId", c."scopes", c."createdAt", o."name"
       FROM auth."oauthConsent" c
       LEFT JOIN auth."oauthClient" o ON o."clientId" = c."clientId"
      WHERE c."userId" = $1::uuid
      ORDER BY c."createdAt" DESC`,
    [userId],
  );
  return (
    result.rows as { clientId: string; scopes: string[]; createdAt: Date; name: string | null }[]
  ).map((row) => ({
    clientId: row.clientId,
    name: row.name?.trim().slice(0, 120) || null,
    host: httpsHost(row.clientId),
    scopes: row.scopes,
    grantedAt: new Date(row.createdAt).toISOString(),
  }));
}
// Disconnects one client in a single atomic statement: its consent and every refresh and
// access token it holds for this owner. The consent row is what the MCP token exchange checks,
// so the next call answers GRANT_REVOKED even for a still-unexpired access token.
export async function revokeConnectedApp(db: Queryable, userId: string, clientId: string) {
  const result = await db.query(
    `WITH access AS (
       DELETE FROM auth."oauthAccessToken" WHERE "userId" = $1::uuid AND "clientId" = $2
     ), refresh AS (
       DELETE FROM auth."oauthRefreshToken" WHERE "userId" = $1::uuid AND "clientId" = $2
     ), consent AS (
       DELETE FROM auth."oauthConsent" WHERE "userId" = $1::uuid AND "clientId" = $2 RETURNING 1
     )
     SELECT count(*)::int AS revoked FROM consent`,
    [userId, clientId],
  );
  return Number((result.rows[0] as { revoked: number } | undefined)?.revoked ?? 0);
}
