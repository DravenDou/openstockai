import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose";
import { handleMcpToken, type McpTokenDeps } from "../src/server/mcp-token";

const issuer = "http://localhost:3000";
const resource = "http://localhost:3100/mcp";
const secret = "m".repeat(32);
const userId = "0b1c6a3e-6d0e-4f0c-8f0d-3c1a2b4d5e6f";
const clientId = "https://client.example.com/oauth/metadata.json";
Object.assign(process.env, {
  DATABASE_URL: "postgresql://user:pw@localhost/db",
  BETTER_AUTH_URL: issuer,
  BETTER_AUTH_SECRET: "s".repeat(32),
  API_BASE_URL: "http://api:8087",
  AGENT_SERVICE_SECRET: "a".repeat(32),
});
delete process.env.MCP_RESOURCE_URL;

let signing: CryptoKeyPair;
let jwks: JSONWebKeySet;
before(async () => {
  signing = await generateKeyPair("EdDSA", { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "EdDSA" }] };
});
afterEach(() => {
  process.env.MCP_SERVICE_SECRET = secret;
});

async function accessToken(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  options: { issuer?: string; audience?: string; exp?: string } = {},
) {
  const jwt = new SignJWT({ scope: "inventory:read inventory:write", azp: clientId, ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: "at+jwt", ...header })
    .setSubject(userId)
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? resource)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "1h");
  return jwt.sign(signing.privateKey);
}
function deps(overrides: Partial<McpTokenDeps> = {}) {
  const signed: unknown[] = [];
  const value: McpTokenDeps = {
    jwks: async () => jwks,
    grant: async () => ({ scopes: ["inventory:read", "inventory:write"], clientName: "Acme" }),
    sign: async (payload) => {
      signed.push(payload);
      const exp = Math.floor(Date.now() / 1000) + 300;
      return `h.${Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url")}.s`;
    },
    ...overrides,
  };
  return { value, signed };
}
function call(body: unknown, headers: Record<string, string> = { "X-MCP-Secret": secret }) {
  return new Request("http://web/api/internal/mcp-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
async function expectFailure(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(((await response.json()) as { code: string }).code, code);
}

test("a missing or wrong service secret is forbidden before the token is looked at", async () => {
  process.env.MCP_SERVICE_SECRET = secret;
  const { value } = deps({
    jwks: async () => {
      throw new Error("must not be reached");
    },
  });
  const token = await accessToken();
  await expectFailure(
    await handleMcpToken(call({ accessToken: token }, {}), value),
    403,
    "FORBIDDEN",
  );
  await expectFailure(
    await handleMcpToken(call({ accessToken: token }, { "X-MCP-Secret": "x".repeat(32) }), value),
    403,
    "FORBIDDEN",
  );
  // The agent secret does not open the MCP route.
  await expectFailure(
    await handleMcpToken(call({ accessToken: token }, { "X-Agent-Secret": "a".repeat(32) }), value),
    403,
    "FORBIDDEN",
  );
});

test("the route answers 503 MCP_DISABLED when MCP_SERVICE_SECRET is unset", async () => {
  delete process.env.MCP_SERVICE_SECRET;
  await expectFailure(
    await handleMcpToken(call({ accessToken: await accessToken() }), deps().value),
    503,
    "MCP_DISABLED",
  );
});

test("malformed bodies and unusable tokens are rejected", async () => {
  const { value } = deps();
  await expectFailure(await handleMcpToken(call({}), value), 400, "INVALID_REQUEST");
  await expectFailure(
    await handleMcpToken(call({ accessToken: "not-a-jwt" }), value),
    401,
    "INVALID_TOKEN",
  );
  const expired = await accessToken({}, {}, { exp: "-1m" });
  await expectFailure(
    await handleMcpToken(call({ accessToken: expired }), value),
    401,
    "INVALID_TOKEN",
  );
  const stranger = await generateKeyPair("EdDSA");
  const forged = await new SignJWT({ azp: clientId })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: "at+jwt" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(resource)
    .setExpirationTime("1h")
    .sign(stranger.privateKey);
  await expectFailure(
    await handleMcpToken(call({ accessToken: forged }), value),
    401,
    "INVALID_TOKEN",
  );
});

test("wrong audience, issuer, typ, missing azp and non-user subjects are rejected", async () => {
  const { value } = deps();
  const cases = [
    await accessToken({}, {}, { audience: "openstockai-api" }),
    await accessToken({}, {}, { audience: "http://localhost:3100/other" }),
    await accessToken({}, {}, { issuer: "https://evil.example.com" }),
    await accessToken({}, { typ: "JWT" }),
    await accessToken({ azp: undefined }),
    await accessToken({ azp: "" }),
    await accessToken({ azp: "a".repeat(513) }),
    // A client-credentials style token names the client, not a user, as subject.
    await new SignJWT({ azp: clientId })
      .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: "at+jwt" })
      .setSubject(clientId)
      .setIssuer(issuer)
      .setAudience(resource)
      .setExpirationTime("1h")
      .sign(signing.privateKey),
  ];
  for (const token of cases)
    await expectFailure(
      await handleMcpToken(call({ accessToken: token }), value),
      401,
      "INVALID_TOKEN",
    );
});

test("an audience list that contains the MCP resource is accepted (openid adds the userinfo endpoint)", async () => {
  const { value } = deps();
  const token = await new SignJWT({ azp: clientId, scope: "openid inventory:read" })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: "at+jwt" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience([resource, `${issuer}/api/auth/oauth2/userinfo`])
    .setExpirationTime("1h")
    .sign(signing.privateKey);
  const response = await handleMcpToken(call({ accessToken: token }), value);
  assert.equal(response.status, 200);
  assert.deepEqual(((await response.json()) as { scopes: string[] }).scopes, ["inventory:read"]);
});

test("a session JWT for the Go API is not accepted as an MCP access token", async () => {
  const { value } = deps();
  const session = await new SignJWT({ sid: userId })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience("openstockai-api")
    .setExpirationTime("5m")
    .sign(signing.privateKey);
  await expectFailure(
    await handleMcpToken(call({ accessToken: session }), value),
    401,
    "INVALID_TOKEN",
  );
});

test("a revoked grant is rejected even though the access token is still valid", async () => {
  const { value, signed } = deps({ grant: async () => null });
  await expectFailure(
    await handleMcpToken(call({ accessToken: await accessToken() }), value),
    403,
    "GRANT_REVOKED",
  );
  assert.deepEqual(signed, []);
});

test("the happy path mints an MCP actor token and returns the contract payload", async () => {
  const lookups: unknown[] = [];
  const { value, signed } = deps({
    grant: async (user, client) => {
      lookups.push([user, client]);
      return { scopes: ["inventory:read", "inventory:write"], clientName: "Acme" };
    },
  });
  const response = await handleMcpToken(call({ accessToken: await accessToken() }), value);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(lookups, [[userId, clientId]]);
  assert.deepEqual(signed, [
    { sub: userId, act: "mcp", cid: clientId, scope: "inventory:read inventory:write" },
  ]);
  assert.deepEqual(Object.keys(body).sort(), [
    "clientId",
    "clientName",
    "expiresAt",
    "scopes",
    "token",
    "userId",
  ]);
  assert.equal(body.userId, userId);
  assert.equal(body.clientId, clientId);
  assert.equal(body.clientName, "Acme");
  assert.deepEqual(body.scopes, ["inventory:read", "inventory:write"]);
  assert.ok(Math.abs(Date.parse(body.expiresAt as string) - (Date.now() + 300_000)) < 5000);
});

test("granted scopes are the intersection of the token and the current consent", async () => {
  const { value, signed } = deps({
    grant: async () => ({ scopes: ["inventory:read"], clientName: null }),
  });
  const response = await handleMcpToken(call({ accessToken: await accessToken() }), value);
  const body = (await response.json()) as { scopes: string[]; clientName: string | null };
  assert.deepEqual(body.scopes, ["inventory:read"]);
  // The Go token carries the narrowed scopes, so Go refuses writes for a read-only grant.
  assert.deepEqual((signed[0] as { scope: string }).scope, "inventory:read");
  assert.equal(body.clientName, null);
});
