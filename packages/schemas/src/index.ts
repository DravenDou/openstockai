import { z } from "zod";
export const query = z.object({ query: z.string().max(160).default("") }).strict();
export const page = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0),
  })
  .strict();
export const money = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Decimal amount with up to two decimals, for example 14.99");
// Cursor pagination used by history endpoints (purchases, audit log).
export const cursor = {
  beforeId: z.uuid().optional(),
  beforeDate: z.string().max(64).optional(),
};
export const amount = z.number().multipleOf(0.001).min(-1e9).max(1e9);
export const product = z
  .object({
    name: z.string().trim().min(1).max(160),
    sku: z.string().trim().min(1).max(80),
    categoryId: z.uuid().optional(),
    categoryName: z.string().max(120).optional(),
    unitCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,23}$/)
      .optional(),
    costPrice: money,
    salePrice: money,
    minimum: amount.nonnegative().default(0),
    description: z.string().max(4000).default(""),
    location: z.string().max(300).default(""),
    icon: z.string().max(30).default("package"),
    barcode: z.string().max(100).default(""),
    initialStock: amount.nonnegative().default(0),
    warehouseId: z.uuid().optional(),
  })
  .strict();
export const adjustment = z
  .object({
    productId: z.uuid(),
    warehouseId: z.uuid(),
    quantity: amount.refine((n) => n !== 0),
    type: z.enum([
      "initial",
      "purchase",
      "sale",
      "adjustment_in",
      "adjustment_out",
      "return_in",
      "return_out",
    ]),
    reference: z.string().max(200).default(""),
  })
  .strict();
// Catalog edit: every field optional and NO defaults, so an omitted field is never overwritten.
export const productPatch = z
  .object({
    id: z.uuid(),
    name: product.shape.name.optional(),
    categoryId: z.uuid().optional(),
    categoryName: z.string().max(120).optional(),
    unitCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,23}$/)
      .optional(),
    costPrice: money.optional(),
    salePrice: money.optional(),
    minimum: amount.nonnegative().optional(),
    description: z.string().max(4000).optional(),
    location: z.string().max(300).optional(),
    barcode: z.string().max(100).optional(),
  })
  .strict();
export const transfer = z
  .object({
    productId: z.uuid(),
    fromWarehouseId: z.uuid(),
    toWarehouseId: z.uuid(),
    quantity: amount.positive(),
  })
  .strict();
export const lookupName = z.string().trim().min(1).max(120);
export const supplier = z
  .object({ name: lookupName, email: z.union([z.literal(""), z.email().max(254)]).optional() })
  .strict();
export const purchaseItem = z
  .object({ productId: z.uuid(), quantity: amount.positive(), costPrice: money })
  .strict();
export const purchase = z
  .object({
    warehouseId: z.uuid(),
    supplierId: z.uuid().optional(),
    reference: z.string().trim().min(1).max(200),
    items: z.array(purchaseItem).min(1).max(100),
  })
  .strict();
export const stockCount = z
  .object({
    productId: z.uuid(),
    warehouseId: z.uuid(),
    counted: amount.nonnegative(),
    expected: amount.nonnegative(),
    reference: z.string().trim().min(1).max(200).default("Stock count"),
  })
  .strict();
export const unit = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/, "Lowercase letters, digits and underscores"),
    name: z.string().trim().min(1).max(60),
    symbol: z.string().trim().min(1).max(12),
    decimals: z.number().int().min(0).max(3),
    active: z.boolean().default(true),
  })
  .strict();
export const currencies = ["BOB", "EUR", "GBP", "USD"] as const;
export const settingsPatch = z
  .object({
    store: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    currency: z.enum(currencies),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe("IANA time zone, for example Europe/Madrid"),
    automatic: z
      .boolean()
      .describe(
        "Auto-approve low-risk writes. Deletes, archives and restores always need approval.",
      ),
    lowStock: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one setting to change");

// The target ID travels in the URL; Go registers and hashes only the remaining body.
export function withoutId<T extends Record<string, unknown>>(input: T): Omit<T, "id"> {
  const { id, ...body } = input;
  void id;
  return body;
}
