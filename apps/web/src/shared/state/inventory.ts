export type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  cost: number;
  minimum: number;
  location: string;
  notes: string;
  icon: string;
  categoryId?: string;
  warehouseId?: string;
  costPrice?: string;
  salePrice?: string;
  barcode?: string;
  unitCode?: string;
  unitSymbol?: string;
  unitName?: string;
  unitDecimals?: number;
};
export type Movement = {
  id: string;
  productId: string;
  name: string;
  kind: "Stock in" | "Sale" | "Adjustment";
  quantity: number;
  actor: string;
  date: string;
  timestamp: number;
  source?: string;
  warehouseId?: string;
  unitSymbol?: string;
};
export type Settings = {
  store: string;
  email: string;
  currency: "USD" | "EUR" | "GBP" | "BOB";
  timezone: string;
  automatic: boolean;
  lowStock: boolean;
  voice: boolean;
};
export type InventoryState = {
  products: Product[];
  movements: Movement[];
  purchaseApplied: boolean;
  settings: Settings;
};
export function dayKey(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join("-");
}
export function movementInPeriod(
  movement: Movement,
  period: string,
  timezone: string,
  now = Date.now(),
) {
  if (period === "All movements") return true;
  const today = dayKey(now, timezone);
  const date = dayKey(movement.timestamp, timezone);
  if (period === "Today") return date === today;
  const days = (Date.parse(today) - Date.parse(date)) / 86400000;
  return days >= 0 && days < 7;
}
export function movementDate(movement: Movement, timezone: string, now = Date.now()) {
  const today = dayKey(now, timezone);
  const date = dayKey(movement.timestamp, timezone);
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  const label =
    date === today
      ? "Today"
      : date === yesterday
        ? "Yesterday"
        : new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            day: "numeric",
            month: "short",
          }).format(movement.timestamp);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(movement.timestamp);
  return `${label} · ${time}`;
}
export const initialState: InventoryState = {
  products: [],
  movements: [],
  purchaseApplied: false,
  settings: {
    store: "",
    email: "",
    currency: "USD",
    timezone: "UTC",
    automatic: false,
    lowStock: true,
    voice: false,
  },
};
let displayCurrency: Settings["currency"] = "USD";
export function setCurrency(value: Settings["currency"]) {
  displayCurrency = value;
}
function cents(value: string | number) {
  const text = typeof value === "number" ? value.toFixed(2) : value;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return BigInt(0);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
function decimalCents(value: bigint) {
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
}
export const euro = (value: string | number, decimals = true) => {
  const amount = cents(value),
    whole = decimals ? amount / BigInt(100) : (amount + BigInt(50)) / BigInt(100);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: displayCurrency,
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  })
    .formatToParts(whole)
    .map((part) =>
      part.type === "fraction" ? (amount % BigInt(100)).toString().padStart(2, "0") : part.value,
    )
    .join("");
};
export function stockCost(quantity: string, cost: string) {
  if (!/^\d+(\.\d{1,3})?$/.test(quantity)) return "0.00";
  const [whole, decimals = ""] = quantity.split(".");
  const thousandths = BigInt(whole) * BigInt(1000) + BigInt(decimals.padEnd(3, "0"));
  return decimalCents((thousandths * cents(cost) + BigInt(500)) / BigInt(1000));
}
export const status = (p: Product) =>
  p.stock === 0 ? "Out of stock" : p.stock <= p.minimum ? "Low stock" : "In stock";
export function exportCsv(filename: string, rows: (string | number)[][]) {
  const content =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            const text = typeof v === "string" && /^[=+@\t\r-]/.test(v) ? "'" + v : String(v);
            return `"${text.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function movementTypeLabel(type: string) {
  const labels: Record<string, string> = {
    initial: "Initial stock",
    purchase: "Purchase",
    sale: "Sale",
    adjustment_in: "Adjustment in",
    adjustment_out: "Adjustment out",
    transfer_in: "Transfer received",
    transfer_out: "Transfer sent",
    return_in: "Customer return",
    return_out: "Supplier return",
  };
  return labels[type] || type;
}
