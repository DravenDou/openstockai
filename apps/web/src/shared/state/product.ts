import type { Schemas } from "@openstockai/api-client/client";
import type { Movement, Product } from "./inventory";

export function productFromAPI(p: Schemas["Product"]): Product {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    categoryId: p.category_id || undefined,
    cost: Number(p.cost_price),
    costPrice: p.cost_price,
    salePrice: p.sale_price,
    stock: p.stock,
    minimum: p.minimum,
    location: p.location,
    notes: p.description,
    icon: p.icon,
    barcode: p.barcode,
    unitCode: p.unit_code,
    unitSymbol: p.unit_symbol,
    unitName: p.unit_name,
    unitDecimals: p.unit_decimals,
  };
}
export function movementFromAPI(
  m: Schemas["Movement"],
  identity: Schemas["Identity"] | null,
): Movement {
  return {
    id: m.id,
    productId: m.product_id,
    warehouseId: m.warehouse_id,
    name: m.name,
    kind: m.type === "sale" ? "Sale" : m.quantity > 0 ? "Stock in" : "Adjustment",
    quantity: m.quantity,
    actor:
      m.actor_type === "ai"
        ? "OpenStock AI"
        : m.user_id === identity?.user_id
          ? identity.name
          : m.user_id,
    date: "",
    timestamp: Date.parse(m.created_at),
    source: m.reference,
    unitSymbol: m.unit_symbol,
  };
}
