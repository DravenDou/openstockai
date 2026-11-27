import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { serverEnv } from "../src/env";

const template = resolve("../../.env.example");
const entrypoint = resolve("../../docker/entrypoint.sh");
const init = resolve("../../docker/init.sh");
const secretNames = [
  "POSTGRES_PASSWORD",
  "API_DATABASE_PASSWORD",
  "AUTH_DATABASE_PASSWORD",
  "BETTER_AUTH_SECRET",
  "AGENT_SERVICE_SECRET",
];

test(".env.example only asks for LLM settings and holds no secrets", () => {
  const text = readFileSync(template, "utf8");
  const values = parseEnv(text);
  assert.ok("LLM_PROVIDER" in values && "LLM_MODEL" in values);
  assert.equal(values.LLM_API_KEY, "");
  for (const name of secretNames) assert.ok(!text.includes(name), name);
});

test("init generates each secret once and never rotates it", () => {
  const directory = mkdtempSync(join(tmpdir(), "openstockai-init-"));
  const run = () =>
    execFileSync("sh", [init], {
      env: { ...process.env, SECRETS_DIR: directory },
      encoding: "utf8",
    });
  try {
    const first = run();
    const values = secretNames.map((name) => readFileSync(join(directory, name), "utf8"));
    for (const value of values) assert.match(value, /^[0-9a-f]{64}$/);
    assert.equal(new Set(values).size, secretNames.length);
    for (const value of values) assert.ok(!first.includes(value));
    assert.equal(statSync(join(directory, secretNames[0]!)).mode & 0o777, 0o444);
    assert.match(run(), /already present/);
    assert.deepEqual(
      secretNames.map((name) => readFileSync(join(directory, name), "utf8")),
      values,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("entrypoint loads generated secrets, lets overrides win and maps PGPASSWORD", () => {
  const directory = mkdtempSync(join(tmpdir(), "openstockai-entry-"));
  try {
    writeFileSync(join(directory, "AGENT_SERVICE_SECRET"), "generated-agent");
    writeFileSync(join(directory, "BETTER_AUTH_SECRET"), "generated-auth");
    writeFileSync(join(directory, "AUTH_DATABASE_PASSWORD"), "generated-db");
    const result = spawnSync(
      "sh",
      [entrypoint, "sh", "-c", 'echo "$AGENT_SERVICE_SECRET $BETTER_AUTH_SECRET $PGPASSWORD"'],
      {
        env: {
          PATH: process.env.PATH,
          OPENSTOCK_SECRETS_DIR: directory,
          AGENT_SERVICE_SECRET: "",
          BETTER_AUTH_SECRET: "override-auth",
          DB_PASSWORD_VAR: "AUTH_DATABASE_PASSWORD",
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "generated-agent override-auth generated-db");
    const missing = spawnSync("sh", [entrypoint, "true"], {
      env: { PATH: process.env.PATH, OPENSTOCK_SECRETS_DIR: directory, DB_PASSWORD_VAR: "NOPE" },
      encoding: "utf8",
    });
    assert.notEqual(missing.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("server configuration rejects protocols, credentials in HTTP URLs and missing secrets safely", () => {
  const valid = {
    DATABASE_URL: "postgresql://user:secret@localhost/db",
    BETTER_AUTH_URL: "http://localhost:3017",
    API_BASE_URL: "http://api:8087",
    BETTER_AUTH_SECRET: "s".repeat(32),
    AGENT_SERVICE_SECRET: "a".repeat(32),
  };
  assert.equal(serverEnv(valid).JWT_AUDIENCE, "openstockai-api");
  for (const change of [
    { DATABASE_URL: "https://private-secret/db" },
    { API_BASE_URL: "private-secret" },
    { BETTER_AUTH_URL: "private-secret" },
    { API_BASE_URL: "http://user:private-secret@api" },
    { BETTER_AUTH_URL: "http://localhost/path" },
    { BETTER_AUTH_SECRET: "private-secret" },
  ]) {
    assert.throws(
      () => serverEnv({ ...valid, ...change }),
      (error: Error) => {
        assert.match(error.message, /Invalid configuration/);
        assert.ok(!error.message.includes("private-secret"));
        return true;
      },
    );
  }
});

test("MCP settings default to a loopback resource, stay disabled without a secret and validate when set", () => {
  const valid = {
    DATABASE_URL: "postgresql://user:secret@localhost/db",
    BETTER_AUTH_URL: "http://localhost:3017",
    API_BASE_URL: "http://api:8087",
    BETTER_AUTH_SECRET: "s".repeat(32),
    AGENT_SERVICE_SECRET: "a".repeat(32),
  };
  const defaults = serverEnv(valid);
  assert.equal(defaults.MCP_RESOURCE_URL, "http://localhost:3100/mcp");
  assert.equal(defaults.MCP_SERVICE_SECRET, undefined);
  assert.equal(serverEnv({ ...valid, MCP_SERVICE_SECRET: "" }).MCP_SERVICE_SECRET, undefined);
  assert.equal(
    serverEnv({ ...valid, MCP_SERVICE_SECRET: "m".repeat(32) }).MCP_SERVICE_SECRET,
    "m".repeat(32),
  );
  assert.equal(
    serverEnv({ ...valid, MCP_RESOURCE_URL: "https://mcp.example.com/mcp" }).MCP_RESOURCE_URL,
    "https://mcp.example.com/mcp",
  );
  for (const change of [
    { MCP_SERVICE_SECRET: "private-secret" },
    { MCP_RESOURCE_URL: "http://mcp.example.com/mcp" },
    { MCP_RESOURCE_URL: "https://user:private-secret@mcp.example.com/mcp" },
    { MCP_RESOURCE_URL: "https://mcp.example.com/mcp?x=1" },
    { MCP_RESOURCE_URL: "https://mcp.example.com/mcp#frag" },
  ]) {
    assert.throws(
      () => serverEnv({ ...valid, ...change }),
      (error: Error) => {
        assert.match(error.message, /Invalid configuration: MCP_/);
        assert.ok(!error.message.includes("private-secret"));
        return true;
      },
    );
  }
});
