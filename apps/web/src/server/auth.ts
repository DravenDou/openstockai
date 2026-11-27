import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";
import { serverEnv } from "@openstockai/server/env";

const databaseGlobal = globalThis as typeof globalThis & { openstockAuthPool?: Pool };
export function authDatabase() {
  return (databaseGlobal.openstockAuthPool ??= new Pool({
    connectionString: serverEnv().AUTH_DATABASE_URL || serverEnv().DATABASE_URL,
    options:
      "-c search_path=auth,public -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000",
    max: serverEnv().AUTH_DB_MAX_CONNECTIONS,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    maxLifetimeSeconds: 1800,
    application_name: "openstockai-auth",
  }));
}
export async function ownerExists() {
  const result = await authDatabase().query(`SELECT 1 FROM auth."user" LIMIT 1`);
  return result.rowCount !== 0;
}
function createAuth() {
  const env = serverEnv();
  return betterAuth({
    appName: "OpenStock AI",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: authDatabase(),
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    rateLimit: { enabled: true, window: 60, max: 60, storage: "database" },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: {
        create: {
          // Single-owner app: the first sign-up creates the owner, every later one is
          // rejected. A unique index on auth."user" ((true)) backs this against races.
          before: async () => {
            if (await ownerExists())
              throw new APIError("FORBIDDEN", {
                code: "SIGNUP_CLOSED",
                message: "An owner account already exists. Sign-up is closed.",
              });
          },
        },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: new URL(env.BETTER_AUTH_URL).protocol === "https:",
      // The local origin is directly reachable. Forwarded headers are not
      // authenticated; use Better Auth's shared per-path bucket until an
      // exclusive, trusted ingress is configured for a hosted deployment.
      ipAddress: { ipAddressHeaders: [] },
    },
    plugins: [
      jwt({
        jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
        jwt: {
          issuer: env.BETTER_AUTH_URL,
          audience: env.JWT_AUDIENCE,
          expirationTime: "5m",
          definePayload: ({ user, session }) => ({ sub: user.id, sid: session.id }),
        },
      }),
      nextCookies(),
    ],
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
