"use client";
import { actorLabel, euro, stockCost, movementTypeLabel } from "@/shared/state/inventory";
import { productFromAPI } from "@/shared/state/product";
import { inventoryActions, useInventory } from "@/shared/state/store";
import { useAPI } from "@/shared/api/use-api";
import { Archive, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { MovementDialog } from "../components/movement-dialog";
import { ProductForm } from "../components/product-form";
import { QueryState } from "../../../shared/components/query-state";
import {
  BackLink,
  EmptyState,
  Metrics,
  PageHeading,
  Pagination,
  PanelTitle,
} from "../../../shared/components/shared";
import { Button } from "../../../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog";

export function ProductDetailView({ id }: { id: string }) {
  const result = useAPI("/v1/products/{id}", {}, id);
  const [adjust, setAdjust] = useState(false);
  const [edit, setEdit] = useState(false);
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const key = useRef(crypto.randomUUID());
  const router = useRouter();
  const { warehouses, settings, identity } = useInventory();
  const history = useAPI("/v1/movements-page", { product: id, limit: 12, offset: (page - 1) * 12 });
  const balances = useAPI("/v1/inventory", { product: id, limit: 500 });
  if (!result.data)
    return (
      <>
        <BackLink />
        <QueryState loading={result.loading} error={result.error} />
      </>
    );
  const p = productFromAPI(result.data);

  return (
    <>
      <PageHeading title={p.name} description={`${p.category || "No category"} / ${p.sku}`}>
        <BackLink />
        <>
          <Button variant="outline" onClick={() => setEdit(true)}>
            <Pencil size={14} />
            Edit
          </Button>
          <Button onClick={() => setAdjust(true)}>
            <Plus size={14} />
            Adjust stock
          </Button>
        </>
      </PageHeading>
      <Metrics
        items={[
          { label: "Current stock", value: `${p.stock} ${p.unitSymbol}` },
          {
            label: "Cost / Price",
            value: `${euro(p.costPrice || "0")} / ${euro(p.salePrice || "0")}`,
          },
          { label: "Stock value", value: euro(stockCost(String(p.stock), p.costPrice || "0")) },
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-xl border p-5">
          <PanelTitle>Product details</PanelTitle>
          <dl className="mt-6 space-y-4 text-sm">
            {[
              ["SKU", p.sku],
              ["Barcode", p.barcode || "No barcode"],
              ["Category", p.category || "No category"],
              ["Unit of measure", `${p.unitName} (${p.unitSymbol})`],
              ["Minimum stock", `${p.minimum} ${p.unitSymbol}`],
              ["Location", p.location || "No location"],
            ].map(([label, value]) => (
              <div className="flex flex-wrap justify-between gap-3" key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            {p.notes && (
              <div>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="mt-2 whitespace-pre-wrap">{p.notes}</dd>
              </div>
            )}
          </dl>
        </section>
        <aside className="soft-panel space-y-4 p-5">
          <PanelTitle>Stock by warehouse</PanelTitle>
          <QueryState loading={balances.loading} error={balances.error} />
          {balances.data?.map((b) => (
            <div key={b.warehouse_id} className="flex justify-between gap-3 text-sm">
              <span>{warehouses.find((w) => w.id === b.warehouse_id)?.name || b.warehouse_id}</span>
              <strong>
                {b.quantity} {p.unitSymbol}
              </strong>
            </div>
          ))}
          {balances.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No stock recorded.</p>
          )}
          <>
            <Button
              variant="outline"
              className="w-full"
              disabled={p.stock !== 0}
              title={p.stock !== 0 ? "Empty the stock before archiving" : "Archive product"}
              onClick={() => setArchive(true)}
            >
              <Archive size={14} />
              Archive product
            </Button>
            <p className="text-xs text-muted-foreground">
              Archiving keeps the history. Requires zero stock.
            </p>
          </>
        </aside>
      </div>
      <section className="rounded-xl border p-5">
        <PanelTitle>Product history</PanelTitle>
        <QueryState loading={history.loading} error={history.error} />
        {history.data?.items.length === 0 && <EmptyState title="No movements" />}
        {history.data?.items.map((m) => (
          <div key={m.id} className="flex flex-wrap justify-between gap-3 border-b py-4 text-xs">
            <div>
              <p>
                {movementTypeLabel(m.type)} · {m.reference || "No reference"}
              </p>
              <p className="mt-1 text-muted-foreground">
                {new Date(m.created_at).toLocaleString("en-US", { timeZone: settings.timezone })} ·{" "}
                {actorLabel(m.actor_type, identity)}
              </p>
            </div>
            <strong className="tabular">
              {m.quantity > 0 ? "+" : ""}
              {m.quantity} {m.unit_symbol}
            </strong>
          </div>
        ))}
        <Pagination
          page={page}
          pageSize={12}
          total={history.data?.total || 0}
          count={history.data?.items.length || 0}
          onChange={setPage}
          noun="movements"
        />
      </section>
      <MovementDialog
        key={`${id}-${adjust}`}
        open={adjust}
        onOpenChange={setAdjust}
        productId={id}
      />
      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit product</DialogTitle>
            <DialogDescription>{p.sku} · Update details, unit and prices.</DialogDescription>
          </DialogHeader>
          {edit && (
            <ProductForm
              product={p}
              onSaved={() => {
                setEdit(false);
                toast.success("Product updated");
              }}
              onCancel={() => setEdit(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={archive} onOpenChange={setArchive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {p.name}</DialogTitle>
            <DialogDescription>
              It will be removed from active inventory. Its movements and audit history will be
              kept.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setArchive(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await inventoryActions.archive(id, key.current);
                  toast.success("Product archived");
                  router.push("/inventory");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm archive
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
