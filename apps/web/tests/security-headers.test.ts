import assert from "node:assert/strict";
import { test } from "node:test";
import nextConfig from "../next.config";

test("every response forbids framing", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const all = rules.find((r) => r.source === "/:path*");
  const value = (key: string) => all?.headers.find((h) => h.key === key)?.value;
  assert.equal(value("Content-Security-Policy"), "frame-ancestors 'none'");
  assert.equal(value("X-Frame-Options"), "DENY");
});
