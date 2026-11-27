"use client";
import { getPurchaseDraft, inventoryActions, useInventory } from "@/shared/state/store";
import { usePurchaseProducts } from "@/features/purchases/lib/use-purchase-products";
import { Check, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PurchaseLine, type PurchaseLineItem } from "../components/purchase-line";
import { LookupSelect } from "../../../shared/components/lookup-select";
import { QueryState } from "../../../shared/components/query-state";
import { ActionLink, PageHeading } from "../../../shared/components/shared";
import { Button } from "../../../shared/ui/button";

export function PurchaseReviewView() {
  const draft = getPurchaseDraft();
  const { purchaseApplied, warehouses } = useInventory();
  const [items, setItems] = useState<PurchaseLineItem[]>(draft?.items || []);
  const [warehouse, setWarehouse] = useState(warehouses[0]?.id || "");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matching = usePurchaseProducts(items.map((item) => item.sku));
  if (!draft)
    return (
      <>
        <PageHeading
          title="Review a purchase"
          description="Create a manual purchase to enter its products and quantities."
        />
        <ActionLink href="/purchases/new">Record purchase</ActionLink>
      </>
    );
  return (
    <form
      className="space-y-7"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || matching.loading || matching.error) return;
        setBusy(true);
        setError("");
        try {
          await inventoryActions.applyPurchase(
            items.map((item) => ({
              ...item,
              id: matching.products[item.sku]?.id,
              costPrice:
                item.costPrice ?? matching.products[item.sku]?.cost_price ?? item.cost.toFixed(2),
            })),
            draft.reference,
            warehouse,
            supplier || undefined,
          );
          toast.success("Purchase saved and inventory updated");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <PageHeading
        title="Review and confirm your purchase."
        description={
          purchaseApplied
            ? "Purchase saved. The movements are now in the history."
            : "Review quantities, units and prices before confirming."
        }
      />
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl bg-muted p-5">
          <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <FileText size={14} />
            {draft.name}
          </p>
          <p className="rounded-lg bg-background p-5 text-sm leading-relaxed">
            Enter the SKU to find an existing product. If it is new, fill in the name, unit and
            prices. The purchase is saved after you review and confirm.
          </p>
        </section>
        <section className="min-w-0 space-y-4">
          <QueryState loading={matching.loading} error={matching.error} />
          <p className="rounded-lg bg-secondary p-4 text-xs">
            {items.length} lines · {items.filter((item) => matching.products[item.sku]).length}{" "}
            existing products · Reference: {draft.reference}
          </p>
          <fieldset disabled={purchaseApplied || busy} className="space-y-4">
            {items.map((item, index) => (
              <div key={index} className="space-y-2">
                <PurchaseLine
                  item={item}
                  product={matching.products[item.sku] || null}
                  onChange={(changes) =>
                    setItems((current) =>
                      current.map((row, i) => (i === index ? { ...row, ...changes } : row)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                  disabled={items.length === 1}
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                >
                  Remove line
                </Button>
              </div>
            ))}
            {items.length < 100 && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setItems((current) => [
                    ...current,
                    {
                      name: "",
                      sku: "",
                      category: "",
                      quantity: 1,
                      cost: 0,
                      unitCode: "pcs",
                    },
                  ])
                }
              >
                Add line
              </Button>
            )}
          </fieldset>
        </section>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-5 border-t pt-5">
        <div className="flex flex-wrap gap-4">
          <LookupSelect
            endpoint="/v1/warehouses"
            label="Purchase warehouse"
            value={warehouse}
            onChange={setWarehouse}
            disabled={purchaseApplied || busy}
            required
          />
          <LookupSelect
            endpoint="/v1/suppliers"
            label="Supplier"
            value={supplier}
            onChange={setSupplier}
            disabled={purchaseApplied || busy}
            emptyLabel="No supplier"
          />
        </div>
        {purchaseApplied ? (
          <ActionLink href="/inventory">View inventory</ActionLink>
        ) : (
          <div className="flex gap-3">
            <ActionLink href="/purchases">Cancel</ActionLink>
            <Button disabled={busy || matching.loading || !!matching.error}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirm and update
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Categories, products, purchase and stock are saved together. Retrying reuses the same key to
        avoid duplicates.
      </p>
    </form>
  );
}
