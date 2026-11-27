import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findGrant,
  listConnectedApps,
  revokeConnectedApp,
  type Queryable,
} from "../src/server/connected-apps";

const userId = "0b1c6a3e-6d0e-4f0c-8f0d-3c1a2b4d5e6f";
const clientId = "https://client.example.com/meta.json";

// A tiny in-memory stand-in for the three OAuth tables, keyed by the statement's intent.
function fakeDb() {
  const consents = new Set([`${userId}|${clientId}`]);
  const calls: { text: string; values: unknown[] }[] = [];
  const db: Queryable = {
    async query(text, values) {
      calls.push({ text, values });
      const key = `${values[0]}|${values[1]}`;
      if (text.includes("WITH access AS")) {
        const had = consents.delete(key);
        return { rows: [{ revoked: had ? 1 : 0 }] };
      }
      if (text.includes('SELECT c."scopes", o."name"')) {
        return {
          rows: consents.has(key) ? [{ scopes: ["inventory:read"], name: "Acme" }] : [],
        };
      }
      return {
        rows: [...consents].map((entry) => ({
          clientId: entry.split("|")[1],
          scopes: ["inventory:read"],
          createdAt: new Date("2026-11-01T10:00:00Z"),
          name: " Acme ",
        })),
      };
    },
  };
  return { db, calls };
}

test("revoking deletes the consent and every token of that client in one statement", async () => {
  const { db, calls } = fakeDb();
  assert.equal(await revokeConnectedApp(db, userId, clientId), 1);
  assert.equal(calls.length, 1);
  const sql = calls[0]!.text;
  for (const table of ["oauthAccessToken", "oauthRefreshToken", "oauthConsent"])
    assert.match(sql, new RegExp(`DELETE FROM auth\\."${table}"`));
  assert.deepEqual(calls[0]!.values, [userId, clientId]);
  assert.equal(await revokeConnectedApp(db, userId, clientId), 0);
});

test("after a revoke the grant lookup behind the MCP token exchange finds nothing", async () => {
  const { db } = fakeDb();
  assert.deepEqual(await findGrant(db, userId, clientId), {
    scopes: ["inventory:read"],
    clientName: "Acme",
  });
  await revokeConnectedApp(db, userId, clientId);
  assert.equal(await findGrant(db, userId, clientId), null);
});

test("connected apps list names, https hosts, scopes and the grant date", async () => {
  const { db } = fakeDb();
  assert.deepEqual(await listConnectedApps(db, userId), [
    {
      clientId,
      name: "Acme",
      host: "client.example.com",
      scopes: ["inventory:read"],
      grantedAt: "2026-11-01T10:00:00.000Z",
    },
  ]);
});
