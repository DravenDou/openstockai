import assert from "node:assert/strict";
import { test } from "node:test";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { adjustArgs, ids, mutations, setup, token } from "./harness";

const order = [
  "search_products",
  "get_product",
  "list_low_stock",
  "get_stock_movements",
  "list_purchases",
  "get_purchase",
  "get_report",
  "list_reference_data",
  "get_audit_log",
  "adjust_stock",
  "transfer_stock",
  "record_stock_count",
  "record_purchase",
  "create_product",
  "update_product",
  "archive_product",
  "restore_product",
];
const text = (result: { content?: unknown }) => (result.content as { text: string }[])[0]!.text;

test("tools/list: fixed order, annotations, public ten-minute cache hint", async () => {
  const { connect } = await setup();
  const client = await connect(await token());
  const list = (await client.listTools()) as Awaited<ReturnType<typeof client.listTools>> & {
    ttlMs?: number;
    cacheScope?: string;
  };
  assert.deepEqual(
    list.tools.map((t) => t.name),
    order,
  );
  for (const tool of list.tools) {
    assert.ok(tool.title && tool.description && tool.outputSchema, `${tool.name} is documented`);
    assert.equal(tool.annotations?.openWorldHint, false);
    const write = order.indexOf(tool.name) >= 9;
    assert.equal(tool.annotations?.readOnlyHint, !write, tool.name);
  }
  const destructive = list.tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
  assert.deepEqual(destructive, ["archive_product", "restore_product"]);
  assert.equal(list.ttlMs, 600_000);
  assert.equal(list.cacheScope, "public");
  await client.close();
});

test("server/discover advertises the skills extension; skills list and read", async () => {
  const { connect } = await setup();
  const client = await connect(await token());
  assert.ok(client.getDiscoverResult(), "modern era negotiated");
  const skills = new SkillsClient(client);
  assert.ok(skills.supported, "the skills extension is advertised");
  assert.ok(client.getServerCapabilities()?.extensions?.["io.modelcontextprotocol/skills"]);
  const listing = await skills.list();
  assert.deepEqual(listing.skills.map((s) => s.frontmatter.name).sort(), [
    "cycle-count",
    "receive-delivery",
    "restock-review",
  ]);
  const restock = listing.skills.find((s) => s.frontmatter.name === "restock-review")!;
  const file = await skills.read(restock);
  assert.ok(file.verified);
  assert.match(file.text ?? "", /never call `record_purchase`/i);
  await client.close();
});

test("a read tool calls Go with the exchanged token, never the access token", async () => {
  const { connect, fake } = await setup();
  const access = await token();
  const client = await connect(access);
  const result = await client.callTool({ name: "search_products", arguments: { query: "hammer" } });
  assert.notEqual(result.isError, true);
  const data = result.structuredContent as { items: { sku: string }[]; total: number };
  assert.equal(data.items[0]!.sku, "HAM-001");
  const go = fake.state.calls.filter((c) => c.url.startsWith("http://api.test"));
  assert.equal(go.length, 1);
  assert.equal(go[0]!.headers.get("authorization"), "Bearer go-token");
  assert.equal(go[0]!.headers.get("x-mcp-secret"), "s".repeat(40));
  assert.ok(go[0]!.url.includes("query=hammer"));
  for (const call of fake.state.calls.filter((c) => !c.url.includes("/mcp-token")))
    assert.ok(
      !(call.headers.get("authorization") ?? "").includes(access),
      "access token never forwarded",
    );
  // Exchange on every call: no caching.
  await client.callTool({ name: "list_low_stock", arguments: {} });
  assert.equal(fake.state.exchanges, 2);
  await client.close();
});

test("get_product by SKU returns balances; bad arguments are a tool error", async () => {
  const { connect } = await setup();
  const client = await connect(await token());
  const ok = await client.callTool({ name: "get_product", arguments: { sku: "HAM-001" } });
  const data = ok.structuredContent as {
    product: { id: string };
    balances: { quantity: number }[];
  };
  assert.equal(data.product.id, ids.product);
  assert.equal(data.balances[0]!.quantity, 12);
  const both = await client.callTool({
    name: "get_product",
    arguments: { sku: "A", id: ids.product },
  });
  assert.equal(both.isError, true);
  const report = await client.callTool({ name: "get_report", arguments: { report: "summary" } });
  assert.equal((report.structuredContent as { data: { low: number } }).data.low, 1);
  await client.close();
});

test("a revoked grant is a clear tool error", async () => {
  const { connect, fake } = await setup();
  const client = await connect(await token());
  fake.state.revoked = true;
  const result = await client.callTool({ name: "list_low_stock", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(text(result), /no longer allows/);
  await client.close();
});

test("resources: reference, low-stock and the product template carry cache hints", async () => {
  const { connect } = await setup();
  const client = await connect(await token());
  const hints = async (uri: string) => {
    const read = (await client.readResource({ uri })) as {
      contents: { text?: string }[];
      ttlMs?: number;
      cacheScope?: string;
    };
    assert.ok(read.contents[0]!.text);
    return [read.ttlMs, read.cacheScope];
  };
  assert.deepEqual(await hints("openstock://reference"), [60_000, "private"]);
  assert.deepEqual(await hints("openstock://low-stock"), [30_000, "private"]);
  assert.deepEqual(await hints(`openstock://products/${ids.product}`), [15_000, "private"]);
  const listed = await client.listResources();
  assert.ok(listed.resources.some((r) => r.uri === `openstock://products/${ids.product}`));
  await client.close();
});

// ---------------------------------------------------------------------------------------------
// Writes and the MRTR approval protocol
// ---------------------------------------------------------------------------------------------
const approve = (answer: boolean) => () => ({ action: "accept", content: { approve: answer } });

test("write, approval not required: applied at once, key = action ID", async () => {
  const { connect, fake } = await setup();
  fake.state.policy = "not_required";
  const client = await connect(await token(), () => assert.fail("no prompt expected"));
  const result = await client.callTool({ name: "adjust_stock", arguments: adjustArgs });
  assert.equal((result.structuredContent as { status: string }).status, "applied");
  const [action] = [...fake.state.actions.values()];
  const [write] = mutations(fake.state.calls);
  assert.equal(write!.headers.get("idempotency-key"), action!.id);
  assert.equal(write!.headers.get("x-agent-action-id"), action!.id);
  assert.equal(action!.operation, "POST /v1/inventory/adjustments");
  assert.deepEqual(write!.body, action!.toolInput);
  await client.close();
});

test("write, form path: accept approves as mcp and applies once", async () => {
  const { connect, fake } = await setup();
  const prompts: { message: string; mode?: string; requestedSchema?: unknown }[] = [];
  const client = await connect(await token(), (params) => (prompts.push(params), approve(true)()));
  const result = await client.callTool({ name: "adjust_stock", arguments: adjustArgs });
  assert.equal((result.structuredContent as { status: string }).status, "applied");
  assert.equal(prompts.length, 1);
  assert.match(
    prompts[0]!.message,
    /Adjust stock \(adjustment_in\): \+5 of "Claw hammer" \(HAM-001\) in warehouse "Main"/,
  );
  assert.notEqual(prompts[0]!.mode, "url");
  const [action] = [...fake.state.actions.values()];
  assert.equal(action!.approval, "approved");
  assert.ok(action!.completed);
  const approvals = fake.state.calls.filter((c) => c.url.endsWith("/approval"));
  assert.deepEqual(
    approvals.map((c) => c.body),
    [{ approved: true }],
  );
  const writes = mutations(fake.state.calls);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.headers.get("idempotency-key"), action!.id);
  await client.close();
});

for (const [name, answer] of [
  ["decline", { action: "decline" }],
  ["cancel", { action: "cancel" }],
  ["approve=false", { action: "accept", content: { approve: false } }],
] as const)
  test(`write, form path: ${name} sends approval=false and applies nothing`, async () => {
    const { connect, fake } = await setup();
    const client = await connect(await token(), () => answer);
    const result = await client.callTool({ name: "adjust_stock", arguments: adjustArgs });
    assert.equal((result.structuredContent as { status: string }).status, "declined_in_client");
    assert.match(text(result), /declined in the client/);
    assert.deepEqual(
      fake.state.calls.filter((c) => c.url.endsWith("/approval")).map((c) => c.body),
      [{ approved: false }],
    );
    assert.equal(mutations(fake.state.calls).length, 0);
    await client.close();
  });

test("write, owner path: URL elicitation, waiting, then applied", async () => {
  const { connect, fake } = await setup();
  fake.state.policy = "owner";
  const prompts: { mode?: string; url?: string; message: string }[] = [];
  const client = await connect(await token(), (params) => {
    prompts.push(params);
    // The owner approves in the web app after the second prompt.
    if (prompts.length === 2) [...fake.state.actions.values()][0]!.approval = "approved";
    return { action: "accept" };
  });
  const result = await client.callTool({ name: "archive_product", arguments: { id: ids.product } });
  assert.equal(
    (result.structuredContent as { status: string } | undefined)?.status,
    "applied",
    JSON.stringify(result),
  );
  assert.equal(prompts.length, 2);
  const [action] = [...fake.state.actions.values()];
  assert.ok(
    prompts.every(
      (p) => p.mode === "url" && p.url === `http://localhost:3000/approvals/${action!.id}`,
    ),
  );
  assert.match(prompts[0]!.message, /owner must approve this in OpenStock/);
  assert.match(prompts[1]!.message, /Still waiting/);
  assert.equal(action!.operation, `DELETE /v1/products/${ids.product}`);
  assert.deepEqual(action!.toolInput, {});
  // Tried (409) once, then applied: same key both times, never an mcp approval.
  const tries = mutations(fake.state.calls);
  assert.equal(tries.length, 2);
  assert.ok(tries.every((c) => c.headers.get("idempotency-key") === action!.id));
  assert.equal(fake.state.calls.filter((c) => c.url.endsWith("/approval")).length, 0);
  await client.close();
});

test("write, owner path: rejected by the owner", async () => {
  const { connect, fake } = await setup();
  fake.state.policy = "owner";
  const client = await connect(await token(), () => {
    [...fake.state.actions.values()][0]!.approval = "rejected";
    return { action: "accept" };
  });
  const result = await client.callTool({ name: "restore_product", arguments: { id: ids.product } });
  assert.equal((result.structuredContent as { status: string }).status, "rejected_by_owner");
  assert.match(text(result), /Rejected by the owner/);
  await client.close();
});

test("write, owner path: a restore names the archived product, not its ID", async () => {
  const { connect, fake } = await setup();
  fake.state.policy = "owner";
  const prompts: { message: string }[] = [];
  const client = await connect(
    await token(),
    (params) => (prompts.push(params), { action: "decline" }),
  );
  await client.callTool({ name: "restore_product", arguments: { id: ids.archived } });
  assert.match(prompts[0]!.message, /^Restore product "Old hammer" \(OLD-1\)/);
  await client.close();
});

test("write, owner path: declining the URL prompt withdraws the action", async () => {
  const { connect, fake } = await setup();
  fake.state.policy = "owner";
  const client = await connect(await token(), () => ({ action: "decline" }));
  const result = await client.callTool({ name: "archive_product", arguments: { id: ids.product } });
  assert.equal((result.structuredContent as { status: string }).status, "declined_in_client");
  assert.deepEqual(
    fake.state.calls.filter((c) => c.url.endsWith("/approval")).map((c) => c.body),
    [{ approved: false }],
  );
  assert.equal(mutations(fake.state.calls).length, 0);
  await client.close();
});

test("update_product sends only the given fields (no defaults)", async () => {
  const { connect, fake } = await setup();
  fake.state.policy = "not_required";
  const client = await connect(await token());
  await client.callTool({
    name: "update_product",
    arguments: { id: ids.product, name: "Hammer 2" },
  });
  const [write] = mutations(fake.state.calls);
  assert.equal(write!.method, "PATCH");
  assert.deepEqual(write!.body, { name: "Hammer 2" });
  await client.close();
});

// Interfering with the retry of an approval round: the client echoes what the hook changes.
async function intercepted(change: (params: Record<string, unknown>) => void) {
  const ctx = await setup();
  ctx.hooks.tamper = (rpc) => {
    if (rpc.params?.requestState) change(rpc.params);
  };
  let prompts = 0;
  const client = await ctx.connect(
    await token(),
    () => (prompts++, { action: "accept", content: { approve: true } }),
  );
  const result = await client
    .callTool({ name: "adjust_stock", arguments: adjustArgs })
    .catch((error: Error) => error);
  await client.close();
  return { ...ctx, result, prompts };
}
const untouched = (ctx: Awaited<ReturnType<typeof intercepted>>) => {
  assert.equal(mutations(ctx.fake.state.calls).length, 0);
  assert.equal([...ctx.fake.state.actions.values()][0]!.approval, "pending");
};

test("requestState: a tampered state is rejected and nothing is applied", async () => {
  const ctx = await intercepted((params) => {
    params.requestState = `${String(params.requestState).slice(0, -4)}AAAA`;
  });
  assert.ok(ctx.result instanceof Error, "protocol error");
  assert.match((ctx.result as Error).message, /requestState/);
  untouched(ctx);
});

test("requestState: changed arguments between rounds are refused", async () => {
  const ctx = await intercepted((params) => {
    params.arguments = { ...(params.arguments as object), quantity: 500 };
  });
  const result = ctx.result as { isError?: boolean; content: { text: string }[] };
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /different call/);
  untouched(ctx);
});

test("requestState: a state minted for another client is refused", async () => {
  const ctx = await setup();
  let stolen = "";
  ctx.hooks.tamper = (rpc) => {
    if (typeof rpc.params?.requestState === "string") stolen = rpc.params.requestState;
  };
  const a = await ctx.connect(await token(), () => ({ action: "cancel" }));
  await a.callTool({ name: "adjust_stock", arguments: adjustArgs });
  await a.close();
  assert.ok(stolen, "the first client received a state");
  const before = mutations(ctx.fake.state.calls).length;
  ctx.hooks.tamper = (rpc) => {
    Object.assign(rpc.params!, {
      requestState: stolen,
      inputResponses: { approve: { action: "accept", content: { approve: true } } },
    });
  };
  const b = await ctx.connect(await token({ azp: "https://other.example/client.json" }));
  const result = await b
    .callTool({ name: "adjust_stock", arguments: adjustArgs })
    .catch((error: Error) => error);
  assert.ok(result instanceof Error, "protocol error, not a tool result");
  assert.match(result.message, /Invalid or expired requestState/);
  assert.equal(mutations(ctx.fake.state.calls).length, before);
  await b.close();
});

test("requestState: a state for another tool is refused by the handler", async () => {
  const ctx = await setup();
  let seen = false;
  ctx.hooks.tamper = (rpc) => {
    if (!rpc.params?.requestState) return;
    seen = true;
    rpc.params.name = "restore_product";
  };
  const client = await ctx.connect(await token(), approve(true));
  const result = await client.callTool({ name: "archive_product", arguments: { id: ids.product } });
  assert.ok(seen);
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(text(result), /different call/);
  assert.equal(mutations(ctx.fake.state.calls).length, 0);
  await client.close();
});

test("write, form path: Go now wants the owner, so the prompt switches to the owner URL", async () => {
  const { connect, fake } = await setup();
  fake.state.escalate = true;
  const prompts: { mode?: string; url?: string }[] = [];
  const client = await connect(await token(), (params) => {
    prompts.push(params);
    if (prompts.length === 2) [...fake.state.actions.values()][0]!.approval = "approved";
    return { action: "accept", content: { approve: true } };
  });
  const result = await client.callTool({ name: "adjust_stock", arguments: adjustArgs });
  assert.equal((result.structuredContent as { status: string }).status, "applied");
  const [action] = [...fake.state.actions.values()];
  assert.notEqual(prompts[0]!.mode, "url");
  assert.equal(prompts[1]!.mode, "url");
  assert.equal(prompts[1]!.url, `http://localhost:3000/approvals/${action!.id}`);
  await client.close();
});

test("write: registration answered rejected is reported and applies nothing", async () => {
  const { connect, fake } = await setup();
  fake.state.policy = "rejected";
  const client = await connect(await token(), () => assert.fail("no prompt expected"));
  const result = await client.callTool({ name: "adjust_stock", arguments: adjustArgs });
  assert.equal((result.structuredContent as { status: string }).status, "rejected_by_owner");
  assert.equal(mutations(fake.state.calls).length, 0);
  await client.close();
});

// The owner decided in the web app while the client's form was open: Go answers 409
// ACTION_NOT_PENDING and the server follows Go's record.
for (const [race, answer, status, writes] of [
  ["approved", approve(true), "applied", 1],
  ["rejected", approve(true), "rejected_by_owner", 0],
  ["completed", approve(true), "applied", 0],
  ["approved", approve(false), "applied", 1],
  ["rejected", approve(false), "rejected_by_owner", 0],
  ["completed", approve(false), "applied", 0],
] as const)
  test(`write, ACTION_NOT_PENDING race (${race}, client says ${answer().content.approve}): ${status}`, async () => {
    const { connect, fake } = await setup();
    fake.state.race = race;
    const client = await connect(await token(), answer);
    const result = await client.callTool({ name: "adjust_stock", arguments: adjustArgs });
    assert.equal((result.structuredContent as { status: string }).status, status);
    if (race === "completed") assert.match(text(result), /Already applied/);
    assert.equal(mutations(fake.state.calls).length, writes);
    const [action] = [...fake.state.actions.values()];
    for (const write of mutations(fake.state.calls))
      assert.equal(write.headers.get("idempotency-key"), action!.id);
    await client.close();
  });

test("get_stock_movements sends Go's exact kind value; other values are refused", async () => {
  const { connect, fake } = await setup();
  const client = await connect(await token());
  for (const kind of ["in", "out", "adjustment", "return", "transfer"]) {
    const result = await client.callTool({ name: "get_stock_movements", arguments: { kind } });
    assert.ok(!result.isError, kind);
    const call = fake.state.calls.filter((c) => c.url.includes("/v1/stock-movements")).at(-1)!;
    assert.equal(new URL(call.url).searchParams.get("kind"), kind);
  }
  const bad = await client.callTool({ name: "get_stock_movements", arguments: { kind: "sale" } });
  assert.equal(bad.isError, true);
  await client.close();
});

test("resources: an unknown or malformed product is resource-not-found", async () => {
  const { connect } = await setup();
  const client = await connect(await token());
  for (const id of ["44444444-4444-4444-8444-444444444444", "not-a-uuid"]) {
    const uri = `openstock://products/${id}`;
    const error = (await client.readResource({ uri }).catch((e: Error) => e)) as Error & {
      code?: number;
      data?: { uri?: string };
    };
    assert.ok(error instanceof Error, id);
    // The 2026-07-28 spec answers an unknown resource with INVALID_PARAMS and data.uri.
    assert.equal(error.code, -32602, id);
    assert.equal(error.data?.uri, uri);
    assert.match(error.message, /Resource not found/);
    assert.ok(error.message.includes(uri), error.message);
  }
  await client.close();
});

test("resources: lists cut at the cap say so; short lists do not", async () => {
  const { connect, fake } = await setup();
  const client = await connect(await token());
  const read = async (uri: string) =>
    JSON.parse(
      ((await client.readResource({ uri })) as { contents: { text: string }[] }).contents[0]!.text,
    );
  fake.state.many = 51;
  const reference = await read("openstock://reference");
  assert.equal(reference.warehouses.length, 50);
  assert.deepEqual(reference.truncated, ["warehouses"]);
  assert.match(reference.note, /capped at 50/);
  const listed = (await client.listResources()) as { resources: { uri: string }[] };
  assert.equal(
    listed.resources.filter((r) => r.uri.startsWith("openstock://products/")).length,
    50,
  );
  const templates = await client.listResourceTemplates();
  assert.match(templates.resourceTemplates[0]!.description ?? "", /at most 50/);
  await client.close();
  // A fresh client: the first one may serve the cached read.
  fake.state.many = 3;
  const other = await connect(await token());
  const short = JSON.parse(
    (
      (await other.readResource({ uri: "openstock://reference" })) as {
        contents: { text: string }[];
      }
    ).contents[0]!.text,
  );
  assert.deepEqual(short.truncated, []);
  await other.close();
});

test("an unreachable Go API is a plain tool error without internals", async () => {
  const ctx = await setup({
    wrap: (base) => async (input, init) => {
      if (String(input instanceof Request ? input.url : input).startsWith("http://api.test"))
        throw new TypeError("connect ECONNREFUSED 10.0.0.5:8087");
      return base(input, init);
    },
  });
  const client = await ctx.connect(await token());
  const result = await client.callTool({ name: "list_low_stock", arguments: {} });
  assert.equal(result.isError, true);
  assert.ok(!text(result).includes("10.0.0.5"));
  assert.match(text(result), /did not respond/);
  await client.close();
});
