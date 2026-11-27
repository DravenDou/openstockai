import { z } from "zod";

export const traceQuerySchema = z
  .object({
    traceId: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const traceSummarySchema = z.object({
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  agentName: z.string().max(200).nullable(),
  conversationId: z.string().max(200).nullable(),
  startedAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  spanCount: z.number().int().nonnegative(),
});

export const traceSpanSchema = z.object({
  spanId: z.string().regex(/^[0-9a-f]{16}$/),
  parentSpanId: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
  name: z.string().max(200),
  durationMs: z.number().nonnegative(),
  offsetMs: z.number().nonnegative(),
  statusCode: z.number().int().min(0).max(2),
  model: z.string().max(200).nullable(),
  tool: z.string().max(200).nullable(),
});

export const traceDetailSchema = traceSummarySchema.extend({
  spans: z.array(traceSpanSchema).max(2000),
  truncated: z.boolean(),
  errorSpanCount: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative().nullable(),
  outputTokens: z.number().nonnegative().nullable(),
});

export const traceListSchema = z.object({
  items: z.array(traceSummarySchema).max(20),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});

export type TraceSummary = z.infer<typeof traceSummarySchema>;
export type TraceSpan = z.infer<typeof traceSpanSchema>;
export type TraceDetail = z.infer<typeof traceDetailSchema>;
