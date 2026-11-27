"use client";
import type { Schemas } from "@openstockai/api-client/client";
import { euro, stockCost } from "@/shared/state/inventory";
import { useAPI } from "@/shared/api/use-api";
import { useInventory, type PurchaseDraft } from "@/shared/state/store";
import { Input } from "../../../shared/ui/input";

export type PurchaseLineItem = PurchaseDraft["items"][number] & { salePrice?: string };

export function PurchaseLine({
  item,
  product,
  onChange,
}: {
  item: PurchaseLineItem;
  product: Schemas["Product"] | null;
  onChange: (changes: Partial<PurchaseLineItem>) => void;
}) {
  const { units } = useInventory();
  const categories = useAPI(
    "/v1/categories",
    { query: item.category, limit: 30 },
    undefined,
    !product,
  );
  const unit = units.find((u) => u.code === (product?.unit_code || item.unitCode || "pcs"));
  const step = 10 ** -(unit?.decimals || 0);
  const costPrice = item.costPrice ?? product?.cost_price ?? item.cost.toFixed(2);
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <p className="text-xs font-medium">{product ? `Existing: ${product.name}` : "New product"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          Name
          <Input
            placeholder={product?.name}
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            required={!product}
            maxLength={160}
          />
        </label>
        <label className="text-xs">
          SKU
          <Input
            value={item.sku}
            onChange={(e) => onChange({ sku: e.target.value })}
            required
            maxLength={80}
          />
        </label>
        <label className="text-xs">
          Quantity ({unit?.symbol || "pcs"})
          <Input
            type="number"
            min={step}
            max={1e9}
            step={step}
            value={item.quantity}
            onChange={(e) => onChange({ quantity: Number(e.target.value) })}
            required
          />
        </label>
        <label className="text-xs">
          Unit cost
          <Input
            type="number"
            min="0"
            step="0.01"
            value={costPrice}
            onChange={(e) => onChange({ costPrice: e.target.value, cost: Number(e.target.value) })}
            required
          />
        </label>
        {!product && (
          <>
            <label className="text-xs">
              Unit
              <select
                className="block h-10 w-full rounded border bg-background px-3"
                value={item.unitCode || "pcs"}
                onChange={(e) => onChange({ unitCode: e.target.value })}
              >
                {units
                  .filter((u) => u.active)
                  .map((u) => (
                    <option value={u.code} key={u.code}>
                      {u.name} ({u.symbol})
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs">
              Sale price
              <Input
                type="number"
                min="0"
                step="0.01"
                value={item.salePrice || ""}
                onChange={(e) => onChange({ salePrice: e.target.value })}
                required
              />
            </label>
            <label className="text-xs sm:col-span-2">
              Category
              <Input
                list={`purchase-categories-${item.sku}`}
                value={item.category}
                onChange={(e) => onChange({ category: e.target.value })}
                maxLength={120}
              />
              <datalist id={`purchase-categories-${item.sku}`}>
                {categories.data?.map((c) => (
                  <option value={c.name} key={c.id} />
                ))}
              </datalist>
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Subtotal:{" "}
          {/^(\d+)(\.\d{1,2})?$/.test(costPrice)
            ? euro(stockCost(String(item.quantity), costPrice))
            : "—"}
        </span>
        <span>
          Current stock: {product?.stock || 0} {unit?.symbol}
        </span>
      </div>
    </section>
  );
}
