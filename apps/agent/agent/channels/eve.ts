import { eveChannel } from "eve/channels/eve";
import type { AuthFn } from "eve/channels/auth";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverEnv } from "@openstockai/server/env";

// The throwaway eval stack (`pnpm agent:eval`) sets OPENSTOCK_EVAL_TOKEN and calls the agent
// directly, with the owner's cookie and a bearer token instead of the web proxy's service
// secret. No production configuration sets the variable, so this never matches there.
function evalBearer(request: Request) {
  const token = process.env.OPENSTOCK_EVAL_TOKEN;
  if (!token || token.length < 32) return false;
  const given = Buffer.from((request.headers.get("authorization") || "").replace(/^Bearer /i, ""));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
const auth: AuthFn<Request> = async (request) => {
  const env = serverEnv(),
    a = Buffer.from(request.headers.get("X-Agent-Secret") || ""),
    b = Buffer.from(env.AGENT_SERVICE_SECRET);
  if ((a.length !== b.length || !timingSafeEqual(a, b)) && !evalBearer(request)) return null;
  const res = await fetch(`${env.BETTER_AUTH_URL}/api/internal/agent-auth`, {
    headers: {
      Cookie: request.headers.get("cookie") || "",
      "X-Agent-Secret": env.AGENT_SERVICE_SECRET,
    },
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!res.ok) return null;
  const who = z.object({ userId: z.uuid(), sessionId: z.uuid() }).parse(await res.json());
  return {
    authenticator: "openstockai:better-auth",
    principalType: "user",
    principalId: who.userId,
    attributes: { sessionId: who.sessionId },
  };
};
// Eve 1 serves GET /eve/v1/info (which `eve eval` reads before it starts) only to operators.
// A bearer-only request from the eval runner, with no user cookie, is admitted as a service.
const evalOperator: AuthFn<Request> = async (request) =>
  evalBearer(request)
    ? {
        authenticator: "openstockai:eval-operator",
        principalType: "service",
        principalId: "eval-runner",
        attributes: {},
      }
    : null;
export default eveChannel({ auth: [auth, evalOperator] });
