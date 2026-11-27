import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { parseEnv } from "node:util";

const template = parseEnv(readFileSync(".env.example", "utf8"));
let current = existsSync(".env")
  ? readFileSync(".env", "utf8")
  : "# Private local configuration for OpenStock AI\n";
const values = parseEnv(current);
function put(key, value) {
  values[key] = value;
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "m");
  current = pattern.test(current)
    ? current.replace(pattern, () => line)
    : `${current.trimEnd()}\n${line}\n`;
}
function ensure(key, value) {
  if (!(key in values)) put(key, value);
}
const secret = () => randomBytes(32).toString("hex");
function databaseURL(value, key) {
  try {
    const url = new URL(value);
    if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error();
    return url;
  } catch {
    console.error(`Invalid configuration: ${key}. Check .env without sharing its values.`);
    process.exit(1);
  }
}
// A copied template is not an existing private credential. Replace its paired
// placeholders together, preserving custom URLs/passwords in every other case.
if (values.POSTGRES_PASSWORD === "change-me" && values.DATABASE_URL === template.DATABASE_URL) {
  put("POSTGRES_PASSWORD", secret());
  put(
    "DATABASE_URL",
    `postgresql://openstockai:${values.POSTGRES_PASSWORD}@localhost:${values.POSTGRES_PORT || template.POSTGRES_PORT}/openstockai?sslmode=disable`,
  );
}
const existingURL = values.DATABASE_URL
  ? databaseURL(values.DATABASE_URL, "DATABASE_URL")
  : undefined;
if (!values.POSTGRES_PASSWORD)
  put("POSTGRES_PASSWORD", existingURL ? decodeURIComponent(existingURL.password) : secret());
for (const key of ["BETTER_AUTH_SECRET", "AGENT_SERVICE_SECRET"])
  if (!values[key]) put(key, secret());
for (const key of ["WEB_PORT", "API_PORT", "POSTGRES_PORT"]) ensure(key, template[key]);
ensure(
  "DATABASE_URL",
  `postgresql://openstockai:${encodeURIComponent(values.POSTGRES_PASSWORD)}@localhost:${values.POSTGRES_PORT}/openstockai?sslmode=disable`,
);
ensure("BETTER_AUTH_URL", `http://localhost:${values.WEB_PORT}`);
ensure("BETTER_AUTH_JWKS_URL", `${values.BETTER_AUTH_URL}/api/auth/jwks`);
ensure("JWT_ISSUER", values.BETTER_AUTH_URL);
ensure("API_BASE_URL", `http://127.0.0.1:${values.API_PORT}`);
ensure("API_ADDR", `127.0.0.1:${values.API_PORT}`);
for (const [kind, login] of [
  ["API", "openstock_api_login"],
  ["AUTH", "openstock_auth_login"],
]) {
  const passwordKey = `${kind}_DATABASE_PASSWORD`,
    urlKey = `${kind}_DATABASE_URL`;
  const previous = values[urlKey] ? databaseURL(values[urlKey], urlKey) : undefined;
  if (!values[passwordKey])
    put(passwordKey, previous ? decodeURIComponent(previous.password) : secret());
  if (!values[urlKey]) {
    const url = databaseURL(values.DATABASE_URL, "DATABASE_URL");
    url.username = login;
    url.password = values[passwordKey];
    put(urlKey, String(url));
  }
}
// Fill every template key, including intentionally blank optional values. Existing
// keys, models, quoted passwords and custom URLs remain exactly as entered.
for (const [key, value] of Object.entries(template)) ensure(key, value);
writeFileSync(".env", current.endsWith("\n") ? current : `${current}\n`, { mode: 0o600 });
chmodSync(".env", 0o600);
console.log(
  ".env complete; existing values kept, permissions 0600. Set the AI provider key if missing.",
);
