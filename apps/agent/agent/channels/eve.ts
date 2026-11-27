import { eveChannel } from "eve/channels/eve";
import type { AuthFn } from "eve/channels/auth";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverEnv } from "@openstockai/server/env";

const auth: AuthFn<Request> = async (request) => {
  const env = serverEnv(),
    a = Buffer.from(request.headers.get("X-Agent-Secret") || ""),
    b = Buffer.from(env.AGENT_SERVICE_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
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
export default eveChannel({ auth: [auth] });
