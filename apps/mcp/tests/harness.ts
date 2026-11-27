import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";
import { createApp } from "../src/app";
import { mcpConfig } from "../src/env";

export const ids = {
  user: "7a1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
  product: "11111111-1111-4111-8111-111111111111",
  main: "22222222-2222-4222-8222-222222222222",
  second: "33333333-3333-4333-8333-333333333333",
  archived: "44444444-4444-4444-8444-444444444444",
};
export const env = {
  MCP_PORT: "3100",
  MCP_RESOURCE_URL: "http://localhost:3100/mcp",
  BETTER_AUTH_URL: "http://localhost:3000",
  AUTH_INTERNAL_URL: "http://web.test:3017",
  API_BASE_URL: "http://api.test:8087",
  MCP_SERVICE_SECRET: "s".repeat(40),
  MCP_STATE_SECRET: "k".repeat(40),
};
export const config = mcpConfig(env);
const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "EdDSA", use: "sig" };
// The SDK bearer gate checks exp against the real clock, so the tests use it too.
const clock = { now: Date.now() };
export const now = () => clock.now;

export async function token(
  claims: Record<string, unknown> = {},
  header: { typ?: string } = {},
  exp = Math.floor(clock.now / 1000) + 600,
) {
  const payload = {
    scope: "openid inventory:read inventory:write",
    azp: "https://client.example/metadata.json",
    ...claims,
  };
  const jwt = new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ: header.typ ?? "at+jwt" })
    .setIssuer((claims.iss as string) ?? config.issuer)
    .setSubject(ids.user)
    .setIssuedAt(Math.floor(clock.now / 1000))
    .setExpirationTime(exp);
  // aud may be a list: Better Auth adds the userinfo endpoint when openid is granted.
  jwt.setAudience(
    (claims.aud as string | string[]) ?? [
      config.resourceUrl,
      `${config.issuer}/api/auth/oauth2/userinfo`,
    ],
  );
  return jwt.sign(privateKey);
}

type Action = {
  id: string;
  operation: string;
  toolInput: unknown;
  ownerRequired: boolean;
  approval: "pending" | "approved" | "rejected" | "not_required";
  completed: boolean;
};
export type Call = { method: string; url: string; headers: Headers; body: unknown };

// A fake web app (JWKS, token exchange) and Go API in one injected fetch.
export function backend() {
  const state = {
    calls: [] as Call[],
    actions: new Map<string, Action>(),
    // How POST /v1/agent-actions answers: no approval, in-client approval, or owner approval.
    policy: "client" as "not_required" | "client" | "owner" | "rejected",
    // The owner decides in the web app before the client's approval POST arrives (409).
    race: undefined as undefined | "approved" | "rejected" | "completed",
    // The client-mode approval POST is answered OWNER_APPROVAL_REQUIRED (policy changed since).
    escalate: false,
    // How many warehouses and products the fake holds (to exercise the list caps).
    many: 0,
    revoked: false,
    exchanges: 0,
  };
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  const fail = (code: string, status: number) => json({ error: { code, message: code } }, status);
  const product = {
    id: ids.product,
    name: "Claw hammer",
    sku: "HAM-001",
    barcode: "",
    description: "",
    location: "",
    icon: "package",
    minimum: 5,
    category_id: null,
    category: "Tools",
    cost_price: "9.50",
    sale_price: "14.99",
    stock: 12,
    unit_code: "unit",
    unit_symbol: "u",
    unit_name: "Unit",
    unit_decimals: 0,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.clone().text();
    const body = text ? JSON.parse(text) : undefined;
    state.calls.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (url.href === `${config.authUrl}/api/auth/jwks`) return json({ keys: [jwk] });
    if (url.href === `${config.authUrl}/api/internal/mcp-token`) {
      state.exchanges++;
      if (request.headers.get("x-mcp-secret") !== env.MCP_SERVICE_SECRET)
        return json({ code: "FORBIDDEN" }, 403);
      if (state.revoked) return json({ code: "GRANT_REVOKED" }, 403);
      const claims = JSON.parse(
        Buffer.from(body.accessToken.split(".")[1], "base64url").toString(),
      );
      return json({
        token: "go-token",
        expiresAt: new Date(clock.now + 300_000).toISOString(),
        userId: claims.sub,
        clientId: claims.azp,
        clientName: "Test client",
        scopes: String(claims.scope)
          .split(" ")
          .filter((s) => s.startsWith("inventory:")),
      });
    }
    if (url.origin !== config.apiUrl) return json({ code: "UNEXPECTED" }, 500);
    if (
      request.headers.get("authorization") !== "Bearer go-token" ||
      request.headers.get("x-mcp-secret") !== env.MCP_SERVICE_SECRET
    )
      return fail("UNAUTHORIZED", 401);
    const path = url.pathname;
    if (request.method === "GET") {
      // Like Go, GET /v1/products/{id} finds only active products; archived ones are listed.
      if (path === "/v1/products" && url.searchParams.get("status") === "archived")
        return json({
          items: [{ ...product, id: ids.archived, name: "Old hammer", sku: "OLD-1" }],
          total: 1,
        });
      if (path === "/v1/products")
        return json({
          items: Array.from(
            { length: Math.min(state.many || 1, Number(url.searchParams.get("limit") ?? 20)) },
            () => product,
          ),
          total: state.many || 1,
        });
      if (path === "/v1/products/by-sku") return json(product);
      if (path === `/v1/products/${ids.product}`) return json(product);
      if (path === "/v1/inventory")
        return json([{ warehouse_id: ids.main, product_id: ids.product, quantity: 12 }]);
      if (path === `/v1/warehouses/${ids.main}`) return json({ id: ids.main, name: "Main" });
      if (path === "/v1/warehouses")
        return json(
          Array.from(
            { length: Math.min(state.many || 1, Number(url.searchParams.get("limit") ?? 20)) },
            () => ({ id: ids.main, name: "Main" }),
          ),
        );
      if (path === "/v1/stock-movements") return json([]);
      const found = /^\/v1\/agent-actions\/([^/]+)$/.exec(path);
      if (found) {
        const a = state.actions.get(found[1]!);
        if (!a) return fail("NOT_FOUND", 404);
        return json({
          id: a.id,
          operation: a.operation,
          toolInput: a.toolInput,
          status: a.completed ? "completed" : "pending",
          approvalStatus: a.approval,
          actorType: "mcp",
          clientId: "https://client.example/metadata.json",
          ownerApprovalRequired: a.ownerRequired,
          startedAt: new Date(clock.now).toISOString(),
          completedAt: a.completed ? new Date(clock.now).toISOString() : null,
          error: null,
        });
      }
      if (path === "/v1/categories" || path === "/v1/suppliers") return json([]);
      if (path === "/v1/units")
        return json([{ code: "unit", name: "Unit", symbol: "u", decimals: 0, active: true }]);
      if (path === "/v1/low-stock")
        return json([
          {
            id: ids.product,
            name: product.name,
            sku: product.sku,
            minimum: 5,
            stock: 2,
            unit_code: "unit",
            unit_symbol: "u",
          },
        ]);
      if (path === "/v1/inventory/summary")
        return json({ products: 1, low: 1, empty: 0, stock_value: "114.00" });
      return fail("NOT_FOUND", 404);
    }
    if (path === "/v1/agent-actions" && request.method === "POST") {
      const action: Action = {
        id: body.id,
        operation: body.operation,
        toolInput: body.toolInput,
        ownerRequired: state.policy === "owner",
        approval:
          state.policy === "not_required"
            ? "not_required"
            : state.policy === "rejected"
              ? "rejected"
              : "pending",
        completed: false,
      };
      state.actions.set(action.id, action);
      return json({
        id: action.id,
        approvalStatus: action.approval,
        ownerApprovalRequired: action.ownerRequired,
      });
    }
    const approval = /^\/v1\/agent-actions\/([^/]+)\/approval$/.exec(path);
    if (approval) {
      const action = state.actions.get(approval[1]!);
      if (!action) return fail("NOT_FOUND", 404);
      if (state.race) {
        action.approval = state.race === "rejected" ? "rejected" : "approved";
        action.completed = state.race === "completed";
        return fail("ACTION_NOT_PENDING", 409);
      }
      if (body.approved && state.escalate) action.ownerRequired = true;
      if (body.approved && action.ownerRequired) return fail("OWNER_APPROVAL_REQUIRED", 403);
      action.approval = body.approved ? "approved" : "rejected";
      return json({});
    }
    // A mutation: the idempotency key and the action ID are the registered action's ID.
    const action = state.actions.get(request.headers.get("x-agent-action-id") ?? "");
    if (!action || request.headers.get("idempotency-key") !== action.id)
      return fail("ACTION_MISMATCH", 409);
    if (
      action.operation !== `${request.method} ${path}` ||
      JSON.stringify(action.toolInput) !== JSON.stringify(body ?? {})
    )
      return fail("ACTION_MISMATCH", 409);
    if (action.approval === "rejected") return fail("ACTION_REJECTED", 403);
    if (action.approval === "pending") return fail("APPROVAL_REQUIRED", 409);
    action.completed = true;
    if (path === "/v1/products") return json({ id: randomUUID() });
    if (request.method === "DELETE") return json({ id: ids.product, status: "archived" });
    if (path.endsWith("/restore")) return json({ id: ids.product, status: "active" });
    return json({});
  };
  return { state, fetch: fetcher, product };
}

// The app plus a connected SDK client, in-process: no port, no socket.
export async function setup(
  options: { skills?: boolean; wrap?: (base: typeof fetch) => typeof fetch } = {},
) {
  const fake = backend();
  const skills =
    options.skills === false
      ? undefined
      : await loadSkills(new URL("../skills", import.meta.url).pathname, { strict: true });
  const app = createApp(
    { config, fetch: options.wrap ? options.wrap(fake.fetch) : fake.fetch, now },
    skills,
  );
  // The Host header a real client sends; a bare fetch(Request) does not carry one.
  const hooks: { tamper?: (rpc: { params?: Record<string, unknown> }) => void } = {};
  const call = async (url: string | URL, init?: RequestInit) => {
    let request = new Request(url, init);
    if (!request.headers.has("host")) request.headers.set("host", "localhost:3100");
    if (hooks.tamper && request.method === "POST") {
      const rpc = await request
        .clone()
        .json()
        .catch(() => undefined);
      if (rpc?.method === "tools/call") {
        hooks.tamper(rpc);
        if (typeof rpc.params?.name === "string") request.headers.set("mcp-name", rpc.params.name);
        request = new Request(request, { body: JSON.stringify(rpc) });
      }
    }
    return app.fetch(request);
  };
  async function connect(
    accessToken: string,
    elicit?: (params: {
      mode?: string;
      message: string;
      url?: string;
      requestedSchema?: unknown;
    }) => unknown,
    inputRequired?: { maxRounds?: number },
  ) {
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      {
        versionNegotiation: { mode: "auto" },
        capabilities: { elicitation: { form: {}, url: {} } },
        ...(inputRequired ? { inputRequired } : {}),
      },
    );
    client.setRequestHandler(
      "elicitation/create",
      async (request) => (elicit ? elicit(request.params as never) : { action: "cancel" }) as never,
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.resourceUrl), {
        fetch: (url, init) => call(url, init),
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
    );
    return client;
  }
  return { fake, app, call, connect, hooks };
}
export const mutations = (calls: Call[]) =>
  calls.filter(
    (c) =>
      c.url.startsWith(config.apiUrl) && c.method !== "GET" && !c.url.includes("/agent-actions"),
  );
export const adjustArgs = {
  productId: ids.product,
  warehouseId: ids.main,
  quantity: 5,
  type: "adjustment_in" as const,
  reference: "test",
};
