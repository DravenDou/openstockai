import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const repo = resolve(".");
const web = join(repo, "apps/web");
const webSrc = join(web, "src");
const agent = join(repo, "apps/agent");
const mcp = join(repo, "apps/mcp");
const packages = join(repo, "packages");
const SKIP = new Set(["node_modules", ".next", ".eve", ".cache", ".output"]);

function sourceFiles(directory, pattern = /\.tsx?$/) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sourceFiles(path, pattern);
    return pattern.test(path) ? [path] : [];
  });
}

function parse(path) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function specifiers(file) {
  const found = [];
  function visit(node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : undefined;
    if (specifier && ts.isStringLiteral(specifier)) found.push(specifier.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

function resolveFile(base) {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.json`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

const inside = (path, directory) => path === directory || path.startsWith(directory + sep);

// Workspace package specifiers (`@openstockai/<name>/...`) resolve to packages/<name>.
const workspaceName = /^@openstockai\/([^/]+)/;

// ---------------------------------------------------------------------------
// apps/web: resolve aliases, relative imports and workspace packages so moving
// a file cannot bypass a rule.
// ---------------------------------------------------------------------------
const graph = new Map();
const clients = [];
for (const path of sourceFiles(webSrc)) {
  const file = parse(path);
  if (
    file.statements.some(
      (node) => ts.isExpressionStatement(node) && node.expression.text === "use client",
    )
  )
    clients.push(path);
  const edges = [];
  for (const spec of specifiers(file)) {
    if (spec.startsWith("@/") || spec.startsWith(".")) {
      const base = spec.startsWith("@/")
        ? resolve(webSrc, spec.slice(2))
        : resolve(dirname(path), spec);
      const target = resolveFile(base);
      assert.ok(target, `${relative(repo, path)}: unresolved import ${spec}`);
      edges.push(target);
    } else if (/^@openstockai\/server(\/|$)/.test(spec)) {
      // The server package behaves like src/server: a virtual node in the server zone.
      edges.push(join(webSrc, "server", "__workspace__", spec));
    }
  }
  graph.set(path, edges);
}

test("web shared, server, shell and features respect their dependency boundaries", () => {
  assert.ok(graph.size > 50, "The check must walk the real web application code");
  const violations = [];
  for (const [source, targets] of graph) {
    const from = relative(webSrc, source).split(sep);
    for (const target of targets) {
      const to = relative(webSrc, target).split(sep);
      const allowed =
        from[0] === "shared"
          ? to[0] === "shared"
          : from[0] === "server"
            ? ["server", "shared"].includes(to[0])
            : from[0] === "features"
              ? to[0] === "shared" || (to[0] === "features" && to[1] === from[1])
              : from[0] === "shell"
                ? ["shell", "features", "shared"].includes(to[0])
                : true;
      if (!allowed) violations.push(`${relative(webSrc, source)} -> ${relative(webSrc, target)}`);
    }
  }
  assert.deepEqual(violations, [], "Composition between features belongs to shell/app");
});

test("web client components never reach server code, even transitively", () => {
  const violations = [];
  for (const client of clients) {
    const visited = new Set();
    function walk(source, chain) {
      if (visited.has(source)) return;
      visited.add(source);
      if (relative(webSrc, source).startsWith(`server${sep}`)) {
        violations.push(chain.map((path) => relative(webSrc, path)).join(" -> "));
        return;
      }
      for (const target of graph.get(source) ?? []) walk(target, [...chain, target]);
    }
    walk(client, [client]);
  }
  assert.deepEqual(violations, [], "Secrets and server identity must stay out of the client");
});

// ---------------------------------------------------------------------------
// Cross-workspace rules.
// ---------------------------------------------------------------------------
function workspaceViolations(root, forbidden) {
  const violations = [];
  for (const path of sourceFiles(root)) {
    for (const spec of specifiers(parse(path))) {
      let reason;
      if (spec.startsWith(".")) {
        const target = resolve(dirname(path), spec);
        reason = forbidden.paths.find((directory) => inside(target, directory));
      } else {
        const name = workspaceName.exec(spec)?.[1];
        reason = name && forbidden.packages.includes(name) ? `@openstockai/${name}` : undefined;
        if (!reason && /^(apps|packages)\//.test(spec)) reason = spec;
      }
      if (reason) violations.push(`${relative(repo, path)} -> ${spec}`);
    }
  }
  return violations;
}

test("apps/agent never imports apps/web or apps/mcp", () => {
  assert.ok(sourceFiles(agent).length > 10, "The check must walk the real agent code");
  assert.deepEqual(workspaceViolations(agent, { paths: [web, mcp], packages: ["web", "mcp"] }), []);
});

test("apps/mcp imports only packages, never another app", () => {
  assert.ok(sourceFiles(mcp).length > 8, "The check must walk the real MCP code");
  assert.deepEqual(
    workspaceViolations(mcp, {
      paths: [web, agent, join(repo, "apps/api")],
      packages: ["web", "agent"],
    }),
    [],
  );
});

test("packages/schemas is a leaf: no apps and no other workspace package", () => {
  const schemas = join(packages, "schemas");
  assert.ok(sourceFiles(schemas).length > 0, "The check must walk the real schemas code");
  const workspace = [];
  for (const path of sourceFiles(schemas))
    for (const spec of specifiers(parse(path)))
      if (workspaceName.test(spec) || spec.startsWith(".."))
        workspace.push(`${relative(repo, path)} -> ${spec}`);
  assert.deepEqual(workspace, []);
});

test("packages never import from apps", () => {
  assert.ok(sourceFiles(packages).length > 3, "The check must walk the real package code");
  assert.deepEqual(
    workspaceViolations(packages, {
      paths: [join(repo, "apps")],
      packages: ["web", "agent", "mcp"],
    }),
    [],
  );
});

test("the api-client package stays client-safe and does not depend on the server package", () => {
  assert.deepEqual(
    workspaceViolations(join(packages, "api-client"), {
      paths: [join(packages, "server")],
      packages: ["server"],
    }),
    [],
  );
});

// ---------------------------------------------------------------------------
// apps/api (Go): module and layer boundaries, derived from import declarations.
// ---------------------------------------------------------------------------
const api = join(repo, "apps/api");
const goModule = /^module\s+(\S+)/m.exec(readFileSync(join(api, "go.mod"), "utf8"))?.[1];

function goFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return goFiles(path);
    return entry.name.endsWith(".go") && !entry.name.endsWith("_test.go") ? [path] : [];
  });
}

function goImports(path) {
  const source = readFileSync(path, "utf8");
  const block = [...source.matchAll(/^import\s*\(([\s\S]*?)^\)/gm)].map((m) => m[1]).join("\n");
  const single = [...source.matchAll(/^import\s+(?:\w+\s+)?"([^"]+)"/gm)].map((m) => `"${m[1]}"`);
  return [...block.matchAll(/"([^"]+)"/g), ...single.join("\n").matchAll(/"([^"]+)"/g)].map(
    (m) => m[1],
  );
}

test("Go modules do not import each other and platform stays infrastructure", () => {
  assert.ok(goModule, "apps/api/go.mod must declare a module path");
  const internal = join(api, "internal");
  const files = goFiles(internal);
  assert.ok(files.length > 10, "The check must walk the real Go code");
  const prefix = `${goModule}/internal/`;
  const violations = [];
  for (const path of files) {
    const from = relative(internal, path).split(sep);
    for (const spec of goImports(path)) {
      if (!spec.startsWith(prefix)) continue;
      const to = spec.slice(prefix.length).split("/");
      if (from[0] === "modules" && to[0] === "modules" && from[1] !== to[1])
        violations.push(`${relative(api, path)} -> ${spec}`);
      if (from[0] === "platform" && ["modules", "app", "transport"].includes(to[0]))
        violations.push(`${relative(api, path)} -> ${spec}`);
    }
  }
  assert.deepEqual(violations, []);
});
