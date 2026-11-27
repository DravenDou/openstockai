import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve("eslint-config-next"));
const pluginRequire = createRequire(configRequire.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = pluginRequire("./utils/get-root-dirs.js");

test("the ESLint glob replacement preserves literal directories and patterns", () => {
  const literal = getRootDirs({ cwd: process.cwd(), settings: { next: { rootDir: "apps/api" } } });
  assert.deepEqual(literal.map(dir => resolve(dir)), [resolve("apps/api")]);
  for (const rootDir of ["apps/*", ["apps/*"]]) {
    const roots = getRootDirs({ cwd: process.cwd(), settings: { next: { rootDir } } });
    assert.deepEqual(roots.map(dir => resolve(dir)).sort(), ["agent", "api", "web"].map(name => resolve("apps", name)));
  }
  assert.deepEqual(getRootDirs({ cwd: process.cwd(), settings: {} }), [process.cwd()]);
});
