import { z } from "zod";
import { authDatabase } from "@/server/auth";
import { listConnectedApps, revokeConnectedApp } from "@/server/connected-apps";
import { identity } from "@/server/http";
import { apiFailure, boundedBody, checkOrigin, HTTPError } from "@openstockai/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const revokeInput = z.object({ clientId: z.string().min(1).max(512) }).strict();

export async function GET(request: Request) {
  try {
    const { userId } = await identity(request.headers);
    return Response.json(
      { items: await listConnectedApps(authDatabase(), userId) },
      { headers: noStore },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
// Revoke: only the signed-in owner, and only from this app's own origin. The client id (a URL)
// travels in the body, not the path.
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const { userId } = await identity(request.headers);
    let body: z.infer<typeof revokeInput>;
    try {
      body = revokeInput.parse(JSON.parse(await new Response(boundedBody(request, 4096)).text()));
    } catch (error) {
      if (error instanceof HTTPError) throw error;
      throw new HTTPError(400, "INVALID_REQUEST", "Send a JSON body with a clientId.");
    }
    const revoked = await revokeConnectedApp(authDatabase(), userId, body.clientId);
    return Response.json({ revoked }, { headers: noStore });
  } catch (error) {
    return apiFailure(error);
  }
}
