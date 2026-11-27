import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { cursor, page, query } from "@openstockai/schemas";
import { annotations, failure, registerLoose, result, sessionOf, type Runtime } from "./runtime";
import type { Session } from "./upstream";

const defined = <T extends Record<string, unknown>>(values: T) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ""),
  ) as Record<string, string | number>;
const loose = z.looseObject;
const uuid = z.uuid();

export const product = (p: {
  id: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  minimum: number;
  unit_symbol: string;
  cost_price: string;
  sale_price: string;
}) => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  category: p.category,
  stock: p.stock,
  minimum: p.minimum,
  unit: p.unit_symbol,
  costPrice: p.cost_price,
  salePrice: p.sale_price,
});
const productOut = loose({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  category: z.string(),
  stock: z.number(),
  minimum: z.number(),
  unit: z.string(),
  costPrice: z.string(),
  salePrice: z.string(),
});
const pageOut = <T extends z.ZodType>(items: T) =>
  loose({ items: z.array(items), hasMore: z.boolean() });
const cursorOut = <T extends z.ZodType>(items: T) =>
  loose({ items: z.array(items), next: z.unknown(), hasMore: z.boolean() });

// Registers the read tools in a fixed order (tools/list follows registration order).
export function registerReads(server: McpServer, rt: Runtime) {
  const { up } = rt;
  const register = registerLoose(server);
  const read = <S extends z.ZodObject, O extends z.ZodObject>(
    name: string,
    config: { title: string; description: string; input: S; output: O },
    run: (args: z.output<S>, session: Session) => Promise<z.input<O>>,
  ) =>
    register(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.input,
        outputSchema: config.output,
        annotations: annotations.read,
      },
      async (args, ctx) => {
        try {
          return result((await run(args as z.output<S>, await sessionOf(rt, ctx))) as never);
        } catch (error) {
          return failure(error);
        }
      },
    );

  read(
    "search_products",
    {
      title: "Search products",
      description:
        "Search the product catalog by name, SKU or barcode, optionally filtered by category ID, warehouse ID, stock level (low = at or below minimum, out = none left) or status (active by default behaviour of the store, archived to find archived items). Returns a compact page; use get_product for full details and per-warehouse balances.",
      input: query
        .extend(page.shape)
        .extend({
          category: uuid.optional(),
          warehouse: uuid.optional(),
          stock: z.enum(["low", "out"]).optional(),
          status: z.enum(["active", "archived"]).optional(),
        })
        .strict(),
      output: pageOut(productOut).extend({ total: z.number() }),
    },
    async (args, session) => {
      const data = await up.go(session, "/v1/products", "get", { query: defined(args) });
      return {
        items: data.items.map(product),
        total: data.total,
        hasMore: args.offset + data.items.length < data.total,
      };
    },
  );

  read(
    "get_product",
    {
      title: "Get product",
      description:
        "Get one product with full details and its stock balance in every warehouse. Identify it by exactly one of id (UUID) or sku (exact match, active or archived).",
      input: z
        .object({ id: uuid.optional(), sku: z.string().trim().min(1).max(80).optional() })
        .strict()
        .refine(
          (v) => (v.id === undefined) !== (v.sku === undefined),
          "Provide exactly one of id or sku",
        ),
      output: loose({ product: loose({ id: z.string() }), balances: z.array(loose({})) }),
    },
    async (args, session) => {
      const item = args.id
        ? await up.go(session, "/v1/products/{id}", "get", { id: args.id })
        : await up.go(session, "/v1/products/by-sku", "get", { query: { sku: args.sku! } });
      const balances = await up.go(session, "/v1/inventory", "get", {
        query: { product: item.id, limit: 100 },
      });
      return {
        product: item,
        balances: balances.map((b) => ({ warehouseId: b.warehouse_id, quantity: b.quantity })),
      };
    },
  );

  read(
    "list_low_stock",
    {
      title: "List low-stock products",
      description:
        "List products whose total stock is at or below their minimum, with the current stock and the minimum. Start here for restocking.",
      input: query.extend(page.shape).strict(),
      output: pageOut(loose({ id: z.string(), name: z.string(), sku: z.string() })),
    },
    async (args, session) => {
      const items = await up.go(session, "/v1/low-stock", "get", { query: defined(args) });
      return { items, hasMore: items.length === args.limit };
    },
  );

  read(
    "get_stock_movements",
    {
      title: "Get stock movements",
      description:
        "List stock movements (entries, exits, transfers, counts), newest first, filtered by product ID, warehouse ID, kind and an RFC 3339 start time. Page with offset until hasMore is false.",
      input: query
        .extend(page.shape)
        .extend({
          product: uuid.optional(),
          warehouse: uuid.optional(),
          kind: z
            .enum(["in", "out", "adjustment", "return", "transfer"])
            .describe(
              "in: entries (positive quantity). out: exits (negative quantity). adjustment, return and transfer: movements of that type, both directions.",
            )
            .optional(),
          since: z.iso.datetime({ offset: true }).optional(),
        })
        .strict(),
      output: pageOut(loose({ id: z.string(), type: z.string(), quantity: z.number() })),
    },
    async (args, session) => {
      const items = await up.go(session, "/v1/stock-movements", "get", { query: defined(args) });
      return { items, hasMore: items.length === args.limit };
    },
  );

  const history = z.object({
    query: z.string().max(160).default(""),
    limit: z.number().int().min(1).max(50).default(20),
    ...cursor,
  });

  read(
    "list_purchases",
    {
      title: "List purchases",
      description:
        "List purchase receipts, newest first, with warehouse, supplier and total. Search by reference or supplier. Page with the returned next cursor (pass its id as beforeId and its date as beforeDate) until hasMore is false. Use get_purchase for the lines.",
      input: history.strict(),
      output: cursorOut(loose({ id: z.string(), reference: z.string(), total: z.string() })),
    },
    async (args, session) => {
      const data = await up.go(session, "/v1/purchases-page", "get", { query: defined(args) });
      return { items: data.items, next: data.next, hasMore: data.next !== null };
    },
  );

  read(
    "get_purchase",
    {
      title: "Get purchase",
      description:
        "Get one purchase receipt with its header (warehouse, supplier, total) and every line.",
      input: z.object({ id: uuid }).strict(),
      output: loose({ purchase: loose({ id: z.string() }), items: z.array(loose({})) }),
    },
    async (args, session) => up.go(session, "/v1/purchases/{id}", "get", { id: args.id }),
  );

  const reports = ["summary", "valuation", "turnover", "supplier_spend", "dashboard"] as const;
  read(
    "get_report",
    {
      title: "Get report",
      description:
        "Read one report. summary: global totals of active products (products, low: at or below minimum stock, empty: zero stock, stock_value at cost). valuation: stock value at cost by category and warehouse (optional warehouse, category). turnover: top and slow movers over a window (optional days, limit). supplier_spend: purchase spend per supplier (optional from, to as RFC 3339 or YYYY-MM-DD, default last 90 days). dashboard: stock value, low stock, 7-day movements, 30-day purchases and recent movements. Money values are decimal strings in the store currency.",
      input: z
        .object({
          report: z.enum(reports),
          warehouse: uuid.optional(),
          category: uuid.optional(),
          days: z.number().int().min(1).max(365).optional(),
          limit: z.number().int().min(1).max(50).optional(),
          from: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
          to: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
        })
        .strict(),
      output: loose({ report: z.enum(reports), data: loose({}) }),
    },
    async ({ report, ...filters }, session) => {
      const q = defined(filters);
      const pick = (...keys: string[]) =>
        Object.fromEntries(Object.entries(q).filter(([key]) => keys.includes(key)));
      const data =
        report === "summary"
          ? await up.go(session, "/v1/inventory/summary", "get")
          : report === "valuation"
            ? await up.go(session, "/v1/analytics/stock-valuation", "get", {
                query: pick("warehouse", "category"),
              })
            : report === "turnover"
              ? await up.go(session, "/v1/analytics/turnover", "get", {
                  query: pick("days", "limit"),
                })
              : report === "supplier_spend"
                ? await up.go(session, "/v1/analytics/supplier-spend", "get", {
                    query: pick("from", "to"),
                  })
                : await up.go(session, "/v1/analytics/dashboard", "get");
      return { report, data };
    },
  );

  const kinds = ["warehouses", "categories", "suppliers", "units"] as const;
  read(
    "list_reference_data",
    {
      title: "List reference data",
      description:
        "List the lookup data other tools need as IDs: warehouses, categories, suppliers (name, email) or units of measure (code, symbol, decimals; use the code when creating products).",
      input: query
        .extend(page.shape)
        .extend({ kind: z.enum(kinds) })
        .strict(),
      output: loose({ kind: z.enum(kinds), items: z.array(loose({})), hasMore: z.boolean() }),
    },
    async ({ kind, ...args }, session) => {
      if (kind === "units") {
        const items = await up.go(session, "/v1/units", "get");
        return { kind, items, hasMore: false };
      }
      const path = `/v1/${kind}` as const;
      const items = await up.go(session, path, "get", { query: defined(args) });
      return { kind, items, hasMore: items.length === args.limit };
    },
  );

  read(
    "get_audit_log",
    {
      title: "Get audit log",
      description:
        "Read the audit log, newest first: who (human, ai, mcp or system) did what to which resource and when. Filter by text or actor. Page with the returned next cursor until hasMore is false. Metadata only, not the full before/after documents.",
      input: history
        .extend({ actor: z.enum(["human", "ai", "mcp", "system"]).optional() })
        .strict(),
      output: cursorOut(loose({ id: z.string(), action: z.string() })),
    },
    async (args, session) => {
      const data = await up.go(session, "/v1/audit-page", "get", { query: defined(args) });
      return {
        items: data.items.map(
          ({ id, created_at, actor_type, user_name, action, resource_type, resource_id }) => ({
            id,
            created_at,
            actor_type,
            user_name,
            action,
            resource_type,
            resource_id,
          }),
        ),
        next: data.next,
        hasMore: data.next !== null,
      };
    },
  );
}
