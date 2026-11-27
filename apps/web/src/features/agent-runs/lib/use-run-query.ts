"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

export function useRunQuery<T>(
  query: Record<string, string | number>,
  schema: z.ZodType<T>,
  refresh: number,
  enabled = true,
) {
  const key = JSON.stringify([query, refresh]);
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({
    key: "",
    data: null,
    error: "",
  });
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const [params] = JSON.parse(key) as [Record<string, string | number>];
    const search = new URLSearchParams(
      Object.entries(params).map(([name, value]) => [name, String(value)]),
    );
    void fetch(`/api/agent-runs?${search}`, {
      cache: "no-store",
      signal: abort.signal,
      redirect: "error",
    })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (!response.ok) {
          const error = errorSchema.safeParse(value);
          if (!abort.signal.aborted)
            setState({
              key,
              data: null,
              error: error.success
                ? error.data.error.message
                : "Could not load agent runs. Press Refresh to retry.",
            });
          return;
        }
        const data = schema.safeParse(value);
        if (!abort.signal.aborted)
          setState({
            key,
            data: data.success ? data.data : null,
            error: data.success
              ? ""
              : "The runs have an incompatible format. Press Refresh to retry.",
          });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setState({
            key,
            data: null,
            error: "Could not load agent runs. Press Refresh to retry.",
          });
      });
    return () => abort.abort();
  }, [key, schema, enabled]);
  return enabled && state.key === key
    ? { ...state, loading: false }
    : { data: null, error: "", loading: enabled };
}
