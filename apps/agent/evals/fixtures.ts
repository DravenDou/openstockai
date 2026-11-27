import assert from "node:assert/strict";
import type config from "./evals.config";
import type { EveEvalContext, EveEvalConfigContext } from "eve/evals";
type Context = EveEvalContext<EveEvalConfigContext<typeof config>>;
export const headers = (t: Context) => ({
  Cookie: t.context.owner.cookie,
  Origin: t.context.base,
});
export const prompt = (t: Context, scenario: string, real: string, payload?: object) =>
  t.context.provider === "controlled"
    ? `VALIDATION:${scenario}${payload ? ` PAYLOAD:${JSON.stringify(payload)}` : ""} ${real}`
    : real;
export async function backend(t: Context, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${t.context.base}/api/backend/${path}`, {
    method,
    headers: { ...headers(t), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, `Fixture endpoint ${path} failed: HTTP ${response.status}`);
  return response.json();
}
export async function report(t: Context, sessionId: string, started: number) {
  t.log(
    JSON.stringify({
      provider: t.context.provider,
      date: new Date().toISOString(),
      sessionId,
      durationMs: Date.now() - started,
    }),
  );
}
