#!/usr/bin/env node
// Cross-platform `VAR=value node ...` for the npm scripts, with no dependencies.
// usage: node scripts/run.mjs [NAME=value ...] <node arguments...>
// Leading NAME=value arguments become environment variables; the rest go to this same Node binary, with no
// shell in between, so a glob such as "test/**/*.test.ts" reaches `node --test` as is on macOS, Linux and Windows.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const env = { ...process.env };
while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
  const a = args.shift();
  const i = a.indexOf('=');
  env[a.slice(0, i)] = a.slice(i + 1);
}
if (!args.length) {
  console.error('usage: node scripts/run.mjs [NAME=value ...] <node arguments...>');
  process.exit(2);
}

const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
// Ctrl+C reaches the child directly from the terminal; forward the signals a process manager might send.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  try { process.on(sig, () => { if (child.exitCode === null) child.kill(sig); }); } catch { /* not supported on this platform */ }
}
child.on('error', (e) => { console.error(e.message); process.exit(1); });
child.on('exit', (code, signal) => { process.exit(code ?? (signal ? 1 : 0)); });
