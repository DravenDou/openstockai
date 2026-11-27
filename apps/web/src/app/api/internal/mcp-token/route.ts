import type { JSONWebKeySet } from "jose";
import { authDatabase, getAuth } from "@/server/auth";
import { findGrant } from "@/server/connected-apps";
import { handleMcpToken } from "@/server/mcp-token";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleMcpToken(request, {
    jwks: async () => (await getAuth().api.getJwks()) as JSONWebKeySet,
    grant: (userId, clientId) => findGrant(authDatabase(), userId, clientId),
    sign: async (payload) => (await getAuth().api.signJWT({ body: { payload } })).token,
  });
}
