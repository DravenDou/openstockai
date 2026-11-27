import assert from "node:assert/strict";
import { test } from "node:test";
import {
  estimateCostUsd,
  LlmConfigError,
  llmConfig,
  llmConfigProblem,
  llmPublicInfo,
} from "../src/ai/config";
import { createLanguageModel, llmModel } from "../src/ai/model";

test("openai-compatible is the default provider and needs a key for remote hosts", () => {
  const config = llmConfig({
    LLM_BASE_URL: "https://api.deepinfra.com/v1/openai",
    LLM_API_KEY: "k",
    LLM_MODEL: "deepseek-ai/DeepSeek-V4-Flash",
  });
  assert.equal(config.provider, "openai-compatible");
  assert.equal(config.baseURL, "https://api.deepinfra.com/v1/openai");
  assert.match(
    llmConfigProblem({ LLM_BASE_URL: "https://openrouter.ai/api/v1", LLM_MODEL: "m" }) ?? "",
    /LLM_API_KEY is required/,
  );
});

test("openai-compatible defaults to the OpenAI base URL", () => {
  const config = llmConfig({ LLM_API_KEY: "k", LLM_MODEL: "gpt-x" });
  assert.equal(config.baseURL, "https://api.openai.com/v1");
});

test("local OpenAI-compatible endpoints may omit the key", () => {
  for (const baseURL of [
    "http://localhost:1234/v1",
    "http://127.0.0.1:8000/v1",
    "http://host.docker.internal:1234/v1",
    "http://vllm:8000/v1",
  ])
    assert.equal(llmConfigProblem({ LLM_BASE_URL: baseURL, LLM_MODEL: "m" }), undefined, baseURL);
});

test("ollama defaults to the compose service and needs no key", () => {
  const config = llmConfig({ LLM_PROVIDER: "ollama", LLM_MODEL: "qwen3:8b" });
  assert.equal(config.provider, "ollama");
  assert.equal(config.baseURL, "http://ollama:11434/v1");
  assert.equal(config.apiKey, undefined);
  const model = createLanguageModel(config);
  assert.equal(model.modelId, "qwen3:8b");
  assert.equal(model.provider, "ollama.chat");
});

test("anthropic requires a key and uses the native provider", () => {
  assert.match(
    llmConfigProblem({ LLM_PROVIDER: "anthropic", LLM_MODEL: "claude-sonnet-5-5" }) ?? "",
    /anthropic/,
  );
  const config = llmConfig({
    LLM_PROVIDER: "anthropic",
    LLM_API_KEY: "k",
    LLM_MODEL: "claude-sonnet-5-5",
  });
  assert.equal(config.baseURL, undefined);
  const model = createLanguageModel(config);
  assert.equal(model.modelId, "claude-sonnet-5-5");
  assert.match(model.provider, /^anthropic/);
});

test("openai-compatible uses Chat Completions", () => {
  const model = createLanguageModel(
    llmConfig({ LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "https://x.example/v1" }),
  );
  assert.equal(model.provider, "openai-compatible.chat");
});

test("configuration errors are clear and never echo secrets", () => {
  assert.match(llmConfigProblem({ LLM_API_KEY: "secret-key" }) ?? "", /LLM_MODEL is required/);
  assert.match(
    llmConfigProblem({ LLM_PROVIDER: "gemini", LLM_API_KEY: "secret-key", LLM_MODEL: "m" }) ?? "",
    /LLM_PROVIDER must be one of/,
  );
  assert.match(
    llmConfigProblem({ LLM_BASE_URL: "ftp://x", LLM_API_KEY: "k", LLM_MODEL: "m" }) ?? "",
    /LLM_BASE_URL/,
  );
  assert.match(
    llmConfigProblem({
      LLM_BASE_URL: "https://user:pw@x.example/v1",
      LLM_API_KEY: "k",
      LLM_MODEL: "m",
    }) ?? "",
    /without credentials/,
  );
  assert.match(
    llmConfigProblem({ LLM_API_KEY: "k", LLM_MODEL: "m", LLM_PRICE_INPUT_PER_MTOK: "free" }) ?? "",
    /LLM_PRICE_INPUT_PER_MTOK/,
  );
  assert.equal(
    JSON.stringify(llmPublicInfo({ LLM_API_KEY: "secret-key", LLM_MODEL: "m" })).includes("secret"),
    false,
  );
});

test("llmModel reports a missing configuration as AI_NOT_CONFIGURED", () => {
  assert.throws(
    () => llmModel({}, { LLM_MODEL: "m" }),
    (error: Error & { code?: string }) =>
      error.code === "AI_NOT_CONFIGURED" && /LLM_API_KEY/.test(error.message),
  );
});

test("cost estimates need configured prices", () => {
  const prices = { priceInputPerMTok: 0.5, priceOutputPerMTok: 2 };
  assert.equal(estimateCostUsd(prices, { inputTokens: 2_000_000, outputTokens: 500_000 }), 2);
  assert.equal(estimateCostUsd(prices, { inputTokens: null, outputTokens: null }), null);
  assert.equal(
    estimateCostUsd(
      { priceInputPerMTok: null, priceOutputPerMTok: null },
      { inputTokens: 10, outputTokens: 10 },
    ),
    null,
  );
  assert.equal(
    llmConfig({ LLM_API_KEY: "k", LLM_MODEL: "m", LLM_PRICE_OUTPUT_PER_MTOK: "3.5" })
      .priceOutputPerMTok,
    3.5,
  );
});

test("anthropic rejects the OpenAI-compatible preset endpoints so the key is never leaked", () => {
  const anthropic = {
    LLM_PROVIDER: "anthropic",
    LLM_API_KEY: "sk-secret-123",
    LLM_MODEL: "claude-sonnet-5-5",
  };
  const cases: [string, string][] = [
    ["https://api.deepinfra.com/v1/openai", "DeepInfra"],
    ["https://openrouter.ai/api/v1", "OpenRouter"],
    ["https://api.openai.com/v1", "OpenAI"],
    ["https://api.deepinfra.com/v1/openai/", "DeepInfra"],
    ["https://API.DeepInfra.com/v1/openai", "DeepInfra"],
    ["https://OPENROUTER.AI/api/v1/", "OpenRouter"],
  ];
  for (const [baseURL, name] of cases) {
    const problem = llmConfigProblem({ ...anthropic, LLM_BASE_URL: baseURL });
    assert.match(
      problem ?? "",
      new RegExp(`points at the ${name} OpenAI-compatible endpoint`),
      baseURL,
    );
    assert.match(problem ?? "", /LLM_PROVIDER=anthropic/);
    assert.doesNotMatch(problem ?? "", /sk-secret/);
    assert.throws(() => llmConfig({ ...anthropic, LLM_BASE_URL: baseURL }), LlmConfigError);
  }
});

test("anthropic still accepts a custom proxy URL or no base URL", () => {
  const anthropic = { LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_MODEL: "claude-sonnet-5-5" };
  for (const baseURL of [
    "https://gateway.example.com/anthropic",
    "https://api.anthropic.com/v1",
    "https://api.deepinfra.com/v1/other",
    "http://localhost:4000",
  ])
    assert.equal(llmConfigProblem({ ...anthropic, LLM_BASE_URL: baseURL }), undefined, baseURL);
  assert.equal(llmConfigProblem(anthropic), undefined);
  assert.equal(llmConfig(anthropic).baseURL, undefined);
});

test("openai-compatible still accepts every preset endpoint", () => {
  for (const baseURL of [
    "https://api.deepinfra.com/v1/openai",
    "https://openrouter.ai/api/v1",
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
  ])
    assert.equal(
      llmConfigProblem({ LLM_BASE_URL: baseURL, LLM_API_KEY: "k", LLM_MODEL: "m" }),
      undefined,
      baseURL,
    );
});

test("llmModel turns the anthropic preset mismatch into AI_NOT_CONFIGURED before any model is built", () => {
  assert.throws(
    () =>
      llmModel(
        {},
        {
          LLM_PROVIDER: "anthropic",
          LLM_API_KEY: "k",
          LLM_MODEL: "m",
          LLM_BASE_URL: "https://api.deepinfra.com/v1/openai",
        },
      ),
    (error: { code?: string; message: string }) =>
      error.code === "AI_NOT_CONFIGURED" && /DeepInfra/.test(error.message),
  );
});

test("provider errors are logged sanitized without secrets or request bodies", async () => {
  const { APICallError } = await import("ai");
  const { aiError } = await import("../src/ai/errors");
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    const error = new APICallError({
      message: "raw",
      url: "https://api.anthropic.com/v1/messages?key=secret",
      requestBodyValues: { prompt: "SECRET-PROMPT" },
      statusCode: 400,
      responseHeaders: { "x-api-key": "sk-secret" },
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "x".repeat(900) },
      }),
    });
    assert.equal(aiError(error).code, "AI_PROVIDER_MODEL");
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /api\.anthropic\.com/);
  assert.match(lines[0], /invalid_request_error/);
  assert.match(lines[0], /400/);
  assert.doesNotMatch(lines[0], /secret|SECRET|sk-/);
  assert.ok(lines[0].length < 700);
});

test("anthropic asks the API to drop mismatched thinking blocks; other providers are untouched", async () => {
  const { anthropicThinkingBindingMiddleware } = await import("../src/ai/model");
  const mw = anthropicThinkingBindingMiddleware();
  const base = { prompt: [], providerOptions: { anthropic: { effort: "low" }, other: { a: 1 } } };
  const out = await mw.transformParams!({ type: "stream", params: base, model: {} as never });
  assert.deepEqual(out.providerOptions, {
    anthropic: {
      effort: "low",
      thinking: { type: "adaptive", blockBinding: { prefixMismatchBehavior: "drop_block" } },
    },
    other: { a: 1 },
  });
  const explicit = await mw.transformParams!({
    type: "stream",
    params: { prompt: [], providerOptions: { anthropic: { thinking: { type: "disabled" } } } },
    model: {} as never,
  });
  assert.equal(
    (explicit.providerOptions as { anthropic: { thinking: { type: string } } }).anthropic.thinking
      .type,
    "disabled",
  );
  // Non-anthropic models are not wrapped, so no anthropic options are ever injected.
  const ollama = createLanguageModel(llmConfig({ LLM_PROVIDER: "ollama", LLM_MODEL: "q" }));
  assert.equal(ollama.provider, "ollama.chat");
});

test("thinking binding applies only to models with preserved thinking", async () => {
  const { preservedThinkingModel } = await import("../src/ai/model");
  for (const m of [
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-fable-5-1",
    "claude-fable-5-2",
    "claude-mythos-5-1",
    "claude-mythos-5-2",
  ])
    assert.ok(preservedThinkingModel.test(m), m);
  for (const m of [
    "claude-haiku-4-5",
    "claude-sonnet-4-6",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5",
  ])
    assert.ok(!preservedThinkingModel.test(m), m);
  const wrapped = (model: string) =>
    createLanguageModel(
      llmConfig({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_MODEL: model }),
    );
  // Wrapped models expose the wrapper; unwrapped ones are the bare Anthropic model.
  assert.notEqual(wrapped("claude-haiku-5-5").constructor, wrapped("claude-haiku-4-5").constructor);
  assert.equal(wrapped("claude-sonnet-5-5").modelId, "claude-sonnet-5-5");
  assert.equal(wrapped("claude-opus-5").modelId, "claude-opus-5");
  for (const provider of ["ollama"])
    assert.equal(
      createLanguageModel(llmConfig({ LLM_PROVIDER: provider, LLM_MODEL: "q" })).provider,
      "ollama.chat",
    );
  const oa = createLanguageModel(llmConfig({ LLM_API_KEY: "k", LLM_MODEL: "gpt-x" }));
  assert.match(oa.provider, /chat/);
});
