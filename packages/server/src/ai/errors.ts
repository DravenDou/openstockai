import { APICallError, InvalidResponseDataError, JSONParseError, RetryError } from "ai";
import { APIError } from "@openstockai/api-client/client";

// Provider bodies can contain prompts and credentials; only publish our own messages.
export function aiError(error: unknown, signal?: AbortSignal): APIError {
  if (error instanceof APIError) return error;
  if (RetryError.isInstance(error)) return aiError(error.lastError, signal);
  if (signal?.aborted || (error instanceof Error && /^(Abort|Timeout)Error$/.test(error.name))) {
    const timeout =
      signal?.reason?.name === "TimeoutError" || (error as Error)?.name === "TimeoutError";
    return new APIError(
      timeout ? "AI_TIMEOUT" : "AI_CANCELLED",
      timeout
        ? "The AI took too long to respond. Check the history before retrying."
        : "The AI call was cancelled.",
      timeout ? 504 : 409,
    );
  }
  if (JSONParseError.isInstance(error) || InvalidResponseDataError.isInstance(error))
    return new APIError(
      "AI_INVALID_RESPONSE",
      "The provider returned an invalid response. The result was not confirmed.",
      502,
    );
  if (APICallError.isInstance(error)) {
    if (error.statusCode !== undefined && error.statusCode >= 200 && error.statusCode < 300)
      return new APIError(
        "AI_INVALID_RESPONSE",
        "The provider returned invalid JSON or incompatible data. The result was not confirmed.",
        502,
      );
    if (
      error.statusCode === 402 ||
      /balance|credits?|payment|insufficient funds/i.test(error.responseBody || "")
    )
      return new APIError(
        "AI_PROVIDER_BALANCE",
        "The provider has no available balance. Check your account with the AI provider.",
        503,
      );
    if (error.statusCode === 401 || error.statusCode === 403)
      return new APIError(
        "AI_PROVIDER_AUTH",
        "The provider rejected the API key. Check the server configuration.",
        503,
      );
    if (error.statusCode === 400 || error.statusCode === 404)
      return new APIError(
        "AI_PROVIDER_MODEL",
        "The model or its parameters are not available. Check AI_MODEL and its compatibility.",
        503,
      );
    if (error.statusCode === 429)
      return new APIError(
        "AI_PROVIDER_RATE_LIMIT",
        "The provider is rate limiting calls. Wait a moment before retrying.",
        429,
      );
  }
  return new APIError(
    "AI_PROVIDER_UNAVAILABLE",
    "The AI provider did not respond correctly. Check its status before retrying.",
    503,
  );
}
