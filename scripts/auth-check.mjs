import nextEnv from "@next/env";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");
const name = `openstock_auth_test_${randomBytes(8).toString("hex")}`;
const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const run = (command, args, env) => {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
};
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  const env = {
    ...process.env,
    DATABASE_URL: String(url),
    TEST_DATABASE_URL: String(url),
    AUTH_DATABASE_URL: String(url),
    BETTER_AUTH_URL: "http://localhost:3017",
  };
  run(process.execPath, ["scripts/api.mjs", "--migrate"], env);
  run(
    "pnpm",
    ["--filter", "@openstockai/web", "exec", "tsx", "--test", "tests/auth.integration.test.ts"],
    env,
  );
} finally {
  // Generated identifier only; never drop any other database.
  if (!/^openstock_auth_test_[0-9a-f]{16}$/.test(name)) throw new Error("Invalid test database.");
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
