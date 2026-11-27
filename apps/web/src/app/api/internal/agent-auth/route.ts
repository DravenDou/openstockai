import { identity } from "@/server/http";
import { apiFailure, checkService } from "@openstockai/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { checkService(request); return Response.json(await identity(request.headers), {headers:{"Cache-Control":"no-store"}}); } catch (error) { return apiFailure(error); }
}
