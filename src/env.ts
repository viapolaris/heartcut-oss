// Tiny .env loader (no deps). Reads KEY=value lines from the repo-root .env (gitignored).
// A variable already set in the real environment always wins. Values this loader set are
// refreshed on the next call, so an edited .env takes effect without a restart.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ours = new Set<string>();

/** HEARTCUT_ENV_FILE overrides the path (tests point it at a file that does not exist). */
export const envFile = (): string => process.env.HEARTCUT_ENV_FILE ?? path.join(REPO, '.env');

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

/** Load the .env into process.env. Empty values are skipped, so a blank placeholder never counts as a key. */
export function loadEnv(file: string = envFile()): void {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const vars = parseEnv(text);
  for (const k of [...ours]) if (!(k in vars) || !vars[k]) { delete process.env[k]; ours.delete(k); }
  for (const [k, v] of Object.entries(vars)) {
    if (!v) continue;
    if (process.env[k] !== undefined && !ours.has(k)) continue;
    process.env[k] = v;
    ours.add(k);
  }
}
