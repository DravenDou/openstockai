import type { WorkflowStepToolContext } from "eve/tools";
import type { paths } from "@openstockai/api-client/generated";
import { call, type Body } from "./api";

// Checkpoint the tool separately so replay keeps its callId and Go idempotency key.
export async function write<P extends keyof paths, M extends ("post" | "patch") & keyof paths[P]>(
  ctx: WorkflowStepToolContext,
  path: P,
  method: M,
  input: Body<NonNullable<paths[P][M]>>,
  options: { id?: string } = {},
) {
  "use step";
  return call(ctx, path, method, input, options);
}
