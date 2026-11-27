import { z } from "zod";
import { goHeaders } from "@/server/http";
import { apiFailure, HTTPError } from "@openstockai/server/http";
import { serverEnv } from "@openstockai/server/env";
import { request as goRequest } from "@openstockai/api-client/client";

export const runtime = "nodejs";
export const maxDuration = 60;

// Link target for the agent's exportProductsCsv tool. The browser session authorizes it;
// the CSV is built here from the same paged export endpoint the inventory page uses.
const filters = z
  .object({
    query: z.string().max(160).default(""),
    category: z.uuid().optional(),
    warehouse: z.uuid().optional(),
    stock: z.enum(["low", "out"]).optional(),
    status: z.enum(["active", "archived"]).default("active"),
  })
  .strict();

const cell = (value: string | number) => {
  const text = typeof value === "string" && /^[=+@\t\r-]/.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export async function GET(request: Request) {
  try {
    const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success)
      throw new HTTPError(422, "INVALID_EXPORT_QUERY", "Check the export filters.");
    const headers = await goHeaders(request.headers);
    const baseURL = serverEnv().API_BASE_URL;
    const rows: (string | number)[][] = [
      ["Product", "SKU", "Barcode", "Category", "Unit", "Stock", "Cost", "Sale price"],
    ];
    let after: string | undefined;
    do {
      const batch = await goRequest("/v1/products-export", "get", {
        baseURL,
        headers,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        query: {
          ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value)),
          limit: 500,
          ...(after ? { afterId: after } : {}),
        },
      });
      for (const p of batch.items)
        rows.push([
          p.name,
          p.sku,
          p.barcode,
          p.category,
          p.unit_symbol,
          p.stock,
          p.cost_price,
          p.sale_price,
        ]);
      after = batch.next?.id;
      if (rows.length > 100_001)
        throw new HTTPError(413, "EXPORT_TOO_LARGE", "Too many products. Narrow the filters.");
    } while (after);
    const body = "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="products-openstockai.csv"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
