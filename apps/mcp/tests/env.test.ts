import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpConfig } from "../src/env";
import { env } from "./harness";

test("defaults: loopback bind, port 3100, internal URLs fall back to the public ones", () => {
  const { AUTH_INTERNAL_URL, MCP_RESOURCE_URL, ...rest } = env;
  void AUTH_INTERNAL_URL;
  void MCP_RESOURCE_URL;
  const config = mcpConfig(rest);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3100);
  assert.deepEqual(config.allowedHosts, ["localhost", "127.0.0.1"]);
  assert.equal(config.resourceUrl, "http://localhost:3100/mcp");
  assert.equal(config.authUrl, "http://localhost:3000");
  assert.equal(config.appUrl, "http://localhost:3000");
});

test("invalid configuration names the variables and never echoes values", () => {
  const secret = "too-short-secret";
  assert.throws(
    () => mcpConfig({ ...env, MCP_STATE_SECRET: secret, API_BASE_URL: "not a url" }),
    (error: Error) =>
      /MCP_STATE_SECRET/.test(error.message) &&
      /API_BASE_URL/.test(error.message) &&
      !error.message.includes(secret),
  );
  assert.throws(() => mcpConfig({}), /BETTER_AUTH_URL[\s\S]*API_BASE_URL[\s\S]*MCP_SERVICE_SECRET/);
});

test("empty optional variables fall back to their defaults", () => {
  const config = mcpConfig({
    ...env,
    AUTH_INTERNAL_URL: "",
    APP_PUBLIC_URL: "",
    MCP_ALLOWED_HOSTS: "",
  });
  assert.equal(config.authUrl, "http://localhost:3000");
  assert.deepEqual(config.allowedHosts, ["localhost", "127.0.0.1"]);
});
