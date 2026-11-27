import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ConsentView } from "@/features/consent/views/consent";
import { loadConsentRequest } from "@/server/oauth-consent";
import { OpenStockApp } from "@/shell/openstock-app";
import { isAppRoute } from "@/shell/routes";

type Props = {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function Page({ params, searchParams }: Props) {
  const { path } = await params;
  // The proxy answers unknown paths with a real 404 before streaming starts;
  // this is the fallback for anything that reaches the page.
  if (!isAppRoute(`/${path.join("/")}`)) notFound();
  // OAuth consent is server-verified (signed query) and rendered outside the workspace shell.
  if (path[0] === "consent")
    return <ConsentView load={await loadConsentRequest(await searchParams, await headers())} />;
  return <OpenStockApp />;
}
