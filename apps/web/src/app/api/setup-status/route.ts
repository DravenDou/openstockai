import { ownerExists } from "@/server/auth";
import { apiFailure } from "@openstockai/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Public and minimal: the sign-in screen needs to know whether to offer owner creation.
export async function GET() {
  try {
    return Response.json(
      { needsOwner: !(await ownerExists()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
