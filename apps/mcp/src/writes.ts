import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  acceptedContent,
  inputRequired,
  inputResponse,
  requireScopes,
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { APIError } from "@openstockai/api-client/client";
import {
  adjustment,
  product,
  productPatch,
  purchase,
  stockCount,
  transfer,
} from "@openstockai/schemas";
import { scopes } from "./auth";
import { failure, registerLoose, sessionOf, type ApprovalState, type Runtime } from "./runtime";
import { ToolFailure, type Session } from "./upstream";

const uuid = z.uuid();
const approveSchema = z.object({
  approve: z.boolean().meta({ title: "Apply this change?" }),
});
const statuses = ["applied", "declined_in_client", "rejected_by_owner"] as const;
export const writeOutput = z.looseObject({
  status: z.enum(statuses),
  actionId: z.string(),
  message: z.string(),
  result: z.unknown().optional(),
});

type Helpers = { label: (kind: "product" | "warehouse", id: string) => Promise<string> };
type Write<S extends z.ZodType> = {
  name: string;
  title: string;
  description: string;
  input: S;
  destructive: boolean;
  idempotent: boolean;
  // The Go operation string, exactly as the agent registers it (method + path with the ID).
  operation: (args: z.output<S>) => string;
  // The exact JSON the mutation sends, and what is registered as toolInput ({} when empty).
  body: (args: z.output<S>) => unknown;
  // One human line for the approval prompt.
  summary: (args: z.output<S>, h: Helpers) => Promise<string>;
  run: (args: z.output<S>, key: string, session: Session, up: Runtime["up"]) => Promise<unknown>;
};

// Stable digest of the parsed arguments; the retry of an approval must carry the same call.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const digest = (tool: string, args: unknown) =>
  createHash("sha256")
    .update(JSON.stringify([tool, canonical(args)]))
    .digest("base64url");

const outcome = (
  status: (typeof statuses)[number],
  actionId: string,
  message: string,
  extra?: unknown,
): CallToolResult => {
  const data = { status, actionId, message, ...(extra === undefined ? {} : { result: extra }) };
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
};

export function registerWrites(server: McpServer, rt: Runtime) {
  const { up, codec } = rt;
  const register = registerLoose(server);
  const names = (session: Session): Helpers => ({
    async label(kind, id) {
      try {
        if (kind === "product") {
          // GET /v1/products/{id} finds only active products; a restore targets an archived one.
          const p = await up.go(session, "/v1/products/{id}", "get", { id }).catch(async () =>
            (
              await up.go(session, "/v1/products", "get", {
                query: { status: "archived", limit: 500 },
              })
            ).items.find((item) => item.id === id),
          );
          return p ? `"${p.name}" (${p.sku})` : id;
        }
        const w = await up.go(session, "/v1/warehouses/{id}", "get", { id });
        return `"${w.name}"`;
      } catch {
        return id;
      }
    },
  });

  const write = <S extends z.ZodObject>(spec: Write<S>) =>
    register(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input,
        outputSchema: writeOutput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: spec.destructive,
          idempotentHint: spec.idempotent,
          openWorldHint: false,
        },
        scopeChallenge: requireScopes(scopes.write),
      },
      async (rawArgs, ctx): Promise<CallToolResult | InputRequiredResult> => {
        const args = rawArgs as z.output<S>;
        try {
          return await run(spec, args, ctx);
        } catch (error) {
          return failure(error);
        }
      },
    );

  async function run<S extends z.ZodObject>(spec: Write<S>, args: z.output<S>, ctx: ServerContext) {
    const session = await sessionOf(rt, ctx);
    if (!session.scopes.includes(scopes.write))
      throw new ToolFailure("The connected application may not change data (inventory:write).");
    const argsDigest = digest(spec.name, args);
    const state = ctx.mcpReq.requestState<ApprovalState>();
    const execute = async (actionId: string) =>
      outcome("applied", actionId, "Applied.", await spec.run(args, actionId, session, up));
    const ask = async (actionId: string, mode: ApprovalState["mode"], retry = false) => {
      const token = await codec.mint(
        { actionId, mode, sub: session.userId, cid: session.clientId, tool: spec.name, argsDigest },
        ctx,
      );
      if (mode === "client")
        return inputRequired({
          inputRequests: {
            approve: inputRequired.elicit({
              message: await spec.summary(args, names(session)),
              requestedSchema: approveSchema,
            }),
          },
          requestState: token,
        });
      return inputRequired({
        inputRequests: {
          approve: inputRequired.elicitUrl({
            message: `${retry ? "Still waiting for the owner. " : ""}${await spec.summary(args, names(session))}. The owner must approve this in OpenStock; open the link, approve, then continue.`,
            url: `${rt.deps.config.appUrl}/approvals/${actionId}`,
          }),
        },
        requestState: token,
      });
    };
    // The owner decided in the web app first (409 ACTION_NOT_PENDING): follow Go's record. Only an
    // approval Go itself holds is executed; the idempotency key is the action ID.
    const decided = async (actionId: string) => {
      const a = await up.go(session, "/v1/agent-actions/{id}", "get", { id: actionId });
      if (a.status === "completed")
        return outcome("applied", actionId, "Already applied: the owner approved it in OpenStock.");
      if (a.approvalStatus === "approved") return execute(actionId);
      if (a.approvalStatus === "rejected")
        return outcome("rejected_by_owner", actionId, "Rejected by the owner.");
      throw new ToolFailure("The approval is no longer pending but has no decision. Try again.");
    };
    const decline = async (actionId: string) => {
      try {
        await up.go(session, "/v1/agent-actions/{id}/approval", "post", {
          id: actionId,
          body: { approved: false },
        });
      } catch (error) {
        if (error instanceof APIError && error.code === "ACTION_NOT_PENDING")
          return decided(actionId);
        throw error;
      }
      return outcome("declined_in_client", actionId, "Not applied: declined in the client.");
    };

    if (!state) {
      const actionId = randomUUID();
      const toolInput = spec.body(args) ?? {};
      const action = await up.go(session, "/v1/agent-actions", "post", {
        body: { id: actionId, conversationId: "mcp", operation: spec.operation(args), toolInput },
      });
      if (action.approvalStatus === "rejected")
        return outcome("rejected_by_owner", actionId, "Not applied: the action was rejected.");
      if (action.approvalStatus === "not_required") return execute(actionId);
      if (action.approvalStatus !== "pending")
        throw new ToolFailure("Go answered an unexpected approval status; nothing was applied.");
      return ask(actionId, action.ownerApprovalRequired ? "owner" : "client");
    }

    // A retry: the SDK already verified signature and TTL. Check it is this caller, this tool
    // and these arguments before anything is applied.
    if (
      state.sub !== session.userId ||
      state.cid !== session.clientId ||
      state.tool !== spec.name ||
      state.argsDigest !== argsDigest
    )
      throw new ToolFailure(
        "This approval belongs to a different call. Start the change again with the same arguments.",
      );
    const view = inputResponse(ctx.mcpReq.inputResponses, "approve");
    if (view.kind !== "elicit") return ask(state.actionId, state.mode);

    if (state.mode === "client") {
      const answer = acceptedContent(ctx.mcpReq.inputResponses, "approve", approveSchema);
      if (answer?.approve !== true) return decline(state.actionId);
      try {
        await up.go(session, "/v1/agent-actions/{id}/approval", "post", {
          id: state.actionId,
          body: { approved: true },
        });
      } catch (error) {
        // Go decides the policy: if it now wants the owner, switch to the owner path.
        if (error instanceof APIError && error.code === "OWNER_APPROVAL_REQUIRED")
          return ask(state.actionId, "owner");
        if (error instanceof APIError && error.code === "ACTION_NOT_PENDING")
          return decided(state.actionId);
        throw error;
      }
      return execute(state.actionId);
    }

    if (view.action !== "accept") return decline(state.actionId);
    try {
      return await execute(state.actionId);
    } catch (error) {
      if (error instanceof APIError && error.code === "APPROVAL_REQUIRED")
        return ask(state.actionId, "owner", true);
      if (error instanceof APIError && error.code === "ACTION_REJECTED")
        return outcome("rejected_by_owner", state.actionId, "Rejected by the owner.");
      throw error;
    }
  }

  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const idOnly = z.object({ id: uuid }).strict();
  const path = (base: string, id: string) => `${base}/${id}`;

  write({
    name: "adjust_stock",
    title: "Adjust stock",
    description:
      "Record one stock entry or exit for a product in a warehouse. quantity is positive for entries and negative for exits; type classifies it (purchase, sale, adjustment_in, adjustment_out, return_in, return_out, initial). Needs approval: low-risk changes are confirmed in your client, quantities above 1000 by the owner in OpenStock. Use record_stock_count to correct stock to a counted value.",
    input: adjustment,
    destructive: false,
    idempotent: false,
    operation: () => "POST /v1/inventory/adjustments",
    body: (a) => a,
    summary: async (a, h) =>
      `Adjust stock (${a.type}): ${signed(a.quantity)} of ${await h.label("product", a.productId)} in warehouse ${await h.label("warehouse", a.warehouseId)}${a.reference ? `, reference "${a.reference}"` : ""}`,
    run: (a, key, s, u) => u.go(s, "/v1/inventory/adjustments", "post", { body: a, key }),
  });
  write({
    name: "transfer_stock",
    title: "Transfer stock",
    description:
      "Move a quantity of one product between two warehouses in a single transaction. Needs approval; quantities above 1000 need the owner.",
    input: transfer,
    destructive: false,
    idempotent: false,
    operation: () => "POST /v1/inventory/transfers",
    body: (a) => a,
    summary: async (a, h) =>
      `Transfer ${a.quantity} of ${await h.label("product", a.productId)} from ${await h.label("warehouse", a.fromWarehouseId)} to ${await h.label("warehouse", a.toWarehouseId)}`,
    run: (a, key, s, u) => u.go(s, "/v1/inventory/transfers", "post", { body: a, key }),
  });
  write({
    name: "record_stock_count",
    title: "Record stock count",
    description:
      "Record a physical count for one product in one warehouse. expected must be the quantity currently on record (read it with get_product just before); counted is what was found. If expected no longer matches, the count is rejected instead of overwriting newer movements. The difference is booked as a stock movement.",
    input: stockCount,
    destructive: false,
    idempotent: false,
    operation: () => "POST /v1/inventory/counts",
    body: (a) => a,
    summary: async (a, h) =>
      `Stock count: ${await h.label("product", a.productId)} in ${await h.label("warehouse", a.warehouseId)}, counted ${a.counted} (on record ${a.expected}, difference ${signed(Math.round((a.counted - a.expected) * 1000) / 1000)})`,
    run: (a, key, s, u) => u.go(s, "/v1/inventory/counts", "post", { body: a, key }),
  });
  write({
    name: "record_purchase",
    title: "Record purchase",
    description:
      "Record a purchase receipt: adds stock to one warehouse for every line in one transaction at the given unit cost. Lines need real product IDs (create missing products first). Only record goods that have actually arrived. Needs approval.",
    input: purchase,
    destructive: false,
    idempotent: false,
    operation: () => "POST /v1/purchases",
    body: (a) => a,
    summary: async (a, h) =>
      `Record purchase "${a.reference}": ${a.items.length} line(s), ${a.items.reduce((n, i) => n + i.quantity, 0)} units into warehouse ${await h.label("warehouse", a.warehouseId)}`,
    run: (a, key, s, u) => u.go(s, "/v1/purchases", "post", { body: a, key }),
  });
  write({
    name: "create_product",
    title: "Create product",
    description:
      "Create a product with a SKU and decimal prices (strings such as 14.99). Optional initialStock needs a real warehouseId; categoryName creates or reuses a category; unitCode comes from list_reference_data. Needs approval.",
    input: product,
    destructive: false,
    idempotent: false,
    operation: () => "POST /v1/products",
    body: (a) => a,
    summary: async (a) =>
      `Create product "${a.name}" (SKU ${a.sku})${a.initialStock ? ` with initial stock ${a.initialStock}` : ""}`,
    run: (a, key, s, u) => u.go(s, "/v1/products", "post", { body: a, key }),
  });
  write({
    name: "update_product",
    title: "Update product",
    description:
      "Edit catalog data of a product: name, category, unit, prices, minimum, location, barcode, description. Only the fields you send change. Never changes stock or SKU. Needs approval.",
    input: productPatch,
    destructive: false,
    idempotent: true,
    operation: (a) => `PATCH ${path("/v1/products", a.id)}`,
    body: ({ id, ...rest }) => (void id, rest),
    summary: async (a, h) =>
      `Update ${await h.label("product", a.id)}: ${
        Object.keys(a)
          .filter((k) => k !== "id")
          .join(", ") || "no fields"
      }`,
    run: ({ id, ...body }, key, s, u) => u.go(s, "/v1/products/{id}", "patch", { id, body, key }),
  });
  write({
    name: "archive_product",
    title: "Archive product",
    description:
      "Archive a product so it leaves the active catalog; its history is kept and it can be restored. Always needs the owner's approval in OpenStock. Confirm the exact product with the user first.",
    input: idOnly,
    destructive: true,
    idempotent: true,
    operation: (a) => `DELETE ${path("/v1/products", a.id)}`,
    body: () => undefined,
    summary: async (a, h) => `Archive product ${await h.label("product", a.id)}`,
    run: (a, key, s, u) => u.go(s, "/v1/products/{id}", "delete", { id: a.id, key }),
  });
  write({
    name: "restore_product",
    title: "Restore product",
    description:
      "Restore an archived product to the active catalog (find it with search_products status=archived). Always needs the owner's approval in OpenStock.",
    input: idOnly,
    destructive: true,
    idempotent: true,
    operation: (a) => `POST ${path("/v1/products", a.id)}/restore`,
    body: () => undefined,
    summary: async (a, h) => `Restore product ${await h.label("product", a.id)}`,
    run: (a, key, s, u) => u.go(s, "/v1/products/{id}/restore", "post", { id: a.id, key }),
  });
}
