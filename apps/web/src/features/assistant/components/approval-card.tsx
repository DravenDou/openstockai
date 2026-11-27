"use client";
import { useEffect, useRef, useState } from "react";
import { ShieldAlert, ShieldQuestion } from "lucide-react";
import type { ConversationInput } from "eve/react";
import { request } from "@openstockai/api-client/client";
import { euro } from "@/shared/state/inventory";
import { useInventory } from "@/shared/state/store";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { summarizeApproval, type RefKind } from "../lib/approval-summary";

type InputRequest = ConversationInput;
const resolved = new Map<string, string>();

// Names come from the store when loaded, otherwise from a single read per ID.
async function lookupName(kind: RefKind, id: string) {
  if (kind === "product") return (await request("/v1/products/{id}", "get", { id })).name;
  if (kind === "category") return (await request("/v1/categories/{id}", "get", { id })).name;
  if (kind === "warehouse") return (await request("/v1/warehouses/{id}", "get", { id })).name;
  return (await request("/v1/suppliers/{id}", "get", { id })).name;
}

function useNames(refs: { kind: RefKind; id: string }[]) {
  const store = useInventory();
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const wanted = JSON.stringify(refs);
  const known = (kind: RefKind, id: string) =>
    (kind === "product"
      ? store.products.find((row) => row.id === id)?.name
      : kind === "category"
        ? store.categories.find((row) => row.id === id)?.name
        : kind === "warehouse"
          ? store.warehouses.find((row) => row.id === id)?.name
          : undefined) ??
    fetched[`${kind}:${id}`] ??
    resolved.get(`${kind}:${id}`);
  const missing = JSON.stringify(
    (JSON.parse(wanted) as { kind: RefKind; id: string }[]).filter(
      ({ kind, id }) => !known(kind, id),
    ),
  );
  useEffect(() => {
    let cancelled = false;
    for (const { kind, id } of JSON.parse(missing) as { kind: RefKind; id: string }[])
      lookupName(kind, id)
        .then((value) => {
          resolved.set(`${kind}:${id}`, value);
          if (!cancelled) setFetched((current) => ({ ...current, [`${kind}:${id}`]: value }));
        })
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [missing]);
  return (kind: RefKind, id: string) => known(kind, id) ?? "Loading…";
}

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
  const action = input.request.action;
  const summary = summarizeApproval(
    action.toolName,
    action.input && typeof action.input === "object"
      ? (action.input as Record<string, unknown>)
      : undefined,
  );
  const refs = [
    ...summary.rows.flatMap((row) => (row.ref ? [{ kind: row.ref, id: row.value }] : [])),
    ...(summary.items ?? []).map((item) => ({ kind: "product" as const, id: item.product })),
  ];
  const name = useNames(refs);
  const Icon = summary.destructive ? ShieldAlert : ShieldQuestion;
  return (
    <section
      aria-label={summary.title}
      className={cn(
        "space-y-4 rounded-lg border p-5",
        summary.destructive ? "border-destructive/50 bg-destructive/5" : "bg-secondary",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon
          size={18}
          className={summary.destructive ? "text-destructive" : undefined}
          aria-hidden
        />
        <h3 className="text-sm font-semibold">{summary.title}</h3>
        {summary.destructive && <Badge variant="destructive">Destructive</Badge>}
      </div>
      <p className="text-sm">{input.request.prompt}</p>
      {summary.rows.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[max-content_1fr]">
          {summary.rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words font-medium">
                {row.ref ? name(row.ref, row.value) : row.money ? euro(row.value) : row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!!summary.items?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Purchase lines</caption>
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Product</th>
                <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                <th className="py-1.5 pl-3 text-right font-medium">Unit cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {summary.items.map((item, index) => (
                <tr key={`${item.product}-${index}`}>
                  <td className="py-1.5 pr-3">{name("product", item.product)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">{euro(item.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.total && (
            <p className="mt-2 text-right text-xs">
              Total <span className="font-semibold tabular-nums">{euro(summary.total)}</span>
            </p>
          )}
        </div>
      )}
      {summary.note && <p className="text-xs text-muted-foreground">{summary.note}</p>}
      <div className="flex flex-wrap gap-2">
        {input.request.options?.map((option) => {
          const approve = option.id === "approve";
          return (
            <Button
              key={option.id}
              variant={approve ? (summary.destructive ? "destructive" : "default") : "outline"}
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
              {approve ? summary.confirm : option.id === "cancel" ? "Reject" : option.label}
            </Button>
          );
        })}
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
