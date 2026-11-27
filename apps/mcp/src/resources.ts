import { z } from "zod";
import {
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/server";
import { APIError } from "@openstockai/api-client/client";
import { sessionOf, type Runtime } from "./runtime";

const json = (uri: URL, data: unknown) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }],
});
const LIST_CAP = 50;
// Ask for one more than the cap so a cut list is known, not guessed, and say so in the payload.
const capped = <T>(items: T[]) => ({
  items: items.slice(0, LIST_CAP),
  truncated: items.length > LIST_CAP,
  shown: Math.min(items.length, LIST_CAP),
});

// Resources are per caller (private cache): they come from the owner's own data.
export function registerResources(server: McpServer, rt: Runtime) {
  const { up } = rt;
  server.registerResource(
    "reference",
    "openstock://reference",
    {
      title: "Reference data",
      description: "Warehouses, categories, suppliers and units of measure with their IDs.",
      mimeType: "application/json",
      cacheHint: { ttlMs: 60_000, cacheScope: "private" },
    },
    async (uri, ctx) => {
      const s = await sessionOf(rt, ctx);
      const query = { limit: LIST_CAP + 1 };
      const [warehouses, categories, suppliers, units] = await Promise.all([
        up.go(s, "/v1/warehouses", "get", { query }),
        up.go(s, "/v1/categories", "get", { query }),
        up.go(s, "/v1/suppliers", "get", { query }),
        up.go(s, "/v1/units", "get"),
      ]);
      const lists = { warehouses, categories, suppliers };
      const out = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, capped(v)]));
      const truncated = Object.entries(out)
        .filter(([, v]) => v.truncated)
        .map(([k]) => k);
      return json(uri, {
        ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.items])),
        units,
        truncated,
        note: truncated.length
          ? `Lists are capped at ${LIST_CAP}; truncated: ${truncated.join(", ")}. Use list_reference_data to page.`
          : undefined,
      });
    },
  );
  server.registerResource(
    "low-stock",
    "openstock://low-stock",
    {
      title: "Low-stock products",
      description: "Products at or below their minimum stock.",
      mimeType: "application/json",
      cacheHint: { ttlMs: 30_000, cacheScope: "private" },
    },
    async (uri, ctx) => {
      const s = await sessionOf(rt, ctx);
      const rows = await up.go(s, "/v1/low-stock", "get", { query: { limit: LIST_CAP + 1 } });
      return json(uri, capped(rows));
    },
  );
  server.registerResource(
    "product",
    new ResourceTemplate("openstock://products/{id}", {
      list: async (ctx) => {
        const s = await sessionOf(rt, ctx);
        const data = await up.go(s, "/v1/products", "get", {
          query: { status: "active", limit: LIST_CAP },
        });
        return {
          resources: data.items.map((p) => ({
            uri: `openstock://products/${p.id}`,
            name: `${p.name} (${p.sku})`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Product",
      description: `One product with details and stock balance per warehouse. resources/list shows at most ${LIST_CAP} active products; search_products finds the rest.`,
      mimeType: "application/json",
      cacheHint: { ttlMs: 15_000, cacheScope: "private" },
    },
    async (uri, variables, ctx) => {
      const id = z.uuid().safeParse(variables.id);
      if (!id.success) throw new ResourceNotFoundError(uri.href);
      const s = await sessionOf(rt, ctx);
      const product = await up.go(s, "/v1/products/{id}", "get", { id: id.data }).catch((error) => {
        throw error instanceof APIError && error.code === "NOT_FOUND"
          ? new ResourceNotFoundError(uri.href)
          : error;
      });
      const balances = await up.go(s, "/v1/inventory", "get", {
        query: { product: id.data, limit: 100 },
      });
      return json(uri, { product, balances });
    },
  );
}
