"use client";
import { AudioLines, Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/shared/auth/client";
import { describeScope, type ConsentLoad } from "@/shared/oauth/consent";
import { Button } from "@/shared/ui/button";

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex items-center gap-2">
        <AudioLines className="text-primary" />
        <span className="text-3xl font-bold">OpenStock AI</span>
      </div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
// Asks the signed-in owner to approve an application that wants to connect (MCP client).
// The name and links come from the application itself and are shown as unverified claims.
export function ConsentView({ load }: { load: ConsentLoad }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState("");
  if (!load.ok)
    return (
      <Frame title="This request cannot be shown">
        <p role="alert" className="text-sm text-muted-foreground">
          {load.reason === "expired"
            ? "The authorization request is invalid or has expired. Start the connection again from the application."
            : "The authorization request could not be loaded. Start the connection again from the application."}
        </p>
        <Button variant="outline" onClick={() => router.push("/")}>
          Back to OpenStock AI
        </Button>
      </Frame>
    );
  const { request } = load;
  const decide = async (accept: boolean) => {
    setBusy(accept ? "allow" : "deny");
    setError("");
    const result = await authClient.$fetch<{ url?: string }>("/oauth2/consent", {
      method: "POST",
      body: { accept },
    });
    if (result.error || !result.data?.url) {
      setBusy(null);
      setError(result.error?.message || "Could not record your choice. Try again.");
      return;
    }
    window.location.assign(result.data.url);
  };
  return (
    <Frame title="Connect an application">
      <section className="space-y-3 text-sm" aria-label="Application">
        <p>
          <strong className="font-semibold">{request.clientName ?? "An application"}</strong>{" "}
          <span className="text-muted-foreground">(unverified name)</span> wants to connect to your
          OpenStock AI account.
        </p>
        <dl className="space-y-1.5 rounded-lg border p-3 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Application ID</dt>
            <dd className="break-all text-right">{request.clientHost ?? request.clientId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Sends you back to</dt>
            <dd className="break-all text-right">{request.redirectTarget}</dd>
          </div>
          {request.clientUri && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Website it claims</dt>
              <dd className="break-all text-right">
                <a
                  href={request.clientUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {request.clientUri}
                </a>
              </dd>
            </div>
          )}
        </dl>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          The name is chosen by the application and anyone can copy it. Only continue if you started
          this connection and recognize the application ID.
        </p>
      </section>
      <section className="space-y-2 text-sm" aria-label="Requested access">
        <h2 className="font-medium">It will be able to</h2>
        <ul className="list-disc space-y-1 pl-5">
          {request.scopes.map((scope) => (
            <li key={scope}>{describeScope(scope)}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">You can revoke this access at any time.</p>
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button className="flex-1" disabled={busy !== null} onClick={() => void decide(true)}>
          {busy === "allow" && <Loader2 className="animate-spin" size={16} />}
          Allow
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void decide(false)}
        >
          {busy === "deny" && <Loader2 className="animate-spin" size={16} />}
          Deny
        </Button>
      </div>
    </Frame>
  );
}
