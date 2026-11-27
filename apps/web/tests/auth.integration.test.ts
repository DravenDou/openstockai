import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client } from "pg";

const enabled = Boolean(process.env.TEST_DATABASE_URL?.includes("/openstock_auth_test_"));
import { getAuth, authDatabase, ownerExists } from "../src/server/auth";
after(async () => {
  if (enabled) await authDatabase().end();
});

test(
  "Better Auth: single-owner sign-up, sign-in, JWT claims, sign-out, rate limiting",
  { skip: !enabled },
  async () => {
    const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    const request = async (
      path: string,
      body?: unknown,
      cookie = "",
      extra: Record<string, string> = {},
    ) => {
      const response = await getAuth().handler(
        new Request(`http://localhost:3017/api/auth/${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Origin: "http://localhost:3017",
            "Content-Type": "application/json",
            Cookie: cookie,
            ...extra,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      const value = await response.json();
      const cookies = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      return { response, value, cookie: cookies };
    };
    try {
      const password = "Local-test-password-2026";
      assert.equal(await ownerExists(), false);
      const short = await request("sign-up/email", {
        name: "Owner",
        email: "owner@example.test",
        password: "too-short",
      });
      assert.ok(short.response.status >= 400, "passwords under 12 characters are rejected");
      const owner = await request("sign-up/email", {
        name: "Owner",
        email: "owner@example.test",
        password,
      });
      assert.equal(owner.response.status, 200);
      assert.equal(await ownerExists(), true);
      // Sign-up is closed once the owner exists.
      const second = await request("sign-up/email", {
        name: "Intruder",
        email: "intruder@example.test",
        password,
      });
      assert.equal(second.response.status, 403);
      assert.equal(second.value.code, "SIGNUP_CLOSED");
      assert.equal((await db.query('SELECT count(*)::int AS n FROM auth."user"')).rows[0].n, 1);
      // Even a direct insert cannot create a second user: the unique index backs the hook.
      await assert.rejects(
        db.query(
          `INSERT INTO auth."user" ("name","email","emailVerified") VALUES ('x','x@example.test',false)`,
        ),
      );
      const wrong = await request("sign-in/email", { email: "owner@example.test", password: "x".repeat(12) });
      assert.ok(wrong.response.status >= 400);
      const login = await request("sign-in/email", { email: "owner@example.test", password });
      assert.equal(login.response.status, 200);
      const token = await request("token", undefined, login.cookie);
      assert.equal(token.response.status, 200);
      const payload = JSON.parse(Buffer.from(String(token.value.token).split(".")[1], "base64url").toString());
      assert.equal(payload.sub, owner.value.user.id);
      assert.match(payload.sid, /^[0-9a-f-]{36}$/);
      assert.equal(payload.organizationId, undefined);
      assert.equal((await request("sign-out", {}, login.cookie)).response.status, 200);
      assert.equal((await request("get-session", undefined, login.cookie)).value, null);
      let limited = false;
      for (let i = 0; i < 70; i++) {
        const result = await request(
          "sign-in/email",
          { email: "absent@example.test", password },
          "",
          { "x-forwarded-for": `192.0.2.${i + 1}`, "x-real-ip": `198.51.100.${i + 1}` },
        );
        if (result.response.status === 429) {
          limited = true;
          break;
        }
      }
      assert.ok(limited, "rotating untrusted IP headers bypassed rate limiting");
    } finally {
      await db.end();
    }
  },
);
