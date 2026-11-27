import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { APIError } from "@openstockai/api-client/client";
import { aiError } from "./errors";

export type ModelContext = {
  allowedToolNames?: readonly string[];
};
export function inputTokenLimit() {
  return positiveEnv("AI_MAX_INPUT_TOKENS", 65_536, 1_000_000);
}
export function stepLimit() {
  return positiveEnv("AI_MAX_STEPS_PER_TURN", 8, 32);
}
function positiveEnv(key: string, fallback: number, ceiling: number) {
  const value = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
    throw new Error(`Invalid configuration: ${key}.`);
  return value;
}
const failedFinish = ["error", "other", "content-filter"];
function finishError(reason: string) {
  if (reason === "length")
    return new APIError(
      "AI_OUTPUT_TRUNCATED",
      "The response hit the output limit. The result was not confirmed; check the history before continuing.",
      502,
    );
  if (failedFinish.includes(reason))
    return new APIError(
      "AI_INVALID_RESPONSE",
      "The provider did not complete a valid response.",
      502,
    );
}
function sanitize(error: unknown, signal?: AbortSignal) {
  const safe = aiError(error, signal);
  if (APICallError.isInstance(error) && error.isRetryable && error.statusCode !== 429)
    return new APICallError({
      message: safe.message,
      url: "https://llm.invalid/chat/completions",
      requestBodyValues: undefined,
      statusCode: error.statusCode,
      isRetryable: true,
    });
  return safe;
}

// Per-call limits applied at the provider boundary, including retries and compaction.
export function limitsMiddleware(ctx: ModelContext = {}): LanguageModelMiddleware {
  function check(
    params: Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0]["params"],
  ) {
    if (params.abortSignal?.aborted) throw aiError(params.abortSignal.reason, params.abortSignal);
    let image = false;
    const serialized =
      JSON.stringify({ prompt: params.prompt, tools: params.tools }, (_key, value) => {
        if (value?.type === "image" || value?.type === "file") {
          image = true;
          return { type: value.type };
        }
        return value;
      }) ?? "null";
    // UTF-8 bytes overestimate ordinary text tokens; media reserves the full budget.
    const input = image ? inputTokenLimit() : Buffer.byteLength(serialized, "utf8") + 1024;
    if (input > inputTokenLimit())
      throw new APIError(
        "AI_INPUT_LIMIT",
        "The context exceeds the AI input limit. Start a shorter conversation.",
        422,
      );
  }
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => ({
      ...params,
      // Advertising is an optimization. Eve retains durable executors and Go
      // still authorizes every call, including guessed names and parked writes.
      tools: ctx.allowedToolNames
        ? params.tools?.filter((tool) => ctx.allowedToolNames!.includes(tool.name))
        : params.tools,
      maxOutputTokens: Math.min(
        params.maxOutputTokens || Infinity,
        positiveEnv("AI_MAX_OUTPUT_TOKENS", 2048, 32_768),
      ),
      abortSignal: AbortSignal.any([
        ...(params.abortSignal ? [params.abortSignal] : []),
        AbortSignal.timeout(120_000),
      ]),
    }),
    async wrapGenerate({ doGenerate, params }) {
      check(params);
      try {
        const response = await doGenerate();
        const failure = finishError(response.finishReason.unified);
        if (failure) throw failure;
        return response;
      } catch (error) {
        throw sanitize(error, params.abortSignal);
      }
    },
    async wrapStream({ doStream, params }) {
      check(params);
      try {
        const response = await doStream();
        const reader = response.stream.getReader();
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const part = await reader.read();
              if (part.done) {
                controller.close();
                return;
              }
              if (part.value.type === "error") throw aiError(part.value.error, params.abortSignal);
              if (part.value.type === "finish") {
                const failure = finishError(part.value.finishReason.unified);
                if (failure) throw failure;
              }
              controller.enqueue(part.value);
            } catch (error) {
              await reader.cancel().catch(() => undefined);
              controller.error(aiError(error, params.abortSignal));
            }
          },
          async cancel(reason) {
            await reader.cancel(reason).catch(() => undefined);
          },
        });
        return { ...response, stream };
      } catch (error) {
        throw sanitize(error, params.abortSignal);
      }
    },
  };
}

// The generic provider layer (OpenAI-compatible, Anthropic, Ollama) arrives in a later milestone.
export function deepInfraModel(ctx: ModelContext = {}) {
  if (!process.env.DEEPINFRA_API_KEY?.trim())
    throw new APIError(
      "AI_NOT_CONFIGURED",
      "Set DEEPINFRA_API_KEY in .env and restart the services.",
      503,
    );
  return wrapLanguageModel({
    model: createOpenAI({
      apiKey: process.env.DEEPINFRA_API_KEY,
      baseURL: "https://api.deepinfra.com/v1/openai",
      name: "deepinfra",
    }).chat(process.env.AI_MODEL || "deepseek-ai/DeepSeek-V4-Flash-0731"),
    middleware: limitsMiddleware(ctx),
  });
}
