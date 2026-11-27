import { defineState } from "eve/context";
import type { ToolContext } from "eve/tools";
import { principal } from "./api";

// Progressive tool selection: the model always sees the core reads and enables groups
// per task with selectTools. Set AI_TOOL_SELECTION=all to expose every tool at once.
export const toolGroups = {
  catalog: [
    "searchCategories",
    "createCategory",
    "updateCategory",
    "deleteCategory",
    "createProduct",
    "updateProduct",
    "archiveProduct",
    "restoreProduct",
    "createUnit",
  ],
  stock: ["adjustStock", "transferStock", "countStock"],
  suppliers: ["searchSuppliers", "createSupplier", "updateSupplier", "deleteSupplier"],
  purchases: ["listPurchases", "getPurchase", "recordPurchase"],
  warehouses: ["createWarehouse", "updateWarehouse", "deleteWarehouse"],
  settings: ["getSettings", "updateSettings"],
  audit: ["getAuditLog"],
  export: ["exportProductsCsv"],
  analytics: ["getStockValuation", "getProductTurnover", "getSupplierSpend"],
} as const;
export type ToolGroup = keyof typeof toolGroups;
export const toolGroupNames = Object.keys(toolGroups) as [ToolGroup, ...ToolGroup[]];
export const groupDescriptions: Record<ToolGroup, string> = {
  catalog: "products (create, edit, archive, restore), categories, units",
  stock: "stock adjustments, transfers between warehouses, physical counts",
  suppliers: "search, create, edit and delete suppliers",
  purchases: "purchase receipts: list, detail, record a delivery",
  warehouses: "create, rename and delete warehouses",
  settings: "read and change app settings, including auto-approval",
  audit: "audit log of who changed what",
  export: "CSV export of products as a download link",
  analytics: "stock valuation, product turnover and slow movers, spend by supplier",
};
export const coreTools = [
  "searchProducts",
  "getProduct",
  "getProductBySku",
  "getInventory",
  "getInventorySummary",
  "getLowStockProducts",
  "getStockMovements",
  "getWarehouses",
  "getMeasurementUnits",
  "selectTools",
] as const;
const core: readonly string[] = coreTools;
export const toolSelection = defineState("openstock.tool-selection", () => ({
  scope: "",
  groups: [] as ToolGroup[],
}));
type Session = ToolContext["session"];
function scope(session: Pick<Session, "id" | "auth">, turnId: string) {
  return JSON.stringify({ ...principal(session), conversationId: session.id, turnId });
}
export function enableToolGroups(session: Session, groups: ToolGroup[]) {
  const key = scope(session, session.turn.id);
  toolSelection.update((current) => ({
    scope: key,
    groups: [...new Set([...(current.scope === key ? current.groups : []), ...groups])],
  }));
  return availableTools(session, session.turn.id) ?? [...core, ...Object.values(toolGroups).flat()];
}
export function availableTools(session: Pick<Session, "id" | "auth">, turnId: string) {
  const mode = process.env.AI_TOOL_SELECTION || "progressive";
  if (mode === "all") return undefined;
  if (mode !== "progressive") throw new Error("Invalid configuration: AI_TOOL_SELECTION.");
  const current = toolSelection.get();
  const groups = current.scope === scope(session, turnId) ? current.groups : [];
  return [...core, ...groups.flatMap((group) => [...toolGroups[group]])];
}
