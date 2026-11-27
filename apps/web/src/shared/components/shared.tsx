"use client";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { status, type Product } from "@/shared/state/inventory";
import { useInventory } from "@/shared/state/store";
import { cn } from "@/shared/lib/utils";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Headphones,
  Keyboard,
  Monitor,
  Mouse,
  Package,
  Plus,
  Router,
  Search,
  Sparkles,
  Usb,
  Webcam,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

const productIcons: Record<string, LucideIcon> = {
  keyboard: Keyboard,
  mouse: Mouse,
  monitor: Monitor,
  usb: Usb,
  headphones: Headphones,
  cable: Cable,
  webcam: Webcam,
  drive: HardDrive,
  router: Router,
  package: Package,
};
export function ProductIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = productIcons[icon] || Package;
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon size={18} strokeWidth={1.5} />
    </span>
  );
}
export function IconButton({
  label,
  children,
  onClick,
  className,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={onClick}
          className={cn("size-8 text-muted-foreground", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
      <div>
        <h1 className="text-[30px] leading-tight font-semibold tracking-[-.027em]">{title}</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  );
}
export function ActionLink({
  href,
  children,
  variant = "outline",
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "outline" | "default" | "ghost";
  className?: string;
}) {
  return (
    <Button
      asChild
      variant={variant}
      className={cn("h-10 rounded-lg text-xs font-medium shadow-none", className)}
    >
      <Link href={href}>{children}</Link>
    </Button>
  );
}
export function BackLink({
  href = "/inventory",
  label = "Back to inventory",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <ActionLink href={href}>
      <ArrowLeft size={14} />
      {label}
    </ActionLink>
  );
}
export function ExportButton({
  onClick,
  label = "Export",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button variant="outline" className="h-10 rounded-lg text-xs shadow-none" onClick={onClick}>
      <ArrowDownToLine size={15} />
      {label}
    </Button>
  );
}
export function Metrics({
  items,
}: {
  items: { label: string; value: string | number; detail?: string }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-5 border-b pt-2 pb-6 sm:grid-cols-3 sm:gap-[50px]">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <strong className="tabular text-[28px] leading-tight font-semibold tracking-[-.03em]">
              {item.value}
            </strong>
            {item.detail && (
              <span className="text-[11px] text-muted-foreground">{item.detail}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function AiShortcut({
  children,
  label = "Open chat",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-[10px] bg-secondary p-4 sm:flex-row sm:items-center sm:px-[18px]">
      <div className="flex items-center gap-3 text-[13px] text-[#8c430d]">
        <Sparkles size={19} className="shrink-0 text-primary" />
        <span>{children}</span>
      </div>
      <ActionLink href="/" className="h-9 w-fit bg-white">
        <ArrowUpRight size={14} />
        {label}
      </ActionLink>
    </div>
  );
}
export function StatusLabel({ product }: { product: Product }) {
  const label = status(product);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs",
        label === "In stock"
          ? "text-[#436e52]"
          : label === "Low stock"
            ? "text-[#b34b08]"
            : "text-muted-foreground",
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {label}
    </span>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-[236px]">
      <Search
        size={15}
        className="pointer-events-none absolute top-3 left-3 text-muted-foreground"
      />
      <Input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-lg bg-[#f7f7f7] pl-9 text-xs shadow-none"
      />
    </div>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className={cn("h-10! w-full rounded-lg text-[13px] shadow-none", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Pagination({
  page,
  total,
  count,
  onChange,
  noun = "products",
  pageSize = 6,
}: {
  page: number;
  total: number;
  count: number;
  onChange: (page: number) => void;
  noun?: string;
  pageSize?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 pt-4 text-[11px] text-muted-foreground">
      <p>
        {count} of {total} {noun}
      </p>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={page <= 1}
          aria-label="Previous page"
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={13} />
        </Button>
        <span>Page {page}</span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={page >= pages}
          aria-label="Next page"
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={13} />
        </Button>
      </div>
    </div>
  );
}
export function EmptyState({
  title = "No results",
  description = "Try another term or change the filters.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center text-center">
      <Search size={25} className="mb-4 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-2 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
export function PageFooter() {
  const { settings } = useInventory();
  return (
    <footer className="mt-auto flex flex-wrap justify-between gap-2 pt-12 pb-5 text-[11px] text-muted-foreground">
      <span>Inventory · {settings.store}</span>
      <span className="flex items-center gap-1.5">
        <Check size={12} /> Saved to your organization
      </span>
    </footer>
  );
}
export function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold tracking-[-.015em]">{children}</h2>;
}
export { Plus };
