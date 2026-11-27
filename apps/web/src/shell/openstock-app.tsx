"use client";
import { usePathname } from "next/navigation";
import { AppShell } from "./app-shell";
import { PageFooter } from "../shared/components/shared";
import { AuditView } from "../features/inventory/views/audit";
import {
  PurchasesView,
  PurchaseDetailView,
  NewPurchaseView,
} from "../features/purchases/views/purchases";
import { CatalogView } from "../features/catalogs/views/catalogs";
import { DashboardView } from "../features/dashboard/views/dashboard";
import { ChatView } from "../features/assistant/views/chat";
import { InventoryView } from "../features/inventory/views/inventory";
import { PurchaseReviewView } from "../features/purchases/views/review";
import { MovementsView } from "../features/inventory/views/movements";
import { NewProductView } from "../features/inventory/views/new-product";
import { ProductDetailView } from "../features/inventory/views/product-detail";
import { RestockView } from "../features/inventory/views/restock";
import { AgentRunsView } from "../features/agent-runs/views/agent-runs";
import { SettingsView } from "../features/settings/views/settings";

export function OpenStockApp() {
  return <Workspace />;
}
function Workspace() {
  const path = usePathname();
  let view: React.ReactNode;
  if (path === "/") view = <DashboardView />;
  else if (path === "/assistant") view = <ChatView />;
  else if (path === "/inventory") view = <InventoryView />;
  else if (path === "/inventory/new") view = <NewProductView />;
  else if (path.startsWith("/inventory/"))
    view = <ProductDetailView id={decodeURIComponent(path.split("/")[2])} />;
  else if (path === "/movements") view = <MovementsView />;
  else if (path === "/purchases/new") view = <NewPurchaseView />;
  else if (path === "/purchases/review") view = <PurchaseReviewView />;
  else if (path === "/purchases") view = <PurchasesView />;
  else if (path.startsWith("/purchases/"))
    view = <PurchaseDetailView id={decodeURIComponent(path.split("/")[2])} />;
  else if (path === "/audit") view = <AuditView />;
  else if (path === "/restock") view = <RestockView />;
  else if (["/units", "/categories", "/warehouses", "/suppliers"].includes(path))
    view = <CatalogView key={path} path={path} />;
  else if (path === "/agent-runs") view = <AgentRunsView />;
  else if (path === "/settings") view = <SettingsView />;
  else view = <p>This page does not exist.</p>;
  return (
    <AppShell>
      <main
        id="content"
        className="page-enter mx-auto flex min-h-[calc(100svh-72px)] max-w-[1440px] min-w-0 flex-col px-5 pt-8 md:px-8 xl:px-10"
      >
        <div className="space-y-7" key={path}>
          {view}
        </div>
        <PageFooter />
      </main>
    </AppShell>
  );
}
