import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
// Workspace packages ship TypeScript source, so they are bundled instead of left external.
const workspace = {
  "@openstockai/api-client": resolve("../../packages/api-client/src"),
};
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
// Compile the real client component as ESM: Streamdown intentionally has no CJS export.
await build({
  entryPoints: ["src/features/assistant/components/chat-message.tsx"],
  outfile: ".cache/chat-render.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  alias: { "next/link": "next/link.js", ...workspace },
  logLevel: "error",
});
const { ChatMessage } = await import("../.cache/chat-render.mjs");
await build({
  entryPoints: ["src/features/assistant/components/approval-card.tsx"],
  outfile: ".cache/approval-render.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  alias: workspace,
  logLevel: "error",
});
const { ApprovalCard } = await import("../.cache/approval-render.mjs");

test("movement approvals display English names while retaining internal tool values", () => {
  for (const [type, label] of [
    ["purchase", "Purchase"],
    ["adjustment_in", "Adjustment in"],
    ["return_in", "Customer return"],
  ]) {
    const input = {
      interactionId: "interaction-test",
      call: { callId: "call-test", name: "adjustStock", input: { type, quantity: 100 } },
      request: {
        kind: "approval",
        prompt: "Confirm the movement",
        options: [{ id: "approve", label: "approve" }],
      },
    };
    const html = renderToStaticMarkup(
      createElement(ApprovalCard, { input, onRespond: async () => {} }),
    );
    assert(html.includes(">Movement</dt>"));
    assert(html.includes(`>${label}</dd>`));
    assert(!html.includes(type));
    assert.match(html, /Approve/);
    assert.equal(input.call.input.type, type);
  }
});

test("destructive approvals are visibly marked and use a specific confirm label", () => {
  const input = {
    interactionId: "interaction-test",
    call: {
      callId: "call-test",
      name: "deleteSupplier",
      input: { id: "550e8400-e29b-41d4-a716-446655440003" },
    },
    request: {
      kind: "approval",
      prompt: "Delete this supplier?",
      options: [
        { id: "approve", label: "approve" },
        { id: "deny", label: "deny" },
      ],
    },
  };
  const html = renderToStaticMarkup(
    createElement(ApprovalCard, { input, onRespond: async () => {} }),
  );
  assert.match(html, /Destructive/);
  assert.match(html, /Delete supplier/);
  assert.match(html, /Reject/);
  assert.match(html, /border-destructive/);
});

test("a failed assistant turn with no text renders its actionable error instead of an empty bubble", () => {
  const message = {
    id: "assistant",
    role: "assistant",
    metadata: { turnId: "turn_0" },
    parts: [{ type: "step-start" }],
  };
  const html = renderToStaticMarkup(
    createElement(ChatMessage, {
      message,
      sessionId: "conversation",
      failure: {
        code: "MODEL_CALL_FAILED",
        message: "Your account cannot use the assistant right now.",
      },
    }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /cannot use the assistant right now/);
  assert.match(html, /href="\/agent-runs"/);
});

test("assistant Markdown renders headings, emphasis and tables while rejecting HTML and unsafe URLs", () => {
  const message = {
    id: "assistant",
    role: "assistant",
    parts: [
      {
        type: "text",
        state: "done",
        text: '## Inventory\n\n**Stock:** 5 kg\n\n| Product | Stock |\n| --- | --- |\n| Rice | 5 |\n\n<img src="https://example.test/track"><script>alert(1)</script>\n[link](javascript:alert(1))',
      },
    ],
  };
  const html = renderToStaticMarkup(createElement(ChatMessage, { message }));
  assert.match(html, /<h2[^>]*>Inventory/);
  assert.match(html, /<strong[^>]*>Stock:/);
  assert.match(html, /<table/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/i);
});

test("a domain failure returned by a tool is visible as Error, with trace input and call ID", () => {
  const message = {
    id: "assistant",
    role: "assistant",
    parts: [
      {
        type: "tool",
        name: "adjustStock",
        callId: "call-test",
        kind: "tool",
        label: "adjustStock",
        stepIndex: 0,
        state: "completed",
        input: { quantity: 0.5 },
        output: { ok: false, error: { message: "Insufficient stock" } },
      },
    ],
  };
  const html = renderToStaticMarkup(createElement(ChatMessage, { message }));
  assert.match(html, /Insufficient stock/);
  assert.match(html, /call-test/);
  assert.match(html, /Parameters/);
  assert.doesNotMatch(html, /Completed/);
});
