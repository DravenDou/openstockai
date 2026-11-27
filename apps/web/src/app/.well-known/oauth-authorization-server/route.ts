import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { getAuth } from "@/server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// RFC 8414 discovery at the issuer root (the issuer is BETTER_AUTH_URL, which has no path).
export const GET = (request: Request) => oauthProviderAuthServerMetadata(getAuth())(request);
