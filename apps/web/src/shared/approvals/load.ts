import type { Schemas } from "@openstockai/api-client/client";

export type ActionView = Schemas["ActionView"];
// Who asked: the client's own claims (unverified) read from the OAuth client tables.
export type ApprovalClient = { clientId: string; name: string | null; host: string | null };
export type ApprovalLoad =
  | { ok: true; action: ActionView; client: ApprovalClient | null; targetName: string | null }
  | { ok: false; reason: "unauthenticated" | "not_found" | "unavailable" };
