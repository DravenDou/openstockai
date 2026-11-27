import { forwardGo } from "@/server/http";
import { apiFailure, HTTPError } from "@openstockai/server/http";
import contracts from "@openstockai/api-client/runtime.json";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const target = path.join("/");
    const route = path.map((part) => (uuid.test(part) ? "{id}" : part)).join("/");
    // Public browser routes come from OpenAPI. Runtime ownership/status stays internal.
    const internal =
      path[0] === "agent-sessions" || (path[0] === "agent-actions" && path.length === 2);
    if (internal || !Object.hasOwn(contracts.responses, `${request.method} /v1/${route}`))
      throw new HTTPError(404, "NOT_FOUND", "Unknown route.");
    return await forwardGo(request, target);
  } catch (error) {
    return apiFailure(error);
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
