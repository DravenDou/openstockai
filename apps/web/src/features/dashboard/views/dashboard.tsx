"use client";
import { ArrowRight, Bot } from "lucide-react";
import { useAPI } from "@/shared/api/use-api";
import { QueryState } from "@/shared/components/query-state";
import { ActionLink, EmptyState, PageHeading } from "@/shared/components/shared";
import { euro, movementTypeLabel } from "@/shared/state/inventory";
import { useInventory } from "@/shared/state/store";

function Tile({
  label,
  value,
  detail,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  href: string;
  tone?: "warning";
}) {
  return (
    <a
      href={href}
      className="group min-w-0 rounded-xl border p-5 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <strong
        className={`tabular mt-3 block truncate text-[28px] leading-tight font-semibold tracking-[-.03em] ${
          tone === "warning" ? "text-[#b34b08]" : ""
        }`}
      >
        {value}
      </strong>
      <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>
    </a>
  );
}

export function DashboardView() {
  const { settings } = useInventory();
  const summary = useAPI("/v1/analytics/dashboard");
  const low = useAPI("/v1/low-stock", { limit: 6 });
  const data = summary.data;
  const movements = data?.recent_movements ?? [];
  const lowRows = low.data ?? [];
  const ready = !summary.loading && !summary.error && data;
  return (
    <>
      <PageHeading
        title="Your stock at a glance."
        description="Stock value at cost, what needs restocking and the latest activity."
      >
        <ActionLink href="/assistant" variant="outline">
          <Bot size={15} />
          Ask the assistant
        </ActionLink>
      </PageHeading>
      <QueryState loading={summary.loading} error={summary.error} />
      {ready && (
        <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            label="Stock value"
            value={euro(data.stock_value)}
            detail="On-hand quantity at cost price"
            href="/inventory"
          />
          <Tile
            label="Low-stock products"
            value={data.low_stock_count}
            detail="At or below their minimum"
            href="/restock"
            tone={data.low_stock_count > 0 ? "warning" : undefined}
          />
          <Tile
            label="Movements, last 7 days"
            value={data.movements_7d}
            detail="Stock in, out and transfers"
            href="/movements"
          />
          <Tile
            label="Purchases, last 30 days"
            value={euro(data.purchase_spend_30d)}
            detail={`${data.purchases_30d} ${data.purchases_30d === 1 ? "purchase" : "purchases"}`}
            href="/purchases"
          />
        </section>
      )}
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <section aria-labelledby="low-stock-title" className="min-w-0 rounded-xl border p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="low-stock-title" className="text-base font-semibold">
              Needs restocking
            </h2>
            <a
              href="/restock"
              className="inline-flex items-center gap-1 text-xs text-[#9b3c00] hover:underline"
            >
              Restock <ArrowRight size={13} />
            </a>
          </div>
          <QueryState loading={low.loading} error={low.error} />
          {!low.loading &&
            !low.error &&
            (lowRows.length ? (
              <ul className="divide-y">
                {lowRows.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <a
                        href={`/inventory/${p.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {p.name}
                      </a>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{p.sku}</p>
                    </div>
                    <p className="tabular shrink-0 text-right text-sm text-[#b34b08]">
                      {p.stock} / {p.minimum} {p.unit_symbol}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="All caught up"
                description="No products at or below the minimum."
              />
            ))}
        </section>
        <section aria-labelledby="recent-title" className="min-w-0 rounded-xl border p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="recent-title" className="text-base font-semibold">
              Recent movements
            </h2>
            <a
              href="/movements"
              className="inline-flex items-center gap-1 text-xs text-[#9b3c00] hover:underline"
            >
              All movements <ArrowRight size={13} />
            </a>
          </div>
          {ready &&
            (movements.length ? (
              <ul className="divide-y">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <a
                        href={`/inventory/${m.product_id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {m.product_name}
                      </a>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {movementTypeLabel(m.type)} · {m.warehouse_name} ·{" "}
                        {new Date(m.created_at).toLocaleString("en-US", {
                          timeZone: settings.timezone,
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    <p className="tabular shrink-0 text-right text-sm">
                      {m.quantity > 0 ? "+" : ""}
                      {m.quantity} {m.unit_symbol}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No movements yet"
                description="Stock changes will appear here as they happen."
              />
            ))}
        </section>
      </div>
    </>
  );
}
