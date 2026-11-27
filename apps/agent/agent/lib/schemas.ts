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
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Importe decimal, por ejemplo 14.99");
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
