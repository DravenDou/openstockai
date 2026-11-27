import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const binary=path.resolve('.tools',process.platform==='win32'?'sqlc.exe':'sqlc');
const command=fs.existsSync(binary)?binary:'sqlc';
const child=spawn(command,['generate','-f','apps/api/sqlc.yaml'],{stdio:'inherit'});
child.on('error',()=>{console.error('Install a reviewed sqlc 1.31.1 build in .tools or on PATH.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
