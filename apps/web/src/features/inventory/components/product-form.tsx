"use client";
import type { Product } from "@/shared/state/inventory";
import { euro, stockCost } from "@/shared/state/inventory";
import { inventoryActions, useInventory } from "@/shared/state/store";
import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { useAPI } from "@/shared/api/use-api";
import { LookupSelect } from "../../../shared/components/lookup-select";
import { PanelTitle } from "../../../shared/components/shared";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";

export function ProductForm({
  product,
  onSaved,
  onCancel,
}: {
  product?: Product;
  onSaved: (id: string) => void;
  onCancel?: () => void;
}) {
  const { units, warehouses } = useInventory();
  const [categoryQuery, setCategoryQuery] = useState(product?.category || "");
  const categories = useAPI("/v1/categories", { query: categoryQuery, limit: 30 });
  const [warehouse, setWarehouse] = useState(warehouses[0]?.id || "");
  const key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unit, setUnit] = useState(product?.unitCode || "pcs");
  const [stock, setStock] = useState("0");
  const [cost, setCost] = useState(product?.costPrice || "0.00");
  const selectedUnit = units.find((u) => u.code === unit);
  const step = 10 ** -(selectedUnit?.decimals || 0);
  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const form = new FormData(e.currentTarget);
        const values = {
          name: String(form.get("name")).trim(),
          sku: String(form.get("sku")).trim(),
          category: String(form.get("category")).trim(),
          barcode: String(form.get("barcode")).trim(),
          costPrice: cost,
          salePrice: String(form.get("salePrice")),
          minimum: Number(form.get("minimum")),
          location: String(form.get("location")),
          notes: String(form.get("notes")),
          unitCode: unit,
        };
        try {
          if (product) {
            await inventoryActions.editProduct(product.id, values, key.current);
            onSaved(product.id);
          } else {
            const result = await inventoryActions.addProduct(
              {
                ...values,
                stock: Number(stock),
                cost: Number(cost),
                warehouseId: String(form.get("warehouse")),
                icon: "package",
              },
              key.current,
            );
            onSaved(result.id);
          }
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className="space-y-5 rounded-xl border p-5">
          <PanelTitle>Product information</PanelTitle>
          <Field
            label="Product name *"
            name="name"
            defaultValue={product?.name}
            required
            maxLength={160}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="SKU *"
              name="sku"
              defaultValue={product?.sku}
              required
              maxLength={80}
              readOnly={!!product}
            />
            <Field label="Barcode" name="barcode" defaultValue={product?.barcode} maxLength={100} />
            <label className="block text-xs">
              Category
              <Input
                className="mt-2"
                name="category"
                value={categoryQuery}
                onChange={(e) => setCategoryQuery(e.target.value)}
                list="product-categories"
                maxLength={120}
                placeholder="No category"
              />
              <datalist id="product-categories">
                {categories.data?.map((c) => (
                  <option value={c.name} key={c.id} />
                ))}
              </datalist>
            </label>
            <label className="block text-xs">
              Unit of measure
              <select
                aria-label="Unit of measure"
                className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                {units
                  .filter((u) => u.active || u.code === product?.unitCode)
                  .map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.name} ({u.symbol})
                    </option>
                  ))}
              </select>
            </label>
            {!product && (
              <>
                <Field
                  label="Initial stock *"
                  name="stock"
                  type="number"
                  min="0"
                  max="1000000000"
                  step={step}
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  required
                />
                <LookupSelect
                  endpoint="/v1/warehouses"
                  label="Initial stock warehouse"
                  name="warehouse"
                  value={warehouse}
                  onChange={setWarehouse}
                  required={Number(stock) > 0}
                />
              </>
            )}
            <Field
              label="Unit cost *"
              name="costPrice"
              type="number"
              min="0"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              required
            />
            <Field
              label="Sale price *"
              name="salePrice"
              type="number"
              min="0"
              step="0.01"
              defaultValue={product?.salePrice || "0.00"}
              required
            />
            <Field
              label="Minimum stock"
              name="minimum"
              type="number"
              min="0"
              max="1000000000"
              step={step}
              defaultValue={String(product?.minimum || 0)}
              required
            />
            <Field
              label="Location"
              name="location"
              defaultValue={product?.location || ""}
              maxLength={300}
            />
          </div>
          <label className="block text-xs">
            Notes
            <Textarea
              name="notes"
              defaultValue={product?.notes}
              className="mt-2 min-h-24"
              maxLength={4000}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
        <aside className="soft-panel space-y-5 p-5">
          <PanelTitle>{product ? "Unit and prices" : "Initial stock"}</PanelTitle>
          <p className="text-sm">
            {selectedUnit?.name} · {selectedUnit?.decimals || 0} decimals
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Quantities are stored exactly. A unit with movements keeps its precision and cannot be
            changed to another.
          </p>
          {!product && (
            <p className="tabular text-2xl font-semibold">{euro(stockCost(stock, cost))}</p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            The category, product and stock are committed together. If the operation fails, nothing
            is saved.
          </p>
        </aside>
      </div>
      <div className="flex justify-end gap-3">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          <Check size={15} />
          {busy ? "Saving…" : product ? "Save changes" : "Save product"}
        </Button>
      </div>
    </form>
  );
}
function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  return (
    <label className="block text-xs">
      {label}
      <Input className="mt-2" {...props} />
    </label>
  );
}
