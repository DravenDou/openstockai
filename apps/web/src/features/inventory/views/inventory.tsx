"use client";
import { euro, exportCsv } from "@/shared/state/inventory";
import { productFromAPI } from "@/shared/state/product";
import { refreshAfterWrite, useInventory } from "@/shared/state/store";
import { useAPI } from "@/shared/api/use-api";
import { cn } from "@/shared/lib/utils";
import { request, type Schemas } from "@openstockai/api-client/client";
import { Button } from "../../../shared/ui/button";
import { Plus, Download, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { LookupSelect } from "../../../shared/components/lookup-select";
import { QueryState } from "../../../shared/components/query-state";
import {
  ActionLink,
  AiShortcut,
  EmptyState,
  ExportButton,
  Metrics,
  PageHeading,
  Pagination,
  ProductIcon,
  SearchInput,
  StatusLabel,
} from "../../../shared/components/shared";

export function InventoryView() {
  const { summary } = useInventory();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [exporting, setExporting] = useState(false);
  const restoreKeys = useRef(new Map<string, string>());
  const [restoring, setRestoring] = useState("");
  const [page, setPage] = useState(1);
  const result = useAPI("/v1/products", {
    query: search,
    stock: filter === "archived" ? "" : filter,
    status: filter === "archived" ? "archived" : "active",
    warehouse,
    category,
    limit: 12,
    offset: (page - 1) * 12,
  });
  const rows = result.data?.items.map(productFromAPI) || [];

  return (
    <>
      <PageHeading
        title="All your inventory."
        description="Products, units, stock and prices in one place."
      >
        <ExportButton
          label="Export page"
          onClick={() => {
            exportCsv("inventory-openstockai.csv", [
              ["Product", "SKU", "Barcode", "Category", "Unit", "Stock", "Cost", "Sale price"],
              ...rows.map((p) => [
                p.name,
                p.sku,
                p.barcode || "",
                p.category,
                p.unitSymbol || "units",
                p.stock,
                p.costPrice || "0",
                p.salePrice || "0",
              ]),
            ]);
            toast.success("Page exported");
          }}
        />
        <Button
          variant="outline"
          disabled={exporting}
          onClick={async () => {
            if (exporting) return;
            setExporting(true);
            try {
              const all: (string | number)[][] = [
                ["Product", "SKU", "Barcode", "Category", "Unit", "Stock", "Cost", "Sale price"],
              ];
              let after: { id: string } | null = null;
              do {
                const batch: Schemas["ExportPage"] = await request("/v1/products-export", "get", {
                  query: {
                    query: search,
                    category,
                    warehouse,
                    stock: filter === "archived" ? "" : filter,
                    status: filter === "archived" ? "archived" : "active",
                    limit: 500,
                    ...(after ? { afterId: after.id } : {}),
                  },
                });
                all.push(
                  ...batch.items.map((p) => [
                    p.name,
                    p.sku,
                    p.barcode,
                    p.category,
                    p.unit_symbol,
                    p.stock,
                    p.cost_price,
                    p.sale_price,
                  ]),
                );
                after = batch.next;
              } while (after);
              exportCsv("inventory-full-openstockai.csv", all);
              toast.success(`${all.length - 1} products exported`);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setExporting(false);
            }
          }}
        >
          <Download size={14} />
          {exporting ? "Exporting…" : "Export results"}
        </Button>
        <ActionLink href="/inventory/new" variant="default">
          <Plus size={15} />
          Add product
        </ActionLink>
      </PageHeading>
      <Metrics
        items={[
          { label: "Active products", value: summary.products },
          {
            label: "Total value",
            value: euro(summary.stock_value),
            detail: "All warehouses · cost",
          },
          { label: "Low stock", value: summary.low, detail: "At or below minimum" },
        ]}
      />
      <AiShortcut>New delivery? Tell OpenStock AI and let it record the products.</AiShortcut>
      <section aria-label="Product list" className="min-w-0 rounded-xl border p-4 md:p-5">
        <div className="mb-6 flex flex-wrap justify-between gap-4">
          <div className="flex flex-wrap gap-4 text-xs">
            {[
              { id: "", text: `All (${summary.products})` },
              { id: "low", text: `Low stock (${summary.low})` },
              { id: "out", text: `Out of stock (${summary.empty})` },
              { id: "archived", text: "Archived" },
            ].map((item) => (
              <button
                key={item.id}
                aria-pressed={filter === item.id}
                className={cn(
                  "py-2",
                  filter === item.id ? "font-semibold" : "text-muted-foreground",
                )}
                onClick={() => {
                  setFilter(item.id);
                  setPage(1);
                }}
              >
                {item.text}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search product, SKU or barcode"
            />
            <LookupSelect
              endpoint="/v1/warehouses"
              label="Filter by warehouse"
              value={warehouse}
              onChange={(value) => {
                setWarehouse(value);
                setPage(1);
              }}
              emptyLabel="All warehouses"
            />
            <LookupSelect
              endpoint="/v1/categories"
              label="Category"
              value={category}
              onChange={(value) => {
                setCategory(value);
                setPage(1);
              }}
              emptyLabel="All categories"
            />
          </div>
        </div>
        <QueryState loading={result.loading} error={result.error} />
        {!result.loading &&
          !result.error &&
          (rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    {["Product", "Category", "Stock", "Cost / Price", "Status"].map((name, i) => (
                      <th
                        key={name}
                        className={cn(
                          "pb-4 font-normal",
                          [1, 3, 4].includes(i) && "hidden md:table-cell",
                        )}
                      >
                        {name}
                      </th>
                    ))}
                    {filter === "archived" && <th className="pb-4 font-normal">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="h-[78px] border-b hover:bg-muted/60">
                      <td className="pr-4">
                        <Link
                          href={filter === "archived" ? "#" : `/inventory/${p.id}`}
                          aria-disabled={filter === "archived"}
                          onClick={(e) => {
                            if (filter === "archived") e.preventDefault();
                          }}
                          className="flex items-center gap-3 py-4"
                        >
                          <ProductIcon icon={p.icon} />
                          <span>
                            <span className="block font-medium">{p.name}</span>
                            <span className="mt-1.5 block text-[10px] text-muted-foreground">
                              {p.sku}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="hidden text-muted-foreground md:table-cell">
                        {p.category || "No category"}
                      </td>
                      <td className="tabular whitespace-nowrap">
                        {p.stock} {p.unitSymbol}
                      </td>
                      <td className="tabular hidden md:table-cell">
                        {euro(p.costPrice || "0")} / {euro(p.salePrice || "0")}
                      </td>
                      <td className="hidden md:table-cell">
                        {filter === "archived" ? "Archived" : <StatusLabel product={p} />}
                      </td>
                      {filter === "archived" && (
                        <td>
                          <Button
                            variant="outline"
                            disabled={!!restoring}
                            onClick={async () => {
                              setRestoring(p.id);
                              try {
                                const retryKey =
                                  restoreKeys.current.get(p.id) || crypto.randomUUID();
                                restoreKeys.current.set(p.id, retryKey);
                                await request("/v1/products/{id}/restore", "post", {
                                  id: p.id,
                                  key: retryKey,
                                });
                                restoreKeys.current.delete(p.id);
                                await refreshAfterWrite();
                                toast.success("Product restored");
                              } catch (e) {
                                toast.error((e as Error).message);
                              } finally {
                                setRestoring("");
                              }
                            }}
                          >
                            <RotateCcw size={14} />
                            Restore
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState />
          ))}
        <Pagination
          page={page}
          total={result.data?.total || 0}
          count={rows.length}
          pageSize={12}
          onChange={setPage}
        />
      </section>
    </>
  );
}
