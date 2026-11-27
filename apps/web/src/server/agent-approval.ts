import { HTTPError } from "@openstockai/server/http";

// The Eve relay may only decide on actions the agent itself registered. Anything else (for
// example an MCP action) must be approved by the owner in the approval page.
export async function assertAgentAction(
  apiBaseUrl: string,
  token: string,
  actionId: string,
  doFetch: typeof fetch = fetch,
) {
  const res = await doFetch(`${apiBaseUrl}/v1/agent-actions/${actionId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  const action = res.ok
    ? ((await res.json().catch(() => null)) as { actorType?: unknown } | null)
    : null;
  if (action?.actorType !== "ai") {
    throw new HTTPError(
      403,
      "FORBIDDEN",
      "Only actions registered by the agent can be approved here.",
    );
  }
}
