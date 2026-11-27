"use client";
import { useEffect, useState } from "react";
import { request } from "@openstockai/api-client/client";
import type { paths } from "@openstockai/api-client/generated";
import { useInventory } from "../state/store";

type GetResult<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: { content: { "application/json": infer R } } } };
}
  ? R
  : never;

// Each view owns a bounded query. A completed mutation invalidates active queries.
export function useAPI<P extends keyof paths>(
  path: P & (paths[P] extends { get: object } ? P : never),
  query: Record<string, string | number> = {},
  id?: string,
  enabled = true,
  refreshKey = 0,
) {
  const { revision } = useInventory();
  const key = JSON.stringify([path, query, id, revision, refreshKey]);
  const [state, setState] = useState<{
    key: string;
    data: GetResult<P> | null;
    error: string;
    loading: boolean;
  }>({ key: "", data: null, error: "", loading: true });
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const [target, params, resourceId] = JSON.parse(key) as [
      P,
      Record<string, string | number>,
      string?,
    ];
    void request(target, "get" as "get" & keyof paths[P], {
      query: params,
      id: resourceId,
      signal: abort.signal,
    })
      .then((data) => {
        if (!abort.signal.aborted)
          setState({ key, data: data as GetResult<P>, error: "", loading: false });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setState({ key, data: null, error: (error as Error).message, loading: false });
      });
    return () => abort.abort();
  }, [key, enabled]);
  return state.key === key && enabled ? state : { data: null, error: "", loading: enabled };
}
