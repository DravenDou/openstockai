"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { request, type Schemas } from "@openstockai/api-client/client";
import {
  initialState,
  movementDate,
  setCurrency,
  type InventoryState,
  type Movement,
  type Product,
  type Settings,
} from "./inventory";
import { movementFromAPI, productFromAPI } from "./product";

type Lookup = Schemas["Lookup"];
type State = InventoryState & {
  categories: Lookup[];
  warehouses: Lookup[];
  identity: Schemas["Identity"] | null;
  inventory: Schemas["Inventory"][];
  units: Schemas["Unit"][];
  summary: Schemas["InventorySummary"];
  revision: number;
};
const empty: State = {
  ...initialState,
  categories: [],
  warehouses: [],
  identity: null,
  inventory: [],
  units: [],
  summary: { products: 0, low: 0, empty: 0, stock_value: "0.00" },
  revision: 0,
};
let state = empty;
let generation = 0;
const listeners = new Set<() => void>();

function update(next: State) {
  state = next;
  setCurrency(next.settings.currency);
  listeners.forEach((fn) => fn());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useInventory() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => empty,
  );
}
export function clearInventory() {
  generation++;
  purchaseDraft = null;
  update(empty);
}
export async function refreshInventory() {
  const current = ++generation;
  // Only bounded previews are shared; views request their own filtered pages.
  const [productPage, movements, categories, warehouses, settings, identity, units, summary] =
    await Promise.all([
      request("/v1/products", "get", { query: { limit: 6, offset: 0 } }),
      request("/v1/stock-movements", "get", { query: { limit: 6, offset: 0 } }),
      request("/v1/categories", "get"),
      request("/v1/warehouses", "get"),
      request("/v1/settings", "get"),
      request("/v1/identity", "get"),
      request("/v1/units", "get"),
      request("/v1/inventory/summary", "get"),
    ]);
  if (current !== generation) return;
  const normalized = movements.map((m) => movementFromAPI(m, identity));
  update({
    ...state,
    products: productPage.items.map(productFromAPI),
    movements: normalized.map((m) => ({ ...m, date: movementDate(m, settings.timezone) })),
    categories,
    warehouses,
    settings: { ...settings, email: settings.email || identity.email },
    identity,
    inventory: [],
    units,
    summary,
    revision: state.revision + 1,
  });
}

// A failed read must not turn a committed write into a failed operation in the UI.
export async function refreshAfterWrite() {
  try {
    await refreshInventory();
  } catch {
    toast.warning("The change was saved, but the view could not be refreshed.", {
      action: {
        label: "Retry refresh",
        onClick: () =>
          void refreshInventory().catch(() =>
            toast.error("Could not refresh the view. Reload the page to see the current state."),
          ),
      },
    });
  }
}
function warehouseID(id?: string) {
  const value = id || state.warehouses[0]?.id;
  if (!value) throw new Error("Create a warehouse in Settings before recording stock.");
  return value;
}

export const inventoryActions = {
  async transfer(
    productId: string,
    fromWarehouseId: string,
    toWarehouseId: string,
    quantity: number,
    key: string,
  ) {
    await request("/v1/inventory/transfers", "post", {
      key,
      body: { productId, fromWarehouseId, toWarehouseId, quantity },
    });
    await refreshAfterWrite();
  },
  async archive(id: string, key: string) {
    await request("/v1/products/{id}", "delete", { id, key });
    await refreshAfterWrite();
  },
  async addProduct(p: Omit<Product, "id">, key?: string) {
    const result = await request("/v1/products", "post", {
      key,
      body: {
        name: p.name,
        sku: p.sku,
        categoryName: p.category,
        unitCode: p.unitCode,
        barcode: p.barcode,
        costPrice: p.costPrice || p.cost.toFixed(2),
        salePrice: p.salePrice || "0",
        minimum: p.minimum,
        description: p.notes,
        location: p.location,
        icon: p.icon,
        initialStock: p.stock,
        warehouseId: p.stock ? warehouseID(p.warehouseId) : undefined,
      },
    });
    await refreshAfterWrite();
    return { ...p, id: result.id };
  },
  async editProduct(id: string, p: Partial<Product>, key?: string) {
    await request("/v1/products/{id}", "patch", {
      id,
      key,
      body: {
        name: p.name,
        categoryName: p.category,
        categoryId: p.category === "" ? "" : undefined,
        unitCode: p.unitCode,
        barcode: p.barcode,
        costPrice: p.costPrice || (p.cost === undefined ? undefined : p.cost.toFixed(2)),
        salePrice: p.salePrice,
        minimum: p.minimum,
        description: p.notes,
        location: p.location,
      },
    });
    await refreshAfterWrite();
  },
  async movement(
    id: string,
    quantity: number,
    kind: Movement["kind"],
    _actor?: string,
    warehouse?: string,
    reference = "",
    key?: string,
  ) {
    await request("/v1/inventory/adjustments", "post", {
      key,
      body: {
        productId: id,
        warehouseId: warehouseID(warehouse),
        quantity,
        type: kind === "Sale" ? "sale" : quantity > 0 ? "adjustment_in" : "adjustment_out",
        reference,
      },
    });
    await refreshAfterWrite();
  },
  async undoMovement(id: string) {
    const movement = state.movements.find((m) => m.id === id);
    if (!movement) throw new Error("Movement not found.");
    await this.movement(
      movement.productId,
      -movement.quantity,
      "Adjustment",
      undefined,
      movement.warehouseId,
      `Reversal of ${id}`,
    );
  },
  async applyPurchase(
    items: {
      id?: string;
      name: string;
      sku: string;
      category: string;
      quantity: number;
      cost: number;
      costPrice?: string;
      salePrice?: string;
      unitCode?: string;
    }[],
    reference: string,
    warehouse?: string,
    supplierId?: string,
  ) {
    const lines: Schemas["PurchaseItem"][] = [];
    for (const item of items) {
      const existing = item.id ? { id: item.id } : undefined;
      const costPrice = item.costPrice || item.cost.toFixed(2);
      if (!existing && !item.salePrice) throw new Error(`Enter the sale price for ${item.name}.`);
      lines.push({
        productId: existing?.id,
        quantity: item.quantity,
        costPrice,
        product: existing
          ? undefined
          : {
              name: item.name,
              sku: item.sku,
              categoryName: item.category,
              unitCode: item.unitCode,
              costPrice,
              salePrice: item.salePrice!,
              minimum: 0,
            },
      });
    }
    await request("/v1/purchases", "post", {
      key: purchaseDraft?.key,
      body: { warehouseId: warehouseID(warehouse), supplierId, reference, items: lines },
    });
    await refreshAfterWrite();
    update({ ...state, purchaseApplied: true });
  },
  async settings(settings: Settings) {
    await request("/v1/settings", "patch", { body: settings });
    await refreshAfterWrite();
  },
};

export type PurchaseDraft = {
  name: string;
  reference: string;
  items: {
    name: string;
    sku: string;
    category: string;
    quantity: number;
    cost: number;
    costPrice?: string;
    unitCode?: string;
  }[];
  key: string;
};
let purchaseDraft: PurchaseDraft | null = null;
export function getPurchaseDraft() {
  return purchaseDraft;
}
export function savePurchaseDraft(draft: PurchaseDraft) {
  purchaseDraft = draft;
  update({ ...state, purchaseApplied: false });
}
