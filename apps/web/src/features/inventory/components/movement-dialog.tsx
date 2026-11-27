"use client";
import { inventoryActions, refreshAfterWrite, useInventory } from "@/shared/state/store";
import { request } from "@openstockai/api-client/client";
import { useAPI } from "@/shared/api/use-api";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { LookupSelect } from "../../../shared/components/lookup-select";
import { QueryState } from "../../../shared/components/query-state";
import { Button } from "../../../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog";
import { Input } from "../../../shared/ui/input";
export function MovementDialog({
  open,
  onOpenChange,
  productId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId?: string;
}) {
  const { warehouses, products } = useInventory();
  const key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(productId || products[0]?.id || "");
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState(warehouses[0]?.id || "");
  const [destination, setDestination] = useState(warehouses[1]?.id || "");
  const [kind, setKind] = useState("Stock in");
  const [quantity, setQuantity] = useState("1");
  const [reference, setReference] = useState("");
  const results = useAPI(
    "/v1/products",
    { query: search, limit: 20 },
    undefined,
    open && !productId,
  );
  const product = useAPI("/v1/products/{id}", {}, selected, open && !!selected);
  const balances = useAPI(
    "/v1/inventory",
    { product: selected, warehouse, limit: 1 },
    undefined,
    open && !!selected,
  );
  // Undefined until the balance for this product and warehouse has loaded.
  const balance = balances.data
    ? (balances.data.find((i) => i.warehouse_id === warehouse)?.quantity ?? 0)
    : undefined;
  const available = balance ?? 0;
  const step = 10 ** -(product.data?.unit_decimals || 0);
  const amount =
    kind === "Sale" || kind === "Supplier return" ? -Math.abs(Number(quantity)) : Number(quantity);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{productId ? "Adjust stock" : "Record movement"}</DialogTitle>
          <DialogDescription>
            Stock in, sales, adjustments and transfers with exact quantities.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              if (kind === "Stock count") {
                await request("/v1/inventory/counts", "post", {
                  key: key.current,
                  body: {
                    productId: selected,
                    warehouseId: warehouse,
                    counted: Number(quantity),
                    expected: available,
                    reference,
                  },
                });
                await refreshAfterWrite();
              } else if (kind === "Customer return" || kind === "Supplier return") {
                await request("/v1/inventory/adjustments", "post", {
                  key: key.current,
                  body: {
                    productId: selected,
                    warehouseId: warehouse,
                    quantity: amount,
                    type: kind === "Customer return" ? "return_in" : "return_out",
                    reference,
                  },
                });
                await refreshAfterWrite();
              } else if (kind === "Transfer")
                await inventoryActions.transfer(
                  selected,
                  warehouse,
                  destination,
                  Number(quantity),
                  key.current,
                );
              else
                await inventoryActions.movement(
                  selected,
                  amount,
                  kind as "Stock in" | "Sale" | "Adjustment",
                  undefined,
                  warehouse,
                  reference,
                  key.current,
                );
              toast.success("Movement recorded");
              key.current = crypto.randomUUID();
              onOpenChange(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!productId && (
            <label className="block text-xs">
              Search product
              <Input
                className="mt-2"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, SKU or barcode"
              />
            </label>
          )}
          <label className="block text-xs">
            Product
            <select
              aria-label="Product"
              className="mt-2 h-10 w-full rounded border bg-background px-3"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              required
              disabled={!!productId}
            >
              <option value="">Select a product</option>
              {product.data && !results.data?.items.some((p) => p.id === selected) && (
                <option value={selected}>{product.data.name}</option>
              )}
              {results.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.sku}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            Movement
            <select
              aria-label="Movement type"
              className="mt-2 h-10 w-full rounded border bg-background px-3"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {[
                "Stock in",
                "Sale",
                "Adjustment",
                "Transfer",
                "Stock count",
                "Customer return",
                "Supplier return",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <LookupSelect
            endpoint="/v1/warehouses"
            label={kind === "Transfer" ? "From warehouse" : "Warehouse"}
            value={warehouse}
            onChange={setWarehouse}
            required
          />
          {kind === "Transfer" && (
            <LookupSelect
              endpoint="/v1/warehouses"
              label="Destination warehouse"
              value={destination}
              onChange={setDestination}
              required
            />
          )}
          <label className="block text-xs">
            {kind === "Stock count" ? "Counted quantity" : "Quantity"} (
            {product.data?.unit_symbol || "units"})
            <Input
              aria-label="Quantity"
              className="mt-2"
              type="number"
              step={step}
              min={kind === "Stock count" ? 0 : kind === "Adjustment" ? undefined : step}
              max="1000000000"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          {kind !== "Transfer" && (
            <label className="block text-xs">
              Reference
              <Input
                className="mt-2"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={200}
                required={kind === "Stock count" || kind.endsWith("return")}
              />
            </label>
          )}
          <QueryState
            loading={product.loading || balances.loading}
            error={product.error || balances.error}
          />
          <p className="rounded-lg bg-muted p-4 text-sm">
            Available:{" "}
            <strong>
              {balance === undefined ? "…" : `${balance} ${product.data?.unit_symbol ?? ""}`}
            </strong>
          </p>
          {kind === "Stock count" && (
            <p className="text-xs text-muted-foreground">
              Enter the total you counted, including zero. The difference will be recorded as an
              adjustment. If stock changes while you count, refresh the view before confirming.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !product.data || balances.loading || !!balances.error}>
              {busy ? "Saving…" : kind === "Transfer" ? "Confirm transfer" : "Confirm movement"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
