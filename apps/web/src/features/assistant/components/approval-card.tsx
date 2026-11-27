"use client";
import { euro, movementTypeLabel } from "@/shared/state/inventory";
import { useInventory } from "@/shared/state/store";
import type { ConversationInput } from "eve/react";
import { useRef, useState } from "react";
import { Button } from "../../../shared/ui/button";

type InputRequest = ConversationInput;
const labels: Record<string, string> = {
  name: "Name",
  sku: "SKU",
  productId: "Product",
  warehouseId: "Warehouse",
  fromWarehouseId: "From",
  toWarehouseId: "To",
  categoryId: "Category",
  categoryName: "Category",
  unitCode: "Unit",
  quantity: "Quantity",
  initialStock: "Initial stock",
  costPrice: "Cost",
  salePrice: "Sale price",
  minimum: "Minimum stock",
  description: "Description",
  reference: "Reference",
  location: "Location",
  type: "Movement",
};
export function ApprovalCard({
  input,
  onRespond,
  disabled = false,
}: {
  input: InputRequest;
  onRespond: (requestId: string, optionId: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const { products, warehouses, categories, units } = useInventory();
  const raw = input.request.action.input;
  const details =
    raw && typeof raw === "object"
      ? Object.entries(raw)
          .map(([key, value]) => {
            const resource =
              key === "productId" ? products : key === "categoryId" ? categories : warehouses;
            const display =
              key === "type"
                ? movementTypeLabel(String(value))
                : key === "unitCode"
                  ? units.find((u) => u.code === value)?.name || String(value)
                  : resource.find((row) => row.id === value)?.name || String(value ?? "");
            return `${labels[key] || key}: ${["costPrice", "salePrice"].includes(key) ? euro(display) : display}`;
          })
          .join(" · ")
      : "Review the details before confirming.";
  return (
    <section className="space-y-4 rounded-lg border bg-secondary p-5">
      <p className="text-sm font-medium">{input.request.prompt}</p>
      <p className="text-xs leading-relaxed break-words">{details}</p>
      <div className="flex flex-wrap gap-2">
        {input.request.options?.map((option) => (
          <Button
            key={option.id}
            variant={option.style === "danger" ? "outline" : "default"}
            disabled={busy || disabled}
            onClick={async () => {
              if (lock.current || disabled) return;
              lock.current = true;
              setBusy(true);
              setError("");
              try {
                await onRespond(input.request.requestId, option.id);
              } catch (error) {
                setError((error as Error).message);
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            {option.id === "approve" ? "Approve" : option.id === "cancel" ? "Reject" : option.label}
          </Button>
        ))}
      </div>
      {busy && (
        <p role="status" className="text-xs">
          Sending decision…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
