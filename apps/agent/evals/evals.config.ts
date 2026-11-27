import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineEvalConfig } from "eve/evals";
import { FIXTURE_EMAIL, FIXTURE_PROJECT, FIXTURE_STORE } from "./seed";

const lookup = z.array(z.object({ id: z.uuid(), name: z.string() }));
const fixtureSchema = z.object({
  project: z.literal(FIXTURE_PROJECT),
  base: z.url(),
  agentUrl: z.url(),
  owner: z.object({ id: z.uuid(), cookie: z.string().min(1) }),
  products: z.array(z.object({ id: z.uuid(), sku: z.string(), name: z.string() })),
  warehouses: lookup,
  categories: lookup,
  suppliers: lookup,
});
const local = ["localhost", "127.0.0.1", "[::1]"];

// The guard refuses to run unless the target is the throwaway eval stack created by
// `pnpm agent:eval`: a local agent URL that matches the fixture file, the fixture owner
// and the fixture store name. Real businesses never match all of these.
export default defineEvalConfig({
  maxConcurrency: 1,
  timeoutMs: 180_000,
  async setup() {
    const flag = process.argv.findIndex((arg) => arg === "--url" || arg.startsWith("--url="));
    assert(flag >= 0, "Run evals with `pnpm agent:eval`; it needs --url for the fixture agent.");
    const arg = process.argv[flag];
    const target = (arg.startsWith("--url=") ? arg.slice(6) : process.argv[flag + 1])?.replace(
      /\/$/,
      "",
    );
    assert(
      process.env.OPENSTOCK_EVAL_FIXTURE,
      "OPENSTOCK_EVAL_FIXTURE is not set. Run `pnpm agent:eval`, which creates an isolated fixture stack.",
    );
    const fixture = fixtureSchema.parse(
      JSON.parse(readFileSync(process.env.OPENSTOCK_EVAL_FIXTURE, "utf8")),
    );
    assert.equal(
      target,
      fixture.agentUrl.replace(/\/$/, ""),
      "The eval target must match the fixture agent.",
    );
    for (const url of [fixture.base, fixture.agentUrl])
      assert(local.includes(new URL(url).hostname), "Only local targets are allowed.");
    const headers = { Cookie: fixture.owner.cookie, Origin: fixture.base };
    const identity = await fetch(`${fixture.base}/api/backend/identity`, { headers });
    assert(identity.ok, "The fixture owner must be signed in.");
    const who = z.object({ user_id: z.uuid(), email: z.string() }).parse(await identity.json());
    assert.equal(who.user_id, fixture.owner.id);
    assert.equal(who.email, FIXTURE_EMAIL, "This instance is not the eval fixture.");
    const settings = await fetch(`${fixture.base}/api/backend/settings`, { headers });
    assert(settings.ok, "Could not read the fixture settings.");
    const { store } = z.object({ store: z.string() }).parse(await settings.json());
    assert.equal(store, FIXTURE_STORE, "This instance is not the eval fixture; refusing to run.");
    return fixture;
  },
});
