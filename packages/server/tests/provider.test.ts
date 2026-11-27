import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCostUsd, llmConfig, llmConfigProblem, llmPublicInfo } from "../src/ai/config";
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
