// Single source of truth for the client-rendered app routes. Used by the proxy
// (to answer unknown paths with a real 404 before the response streams) and by the
// catch-all page.
const sections = [
  "assistant",
  "inventory",
  "movements",
  "purchases",
  "audit",
  "categories",
  "units",
  "warehouses",
  "suppliers",
  "restock",
  "settings",
  "agent-runs",
  "consent",
];
const withDetail = ["inventory", "purchases"];

export function isAppRoute(pathname: string): boolean {
  const path = pathname.split("/").filter(Boolean);
  if (path.length === 0) return true;
  if (!sections.includes(path[0]) || path.length > 2) return false;
  return path.length === 1 || withDetail.includes(path[0]);
}
