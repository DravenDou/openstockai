// Pure description of what an approval request will change, one summary per write tool.
export type RefKind = "product" | "warehouse" | "category" | "supplier";
export type SummaryRow = {
  label: string;
  value: string;
  /** The value is an ID the card resolves to a name. */
  ref?: RefKind;
  /** The value is a decimal amount shown in the store currency. */
  money?: boolean;
};
export type SummaryItem = { product: string; quantity: string; cost: string };
export type ApprovalSummary = {
  title: string;
  /** Deletes, archives and restores: always confirmed and visibly marked. */
  destructive: boolean;
  rows: SummaryRow[];
  items?: SummaryItem[];
  total?: string;
  note?: string;
  /** Label for the confirm button. */
  confirm: string;
};

const adjustmentLabels: Record<string, string> = {
  initial: "Initial stock",
  purchase: "Purchase",
  sale: "Sale",
  adjustment_in: "Adjustment in",
  adjustment_out: "Adjustment out",
  return_in: "Customer return",
  return_out: "Supplier return",
};
const settingLabels: Record<string, string> = {
  store: "Store name",
  email: "Contact email",
  currency: "Currency",
  timezone: "Time zone",
  automatic: "Auto-approve low-risk actions",
  lowStock: "Low-stock alerts",
  voice: "Voice replies",
};
const fieldLabels: Record<string, string> = {
  name: "Name",
  sku: "SKU",
  email: "Email",
  categoryName: "Category",
  unitCode: "Unit",
  minimum: "Minimum stock",
  description: "Description",
  location: "Location",
  barcode: "Barcode",
  icon: "Icon",
  reference: "Reference",
  code: "Code",
  symbol: "Symbol",
  decimals: "Decimals",
  active: "Active",
};

const text = (value: unknown) =>
  value === undefined || value === null
    ? ""
    : typeof value === "boolean"
      ? value
        ? "On"
        : "Off"
      : String(value);
const uuid = (value: unknown) => typeof value === "string" && value.length > 0;

// Cents arithmetic with decimal strings keeps the total exact.
function cents(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole || "0") * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}
export function purchaseTotal(items: { quantity: string; cost: string }[]) {
  const thousandths = items.reduce((sum, item) => {
    const [whole = "0", fraction = ""] = item.quantity.split(".");
    const quantity = BigInt(whole) * BigInt(1000) + BigInt((fraction + "000").slice(0, 3));
    return sum + quantity * cents(item.cost);
  }, BigInt(0));
  const rounded = (thousandths + BigInt(500)) / BigInt(1000);
  return `${rounded / BigInt(100)}.${(rounded % BigInt(100)).toString().padStart(2, "0")}`;
}

function withoutId(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "id"));
}

function generic(input: Record<string, unknown>): SummaryRow[] {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== "object")
    .map(([key, value]) => ({ label: fieldLabels[key] ?? key, value: text(value) }));
}

function productFields(input: Record<string, unknown>): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const add = (label: string, value: unknown, extra: Partial<SummaryRow> = {}) => {
    if (value !== undefined && value !== null && value !== "")
      rows.push({ label, value: text(value), ...extra });
  };
  add("Name", input.name);
  add("SKU", input.sku);
  if (uuid(input.categoryId)) add("Category", input.categoryId, { ref: "category" });
  else add("Category", input.categoryName);
  add("Unit", input.unitCode);
  add("Cost", input.costPrice, { money: true });
  add("Sale price", input.salePrice, { money: true });
  add("Minimum stock", input.minimum);
  add("Barcode", input.barcode);
  add("Location", input.location);
  add("Description", input.description);
  if (Number(input.initialStock) > 0) {
    add("Initial stock", input.initialStock);
    if (uuid(input.warehouseId)) add("In warehouse", input.warehouseId, { ref: "warehouse" });
  }
  return rows;
}

export function summarizeApproval(
  toolName: string,
  raw: Record<string, unknown> | undefined,
): ApprovalSummary {
  const input = raw ?? {};
  const target = (kind: RefKind): SummaryRow[] =>
    uuid(input.id)
      ? [{ label: kind[0].toUpperCase() + kind.slice(1), value: text(input.id), ref: kind }]
      : [];
  const base = { destructive: false, confirm: "Approve" };
  switch (toolName) {
    case "createProduct":
      return { ...base, title: "Create a product", rows: productFields(input) };
    case "updateProduct": {
      const changes = withoutId(input);
      return {
        ...base,
        title: "Update a product",
        rows: [...target("product"), ...productFields(changes)],
        note: "Only the fields listed change. Stock is not affected.",
      };
    }
    case "archiveProduct":
      return {
        ...base,
        destructive: true,
        confirm: "Archive product",
        title: "Archive a product",
        rows: target("product"),
        note: "It leaves the active catalog. History is kept and it can be restored later.",
      };
    case "restoreProduct":
      return {
        ...base,
        destructive: true,
        confirm: "Restore product",
        title: "Restore an archived product",
        rows: target("product"),
        note: "Restoring always needs your confirmation.",
      };
    case "createCategory":
      return { ...base, title: "Create a category", rows: generic(input) };
    case "updateCategory":
      return {
        ...base,
        title: "Rename a category",
        rows: [...target("category"), ...generic({ name: input.name })],
      };
    case "deleteCategory":
      return {
        ...base,
        destructive: true,
        confirm: "Delete category",
        title: "Delete a category",
        rows: target("category"),
        note: "This cannot be undone.",
      };
    case "createSupplier":
      return { ...base, title: "Create a supplier", rows: generic(input) };
    case "updateSupplier": {
      const changes = withoutId(input);
      return {
        ...base,
        title: "Update a supplier",
        rows: [...target("supplier"), ...generic(changes)],
      };
    }
    case "deleteSupplier":
      return {
        ...base,
        destructive: true,
        confirm: "Delete supplier",
        title: "Delete a supplier",
        rows: target("supplier"),
        note: "Existing purchases keep their history. This cannot be undone.",
      };
    case "createWarehouse":
      return { ...base, title: "Create a warehouse", rows: generic(input) };
    case "updateWarehouse":
      return {
        ...base,
        title: "Rename a warehouse",
        rows: [...target("warehouse"), ...generic({ name: input.name })],
      };
    case "deleteWarehouse":
      return {
        ...base,
        destructive: true,
        confirm: "Delete warehouse",
        title: "Delete a warehouse",
        rows: target("warehouse"),
        note: "The API refuses while the warehouse still holds stock. This cannot be undone.",
      };
    case "createUnit":
      return {
        ...base,
        title: "Create a unit of measure",
        rows: generic(input),
        note: "Units cannot be edited or deleted afterwards.",
      };
    case "adjustStock": {
      const quantity = Number(input.quantity);
      return {
        ...base,
        title: quantity < 0 ? "Remove stock" : "Add stock",
        rows: [
          { label: "Product", value: text(input.productId), ref: "product" },
          { label: "Warehouse", value: text(input.warehouseId), ref: "warehouse" },
          { label: "Movement", value: adjustmentLabels[text(input.type)] ?? text(input.type) },
          { label: "Quantity", value: `${quantity > 0 ? "+" : ""}${text(input.quantity)}` },
          ...(input.reference ? [{ label: "Reference", value: text(input.reference) }] : []),
        ],
      };
    }
    case "transferStock":
      return {
        ...base,
        title: "Transfer stock between warehouses",
        rows: [
          { label: "Product", value: text(input.productId), ref: "product" },
          { label: "From", value: text(input.fromWarehouseId), ref: "warehouse" },
          { label: "To", value: text(input.toWarehouseId), ref: "warehouse" },
          { label: "Quantity", value: text(input.quantity) },
        ],
      };
    case "countStock": {
      const difference = Number(input.counted) - Number(input.expected);
      return {
        ...base,
        title: "Record a stock count",
        rows: [
          { label: "Product", value: text(input.productId), ref: "product" },
          { label: "Warehouse", value: text(input.warehouseId), ref: "warehouse" },
          { label: "Recorded stock", value: text(input.expected) },
          { label: "Counted", value: text(input.counted) },
          {
            label: "Difference",
            value: `${difference > 0 ? "+" : ""}${Math.round(difference * 1000) / 1000}`,
          },
        ],
        note: "The difference is booked as a stock movement.",
      };
    }
    case "recordPurchase": {
      const items = (Array.isArray(input.items) ? input.items : []).map((line) => {
        const item = (line ?? {}) as Record<string, unknown>;
        return {
          product: text(item.productId),
          quantity: text(item.quantity),
          cost: text(item.costPrice),
        };
      });
      return {
        ...base,
        title: "Record a purchase",
        rows: [
          { label: "Reference", value: text(input.reference) },
          { label: "Warehouse", value: text(input.warehouseId), ref: "warehouse" },
          ...(uuid(input.supplierId)
            ? [{ label: "Supplier", value: text(input.supplierId), ref: "supplier" as const }]
            : []),
        ],
        items,
        total: items.length ? purchaseTotal(items) : undefined,
        note: "Stock increases in the warehouse for every line.",
      };
    }
    case "updateSettings":
      return {
        ...base,
        title: "Change settings",
        rows: Object.entries(input).map(([key, value]) => ({
          label: settingLabels[key] ?? key,
          value: text(value),
        })),
        note:
          input.automatic === true
            ? "Low-risk actions will run without asking. Deletes, archives and restores will still ask."
            : undefined,
      };
    default:
      return { ...base, title: "Review the details before confirming", rows: generic(input) };
  }
}
