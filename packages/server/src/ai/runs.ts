import { joinActions, type RunAction } from "@openstockai/api-client/agent-runs";
import type { RunStatus, TraceDetail, TraceSummary } from "@openstockai/api-client/agent-traces";
import { estimateCostUsd, llmConfig } from "./config";

export type Prices = { priceInputPerMTok: number | null; priceOutputPerMTok: number | null };

// Prices come from LLM_PRICE_*; an invalid or incomplete LLM config just disables estimates.
export function configuredPrices(env: Record<string, string | undefined> = process.env): Prices {
  try {
    const { priceInputPerMTok, priceOutputPerMTok } = llmConfig(env);
    return { priceInputPerMTok, priceOutputPerMTok };
  } catch {
    const read = (key: string) => {
      const value = Number(env[key]);
      return env[key]?.trim() && Number.isFinite(value) && value >= 0 ? value : null;
    };
    return {
      priceInputPerMTok: read("LLM_PRICE_INPUT_PER_MTOK"),
      priceOutputPerMTok: read("LLM_PRICE_OUTPUT_PER_MTOK"),
    };
  }
}

export const pricesConfigured = (prices: Prices) =>
  prices.priceInputPerMTok !== null || prices.priceOutputPerMTok !== null;

type Costed = { inputTokens: number | null; outputTokens: number | null };
export function withCost<T extends Costed>(run: T, prices: Prices) {
  return { ...run, costUsd: estimateCostUsd(prices, run) };
}

// A pending approval stored in Go makes the run "awaiting approval" unless it already failed.
function statusWith(status: RunStatus, conversationId: string | null, actions: RunAction[]) {
  const pending =
    conversationId !== null &&
    actions.some(
      (action) => action.conversation_id === conversationId && action.approval_status === "pending",
    );
  return status === "ok" && pending ? "awaiting_approval" : status;
}

export function enrichList<T extends TraceSummary & Costed & { status: RunStatus }>(
  items: T[],
  actions: RunAction[],
  prices: Prices,
) {
  return items.map((item) =>
    withCost({ ...item, status: statusWith(item.status, item.conversationId, actions) }, prices),
  );
}

export function enrichDetail(
  trace: TraceDetail,
  actions: RunAction[],
  prices: Prices,
): TraceDetail {
  const timeline = joinActions(trace.timeline, trace.conversationId, actions);
  const base = withCost({ ...trace, timeline }, prices);
  return { ...base, status: statusWith(base.status, trace.conversationId, actions) };
}
