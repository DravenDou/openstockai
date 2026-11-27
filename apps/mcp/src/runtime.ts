import type {
  CallToolResult,
  McpServer,
  RequestStateCodec,
  ServerContext,
} from "@modelcontextprotocol/server";
import { createRequestStateCodec } from "@modelcontextprotocol/server";
import type { Deps } from "./deps";
import { describeError, ToolFailure, upstream, type Session, type Upstream } from "./upstream";

// What a signed requestState carries between the rounds of one approval. It is bound to the
// caller (sub, cid), the tool and a digest of the arguments of the first round.
export type ApprovalState = {
  actionId: string;
  mode: "client" | "owner";
  sub: string;
  cid: string;
  tool: string;
  argsDigest: string;
};
export type Runtime = {
  deps: Deps;
  up: Upstream;
  codec: RequestStateCodec<ApprovalState>;
};
export function createRuntime(deps: Deps): Runtime {
  return {
    deps,
    up: upstream(deps),
    codec: createRequestStateCodec<ApprovalState>({
      key: deps.config.stateSecret,
      ttlSeconds: 600,
      bind: (ctx) => `${ctx.mcpReq.method}\0${ctx.http?.authInfo?.clientId ?? ""}`,
    }),
  };
}

export async function sessionOf(rt: Runtime, ctx: ServerContext): Promise<Session> {
  const token = ctx.http?.authInfo?.token;
  if (!token) throw new ToolFailure("Authentication is required.");
  return rt.up.session(token);
}
export const failure = (error: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: describeError(error) }],
});
// Compact JSON for the model alongside the typed structuredContent.
export const result = <T extends Record<string, unknown>>(data: T): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: data,
});
export const annotations = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
} as const;

// The SDK's registerTool overloads cannot infer through the generic wrappers in reads.ts and
// writes.ts; the schemas and handlers there are typed on their own side.
export type LooseRegister = (
  name: string,
  config: Record<string, unknown>,
  handler: (args: never, ctx: ServerContext) => Promise<unknown>,
) => void;
export const registerLoose = (server: McpServer) =>
  server.registerTool.bind(server) as unknown as LooseRegister;
