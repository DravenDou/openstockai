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
