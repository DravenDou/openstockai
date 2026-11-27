"use client";
import { z } from "zod";
import { authClient } from "@/shared/auth/client";
import { clearInventory, refreshInventory, useInventory } from "@/shared/state/store";
import { AudioLines, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";

const setupStatus = z.object({ needsOwner: z.boolean() });

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const { identity } = useInventory();
  const [error, setError] = useState("");
  useEffect(() => {
    clearInventory();
    if (!data?.user.id) return;
    let active = true;
    void refreshInventory()
      .then(() => {
        if (active) setError("");
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
      clearInventory();
    };
  }, [data?.user.id]);
  if (isPending) return <Loading />;
  if (!data) return <SignedOut />;
  if (error)
    return (
      <Frame title="Could not load your inventory">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button
          onClick={() =>
            void refreshInventory()
              .then(() => setError(""))
              .catch((e) => setError((e as Error).message))
          }
        >
          Retry
        </Button>
        <Button variant="outline" onClick={() => void authClient.signOut()}>
          Sign out
        </Button>
      </Frame>
    );
  if (!identity) return <Loading />;
  return <div key={data.user.id}>{children}</div>;
}
function Loading() {
  return (
    <div
      role="status"
      className="flex min-h-svh items-center justify-center gap-3 text-sm text-muted-foreground"
    >
      <Loader2 className="animate-spin" size={18} />
      Loading your workspace…
    </div>
  );
}
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
// The first visit creates the single owner account; afterwards only sign-in is offered.
function SignedOut() {
  const [needsOwner, setNeedsOwner] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/setup-status", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("setup status");
        setNeedsOwner(setupStatus.parse(await response.json()).needsOwner);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, []);
  if (failed)
    return (
      <Frame title="Could not reach the server">
        <p role="alert" className="text-sm text-destructive">
          Check that the web app, API and database are running, then reload.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </Frame>
    );
  if (needsOwner === null) return <Loading />;
  return <AuthForm mode={needsOwner ? "owner" : "login"} />;
}
function AuthForm({ mode }: { mode: "owner" | "login" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Frame title={mode === "owner" ? "Create owner account" : "Welcome to OpenStock AI"}>
      {mode === "owner" && (
        <p className="text-sm text-muted-foreground">
          This is the first run. The account you create here is the only one this installation will
          ever have.
        </p>
      )}
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(e.currentTarget);
          const email = String(form.get("email"));
          const password = String(form.get("password"));
          try {
            const result =
              mode === "owner"
                ? await authClient.signUp.email({ email, password, name: String(form.get("name")) })
                : await authClient.signIn.email({ email, password });
            if (result.error) throw new Error(result.error.message || "Could not sign in.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === "owner" && (
          <label className="block text-sm">
            Name
            <Input name="name" autoComplete="name" required maxLength={120} className="mt-2" />
          </label>
        )}
        <label className="block text-sm">
          Email
          <Input name="email" type="email" autoComplete="email" required className="mt-2" />
        </label>
        <label className="block text-sm">
          Password
          <Input
            aria-describedby={mode === "owner" ? "password-hint" : undefined}
            name="password"
            type="password"
            autoComplete={mode === "owner" ? "new-password" : "current-password"}
            required
            minLength={mode === "owner" ? 12 : undefined}
            maxLength={128}
            className="mt-2"
          />
        </label>
        {mode === "owner" && (
          <p id="password-hint" className="text-xs text-muted-foreground">
            Use at least 12 characters. If you forget it, reset it from the server with the owner
            password reset command.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" size={16} />}
          {mode === "owner" ? "Create owner account" : "Sign in"}
        </Button>
      </form>
    </Frame>
  );
}
