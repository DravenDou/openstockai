"use client";

import { authClient } from "@/shared/auth/client";
import { clearInventory, useInventory } from "@/shared/state/store";
import { cn } from "@/shared/lib/utils";
import {
  AudioLines,
  Activity,
  Bot,
  Boxes,
  FolderTree,
  History,
  LogOut,
  Menu,
  Ruler,
  Receipt,
  ShieldCheck,
  Settings,
  Store,
  TriangleAlert,
  Truck,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../shared/ui/dialog";

const links = [
  { href: "/", label: "Assistant", icon: Bot, group: "Workspace" },
  { href: "/inventory", label: "Inventory", icon: Boxes, group: "Operations" },
  { href: "/movements", label: "Movements", icon: History },
  { href: "/purchases", label: "Purchases", icon: Receipt },
  { href: "/restock", label: "Restock", icon: TriangleAlert },
  { href: "/categories", label: "Categories", icon: FolderTree, group: "Catalogs" },
  { href: "/units", label: "Units of measure", icon: Ruler },
  { href: "/warehouses", label: "Warehouses", icon: Warehouse },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/audit", label: "Audit log", icon: ShieldCheck, group: "Administration" },
  { href: "/agent-runs", label: "Agent runs", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="space-y-1 px-3 py-5">
      {links.map(({ href, label, icon: Icon, group }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <div key={href}>
            {group && (
              <p className="px-3 pt-5 pb-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                {group}
              </p>
            )}
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-muted",
                active ? "bg-secondary font-medium text-[#9b3c00]" : "text-muted-foreground",
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link
      href="/"
      aria-label="OpenStock AI, go to assistant"
      className="flex items-center gap-2.5 px-6 py-6"
    >
      <AudioLines size={26} className="text-primary" />
      <span className="text-xl font-bold tracking-tight">OpenStock AI</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { identity, settings } = useInventory();
  const pathname = usePathname();
  const title =
    [...links].reverse().find((link) => link.href !== "/" && pathname.startsWith(link.href))
      ?.label || "Assistant";
  return (
    <div className="min-h-svh bg-background">
      <a
        href="#content"
        className="sr-only rounded bg-background p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <aside
        aria-label="Sidebar"
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-[#fcfcfc] lg:flex"
      >
        <Brand />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Navigation />
        </div>
        <div className="border-t p-5">
          <p className="truncate text-sm font-medium">{identity?.name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{identity?.email}</p>
          <Button
            variant="ghost"
            className="mt-3 w-full justify-start px-0 text-xs text-muted-foreground"
            onClick={async () => {
              await authClient.signOut();
              clearInventory();
            }}
          >
            <LogOut size={15} />
            Sign out
          </Button>
        </div>
      </aside>
      <div className="min-w-0 lg:pl-64">
        <header className="flex h-18 items-center justify-between gap-3 border-b px-5 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open sidebar menu"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </Button>
            <span className="truncate text-sm text-muted-foreground">{title}</span>
          </div>
          <span className="flex max-w-[220px] items-center gap-2 text-xs text-muted-foreground">
            <Store size={15} />
            <span className="truncate">{settings.store}</span>
          </span>
        </header>
        {children}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fixed inset-y-0 left-0 top-0 h-svh max-h-svh w-[min(300px,88vw)] translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none p-0 sm:max-w-[300px]">
          <DialogHeader className="sr-only">
            <DialogTitle>Sidebar menu</DialogTitle>
            <DialogDescription>Browse OpenStock AI features.</DialogDescription>
          </DialogHeader>
          <Brand />
          <Navigation onNavigate={() => setOpen(false)} />
          <Button
            variant="ghost"
            className="mx-6 mb-6 justify-start"
            onClick={async () => {
              await authClient.signOut();
              clearInventory();
              setOpen(false);
            }}
          >
            <LogOut size={16} />
            Sign out
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
