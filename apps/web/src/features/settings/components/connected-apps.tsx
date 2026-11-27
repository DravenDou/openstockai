"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { describeScope } from "@/shared/oauth/consent";
import { Button } from "@/shared/ui/button";
import { PanelTitle } from "../../../shared/components/shared";

const listSchema = z.object({
  items: z.array(
    z.object({
      clientId: z.string(),
      name: z.string().nullable(),
      host: z.string().nullable(),
      scopes: z.array(z.string()),
      grantedAt: z.string(),
    }),
  ),
});
type Apps = z.infer<typeof listSchema>["items"];

// Applications (MCP clients) the owner has allowed. Revoking removes the consent and the
// client's tokens, so its next call is refused.
export function ConnectedApps() {
  const [apps, setApps] = useState<Apps | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/connected-apps", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load connected applications.");
        setApps(listSchema.parse(await response.json()).items);
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError((e as Error).message);
      });
    return () => abort.abort();
  }, [reload]);
  const revoke = async (clientId: string) => {
    setBusy(clientId);
    try {
      const response = await fetch("/api/connected-apps", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!response.ok) throw new Error("Could not revoke access. Try again.");
      toast.success("Access revoked");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="max-w-2xl space-y-6 rounded-xl border p-6">
      <PanelTitle>Connected apps</PanelTitle>
      <p className="text-xs text-muted-foreground">
        Applications you allowed to use your inventory through MCP. Names are chosen by the
        applications themselves and are not verified.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {apps?.length === 0 && <p className="text-sm text-muted-foreground">No connected apps.</p>}
      <ul className="divide-y">
        {apps?.map((app) => (
          <li key={app.clientId} className="flex items-start justify-between gap-4 py-4">
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-medium">
                {app.name ?? "Unnamed application"}{" "}
                <span className="text-xs font-normal text-muted-foreground">(unverified name)</span>
              </p>
              <p className="break-all text-xs text-muted-foreground">
                Application ID: {app.host ?? app.clientId}
              </p>
              <ul className="list-disc pl-5 text-xs">
                {app.scopes.map((scope) => (
                  <li key={scope}>{describeScope(scope)}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Allowed on {new Date(app.grantedAt).toLocaleDateString("en-US")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy === app.clientId}
              onClick={() => {
                if (window.confirm(`Revoke access for ${app.name ?? "this application"}?`))
                  void revoke(app.clientId);
              }}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
