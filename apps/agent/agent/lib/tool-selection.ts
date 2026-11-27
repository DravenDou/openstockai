import { defineState } from "eve/context";
import type { ToolContext } from "eve/tools";
import { principal } from "./api";

export const toolGroups = {
  catalog: ["searchCategories", "createCategory", "createProduct", "updateProduct"],
  stock: ["adjustStock", "transferStock"],
  suppliers: ["searchSuppliers", "createSupplier"],
} as const;
export type ToolGroup = keyof typeof toolGroups;
const core = [
  "searchProducts",
  "getProduct",
  "getInventory",
  "getInventorySummary",
  "getLowStockProducts",
  "getStockMovements",
  "getWarehouses",
  "getMeasurementUnits",
  "selectTools",
];
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
