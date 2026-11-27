import type { WorkflowStepToolContext } from "eve/tools";
import type { Schemas } from "@openstockai/api-client/client";
import { call, readSettings } from "./api";

type Settings = Schemas["Settings"];

// Go replaces the whole settings document, so a partial change is merged into the
// current values. Unknown keys from the patch are ignored.
export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next = { ...current };
  for (const key of Object.keys(current) as (keyof Settings)[]) {
    const value = patch[key];
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

// Checkpointed separately so replay keeps its callId and Go idempotency key.
export async function saveSettings(ctx: WorkflowStepToolContext, patch: Partial<Settings>) {
  "use step";
  return call(ctx, "/v1/settings", "patch", mergeSettings(await readSettings(ctx), patch));
}
