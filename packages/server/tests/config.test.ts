import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { serverEnv } from "../src/env";

const bootstrap = resolve("../../scripts/setup-local.mjs");
const template = resolve("../../.env.example");
for (const existing of [false, true]) {
  test(`bootstrap ${existing ? "existing" : "new"} env preserves values and is idempotent`, () => {
    const directory = mkdtempSync(join(tmpdir(), "openstockai-config-"));
    try {
      copyFileSync(template, join(directory, ".env.example"));
      const original =
        'WEB_PORT=3020\nAPI_PORT=8089\nPOSTGRES_PORT=55439\nLLM_MODEL="custom/model #1"\nLLM_API_KEY="private-$-value"\nBETTER_AUTH_SECRET="01234567890123456789012345678901"\n';
      if (existing) writeFileSync(join(directory, ".env"), original);
      const run = () => execFileSync(process.execPath, [bootstrap], { cwd: directory });
      run();
      const first = readFileSync(join(directory, ".env"), "utf8");
      const values = parseEnv(first);
      for (const key of Object.keys(parseEnv(readFileSync(template, "utf8"))))
        assert.ok(key in values, key);
      if (existing)
        for (const [key, value] of Object.entries(parseEnv(original)))
          assert.equal(values[key], value);
      assert.equal(new URL(values.DATABASE_URL!).port, existing ? "55439" : "55432");
      assert.equal(new URL(values.AUTH_DATABASE_URL!).username, "openstock_auth_login");
      assert.equal(new URL(values.API_DATABASE_URL!).username, "openstock_api_login");
      assert.equal(statSync(join(directory, ".env")).mode & 0o777, 0o600);
      run();
      assert.equal(readFileSync(join(directory, ".env"), "utf8"), first);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
test("invalid bootstrap URL fails without disclosing input", () => {
  const directory = mkdtempSync(join(tmpdir(), "openstockai-config-"));
  try {
    copyFileSync(template, join(directory, ".env.example"));
    writeFileSync(join(directory, ".env"), "DATABASE_URL=private-invalid-secret\n");
    const result = spawnSync(process.execPath, [bootstrap], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL/);
    assert.doesNotMatch(result.stderr + result.stdout, /private-invalid-secret/);
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

test("a copied template gets private database credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "openstockai-config-"));
  try {
    copyFileSync(template, join(directory, ".env.example"));
    copyFileSync(template, join(directory, ".env"));
    execFileSync(process.execPath, [bootstrap], { cwd: directory });
    const values = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    assert.notEqual(values.POSTGRES_PASSWORD, "change-me");
    assert.equal(
      decodeURIComponent(new URL(values.DATABASE_URL!).password),
      values.POSTGRES_PASSWORD,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
