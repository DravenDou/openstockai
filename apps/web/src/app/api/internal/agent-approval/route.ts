import { z } from "zod";
import { checkService, apiFailure, HTTPError } from "@openstockai/server/http";
import { authDatabase, getAuth } from "@/server/auth";
import { assertAgentAction } from "@/server/agent-approval";
import { serverEnv } from "@openstockai/server/env";
export const runtime = "nodejs";
const schema = z
  .object({ userId: z.uuid(), sessionId: z.uuid(), actionId: z.uuid(), approved: z.boolean() })
  .strict();
// Called only by Eve's authenticated approval-response policy, never by a model tool.
export async function POST(request: Request) {
  try {
    checkService(request);
    const body = schema.parse(await request.json());
    const session = await authDatabase().query(
      `SELECT 1 FROM auth.session WHERE "userId"=$1::uuid AND id=$2::uuid AND "expiresAt">now()`,
      [body.userId, body.sessionId],
    );
    if (!session.rows[0]) throw new HTTPError(403, "FORBIDDEN", "Invalid session.");
    const { token } = await getAuth().api.signJWT({
      body: { payload: { sub: body.userId, sid: body.sessionId } },
    });
    await assertAgentAction(serverEnv().API_BASE_URL, token, body.actionId);
    const res = await fetch(
      `${serverEnv().API_BASE_URL}/v1/agent-actions/${body.actionId}/approval`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ approved: body.approved }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
