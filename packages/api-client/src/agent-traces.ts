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

export const runStatusSchema = z.enum(["ok", "error", "awaiting_approval"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

// Row of the runs list. Cost is filled in by the web route from LLM_PRICE_* (null when unknown).
export const runSummarySchema = traceSummarySchema.extend({
  status: runStatusSchema.default("ok"),
  model: z.string().max(200).nullable().default(null),
  steps: z.number().int().nonnegative().default(0),
  toolCalls: z.number().int().nonnegative().default(0),
  inputTokens: z.number().nonnegative().nullable().default(null),
  outputTokens: z.number().nonnegative().nullable().default(null),
  costUsd: z.number().nonnegative().nullable().default(null),
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

export const approvalStateSchema = z.enum(["pending", "approved", "rejected"]);
export type ApprovalState = z.infer<typeof approvalStateSchema>;

// One row of the turn timeline: a tool call (with its approval), a lone approval or an error.
export const timelineEventSchema = z.object({
  id: z.string().max(100),
  kind: z.enum(["tool", "approval", "error"]),
  source: z.enum(["trace", "api"]),
  name: z.string().max(200),
  label: z.string().max(200).nullable().default(null),
  stepIndex: z.number().int().nonnegative().nullable(),
  offsetMs: z.number().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  startedAt: z.iso.datetime().nullable().default(null),
  outcome: z.string().max(60).nullable(),
  approval: approvalStateSchema.nullable(),
  callId: z.string().max(200).nullable(),
  actionId: z.string().max(60).nullable().default(null),
  args: z.string().max(400).nullable().default(null),
  errorCode: z.string().max(100).nullable().default(null),
  errorMessage: z.string().max(300).nullable().default(null),
});

export const traceDetailSchema = runSummarySchema.extend({
  spans: z.array(traceSpanSchema).max(2000),
  truncated: z.boolean(),
  errorSpanCount: z.number().int().nonnegative(),
  timeline: z.array(timelineEventSchema).max(500).default([]),
});

export const traceListSchema = z.object({
  items: z.array(runSummarySchema).max(20),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  pricesConfigured: z.boolean().default(false),
});

export type TraceSummary = z.infer<typeof traceSummarySchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type TraceSpan = z.infer<typeof traceSpanSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type TraceDetail = z.infer<typeof traceDetailSchema>;
