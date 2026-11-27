import { z } from "zod";
import { apiFailure, checkService, HTTPError } from "@openstockai/server/http";
import { authDatabase, getAuth } from "@/server/auth";
export const runtime = "nodejs";
const input = z.object({ userId: z.uuid(), sessionId: z.uuid() }).strict();
export async function POST(request: Request) {
  try {
    checkService(request);
    const body = input.parse(await request.json());
    const row = await authDatabase().query(
      `SELECT 1 FROM auth.session WHERE "userId"=$1::uuid AND id=$2::uuid AND "expiresAt">now()`,
      [body.userId, body.sessionId],
    );
    if (!row.rows[0]) throw new HTTPError(403, "FORBIDDEN", "The session has expired.");
    const token = await getAuth().api.signJWT({
      body: { payload: { sub: body.userId, sid: body.sessionId } },
    });
    return Response.json(token, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error);
  }
}
