import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";
import { createApp } from "./app";
import { mcpConfig } from "./env";

const config = mcpConfig();
const skills = await loadSkills(new URL("../skills", import.meta.url).pathname, {
  strict: true,
});
const app = createApp({ config, fetch, now: Date.now }, skills);
const node = toNodeHandler(app, {
  maxRequestBodySize: 1_000_000,
  onerror: (error) => console.error("mcp http:", error.message),
});
const server = createServer((req, res) => {
  node(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.listen(config.port, config.host, () =>
  console.log(
    `OpenStock MCP listening on ${config.host}:${config.port} (resource ${config.resourceUrl})`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close(() => process.exit(0));
    void app.close();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
