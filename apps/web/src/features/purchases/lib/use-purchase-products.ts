"use client";
import { useEffect, useState } from "react";
import { APIError, request, type Schemas } from "@openstockai/api-client/client";
import { useInventory } from "../../../shared/state/store";

export function usePurchaseProducts(skus: string[]): {
  products: Record<string, Schemas["Product"] | null>;
  error: string;
  loading: boolean;
} {
  const { revision } = useInventory();
  const key = JSON.stringify([Array.from(new Set(skus.filter(Boolean))).sort(), revision]);
  const [state, setState] = useState<{
    key: string;
    products: Record<string, Schemas["Product"] | null>;
    error: string;
  }>({ key: "", products: {}, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    const [codes] = JSON.parse(key) as [string[]];
    void Promise.all(
      codes.map(async (sku) => {
        try {
          return [
            sku,
            await request("/v1/products/by-sku", "get", {
              query: { sku },
              signal: controller.signal,
            }),
          ] as const;
        } catch (error) {
          if (error instanceof APIError && error.status === 404) return [sku, null] as const;
          throw error;
        }
      }),
    )
      .then((rows) => {
        if (!controller.signal.aborted)
          setState({ key, products: Object.fromEntries(rows), error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key, products: {}, error: (error as Error).message });
      });
    return () => controller.abort();
  }, [key]);
  return state.key === key
    ? { ...state, loading: false }
    : { products: {}, error: "", loading: true };
}
