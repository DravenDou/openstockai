import { z } from "zod";

const httpURL = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = URL.parse(value);
  return !!url && !url.username && !url.password && !url.hash && !url.search;
});
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
// The protected resource identifier of the MCP server (RFC 8707 / 9728). Better Auth requires
// HTTPS, with plain HTTP accepted only on loopback hosts for local use.
const resourceURL = httpURL.refine((value) => {
  const url = URL.parse(value);
  return !!url && (url.protocol === "https:" || loopbackHosts.has(url.hostname));
});
const databaseURL = z.url({ protocol: /^postgres(ql)?$/ });
const schema = z.object({
  DATABASE_URL: databaseURL,
  AUTH_DATABASE_URL: databaseURL.optional(),
  AUTH_DB_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(64).default(10),
  BETTER_AUTH_URL: httpURL.refine((value) => URL.parse(value)?.pathname === "/"),
  BETTER_AUTH_SECRET: z.string().min(32),
  API_BASE_URL: httpURL,
  JWT_AUDIENCE: z.string().min(1).default("openstockai-api"),
  AGENT_SERVICE_SECRET: z.string().min(32),
  EVE_BASE_URL: httpURL.default("http://127.0.0.1:4273"),
  MCP_RESOURCE_URL: resourceURL.default("http://localhost:3100/mcp"),
  // Optional: unset (or empty) disables the MCP path. When set it must be a real secret.
  MCP_SERVICE_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32).optional(),
  ),
});
export function serverEnv(values: Record<string, string | undefined> = process.env) {
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    // Zod errors can contain user input. Report variable names only.
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid configuration: ${keys.join(", ")}. Check .env and .env.example.`);
  }
  return parsed.data;
}
