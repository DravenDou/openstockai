import { serverEnv } from "@openstockai/server/env";
import { HTTPError } from "@openstockai/server/http";
import { authDatabase } from "./auth";
import { goHeaders } from "./http";
import type { ActionView, ApprovalClient, ApprovalLoad } from "@/shared/approvals/load";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reads one agent action for the owner approval page. Read-only: the browser proxy does not
// expose GET /v1/agent-actions/{id}, so the page reads it here with the owner's session.
export async function loadApproval(id: string, headers: Headers): Promise<ApprovalLoad> {
  if (!uuid.test(id)) return { ok: false, reason: "not_found" };
  let forwarded: Headers;
  try {
    forwarded = await goHeaders(headers);
  } catch (error) {
    if (error instanceof HTTPError && error.status === 401)
      return { ok: false, reason: "unauthenticated" };
    return { ok: false, reason: "unavailable" };
  }
  try {
    const response = await fetch(`${serverEnv().API_BASE_URL}/v1/agent-actions/${id}`, {
      headers: forwarded,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (response.status === 404) return { ok: false, reason: "not_found" };
    if (response.status === 401) return { ok: false, reason: "unauthenticated" };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const action = (await response.json()) as ActionView;
    const [client, targetName] = await Promise.all([
      lookupClient(action.clientId),
      lookupTarget(action.operation, forwarded),
    ]);
    return { ok: true, action, client, targetName };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
// The name of the record an operation targets, so the owner never decides on a bare ID.
// Best effort: any failure falls back to the ID on the page. GET /v1/products/{id} only finds
// active products, so a restore looks the product up among the archived ones.
const targetPath =
  /^(?:PATCH|DELETE|POST) \/v1\/(products|warehouses|categories|suppliers)\/([0-9a-f-]{36})(?:\/restore)?$/i;
type Named = { id?: unknown; name?: unknown; sku?: unknown };
async function lookupTarget(operation: string, headers: Headers): Promise<string | null> {
  const match = targetPath.exec(operation);
  if (!match || !uuid.test(match[2]!)) return null;
  const [, resource, id] = match;
  const get = async <T>(path: string) => {
    const response = await fetch(`${serverEnv().API_BASE_URL}${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    return response.ok ? ((await response.json()) as T) : null;
  };
  try {
    let row = await get<Named>(`/v1/${resource}/${id}`);
    if (!row && resource === "products" && operation.endsWith("/restore"))
      row =
        (await get<{ items?: Named[] }>("/v1/products?status=archived&limit=500"))?.items?.find(
          (item) => item.id === id,
        ) ?? null;
    if (typeof row?.name !== "string" || !row.name.trim()) return null;
    const name = row.name.trim().slice(0, 160);
    return typeof row.sku === "string" && row.sku ? `${name} (${row.sku})` : name;
  } catch {
    return null;
  }
}
export function clientHost(clientId: string) {
  const url = URL.parse(clientId);
  return url?.protocol === "https:" ? url.host : null;
}
async function lookupClient(clientId: string | null): Promise<ApprovalClient | null> {
  if (!clientId) return null;
  try {
    const row = await authDatabase().query<{ name: string | null }>(
      `SELECT "name" FROM auth."oauthClient" WHERE "clientId" = $1 LIMIT 1`,
      [clientId],
    );
    return {
      clientId,
      name: row.rows[0]?.name?.trim().slice(0, 120) || null,
      host: clientHost(clientId),
    };
  } catch {
    return { clientId, name: null, host: clientHost(clientId) };
  }
}
