"use client";
import { AudioLines, Loader2, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { APIError, request } from "@openstockai/api-client/client";
import type { ApprovalLoad } from "@/shared/approvals/load";
import { useInventory } from "@/shared/state/store";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  actionState,
  describeOperation,
  detailItems,
  detailRows,
  riskReason,
  stateText,
  type RefKind,
} from "../lib/operation";

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-6 py-12">
      <div className="flex items-center gap-2">
        <AudioLines className="text-primary" />
        <span className="text-3xl font-bold">OpenStock AI</span>
      </div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
const unavailable: Record<string, string> = {
  not_found: "This approval request does not exist, or it belongs to another account.",
  unavailable: "The request could not be loaded. Check that the API is running and reload.",
  unauthenticated: "Sign in to review this request.",
};
// Owner decision for an action an MCP client registered. Loading changes nothing; only the
// explicit Approve or Reject click sends a POST through the app's origin-checked proxy.
export function ApprovalView({ load }: { load: ApprovalLoad }) {
  const router = useRouter();
  const store = useInventory();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const [decided, setDecided] = useState<boolean | null>(null);
  const refreshed = useRef(false);
  // The server rendered before sign-in finished; this view only mounts once a session exists.
  const needsSession = !load.ok && load.reason === "unauthenticated";
  useEffect(() => {
    if (needsSession && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [needsSession, router]);
  if (!load.ok)
    return (
      <Frame title="This request cannot be shown">
        <p role="alert" className="text-sm text-muted-foreground">
          {unavailable[load.reason]}
        </p>
        <Button variant="outline" onClick={() => router.push("/")}>
          Back to OpenStock AI
        </Button>
      </Frame>
    );
  const { action, client, targetName } = load;
  const info = describeOperation(action.operation);
  const state = actionState(action);
  const pending = state === "pending" && decided === null;
  const reason = riskReason(action.operation, action.toolInput, action.ownerApprovalRequired);
  const name = (kind: RefKind, id: string) =>
    (kind === "product"
      ? store.products.find((row) => row.id === id)?.name
      : kind === "warehouse"
        ? store.warehouses.find((row) => row.id === id)?.name
        : kind === "category"
          ? store.categories.find((row) => row.id === id)?.name
          : undefined) ?? id;
  const rows = [
    ...(info.target
      ? [
          targetName
            ? { label: "Target", value: targetName }
            : { label: "Target", value: info.target.id, ref: info.target.kind },
        ]
      : []),
    ...detailRows(action.toolInput),
  ];
  const items = detailItems(action.toolInput);
  const decide = async (approved: boolean) => {
    setBusy(approved ? "approve" : "reject");
    setError("");
    try {
      await request("/v1/agent-actions/{id}/approval", "post", {
        id: action.id,
        body: { approved },
      });
      setDecided(approved);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof APIError && e.status === 404
          ? "This request is no longer available."
          : (e as Error).message,
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Frame title="Approve a change">
      <section className="space-y-2 text-sm" aria-label="Requested by">
        <p>
          <strong className="font-semibold">MCP client: {client?.name ?? "unnamed"}</strong>{" "}
          <span className="text-muted-foreground">(unverified name)</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Application ID: {client?.host ?? client?.clientId ?? "unknown"}
        </p>
      </section>
      <section className="space-y-3 rounded-lg border p-4 text-sm" aria-label="Change">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">{info.title}</h2>
          {info.destructive && <Badge variant="destructive">Destructive</Badge>}
        </div>
        {rows.length > 0 && (
          <dl className="space-y-1.5 text-xs">
            {rows.map((row) => (
              <div className="flex justify-between gap-4" key={`${row.label}:${row.value}`}>
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="break-all text-right">
                  {row.ref ? name(row.ref, row.value) : row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {items.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {items.map((item, index) => (
              <li key={index}>
                {name("product", item.product)} x {item.quantity}
              </li>
            ))}
          </ul>
        )}
      </section>
      {reason && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          {reason}
        </p>
      )}
      <p className="text-sm" role="status">
        <span className="text-muted-foreground">Status: </span>
        {decided === true
          ? stateText.approved
          : decided === false
            ? stateText.rejected
            : stateText[state]}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {pending ? (
        <div className="flex gap-3">
          <Button className="flex-1" disabled={busy !== null} onClick={() => void decide(true)}>
            {busy === "approve" && <Loader2 className="animate-spin" size={16} />}
            Approve
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void decide(false)}
          >
            {busy === "reject" && <Loader2 className="animate-spin" size={16} />}
            Reject
          </Button>
        </div>
      ) : (
        <p className="text-sm">You can return to your MCP client and continue.</p>
      )}
    </Frame>
  );
}
