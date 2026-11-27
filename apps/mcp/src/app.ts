import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  originValidationResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import type { SkillCatalog } from "@modelcontextprotocol/server/ext/skills";
import { scopes, tokenVerifier } from "./auth";
import type { Deps } from "./deps";
import { createRuntime } from "./runtime";
import { createServer } from "./server";

// A web-standard `fetch(request)` app, so tests drive it in-process and Node only adapts it.
export function createApp(deps: Deps, skills?: SkillCatalog) {
  const { config } = deps;
  const resource = new URL(config.resourceUrl);
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
  const rt = createRuntime(deps);
  const handler = createMcpHandler(() => createServer(rt, skills), {
    onerror: (error) => console.error("mcp:", error.message),
  });
  const gate = requireBearerAuth({
    verifier: tokenVerifier(deps),
    requiredScopes: [scopes.read],
    resourceMetadataUrl: metadataUrl,
    expectedResource: resource,
  });
  const metadata = {
    resource: config.resourceUrl,
    authorization_servers: [config.issuer],
    scopes_supported: [scopes.read, scopes.write],
    bearer_methods_supported: ["header"],
    resource_name: "OpenStock AI",
  };
  return {
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (pathname === "/health" && request.method === "GET")
        return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
      // DNS rebinding protection: only the configured host names, and no foreign browser origins.
      const rejected =
        hostHeaderValidationResponse(request, config.allowedHosts) ??
        originValidationResponse(request, config.allowedHosts);
      if (rejected) return rejected;
      if (pathname === new URL(metadataUrl).pathname && request.method === "GET")
        return Response.json(metadata, {
          headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
        });
      if (pathname === resource.pathname) {
        const auth = await gate(request);
        if (auth instanceof Response) return auth;
        return handler.fetch(request, { authInfo: auth });
      }
      return new Response("Not found", { status: 404 });
    },
    close: () => handler.close(),
  };
}
