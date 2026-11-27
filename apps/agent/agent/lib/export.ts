// Relative link served by the authenticated Next app; the browser session authorizes it.
export function exportLink(filters: Record<string, string>) {
  const params = new URLSearchParams();
  for (const key of ["query", "category", "warehouse", "stock", "status"])
    if (filters[key]) params.set(key, filters[key]);
  const search = params.toString();
  return `/api/exports/products${search ? `?${search}` : ""}`;
}
