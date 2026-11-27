import { createHash } from "node:crypto";
import type { TimelineEvent } from "./agent-traces";

// Server-side helpers that join Eve trace timelines with Go agent actions.
// Everything here is pure so it can be unit-tested with synthetic data.

export type RunAction = {
  id: string;
  conversation_id: string;
  tool_name: string;
  tool_input: unknown;
  status: string;
  approval_status: string;
  started_at: string;
  error: string | null;
};

// Single derivation of the action ID, shared with the agent: sha256(`${conversationId}:${callId}`) as a UUID.
export function actionIdFor(conversationId: string, callId: string) {
  const bytes = createHash("sha256").update(`${conversationId}:${callId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const secretKey = /token|secret|password|passwd|key|authorization|cookie|credential/i;
const MAX_ARGS = 140;

function scalar(value: unknown): string {
  if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 37)}…` : value;
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  return "{…}";
}

// Compact "key=value" summary of a tool input: secret-looking keys are dropped and the
// text is truncated. Only used for display; the full input stays in Go.
export function compactArgs(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) return scalar(input).slice(0, MAX_ARGS);
  const parts = Object.entries(input as Record<string, unknown>)
    .filter(([key, value]) => !secretKey.test(key) && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${scalar(value)}`);
  if (!parts.length) return null;
  const text = parts.join(", ");
  return text.length > MAX_ARGS ? `${text.slice(0, MAX_ARGS - 1)}…` : text;
}

const verbs: Record<string, string> = { POST: "Create", PATCH: "Update", DELETE: "Delete" };
const nouns: Record<string, string> = {
  products: "product",
  categories: "category",
  warehouses: "warehouse",
  suppliers: "supplier",
  units: "unit",
};

// Friendly name for a Go operation such as "PATCH /v1/products/<id>".
export function operationLabel(operation: string) {
  const [method = "", path = ""] = operation.split(" ");
  const [resource = "", second = "", third = ""] = path.replace(/^\/v1\//, "").split("/");
  if (resource === "inventory" && second === "adjustments") return "Adjust stock";
  if (resource === "inventory" && second === "transfers") return "Transfer stock";
  if (resource === "inventory" && second === "counts") return "Record stock count";
  if (resource === "purchases" && method === "POST") return "Record purchase";
  if (resource === "settings" && method === "PATCH") return "Update settings";
  if (resource === "products" && third === "restore") return "Restore product";
  if (resource in nouns && verbs[method]) return `${verbs[method]} ${nouns[resource]}`;
  if (method === "GET") return `Read ${resource.replace(/-/g, " ") || "data"}`;
  return operation.replace(/\/[0-9a-f-]{36}/g, "").slice(0, 100);
}

function approvalFrom(status: string): TimelineEvent["approval"] {
  if (status === "pending") return "pending";
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return null;
}

/**
 * Enrich a trace timeline with Go agent actions of the same conversation.
 * 1. Tool rows are matched by action id derived from (conversation, call id).
 * 2. If some rows stay unmatched and their count equals the unmatched actions',
 *    they are paired in chronological order.
 * 3. Leftover write actions (for example pending approvals absent from the trace)
 *    are appended as API-only rows.
 */
export function joinActions(
  timeline: TimelineEvent[],
  conversationId: string | null,
  actions: RunAction[],
): TimelineEvent[] {
  if (!conversationId) return timeline;
  const own = actions
    .filter((action) => action.conversation_id === conversationId)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const byId = new Map(own.map((action) => [action.id, action]));
  const used = new Set<string>();
  const result = timeline.map((event) => ({ ...event }));
  const apply = (event: TimelineEvent, action: RunAction) => {
    used.add(action.id);
    event.actionId = action.id;
    event.label = operationLabel(action.tool_name);
    event.args = compactArgs(action.tool_input);
    event.approval = approvalFrom(action.approval_status) ?? event.approval;
    if (action.error && !event.errorMessage) event.errorMessage = action.error.slice(0, 300);
  };
  const tools = result.filter((event) => event.kind === "tool");
  for (const event of tools) {
    const action = event.callId ? byId.get(actionIdFor(conversationId, event.callId)) : undefined;
    if (action && !used.has(action.id)) apply(event, action);
  }
  const looseEvents = tools.filter((event) => !event.actionId);
  const looseActions = own.filter((action) => !used.has(action.id));
  if (looseEvents.length && looseEvents.length === looseActions.length)
    looseEvents.forEach((event, index) => apply(event, looseActions[index]));
  for (const action of own) {
    if (used.has(action.id) || action.tool_name.startsWith("GET ")) continue;
    result.push({
      id: `action:${action.id}`.slice(0, 100),
      kind: "tool",
      source: "api",
      name: operationLabel(action.tool_name),
      label: operationLabel(action.tool_name),
      stepIndex: null,
      offsetMs: null,
      durationMs: null,
      startedAt: new Date(action.started_at).toISOString(),
      outcome: action.status,
      approval: approvalFrom(action.approval_status),
      callId: null,
      actionId: action.id,
      args: compactArgs(action.tool_input),
      errorCode: null,
      errorMessage: action.error ? action.error.slice(0, 300) : null,
    });
  }
  return result;
}
