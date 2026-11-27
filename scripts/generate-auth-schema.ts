import { loadEnvConfig } from "@next/env";
import { writeFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
loadEnvConfig(process.cwd());
async function main() {
const { getAuth, authDatabase } = await import("../apps/web/src/server/auth");
const db = authDatabase();
try {
const plan = await getMigrations(getAuth().options);
if (plan.unsafeChanges.length || plan.schemaProblems.length) throw new Error("Review the Better Auth migration before applying it.");
const sql = (await plan.compileMigrations())
  .replace(/create table "([^"]+)"/g, 'create table auth."$1"')
  .replace(/alter table "([^"]+)"/g, 'alter table auth."$1"')
  .replace(/references "([^"]+)"/g, 'references auth."$1"')
  .replace(/ on "([^"]+)"/g, ' on auth."$1"');
if (!sql.replace(/[;\s]/g, "")) {console.info("Better Auth schema is current.");return;}
if (process.argv[2] === "--check") { console.info(sql); process.exitCode = 1; return; }
const filename=process.argv[2]||"00001_auth.sql";
if(!/^\d{5}_auth(?:_[a-z_]+)?\.sql$/.test(filename))throw new Error("Use a versioned name, for example 00004_auth_rate_limit.sql.");
await writeFile(`apps/api/db/migrations/${filename}`, `-- Generated from Better Auth 1.7.7.\n-- +goose Up\nCREATE SCHEMA IF NOT EXISTS auth;\nSET LOCAL search_path TO auth,public;\n${sql}\n-- +goose Down\n-- +goose StatementBegin\nDO $$ BEGIN RAISE EXCEPTION 'Auth migrations are forward-only; prepare a reviewed recovery migration.'; END $$;\n-- +goose StatementEnd\n`,{flag:"wx"});
console.info(`Generated ${filename}; review it before db:migrate.`);
} finally {await db.end();}
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Schema generation failed"); process.exitCode = 1; });
