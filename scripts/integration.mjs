import nextEnv from '@next/env';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL.');
const name = `openstock_test_${randomBytes(8).toString('hex')}`;
const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const run = (args, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/api.mjs', ...args], { stdio: 'inherit', env });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Go exited with code ${code}`)));
});
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
  const env = { ...process.env, DATABASE_URL: url.toString(), API_DATABASE_URL: url.toString(), AUTH_DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString() };
  await run(['--migrate'], env);
  await run(['test', ...process.argv.slice(2)], env);
} finally {
  // Generated identifier only; never delete the development or production database.
  if (!/^openstock_test_[0-9a-f]{16}$/.test(name)) throw new Error('Invalid test database identifier.');
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
