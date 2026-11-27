import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineEvalConfig } from "eve/evals";
const fixtureSchema = z.object({
  base: z.url(),
  compiled: z.literal(true),
  provider: z.enum(["controlled", "deepinfra"]),
  owner: z.object({ id: z.uuid(), cookie: z.string().min(1) }),
  products: z.array(z.object({ id: z.uuid(), sku: z.string() })),
  warehouses: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export default defineEvalConfig({
  maxConcurrency: 1,
  timeoutMs: 180_000,
  async setup() {
    const target =
      process.argv.find((arg) => arg.startsWith("--url="))?.slice(6) ||
      process.argv[process.argv.indexOf("--url") + 1];
    assert(
      process.argv.some((arg) => arg === "--url" || arg.startsWith("--url=")),
      "Evals require --url pointing at the compiled local runtime.",
    );
    assert(
      process.env.OPENSTOCK_EVAL_FIXTURE,
      "Set OPENSTOCK_EVAL_FIXTURE to an isolated synthetic fixture; never use a business account.",
    );
    const fixture = fixtureSchema.parse(
      JSON.parse(readFileSync(process.env.OPENSTOCK_EVAL_FIXTURE, "utf8")),
    );
    assert.equal(
      target?.replace(/\/$/, ""),
      fixture.base,
      "The eval target must match the isolated fixture.",
    );
    assert(
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(fixture.base).hostname),
      "Only a local target is allowed.",
    );
    const headers = { Cookie: fixture.owner.cookie, Origin: fixture.base };
    const identity = await fetch(`${fixture.base}/api/backend/v1/identity`, { headers });
    assert(identity.ok, "The synthetic owner must be signed in.");
    const who = z.object({ user_id: z.uuid(), email: z.string() }).parse(await identity.json());
    assert.equal(who.user_id, fixture.owner.id);
    assert(who.email.startsWith("fixture-"), "Evals cannot run on business data.");
    return fixture;
  },
});
