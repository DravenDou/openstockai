import { notFound } from "next/navigation";
import { OpenStockApp } from "@/shell/openstock-app";
import { isAppRoute } from "@/shell/routes";

export default async function Page({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  // The proxy answers unknown paths with a real 404 before streaming starts;
  // this is the fallback for anything that reaches the page.
  if (!isAppRoute(`/${path.join("/")}`)) notFound();
  return <OpenStockApp />;
}
