import { z } from "zod";

const httpURL = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = URL.parse(value);
  return !!url && !url.username && !url.password && !url.hash && !url.search;
});
const secret = z.string().min(32);
const list = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string()).min(1));
const empty = (value: unknown) => (value === "" ? undefined : value);

const schema = z.object({
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  MCP_HOST: z.string().min(1).default("127.0.0.1"),
  // Host names (no ports) the server answers to: DNS rebinding protection.
  MCP_ALLOWED_HOSTS: z.preprocess(empty, list.default(["localhost", "127.0.0.1"])),
  // The protected resource identifier: the `aud` of every access token.
  MCP_RESOURCE_URL: httpURL.default("http://localhost:3100/mcp"),
  // Public issuer of the access tokens (the web app).
  BETTER_AUTH_URL: httpURL,
  // Where the JWKS and the token exchange live; inside compose this is the web container.
  AUTH_INTERNAL_URL: z.preprocess(empty, httpURL.optional()),
  API_BASE_URL: httpURL,
  // Base of the approval links shown to the owner.
  APP_PUBLIC_URL: z.preprocess(empty, httpURL.optional()),
  MCP_SERVICE_SECRET: secret,
  MCP_STATE_SECRET: secret,
});

export type Config = ReturnType<typeof mcpConfig>;
export function mcpConfig(values: Record<string, string | undefined> = process.env) {
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    // Zod errors can echo secrets. Report variable names only.
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid configuration: ${keys.join(", ")}. Check .env.example.`);
  }
  const env = parsed.data;
  const trim = (value: string) => value.replace(/\/+$/, "");
  return {
    port: env.MCP_PORT,
    host: env.MCP_HOST,
    allowedHosts: env.MCP_ALLOWED_HOSTS,
    resourceUrl: env.MCP_RESOURCE_URL,
    issuer: env.BETTER_AUTH_URL,
    authUrl: trim(env.AUTH_INTERNAL_URL ?? env.BETTER_AUTH_URL),
    apiUrl: trim(env.API_BASE_URL),
    appUrl: trim(env.APP_PUBLIC_URL ?? env.BETTER_AUTH_URL),
    serviceSecret: env.MCP_SERVICE_SECRET,
    stateSecret: env.MCP_STATE_SECRET,
  };
}
