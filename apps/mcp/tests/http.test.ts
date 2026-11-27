import assert from "node:assert/strict";
import { test } from "node:test";
import { config, ids, now, setup, token } from "./harness";

const initBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
const post = (
  call: Awaited<ReturnType<typeof setup>>["call"],
  bearer?: string,
  headers: Record<string, string> = {},
) =>
  call(config.resourceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: initBody,
  });
const metadataUrl = "http://localhost:3100/.well-known/oauth-protected-resource/mcp";

test("health answers without credentials", async () => {
  const { call } = await setup();
  const response = await call("http://localhost:3100/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("protected resource metadata (RFC 9728)", async () => {
  const { call } = await setup();
  const response = await call(metadataUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    resource: config.resourceUrl,
    authorization_servers: [config.issuer],
    scopes_supported: ["inventory:read", "inventory:write"],
    bearer_methods_supported: ["header"],
    resource_name: "OpenStock AI",
  });
});

test("no token: 401 with a resource_metadata challenge", async () => {
  const { call } = await setup();
  const response = await post(call);
  assert.equal(response.status, 401);
  const challenge = response.headers.get("www-authenticate") ?? "";
  assert.match(challenge, /^Bearer /);
  assert.ok(challenge.includes(`resource_metadata="${metadataUrl}"`), challenge);
});

const bad: [string, () => Promise<string>][] = [
  ["garbage", async () => "not-a-jwt"],
  ["wrong audience", () => token({ aud: "http://localhost:3100/other" })],
  ["wrong issuer", () => token({ iss: "http://evil.example" })],
  ["wrong typ", () => token({}, { typ: "JWT" })],
  ["expired", () => token({}, {}, Math.floor(now() / 1000) - 60)],
  ["missing azp", () => token({ azp: undefined })],
];
for (const [name, make] of bad)
  test(`bad token (${name}): 401 invalid_token, never forwarded`, async () => {
    const { call, fake } = await setup();
    const response = await post(call, await make());
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
    assert.ok(!(await response.clone().text()).includes("eyJ"), "the token is not echoed");
    assert.equal(fake.state.exchanges, 0);
  });

test("a token without inventory:read is refused with insufficient_scope", async () => {
  const { call } = await setup();
  const response = await post(call, await token({ scope: "openid" }));
  assert.equal(response.status, 403);
  assert.match(response.headers.get("www-authenticate") ?? "", /insufficient_scope/);
});

test("host and origin validation", async () => {
  const { call } = await setup();
  const valid = await token();
  const rebound = await post(call, valid, { host: "evil.example" });
  assert.equal(rebound.status, 403);
  const foreign = await post(call, valid, { origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
  assert.equal((await post(call, valid)).status, 200);
});

test("a read-only token cannot call a write tool: 403 insufficient_scope", async () => {
  const { connect, fake } = await setup();
  const client = await connect(await token({ scope: "openid inventory:read" }));
  await assert.rejects(
    client.callTool({ name: "archive_product", arguments: { id: ids.product } }),
    (error: Error & { status?: number; data?: unknown }) => {
      assert.match(
        `${error.message} ${JSON.stringify(error.data ?? {})}`,
        /insufficient_scope|inventory:write/,
      );
      return true;
    },
  );
  assert.equal(fake.state.calls.filter((c) => c.url.startsWith(config.apiUrl)).length, 0);
  await client.close();
});
