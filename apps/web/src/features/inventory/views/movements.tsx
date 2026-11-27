"use client";
import { actorLabel, exportCsv, movementTypeLabel } from "@/shared/state/inventory";
import { useInventory } from "@/shared/state/store";
import { useAPI } from "@/shared/api/use-api";
import { Plus } from "lucide-react";
import { useState } from "react";
import { LookupSelect } from "../../../shared/components/lookup-select";
import { MovementDialog } from "../components/movement-dialog";
import { QueryState } from "../../../shared/components/query-state";
import {
  EmptyState,
  ExportButton,
  PageHeading,
  Pagination,
  SearchInput,
} from "../../../shared/components/shared";
import { Button } from "../../../shared/ui/button";
export function MovementsView() {
  const { identity, settings, warehouses } = useInventory();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [since, setSince] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [page, setPage] = useState(1);
  const result = useAPI("/v1/movements-page", {
    query: search,
    kind,
    warehouse,
    since: since ? new Date(since).toISOString() : "",
    limit: 12,
    offset: (page - 1) * 12,
  });
  const rows = result.data?.items || [];
  return (
    <>
      <PageHeading
        title="Every change, under control."
        description="Immutable history, filtered and paginated on the server."
      >
        <ExportButton
          label="Export page"
          onClick={() =>
            exportCsv("stock-movements-openstockai.csv", [
              ["Product", "Type", "Quantity", "Unit", "Source", "Reference", "Date"],
              ...rows.map((m) => [
                m.name,
                m.type,
                m.quantity,
                m.unit_symbol,
                actorLabel(m.actor_type, identity),
                m.reference,
                m.created_at,
              ]),
            ])
          }
        />
        <Button onClick={() => setOpen(true)}>
          <Plus size={15} />
          Record movement
        </Button>
      </PageHeading>
      <section className="min-w-0 rounded-xl border p-5">
        <div className="mb-6 flex flex-wrap gap-3">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search movements"
          />
          <select
            aria-label="Movement type"
            className="h-10 rounded-lg border bg-background px-3 text-xs"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="in">Stock in</option>
            <option value="out">Stock out</option>
            <option value="adjustment">Adjustments</option>
            <option value="return">Returns</option>
            <option value="transfer">Transfers</option>
          </select>
          <LookupSelect
            endpoint="/v1/warehouses"
            label="Movements warehouse"
            value={warehouse}
            onChange={(value) => {
              setWarehouse(value);
              setPage(1);
            }}
            emptyLabel="All warehouses"
          />
          <label className="flex items-center gap-2 text-xs">
            From (UTC)
            <input
              aria-label="Start date in UTC"
              type="date"
              className="h-10 rounded-lg border px-3"
              value={since}
              onChange={(e) => {
                setSince(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <p className="self-center text-xs text-muted-foreground">
            {result.data?.total || 0} movements found
          </p>
        </div>
        <QueryState loading={result.loading} error={result.error} />
        {!result.loading &&
          !result.error &&
          (rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    {["Product", "Movement", "Quantity", "Recorded by", "Date"].map((label, i) => (
                      <th
                        key={label}
                        className={`pb-4 font-normal ${[1, 3, 4].includes(i) ? "hidden md:table-cell" : ""}`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="border-b">
                      <td className="py-5 pr-3">
                        <a
                          href={`/inventory/${m.product_id}`}
                          className="font-medium hover:underline"
                        >
                          {m.name}
                        </a>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {m.reference || m.id.slice(0, 8)}
                        </p>
                      </td>
                      <td className="hidden md:table-cell">
                        {movementTypeLabel(m.type)}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {warehouses.find((w) => w.id === m.warehouse_id)?.name}
                        </p>
                      </td>
                      <td className="tabular whitespace-nowrap">
                        {m.quantity > 0 ? "+" : ""}
                        {m.quantity} {m.unit_symbol}
                      </td>
                      <td className="hidden md:table-cell">{actorLabel(m.actor_type, identity)}</td>
                      <td className="hidden text-muted-foreground md:table-cell">
                        {new Date(m.created_at).toLocaleString("en-US", {
                          timeZone: settings.timezone,
                        })}
                      </td>
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
          noun="movements"
        />
      </section>
      <MovementDialog key={String(open)} open={open} onOpenChange={setOpen} />
    </>
  );
}
