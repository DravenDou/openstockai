import type { EveToolPart, SessionStreamEvent } from "eve/client";

export function turnFailures(events: readonly SessionStreamEvent[]) {
  const failures = new Map<string, { code: string; message: string }>();
  for (const event of events) {
    // A failed turn settles with outcome "failed" and an error; keep it visible, including
    // when replaying a conversation.
    if (event.type === "turn.settled" && event.data.outcome === "failed") {
      failures.set(event.data.turnId, {
        code: event.data.error?.code || "TURN_FAILED",
        message:
          event.data.error?.message ||
          "The response could not be completed. Try again in a moment.",
      });
    }
  }
  return failures;
}

// The state vocabulary the shared Tool header renders.
const toolStates = {
  requested: "input-available",
  running: "input-available",
  blocked: "input-available",
  approval: "approval-requested",
  completed: "output-available",
  failed: "output-error",
  rejected: "output-denied",
  cancelled: "output-denied",
  streaming: "input-streaming",
} as const;

export function toolPresentation(part: EveToolPart) {
  if (part.state === "completed" && part.output && typeof part.output === "object") {
    const output = part.output as {
      ok?: boolean;
      error?: { message?: string };
      approvalRequired?: boolean;
    };
    if (output.ok === false) {
      return output.approvalRequired
        ? { state: "approval-requested" as const, errorText: undefined }
        : {
            state: "output-error" as const,
            errorText:
              output.error?.message ||
              "The API rejected the operation; the result was not confirmed.",
          };
    }
  }
  return {
    state: toolStates[part.state],
    errorText: part.state === "failed" ? part.error?.message : undefined,
  };
}

export const toolLabels: Record<string, string> = {
  selectTools: "Preparing tools",
  searchProducts: "Search products",
  getProduct: "Look up product",
  getInventory: "Check stock",
  getInventorySummary: "Inventory summary",
  getWarehouses: "Look up warehouses",
  getMeasurementUnits: "Look up units of measure",
  getLowStockProducts: "Review restock",
  getStockMovements: "Look up stock movements",
  searchCategories: "Search categories",
  searchSuppliers: "Search suppliers",
  createProduct: "Create product",
  updateProduct: "Update product",
  createCategory: "Create category",
  createSupplier: "Create supplier",
  adjustStock: "Record stock movement",
  transferStock: "Transfer stock",
  getProductBySku: "Look up product by SKU",
  countStock: "Record stock count",
  archiveProduct: "Archive product",
  restoreProduct: "Restore product",
  createUnit: "Create unit",
  updateCategory: "Rename category",
  deleteCategory: "Delete category",
  updateSupplier: "Update supplier",
  deleteSupplier: "Delete supplier",
  createWarehouse: "Create warehouse",
  updateWarehouse: "Rename warehouse",
  deleteWarehouse: "Delete warehouse",
  listPurchases: "Look up purchases",
  getPurchase: "Look up purchase",
  recordPurchase: "Record purchase",
  getSettings: "Look up settings",
  updateSettings: "Change settings",
  getAuditLog: "Look up audit log",
  exportProductsCsv: "Prepare CSV export",
  getStockValuation: "Stock valuation",
  getProductTurnover: "Product turnover",
  getSupplierSpend: "Supplier spend",
};
