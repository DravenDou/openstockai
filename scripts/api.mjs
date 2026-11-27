import nextEnv from '@next/env';
import { spawn } from 'node:child_process';
import path from 'node:path';
nextEnv.loadEnvConfig(process.cwd());
const root = process.cwd();
const args = process.argv.slice(2);
const command = args[0] === 'test' ? ['test', './...', '-count=1', ...args.slice(1)] : ['run', './cmd/api', ...args];
const child = spawn('go', command, {
  cwd: path.join(root, 'apps/api'), stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: args.includes('--migrate') || args.includes('--provision') || args[0] === 'test' ? process.env.DATABASE_URL : process.env.API_DATABASE_URL || process.env.DATABASE_URL, GOPATH: path.join(root, '.cache/go'), GOCACHE: path.join(root, '.cache/gocache') },
});
child.on('error', () => { console.error('Go is not available on PATH.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
