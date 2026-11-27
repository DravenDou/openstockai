import { call } from "eve/events";
import { defineHook } from "eve/hooks";
import { clearCatalogCache } from "../lib/catalog-cache";

// The catalog cache holds the warehouse and unit lists. Writes run in a workflow step, where
// session state is unavailable, so the cache is cleared here once any write settles.
export const writeTools = new Set([
  "adjustStock",
  "archiveProduct",
  "countStock",
  "createCategory",
  "createProduct",
  "createSupplier",
  "createUnit",
  "createWarehouse",
  "deleteCategory",
  "deleteSupplier",
  "deleteWarehouse",
  "recordPurchase",
  "restoreProduct",
  "transferStock",
  "updateCategory",
  "updateProduct",
  "updateSupplier",
  "updateWarehouse",
]);

export default defineHook({
  events: {
    "call.settled"(event, ctx) {
      const finished = call(ctx.view, event.data.callId);
      if (finished && writeTools.has(finished.name)) clearCatalogCache();
    },
  },
});
