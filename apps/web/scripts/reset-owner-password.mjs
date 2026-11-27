#!/usr/bin/env node
// Resets the password of the single owner account and revokes all of its sessions.
//
// Usage:
//   pnpm owner:reset-password                       (prompts, input hidden)
//   printf '%s\n' "$NEW_PASSWORD" | pnpm owner:reset-password   (reads one line from stdin)
//
// The password is never accepted as an argument. Hashing uses Better Auth's own
// `hashPassword` (the same function its email/password sign-in verifies against).
// Needs only DATABASE_URL (or AUTH_DATABASE_URL), `pg` and `better-auth`.
import { hashPassword } from "better-auth/crypto";
import { createInterface } from "node:readline";
import pg from "pg";

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

try {
  const { default: nextEnv } = await import("@next/env");
  nextEnv.loadEnvConfig(process.cwd());
} catch {
  // @next/env is a dev convenience; real environment variables are enough.
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
if (process.argv.length > 2) fail("This command takes no arguments. The password is read from stdin.");
const connectionString = process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) fail("Set DATABASE_URL (or AUTH_DATABASE_URL).");

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          input.setRawMode(false);
          input.pause();
          process.stdout.write("\n");
          return reject(new Error("Cancelled."));
        }
        if (char === "\r" || char === "\n") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    input.on("data", onData);
  });
}
async function readPassword() {
  if (process.stdin.isTTY) {
    const first = await promptHidden("New owner password: ");
    const second = await promptHidden("Repeat the password: ");
    if (first !== second) fail("The passwords do not match.");
    return first;
  }
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    lines.close();
    return line;
  }
  return "";
}

const password = await readPassword();
if (password.length < MIN_LENGTH) fail(`The password must have at least ${MIN_LENGTH} characters.`);
if (password.length > MAX_LENGTH) fail(`The password must have at most ${MAX_LENGTH} characters.`);

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  const users = await client.query(`SELECT id, email FROM auth."user" ORDER BY "createdAt" LIMIT 2`);
  if (users.rowCount === 0) throw new Error("No owner exists yet. Open the app and create the owner account first.");
  const owner = users.rows[0];
  const hash = await hashPassword(password);
  const updated = await client.query(
    `UPDATE auth."account" SET "password"=$1, "updatedAt"=now() WHERE "userId"=$2 AND "providerId"='credential'`,
    [hash, owner.id],
  );
  if (updated.rowCount === 0) throw new Error("The owner has no email/password credential.");
  const revoked = await client.query(`DELETE FROM auth."session" WHERE "userId"=$1`, [owner.id]);
  await client.query("COMMIT");
  console.log(`Password reset for ${owner.email}. Revoked ${revoked.rowCount} session(s).`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  fail(error instanceof Error ? error.message : "Password reset failed.");
} finally {
  await client.end();
}
