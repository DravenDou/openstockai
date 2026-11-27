// Pure LLM configuration parsing. No SDK imports so the web app can validate it cheaply.
export const llmProviders = ["openai-compatible", "anthropic", "ollama"] as const;
export type LlmProvider = (typeof llmProviders)[number];

export type LlmConfig = {
  provider: LlmProvider;
  baseURL: string | undefined;
  apiKey: string | undefined;
  model: string;
  /** USD per million input tokens, when configured. */
  priceInputPerMTok: number | null;
  /** USD per million output tokens, when configured. */
  priceOutputPerMTok: number | null;
};

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

type Env = Record<string, string | undefined>;

export const defaultBaseURL: Record<LlmProvider, string | undefined> = {
  "openai-compatible": "https://api.openai.com/v1",
  anthropic: undefined,
  ollama: "http://ollama:11434/v1",
};

// OpenAI-compatible endpoints shipped as presets in .env.example. An Anthropic key must never
// be sent to them.
const openAiCompatiblePresets = [
  { name: "DeepInfra", url: "https://api.deepinfra.com/v1/openai" },
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { name: "OpenAI", url: "https://api.openai.com/v1" },
] as const;

function endpointKey(url: URL) {
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

function matchedPreset(url: URL) {
  const key = endpointKey(url);
  return openAiCompatiblePresets.find((preset) => endpointKey(new URL(preset.url)) === key);
}

function text(env: Env, key: string) {
  return env[key]?.trim() || undefined;
}

function price(env: Env, key: string) {
  const raw = text(env, key);
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100_000)
    throw new LlmConfigError(`${key} must be a non-negative number (USD per million tokens).`);
  return value;
}

// Hosts that normally run without credentials: loopback, host.docker.internal and
// single-label names such as the "ollama" compose service.
export function isLocalHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "host.docker.internal" ||
    /^127\./.test(host) ||
    !host.includes(".")
  );
}

export function llmConfig(env: Env = process.env): LlmConfig {
  const provider = (text(env, "LLM_PROVIDER") ?? "openai-compatible") as LlmProvider;
  if (!llmProviders.includes(provider))
    throw new LlmConfigError(
      `LLM_PROVIDER must be one of: ${llmProviders.join(", ")} (got "${text(env, "LLM_PROVIDER")}").`,
    );
  const baseURL = text(env, "LLM_BASE_URL") ?? defaultBaseURL[provider];
  if (baseURL !== undefined) {
    const url = URL.parse(baseURL);
    if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password)
      throw new LlmConfigError(
        "LLM_BASE_URL must be an http(s) URL without credentials, for example https://api.openai.com/v1.",
      );
    const preset = provider === "anthropic" ? matchedPreset(url) : undefined;
    if (preset)
      throw new LlmConfigError(
        `LLM_BASE_URL points at the ${preset.name} OpenAI-compatible endpoint, but LLM_PROVIDER=anthropic. Remove or comment out LLM_BASE_URL (the Anthropic provider does not need one) so your Anthropic key is not sent to another provider.`,
      );
  }
  const model = text(env, "LLM_MODEL");
  if (!model)
    throw new LlmConfigError(
      `LLM_MODEL is required for the "${provider}" provider. See the presets in .env.example.`,
    );
  const apiKey = text(env, "LLM_API_KEY");
  const keyOptional =
    provider === "ollama" ||
    (provider === "openai-compatible" && !!baseURL && isLocalHost(new URL(baseURL).hostname));
  if (!apiKey && !keyOptional)
    throw new LlmConfigError(
      provider === "anthropic"
        ? 'LLM_API_KEY is required for the "anthropic" provider.'
        : "LLM_API_KEY is required for this LLM_BASE_URL. Only local endpoints (localhost, host.docker.internal, single-label hosts such as ollama) may omit it.",
    );
  return {
    provider,
    baseURL,
    apiKey,
    model,
    priceInputPerMTok: price(env, "LLM_PRICE_INPUT_PER_MTOK"),
    priceOutputPerMTok: price(env, "LLM_PRICE_OUTPUT_PER_MTOK"),
  };
}

/** Returns the configuration problem as a message, or undefined when it is valid. */
export function llmConfigProblem(env: Env = process.env) {
  try {
    llmConfig(env);
  } catch (error) {
    if (error instanceof LlmConfigError) return error.message;
    throw error;
  }
}

/** Public, secret-free view of the configuration (never includes the API key). */
export function llmPublicInfo(env: Env = process.env) {
  const config = llmConfig(env);
  return {
    provider: config.provider,
    model: config.model,
    priceInputPerMTok: config.priceInputPerMTok,
    priceOutputPerMTok: config.priceOutputPerMTok,
  };
}

/**
 * Estimated cost in USD, or null when no price is configured or usage is unknown.
 * Only the side with a configured price contributes when the other is missing.
 */
export function estimateCostUsd(
  prices: { priceInputPerMTok: number | null; priceOutputPerMTok: number | null },
  usage: { inputTokens: number | null; outputTokens: number | null },
) {
  const parts: number[] = [];
  if (prices.priceInputPerMTok !== null && usage.inputTokens !== null)
    parts.push((usage.inputTokens * prices.priceInputPerMTok) / 1_000_000);
  if (prices.priceOutputPerMTok !== null && usage.outputTokens !== null)
    parts.push((usage.outputTokens * prices.priceOutputPerMTok) / 1_000_000);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}
