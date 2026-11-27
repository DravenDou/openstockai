"use client";
import { exportCsv } from "@/shared/state/inventory";
import { useAPI } from "@/shared/api/use-api";
import { useState } from "react";
import { QueryState } from "../../../shared/components/query-state";
import {
  EmptyState,
  ExportButton,
  PageHeading,
  Pagination,
} from "../../../shared/components/shared";
export function RestockView() {
  const [page, setPage] = useState(1);
  const result = useAPI("/v1/products", { stock: "low", limit: 12, offset: (page - 1) * 12 });
  const rows = result.data?.items || [];
  const suggested = (p: (typeof rows)[number]) =>
    Number((p.minimum - p.stock + 10 ** -p.unit_decimals).toFixed(p.unit_decimals));
  return (
    <>
      <PageHeading
        title="What needs restocking."
        description="Products at or below minimum stock. Suggested quantities exceed the minimum by the smallest increment of their unit."
      >
        <ExportButton
          label="Export page"
          onClick={() =>
            exportCsv("restock-openstockai.csv", [
              ["Product", "SKU", "Unit", "Stock", "Minimum", "Suggested"],
              ...rows.map((p) => [p.name, p.sku, p.unit_symbol, p.stock, p.minimum, suggested(p)]),
            ])
          }
        />
      </PageHeading>
      <section className="min-w-0 rounded-xl border p-5">
        <QueryState loading={result.loading} error={result.error} />
        {!result.loading &&
          !result.error &&
          (rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    {["Product", "Stock", "Minimum", "Suggested"].map((label) => (
                      <th key={label} className="pb-4 font-normal">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr className="border-b" key={p.id}>
                      <td className="py-5 pr-3">
                        <a href={`/inventory/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </a>
                        <p className="mt-1 text-xs text-muted-foreground">{p.sku}</p>
                      </td>
                      <td className="tabular whitespace-nowrap">
                        {p.stock} {p.unit_symbol}
                      </td>
                      <td className="tabular whitespace-nowrap">
                        {p.minimum} {p.unit_symbol}
                      </td>
                      <td className="tabular whitespace-nowrap text-[#9b3c00]">
                        +{suggested(p)} {p.unit_symbol}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="All caught up" description="No products at or below the minimum." />
          ))}
        <Pagination
          page={page}
          pageSize={12}
          total={result.data?.total || 0}
          count={rows.length}
          onChange={setPage}
        />
        <p className="mt-5 text-xs text-muted-foreground">
          This list does not create purchases or change stock. Quantities in different units are not
          added together.
        </p>
      </section>
    </>
  );
}
