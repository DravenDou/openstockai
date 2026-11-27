import { z } from "zod";
import type { ToolContext } from "eve/tools";
import type { ApprovalContext, ApprovalResponseContext, Approval } from "eve/tools/approval";
import { request, APIError } from "@openstockai/api-client/client";
import { actionIdFor } from "@openstockai/api-client/agent-runs";
import type { paths } from "@openstockai/api-client/generated";
import { serverEnv } from "@openstockai/server/env";
import { auditResult } from "./results";
import { readCatalog, writeCatalog } from "./catalog-cache";
const identitySchema = z.object({ userId: z.uuid(), sessionId: z.uuid() });
export function principal(session: Pick<ToolContext["session"], "auth">) {
  const current = session.auth.current,
    initiator = session.auth.initiator;
  if (
    current?.principalType !== "user" ||
    current.principalId !== initiator?.principalId ||
    current.authenticator !== initiator?.authenticator
  )
    throw new Error("The conversation is not bound to a user.");
  return identitySchema.parse({
    userId: current.principalId,
    sessionId: current.attributes.sessionId,
  });
}
export function actionID(ctx: { session: { id: string }; callId: string }) {
  return actionIdFor(ctx.session.id, ctx.callId);
}
export async function agentHeaders(ctx: {
  session: Pick<ToolContext["session"], "auth">;
}): Promise<Record<string, string>> {
  const env = serverEnv();
  const who = principal(ctx.session);
  const res = await fetch(`${env.BETTER_AUTH_URL}/api/internal/agent-token`, {
    method: "POST",
    headers: {
      "X-Agent-Secret": env.AGENT_SERVICE_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(who),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!res.ok) throw new Error("The session has expired.");
  const { token } = z.object({ token: z.string() }).parse(await res.json());
  return {
    Authorization: `Bearer ${token}`,
    "X-Agent-Secret": env.AGENT_SERVICE_SECRET,
  };
}
async function register(
  ctx: ApprovalContext | Pick<ToolContext, "session" | "callId">,
  operation: string,
  input: unknown,
  headers?: HeadersInit,
) {
  return request("/v1/agent-actions", "post", {
    baseURL: serverEnv().API_BASE_URL,
    headers: headers ?? (await agentHeaders(ctx)),
    body: { id: actionID(ctx), conversationId: ctx.session.id, operation, toolInput: input },
    signal: AbortSignal.timeout(30_000),
  });
}
// payload may be async (for example to merge a partial update into current data) but must be
// deterministic: Go binds the approved action to the exact body the tool sends later.
export function approval<T extends Record<string, unknown>>(
  operation: (input: T) => string,
  payload: (input: T, ctx: ApprovalContext) => unknown | Promise<unknown> = (input) => input,
): Approval<T> {
  return {
    async request(ctx) {
      principal(ctx.session);
      if (!ctx.toolInput) throw new Error("Tool input required.");
      const action = await register(
        ctx as ApprovalContext,
        operation(ctx.toolInput as T),
        await payload(ctx.toolInput as T, ctx as ApprovalContext),
      );
      if (action.approvalStatus === "rejected") return "denied";
      return action.approvalStatus === "pending" ? "user-approval" : "approved";
    },
    async response(ctx: ApprovalResponseContext<T>) {
      const who = identitySchema.parse({
        userId: ctx.response.principal.principalId,
        sessionId: ctx.response.principal.attributes.sessionId,
      });
      if (
        ctx.response.principal.principalType !== "user" ||
        who.userId !== ctx.request.principal?.principalId
      )
        return {
          status: "rejected",
          reason: "Only the user who started the action can confirm it.",
        };
      const id = actionID({ session: ctx.session, callId: ctx.request.callId });
      const env = serverEnv();
      const res = await fetch(`${env.BETTER_AUTH_URL}/api/internal/agent-approval`, {
        method: "POST",
        headers: {
          "X-Agent-Secret": env.AGENT_SERVICE_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...who,
          actionId: id,
          approved: ctx.response.decision === "approve",
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      return res.ok
        ? { status: "allowed" }
        : {
            status: "rejected",
            reason: "The API rejected the approval. Check your session.",
          };
    },
  };
}
type Methods = "get" | "post" | "patch" | "delete";
export type Body<O> = O extends { requestBody: { content: { "application/json": infer B } } }
  ? B
  : never;
// Reads the current settings for a merge. Used before a write is registered, so it
// is not an agent action of its own (the write's action carries the full audit trail).
export async function readSettings(ctx: Pick<ToolContext, "session"> | ApprovalContext) {
  return request("/v1/settings", "get", {
    baseURL: serverEnv().API_BASE_URL,
    headers: await agentHeaders(ctx),
    signal: AbortSignal.timeout(15_000),
  });
}
export async function call<P extends keyof paths, M extends Methods & keyof paths[P]>(
  ctx: Pick<ToolContext, "session" | "callId" | "abortSignal">,
  path: P,
  method: M,
  input: Body<NonNullable<paths[P][M]>> | undefined,
  options: { id?: string; query?: Record<string, string | number>; fresh?: boolean } = {},
) {
  const operation = `${method.toUpperCase()} ${path.replace("{id}", options.id || "")}`;
  const payload = input ?? options.query ?? {};
  const env = serverEnv();
  const authHeaders = await agentHeaders(ctx);
  const id = actionID(ctx);
  const action = await register(ctx, operation, payload, authHeaders);
  if (action.approvalStatus === "pending")
    return { ok: false, approvalRequired: true, actionId: id } as const;
  if (action.approvalStatus === "rejected")
    return {
      ok: false,
      error: { code: "APPROVAL_REJECTED", message: "The action was rejected." },
    } as const;
  const cacheable = method === "get" && (path === "/v1/warehouses" || path === "/v1/units");
  const scope = JSON.stringify({ ...principal(ctx.session), turnId: ctx.session.turn.id });
  const cacheKey = JSON.stringify([
    path,
    Object.entries(options.query ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  try {
    const cached =
      cacheable && !options.fresh
        ? readCatalog<Awaited<ReturnType<typeof request<P, M>>>>(scope, cacheKey)
        : undefined;
    const data =
      cached ??
      (await request(path, method, {
        ...options,
        body: input,
        baseURL: env.API_BASE_URL,
        headers: { ...authHeaders, "X-Agent-Action-ID": id },
        key: id,
        signal: AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(30_000)]),
      }));
    if (method === "get")
      await request("/v1/agent-actions/{id}", "patch", {
        id,
        baseURL: env.API_BASE_URL,
        headers: authHeaders,
        body: {
          result:
            cached === undefined
              ? auditResult(data)
              : { source: "turn-cache", data: auditResult(data) },
          status: "completed",
        },
        signal: AbortSignal.timeout(10_000),
      });
    if (cacheable && cached === undefined) writeCatalog(scope, cacheKey, data);
    return { ok: true, data } as const;
  } catch (error) {
    const domain =
      error instanceof APIError
        ? { code: error.code, message: error.message }
        : {
            code: "API_UNAVAILABLE",
            message: "The API did not respond; check the state before repeating the operation.",
          };
    if (domain.code !== "APPROVAL_REQUIRED")
      await request("/v1/agent-actions/{id}", "patch", {
        id,
        baseURL: env.API_BASE_URL,
        headers: authHeaders,
        body: { result: null, status: "failed", error: domain.message },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    return { ok: false, error: domain } as const;
  }
  // Writes run in a workflow "use step" function, where defineState get()/update() throw, so
  // they never touch the catalog cache; hooks/clear-catalog-cache.ts clears it after the call.
}
