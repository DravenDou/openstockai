import { McpServer } from "@modelcontextprotocol/server";
import type { SkillCatalog } from "@modelcontextprotocol/server/ext/skills";
import { registerReads } from "./reads";
import { registerResources } from "./resources";
import type { Runtime } from "./runtime";
import { registerWrites } from "./writes";

const instructions = `OpenStock AI is a self-hosted inventory app. Read tools are safe to call freely. Every write goes through approval: small changes are confirmed in this client, large ones, archives and restores by the owner in OpenStock. Never repeat a write that reports waiting or declined; ask the user. Look up IDs with search_products and list_reference_data instead of guessing them. Skills describe common workflows (restock review, receiving a delivery, cycle counts).`;

// Tool registration order is the order of tools/list, so it is fixed here. Deliberately NOT
// exposed: settings (an external client must not be able to turn on auto-approval), editing or
// deleting warehouses, categories, suppliers and units (the owner does that in the UI), and
// the CSV export (it needs a browser session).
export function createServer(rt: Runtime, skills?: SkillCatalog) {
  const server = new McpServer(
    { name: "openstockai", title: "OpenStock AI", version: "0.1.0" },
    {
      instructions,
      cacheHints: { "tools/list": { ttlMs: 600_000, cacheScope: "public" } },
      requestState: { verify: rt.codec.verify },
    },
  );
  registerReads(server, rt);
  registerWrites(server, rt);
  registerResources(server, rt);
  skills?.attach(server);
  return server;
}
