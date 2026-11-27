"use client";
import { request, type Schemas } from "@openstockai/api-client/client";
import { refreshAfterWrite, useInventory } from "@/shared/state/store";
import { useAPI } from "@/shared/api/use-api";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "../../../shared/components/query-state";
import { EmptyState, PageHeading, PanelTitle } from "../../../shared/components/shared";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../shared/ui/dialog";

const catalogs = {
  "/categories": {
    title: "Categories",
    description: "Organize your products into categories.",
    endpoint: "/v1/categories",
    itemEndpoint: "/v1/categories/{id}",
  },
  "/warehouses": {
    title: "Warehouses",
    description: "Check stock and record transfers between locations.",
    endpoint: "/v1/warehouses",
    itemEndpoint: "/v1/warehouses/{id}",
  },
  "/suppliers": {
    title: "Suppliers",
    description: "Save suppliers to link them to your purchases.",
    endpoint: "/v1/suppliers",
    itemEndpoint: "/v1/suppliers/{id}",
  },
} as const;
export function CatalogView({ path }: { path: string }) {
  return path === "/units" ? <UnitsView /> : <LookupCatalog path={path as keyof typeof catalogs} />;
}
function LookupCatalog({ path }: { path: keyof typeof catalogs }) {
  const config = catalogs[path];
  
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useAPI(config.endpoint, { query: search, limit: 21, offset: (page - 1) * 20 });
  const [editing, setEditing] = useState<Schemas["Lookup"] | null>(null);
  const [deleting, setDeleting] = useState<Schemas["Lookup"] | null>(null);
  const [version, setVersion] = useState(0);
  const key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setEditing(null);
    setVersion((v) => v + 1);
    key.current = crypto.randomUUID();
    setError("");
  };
  return (
    <>
      <PageHeading title={config.title} description={config.description} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-xl border p-5">
          <Input
            aria-label="Search records"
            placeholder="Search by name"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="mb-4"
          />
          <QueryState loading={query.loading} error={query.error} />
          {query.data?.length === 0 && <EmptyState title={`No ${config.title.toLowerCase()}`} />}
          <ul className="divide-y">
            {query.data?.slice(0, 20).map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"
              >
                <div>
                  <p>{row.name}</p>
                  {"email" in row && (
                    <p className="mt-1 text-xs text-muted-foreground">{row.email}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => {
                      setEditing(row);
                      setVersion((v) => v + 1);
                      key.current = crypto.randomUUID();
                      setError("");
                    }}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${row.name}`}
                    onClick={() => {
                      setDeleting(row);
                      key.current = crypto.randomUUID();
                      setError("");
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3 text-xs">
            <Button
              variant="outline"
              disabled={page === 1 || query.loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={query.loading || !query.data || query.data.length <= 20}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </section>
        <form
          key={version}
          className="soft-panel space-y-5 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            const values = new FormData(e.currentTarget);
            const body = {
              name: String(values.get("name")),
              ...(path === "/suppliers" ? { email: String(values.get("email")) } : {}),
            };
            try {
              if (editing)
                await request(config.itemEndpoint, "patch", {
                  id: editing.id,
                  key: key.current,
                  body,
                });
              else await request(config.endpoint, "post", { key: key.current, body });
              reset();
              await refreshAfterWrite();
              toast.success("Record saved");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <PanelTitle>{editing ? "Edit record" : "Add record"}</PanelTitle>
          <label className="block text-xs">
            Name
            <Input
              name="name"
              className="mt-2"
              required
              maxLength={120}
              defaultValue={editing?.name}
            />
          </label>
          {path === "/suppliers" && (
            <label className="block text-xs">
              Email
              <Input name="email" type="email" className="mt-2" defaultValue={editing?.email} />
            </label>
          )}
          {error && !deleting && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button disabled={busy}>
              <Plus size={15} />
              Save
            </Button>
            {editing && (
              <Button type="button" variant="outline" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </div>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}</DialogTitle>
            <DialogDescription>
              Only records with no associated products or history can be deleted. Existing
              references are kept.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleting || busy) return;
                setBusy(true);
                setError("");
                try {
                  await request(config.itemEndpoint, "delete", {
                    id: deleting.id,
                    key: key.current,
                  });
                  setDeleting(null);
                  reset();
                  setPage(1);
                  await refreshAfterWrite();
                  toast.success("Record deleted");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete record
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function UnitsView() {
  const { units } = useInventory();
  const [editing, setEditing] = useState<Schemas["Unit"] | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  return (
    <>
      <PageHeading
        title="Units of measure"
        description="Default and configurable units for this organization."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 rounded-xl border p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  {["Unit", "Symbol", "Decimals", "Status", ""].map((label, i) => (
                    <th className="pb-4 font-normal" key={i}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.code} className="border-b">
                    <td className="py-4">
                      <p>{u.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{u.code}</p>
                    </td>
                    <td>{u.symbol}</td>
                    <td>{u.decimals}</td>
                    <td className="text-xs text-muted-foreground">
                      {u.active ? "Active" : "Inactive"}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${u.name}`}
                        onClick={() => {
                          setEditing(u);
                          setFormVersion((v) => v + 1);
                          setError("");
                          key.current = crypto.randomUUID();
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <form
          key={formVersion}
          className="soft-panel space-y-5 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const code = String(f.get("code"));
              if (!editing && units.some((u) => u.code === code))
                throw new Error("That code already exists. Use Edit to modify the unit.");
              await request("/v1/units", "post", {
                key: key.current,
                body: {
                  code,
                  name: String(f.get("name")),
                  symbol: String(f.get("symbol")),
                  decimals: Number(f.get("decimals")),
                  active: f.get("active") === "on",
                },
              });
              await refreshAfterWrite();
              setEditing(null);
              setFormVersion((v) => v + 1);
              key.current = crypto.randomUUID();
              toast.success("Unit saved");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <PanelTitle>{editing ? "Edit unit" : "Create unit"}</PanelTitle>
          <label className="block text-xs">
            Code
            <Input
              name="code"
              className="mt-2"
              pattern="[a-z][a-z0-9_]{0,23}"
              placeholder="roll"
              required
              readOnly={!!editing}
              defaultValue={editing?.code}
            />
          </label>
          <label className="block text-xs">
            Name
            <Input
              name="name"
              className="mt-2"
              placeholder="Roll"
              required
              maxLength={80}
              defaultValue={editing?.name}
            />
          </label>
          <label className="block text-xs">
            Symbol
            <Input
              name="symbol"
              className="mt-2"
              placeholder="roll"
              required
              maxLength={16}
              defaultValue={editing?.symbol}
            />
          </label>
          <label className="block text-xs">
            Allowed decimals
            <select
              name="decimals"
              aria-label="Allowed decimals"
              className="mt-2 h-10 w-full rounded border bg-background px-3"
              defaultValue={editing?.decimals || 0}
              disabled={!!editing}
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {editing && <input type="hidden" name="decimals" value={editing.decimals} />}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input name="active" type="checkbox" defaultChecked={editing?.active ?? true} />
            Available for new products
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Deactivating prevents new assignments. Existing products and history are kept. Precision
            cannot be changed after the unit is created.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button disabled={busy}>Save unit</Button>
            {editing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setFormVersion((v) => v + 1);
                  setError("");
                  key.current = crypto.randomUUID();
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
