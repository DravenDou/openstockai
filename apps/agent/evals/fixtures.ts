import assert from "node:assert/strict";
import type config from "./evals.config";
import type { EveEvalContext, EveEvalConfigContext } from "eve/evals";
type Context = EveEvalContext<EveEvalConfigContext<typeof config>>;
export const headers = (t: Context) => ({
  Cookie: t.context.owner.cookie,
  Origin: t.context.base,
});
export function sku(t: Context, value: string) {
  const found = t.context.products.find((row) => row.sku === value);
  assert(found, `Fixture product ${value} is missing`);
  return found;
}
export function named<T extends { id: string; name: string }>(rows: T[], name: string) {
  const found = rows.find((row) => row.name === name);
  assert(found, `Fixture row "${name}" is missing`);
  return found;
}
// Reads go through the same authenticated Next proxy the web app uses.
export async function backend(t: Context, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${t.context.base}/api/backend/${path}`, {
    method,
    headers: {
      ...headers(t),
      "Content-Type": "application/json",
      ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, `Fixture endpoint ${path} failed: HTTP ${response.status}`);
  return response.json();
}
export async function report(t: Context, sessionId: string, started: number) {
  t.log(
    JSON.stringify({ date: new Date().toISOString(), sessionId, durationMs: Date.now() - started }),
  );
}
