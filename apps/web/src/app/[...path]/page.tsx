import { notFound } from "next/navigation";
import { OpenStockApp } from "@/shell/openstock-app";

const sections = [
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
];
export default async function Page({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (
    !sections.includes(path[0]) ||
    path.length > 2 ||
    (path.length === 2 && !["inventory", "purchases"].includes(path[0]))
  )
    notFound();
  return <OpenStockApp />;
}
