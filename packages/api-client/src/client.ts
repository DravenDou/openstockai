import { z } from "zod";
import { validateResponse } from "./contract";
import type { paths, components } from "./generated.ts";
export type Schemas = components["schemas"];
type Methods = "get" | "post" | "patch" | "delete";
type Body<O> = O extends { requestBody: { content: { "application/json": infer B } } } ? B : never;
type Result<O> = O extends { responses: { 200: { content: { "application/json": infer R } } } }
  ? R
  : never;
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export class APIError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<P extends keyof paths, M extends Methods & keyof paths[P]>(
  path: P,
  method: M,
  options: {
    body?: Body<NonNullable<paths[P][M]>>;
    id?: string;
    baseURL?: string;
    headers?: HeadersInit;
    key?: string;
    query?: Record<string, string | number>;
    signal?: AbortSignal;
    // Injected transport for server-side callers and tests; defaults to the global fetch.
    fetch?: typeof fetch;
  } = {},
): Promise<Result<NonNullable<paths[P][M]>>> {
  const target = path.replace("{id}", encodeURIComponent(options.id || ""));
  const params = new URLSearchParams(
    Object.entries(options.query || {}).map(([k, v]) => [k, String(v)]),
  );
  const url = options.baseURL
    ? `${options.baseURL}${target}`
    : `/api/backend${target.replace(/^\/v1/, "")}`;
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (method !== "get") headers.set("Idempotency-Key", options.key || crypto.randomUUID());
  const response = await (options.fetch ?? fetch)(`${url}${params.size ? `?${params}` : ""}`, {
    method: method.toUpperCase(),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: options.signal,
    redirect: "error",
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = errorSchema.safeParse(data);
    throw new APIError(
      error.success ? error.data.error.code : "API_ERROR",
      error.success ? error.data.error.message : "The operation could not be completed.",
      response.status,
    );
  }
  try {
    return validateResponse(`${method.toUpperCase()} ${path}`, data) as Result<
      NonNullable<paths[P][M]>
    >;
  } catch {
    throw new APIError(
      "INVALID_RESPONSE",
      "The server returned data that does not match the contract. Do not repeat writes; refresh the view.",
      502,
    );
  }
}
