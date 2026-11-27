"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAPI } from "@/shared/api/use-api";
import { euro } from "@/shared/state/inventory";
import { savePurchaseDraft, useInventory } from "@/shared/state/store";
import type { Schemas } from "@openstockai/api-client/client";
import { HistoryNavigation } from "@/shared/components/history-navigation";
import { QueryState } from "../../../shared/components/query-state";
import {
  ActionLink,
  EmptyState,
  PageHeading,
  SearchInput,
  Metrics,
  BackLink,
} from "../../../shared/components/shared";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";

export function NewPurchaseView() {
  const router = useRouter();
  return (
    <>
      <PageHeading
        title="Record a purchase"
        description="Add existing or new products and receive their quantities into a warehouse."
      >
        <BackLink href="/purchases" label="Back to purchases" />
      </PageHeading>
      <form
        className="max-w-xl space-y-5 rounded-xl border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          const reference = String(values.get("reference") || "").trim();
          if (!reference) return;
          savePurchaseDraft({
            name: "Manual purchase",
            reference,
            items: [{ name: "", sku: "", category: "", quantity: 1, cost: 0, unitCode: "pcs" }],
            key: crypto.randomUUID(),
          });
          router.push("/purchases/review");
        }}
      >
        <label className="block text-sm">
          Purchase reference
          <Input className="mt-2" name="reference" required maxLength={200} placeholder="PUR-001" />
        </label>
        <p className="text-xs text-muted-foreground">
          In the next step you review products, quantities and costs. Stock changes when you
          confirm.
        </p>
        <Button type="submit">Continue</Button>
      </form>
    </>
  );
}

export function PurchasesView() {
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<Schemas["HistoryCursor"][]>([]);
  const cursor = cursors.at(-1);
  const result = useAPI("/v1/purchases-page", {
    query: search,
    limit: 20,
    ...(cursor ? { beforeId: cursor.id, beforeDate: cursor.date } : {}),
  });
  const { settings } = useInventory();
  return (
    <>
      <PageHeading
        title="Purchase history"
        description="Confirmed receipts, supplier, warehouse and line item details."
      >
        <ActionLink href="/purchases/new">Record purchase</ActionLink>
      </PageHeading>
      <section className="rounded-xl border p-5">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setCursors([]);
          }}
          placeholder="Search reference or supplier"
        />
        <QueryState loading={result.loading} error={result.error} />
        {result.data?.items.length === 0 && <EmptyState title="No purchases recorded" />}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                {["Reference", "Date", "Supplier", "Warehouse", "Total"].map((h) => (
                  <th key={h} className="p-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.data?.items.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="p-3">
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/purchases/${p.id}`}
                    >
                      {p.reference}
                    </Link>
                  </td>
                  <td className="p-3 text-xs">
                    {new Date(p.created_at).toLocaleString("en-US", {
                      timeZone: settings.timezone,
                    })}
                  </td>
                  <td className="p-3">{p.supplier || "No supplier"}</td>
                  <td className="p-3">{p.warehouse}</td>
                  <td className="p-3 tabular whitespace-nowrap">{euro(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <HistoryNavigation
          back={cursors.length > 0 && !result.loading}
          next={!!result.data?.next && !result.loading}
          onBack={() => setCursors((c) => c.slice(0, -1))}
          onNext={() => {
            if (result.data?.next) setCursors((c) => [...c, result.data!.next!]);
          }}
        />
      </section>
    </>
  );
}
export function PurchaseDetailView({ id }: { id: string }) {
  const result = useAPI("/v1/purchases/{id}", {}, id);
  const { settings } = useInventory();
  const p = result.data?.purchase;
  return (
    <>
      <PageHeading
        title={p?.reference || "Purchase details"}
        description="The receipt has already been applied to stock. This record keeps purchase quantities and costs."
      >
        <BackLink href="/purchases" label="Back to purchases" />
      </PageHeading>
      <QueryState loading={result.loading} error={result.error} />
      {p && (
        <>
          <Metrics
            items={[
              { label: "Total received", value: euro(p.total) },
              { label: "Warehouse", value: p.warehouse },
              { label: "Supplier", value: p.supplier || "No supplier" },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            {new Date(p.created_at).toLocaleString("en-US", { timeZone: settings.timezone })} ·{" "}
            {p.actor_type === "ai" ? "Assistant" : "User"}
          </p>
          <section className="overflow-x-auto rounded-xl border p-5">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  {["Product / SKU", "Quantity", "Unit cost", "Amount"].map((h) => (
                    <th key={h} className="p-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data?.items.map((line) => (
                  <tr key={line.product_id} className="border-b">
                    <td className="p-3">
                      {line.name}
                      <p className="mt-1 text-xs text-muted-foreground">{line.sku}</p>
                    </td>
                    <td className="p-3 tabular whitespace-nowrap">
                      {line.quantity} {line.unit_symbol}
                    </td>
                    <td className="p-3 tabular">{euro(line.cost_price)}</td>
                    <td className="p-3 tabular">{euro(line.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
