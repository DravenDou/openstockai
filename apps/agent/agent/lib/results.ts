import { createHash } from "node:crypto";
import type { Schemas } from "@openstockai/api-client/client";

export function auditResult(data: unknown) {
  const json = JSON.stringify(data) ?? "null";
  const bytes = Buffer.byteLength(json);
  if (bytes <= 60_000) return data;
  const items = Array.isArray(data)
    ? data
    : data && typeof data === "object" && "items" in data && Array.isArray(data.items)
      ? data.items
      : undefined;
  // Go caps audit results at 64 KiB; retain a fingerprint instead of losing the read.
  return {
    summarized: true,
    bytes,
    sha256: createHash("sha256").update(json).digest("hex"),
    itemCount: items?.length,
  };
}

export function pageResult<T>(items: T[], page: { limit: number; offset: number }, total?: number) {
  const hasMore =
    total === undefined ? items.length === page.limit : page.offset + items.length < total;
  return {
    items,
    ...(total === undefined ? {} : { total }),
    hasMore,
    nextOffset: hasMore ? page.offset + items.length : null,
  };
}

export function productSummary(product: Schemas["Product"]) {
  const {
    id,
    name,
    sku,
    category_id,
    category,
    cost_price,
    sale_price,
    minimum,
    stock,
    unit_code,
    unit_symbol,
    unit_decimals,
  } = product;
  return {
    id,
    name,
    sku,
    category_id,
    category,
    cost_price,
    sale_price,
    minimum,
    stock,
    unit_code,
    unit_symbol,
    unit_decimals,
  };
}
