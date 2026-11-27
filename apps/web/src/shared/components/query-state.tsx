import { Loader2 } from "lucide-react";
export function QueryState({ loading, error }: { loading: boolean; error: string }) {
  if (error)
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
      >
        {error}
      </p>
    );
  if (loading)
    return (
      <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        Loading…
      </p>
    );
  return null;
}
