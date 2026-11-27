// Pure description of an agent action for the owner approval page. Go stays the policy
// authority (ownerApprovalRequired); this only explains the decision in plain English.
export type RefKind = "product" | "warehouse" | "category" | "supplier";
export type DetailRow = { label: string; value: string; ref?: RefKind };
export type OperationInfo = {
  title: string;
  /** Delete, archive or restore: always decided by the owner. */
  destructive: boolean;
  /** The id carried in the operation path (PATCH/DELETE/restore), when there is one. */
  target?: { kind: RefKind; id: string };
};

const resources: Record<string, { kind: RefKind | "unit"; singular: string }> = {
  products: { kind: "product", singular: "product" },
  categories: { kind: "category", singular: "category" },
  warehouses: { kind: "warehouse", singular: "warehouse" },
  suppliers: { kind: "supplier", singular: "supplier" },
  units: { kind: "unit", singular: "unit of measure" },
};
const fixed: Record<string, string> = {
  "POST /v1/purchases": "Record a purchase",
  "POST /v1/inventory/adjustments": "Adjust stock",
  "POST /v1/inventory/transfers": "Transfer stock between warehouses",
  "POST /v1/inventory/counts": "Record a stock count",
  "PATCH /v1/settings": "Change settings",
  "POST /v1/units": "Create a unit of measure",
};

export function describeOperation(operation: string): OperationInfo {
  if (fixed[operation]) return { title: fixed[operation], destructive: false };
  const match = /^(POST|PATCH|DELETE) \/v1\/([a-z]+)(?:\/([^/\s]+))?(?:\/(restore|archive))?$/.exec(
    operation,
  );
  const resource = match && resources[match[2]!];
  if (match && resource) {
    const [, method, , id, action] = match;
    const target = id && resource.kind !== "unit" ? { kind: resource.kind, id } : undefined;
    if (method === "POST" && !id)
      return { title: `Create a ${resource.singular}`, destructive: false };
    if (method === "PATCH" && id)
      return { title: `Edit a ${resource.singular}`, destructive: false, target };
    // Go archives a product on DELETE (it keeps its history and can be restored); a category,
    // warehouse or supplier is really deleted.
    if (method === "DELETE" && id)
      return {
        title: resource.kind === "product" ? "Archive a product" : `Delete a ${resource.singular}`,
        destructive: true,
        target,
      };
    if (action === "restore")
      return { title: `Restore a ${resource.singular}`, destructive: true, target };
    if (action === "archive")
      return { title: `Archive a ${resource.singular}`, destructive: true, target };
  }
  return {
    title: `Unrecognized operation (${operation})`,
    destructive: /^DELETE /.test(operation),
  };
}

const HIGH_QUANTITY = 1000;
const asNumber = (value: unknown) => {
  const number = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
// Largest quantity-like amount in the input, used only to explain the ">1000 units" rule.
function quantities(operation: string, input: unknown): (number | null)[] {
  const body = record(input);
  if (operation === "POST /v1/products") return [asNumber(body.initialStock)];
  if (operation === "POST /v1/inventory/counts")
    return [asNumber(body.counted), asNumber(body.expected)];
  if (operation === "POST /v1/purchases")
    return [
      (Array.isArray(body.items) ? body.items : []).reduce<number>(
        (sum, item) => sum + Math.abs(asNumber(record(item).quantity) ?? 0),
        0,
      ),
    ];
  return [asNumber(body.quantity)];
}
export function riskReason(operation: string, input: unknown, ownerApprovalRequired: boolean) {
  const info = describeOperation(operation);
  if (info.destructive)
    return "Deletes, archives and restores always need the owner's decision in OpenStock.";
  const high = quantities(operation, input).some(
    (value) => value !== null && Math.abs(value) > HIGH_QUANTITY,
  );
  if (high) return "Quantities above 1000 units always need the owner's decision in OpenStock.";
  if (ownerApprovalRequired) return "OpenStock requires the owner's decision for this change.";
  return null;
}

const labels: Record<string, string> = {
  name: "Name",
  sku: "SKU",
  email: "Email",
  categoryName: "Category",
  unitCode: "Unit",
  minimum: "Minimum stock",
  description: "Description",
  location: "Location",
  barcode: "Barcode",
  reference: "Reference",
  code: "Code",
  symbol: "Symbol",
  decimals: "Decimals",
  active: "Active",
  initialStock: "Initial stock",
  quantity: "Quantity",
  counted: "Counted",
  expected: "Expected",
  type: "Type",
  reason: "Reason",
  note: "Note",
  store: "Store name",
  currency: "Currency",
  timezone: "Time zone",
  automatic: "Auto-approve low-risk actions",
  lowStock: "Low-stock alerts",
  voice: "Voice replies",
  productId: "Product",
  warehouseId: "Warehouse",
  fromWarehouseId: "From warehouse",
  toWarehouseId: "To warehouse",
  supplierId: "Supplier",
};
const refKinds: Record<string, RefKind> = {
  productId: "product",
  warehouseId: "warehouse",
  fromWarehouseId: "warehouse",
  toWarehouseId: "warehouse",
  supplierId: "supplier",
};
const humanize = (key: string) =>
  labels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const show = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);

// Flat key/value rows from toolInput; ids become refs the view resolves to names.
export function detailRows(input: unknown): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const [key, value] of Object.entries(record(input))) {
    if (value === null || value === undefined || key === "items") continue;
    rows.push({ label: humanize(key), value: show(value), ref: refKinds[key] });
  }
  return rows;
}
export type PurchaseLine = { product: string; quantity: string };
export function detailItems(input: unknown): PurchaseLine[] {
  const items = record(input).items;
  return (Array.isArray(items) ? items : []).map((item) => ({
    product: show(record(item).productId ?? record(item).name ?? ""),
    quantity: show(record(item).quantity ?? ""),
  }));
}

export type ApprovalState = "pending" | "approved" | "rejected" | "completed" | "failed";
export function actionState(view: { status: string; approvalStatus: string }): ApprovalState {
  if (view.approvalStatus === "rejected") return "rejected";
  if (view.status === "completed") return "completed";
  if (view.status === "failed") return "failed";
  if (view.approvalStatus === "approved") return "approved";
  return "pending";
}
export const stateText: Record<ApprovalState, string> = {
  pending: "Waiting for your decision",
  approved: "Approved. The MCP client can now apply it.",
  rejected: "Rejected. Nothing was changed.",
  completed: "Applied",
  failed: "Failed",
};
