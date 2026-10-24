#!/usr/bin/env node
// tool: check-overlap
// does: reports 8-word runs that repo files share with a folder of reference texts (other people's work we must not copy)
// usage: node tools/check-overlap.mjs <reference-dir> [--n 8] [--show] [--max 0]
//
// Text is normalised before comparing: lowercase, punctuation stripped, whitespace collapsed.
// Files checked: every file git tracks plus untracked files that are not ignored.
// If the reference folder is missing, it prints a note and exits 0, so it can run anywhere.
// --show prints each shared run. --max N exits 1 when any file has more than N runs.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const refDir = args.find((a, i) => !a.startsWith('--') && !['--n', '--max'].includes(args[i - 1]));
const N = Number(flag('--n', 8));
const MAX = flag('--max', null);
const SHOW = args.includes('--show');

if (!refDir) {
  console.error('usage: node tools/check-overlap.mjs <reference-dir> [--n 8] [--show] [--max 0]');
  process.exit(2);
}
if (!existsSync(refDir) || !statSync(refDir).isDirectory()) {
  console.log(`check-overlap: reference folder not found (${refDir}); nothing to compare. Skipping.`);
  process.exit(0);
}

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

const grams = (ws) => {
  const out = new Set();
  for (let i = 0; i + N <= ws.length; i++) out.add(ws.slice(i, i + N).join(' '));
  return out;
};

const refGrams = new Set();
for (const name of readdirSync(refDir)) {
  const p = join(refDir, name);
  if (!statSync(p).isFile()) continue;
  for (const g of grams(words(readFileSync(p, 'utf8')))) refGrams.add(g);
}

const root = resolve(new URL('..', import.meta.url).pathname);
const refAbs = resolve(refDir);
let files;
try {
  files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
} catch {
  console.error('check-overlap: not a git checkout; cannot list files.');
  process.exit(2);
}

const rows = [];
for (const f of files) {
  const p = join(root, f);
  if (!existsSync(p) || !statSync(p).isFile()) continue;
  if (resolve(p).startsWith(refAbs + '/')) continue;
  if (statSync(p).size > 5_000_000) continue;
  const buf = readFileSync(p);
  if (buf.includes(0)) continue; // binary
  const shared = [...grams(words(buf.toString('utf8')))].filter((g) => refGrams.has(g));
  if (shared.length) rows.push({ file: relative(root, p), shared });
}

rows.sort((a, b) => b.shared.length - a.shared.length || a.file.localeCompare(b.file));
const total = rows.reduce((s, r) => s + r.shared.length, 0);
console.log(`check-overlap: ${N}-word runs shared with ${refDir}`);
if (!rows.length) console.log('  none');
for (const r of rows) {
  console.log(`  ${String(r.shared.length).padStart(5)}  ${r.file}`);
  if (SHOW) for (const g of r.shared) console.log(`           "${g}"`);
}
console.log(`  total ${total} in ${rows.length} file(s)`);
if (MAX !== null && rows.some((r) => r.shared.length > Number(MAX))) process.exit(1);
