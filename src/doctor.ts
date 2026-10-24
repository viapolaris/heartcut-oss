// heartcut doctor: one plain checklist of what this machine has and what is missing.
// Read-only: no paid call, no network, no key ever leaves this file (only variable names do).
// Used by `heartcut doctor`, GET /api/doctor and the start-up message. Probes are injectable for tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECTS_DIR, MEDIA_ROOT } from './store.ts';
import { activeLlm, isFake } from './llm.ts';
import { isLocalAvailable, type LocalAvailability } from './gen/local.ts';
import { getGenStatus, type GenStatus } from './gen/status.ts';
import { findOnPath } from './which.ts';

export { findOnPath };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The oldest Node that runs Heartcut: 22.18 is the first 22.x that strips TypeScript types without a flag. */
export const MIN_NODE = '22.18.0';

/** ok: fine. info: optional or not needed now. warn: needed for real films, fake mode still works. fail: Heartcut cannot run. */
export type Level = 'ok' | 'info' | 'warn' | 'fail';
export interface Check { id: string; label: string; level: Level; detail: string; fix?: string }
export interface DoctorReport {
  /** Heartcut can start and run in fake mode (no check failed). */
  canRun: boolean;
  /** Nothing to fix: no warn and no fail. */
  ready: boolean;
  fake: boolean;
  checks: Check[];
}

/** What the language model check needs. Mirrors the dashboard's llmStatus: names only, never a key. */
export interface LlmProbe { provider: string; label: string; keyEnv: string | null; keyRequired: boolean; keyFound: boolean; baseUrl: string | null; error?: string; source?: string; reason?: string }

export interface Probes {
  node: string;
  platform: NodeJS.Platform;
  fake: boolean;
  /** Full path of a program, or null. */
  which: (bin: string) => string | null;
  llm: () => LlmProbe;
  gen: () => GenStatus;
  local: () => LocalAvailability;
  writable: (dir: string) => boolean;
  envExists: () => boolean;
  dirs: { projects: string; media: string };
}

/** Same lookup order as src/ffmpeg.ts: HEARTCUT_FFMPEG / HEARTCUT_FFPROBE, then Homebrew, then PATH. */
function findFf(name: 'ffmpeg' | 'ffprobe'): string | null {
  const env = process.env[`HEARTCUT_${name.toUpperCase()}`];
  if (env) return fs.existsSync(env) ? env : null;
  const brew = `/opt/homebrew/bin/${name}`;
  if (fs.existsSync(brew)) return brew;
  return findOnPath(name);
}

/** True when the folder exists and is writable, or does not exist yet and its nearest existing parent is writable. */
export function canWrite(dir: string): boolean {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(d)) {
      try { if (!fs.statSync(d).isDirectory()) return false; fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; }
    }
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}

function llmProbe(): LlmProbe {
  try {
    const r = activeLlm();
    return { provider: r.provider, label: r.label, keyEnv: r.keyEnv ?? null, keyRequired: r.keyRequired, keyFound: r.keyFound, baseUrl: r.baseUrl ?? null, source: r.source, ...(r.reason ? { reason: r.reason } : {}) };
  } catch (e) {
    return { provider: 'claude-cli', label: 'Language model', keyEnv: null, keyRequired: false, keyFound: false, baseUrl: null, error: (e as Error).message };
  }
}

export function realProbes(): Probes {
  return {
    node: process.versions.node,
    platform: process.platform,
    fake: isFake(),
    which: (bin) => (bin === 'ffmpeg' || bin === 'ffprobe' ? findFf(bin) : findOnPath(bin)),
    llm: llmProbe,
    gen: getGenStatus,
    local: isLocalAvailable,
    writable: canWrite,
    envExists: () => fs.existsSync(process.env.HEARTCUT_ENV_FILE ?? path.join(REPO, '.env')),
    dirs: { projects: PROJECTS_DIR, media: MEDIA_ROOT },
  };
}

const newer = (have: string, min: string): boolean => {
  const a = have.replace(/^v/, '').split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return true;
};

export function ffmpegHint(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'Install it: brew install ffmpeg (Homebrew is at brew.sh).';
  if (platform === 'win32') return 'Install it: winget install --id Gyan.FFmpeg, then open a new terminal.';
  if (platform === 'linux') return 'Install it: sudo apt install ffmpeg (Debian or Ubuntu). Other Linux: use your package manager.';
  return 'Install ffmpeg from ffmpeg.org and make sure ffmpeg and ffprobe are on your PATH.';
}

/** A folder as a person would say it: relative to the Heartcut folder, else ~/..., else as is. */
const where = (dir: string): string => {
  const rel = path.relative(REPO, dir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  const home = os.homedir();
  return home && dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;
};

export function runDoctor(over: Partial<Probes> = {}): DoctorReport {
  const p: Probes = { ...realProbes(), ...over };
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  add(newer(p.node, MIN_NODE)
    ? { id: 'node', label: 'Node', level: 'ok', detail: `${p.node}.` }
    : { id: 'node', label: 'Node', level: 'fail', detail: `Node ${p.node} is too old.`, fix: `Install Node ${MIN_NODE} or newer from nodejs.org.` });

  const missing = (['ffmpeg', 'ffprobe'] as const).filter((b) => !p.which(b));
  add(missing.length === 0
    ? { id: 'ffmpeg', label: 'ffmpeg', level: 'ok', detail: 'ffmpeg and ffprobe found.' }
    : { id: 'ffmpeg', label: 'ffmpeg', level: 'fail', detail: `${missing.join(' and ')} not found. Heartcut needs it to make clips and the final film.`, fix: ffmpegHint(p.platform) });

  const l = p.llm();
  const lc: Check = { id: 'llm', label: 'Language model', level: 'ok', detail: l.source === 'auto' && l.reason ? `${l.label}, picked automatically (${l.reason}).` : `${l.label}.` };
  if (l.source === 'none') Object.assign(lc, { level: 'warn', detail: l.reason || 'No language model found.', fix: 'Do one of these: install Claude Code (claude.com/claude-code) and sign in once; or add one key to .env (ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY); or start Ollama or LM Studio with a model loaded. Then run the doctor again.' });
  else if (l.error) Object.assign(lc, { level: 'warn', detail: l.error, fix: 'Fix the HEARTCUT_LLM settings in .env, or pick a language model in the dashboard.' });
  else if (l.provider === 'claude-cli' && !p.which('claude')) Object.assign(lc, { level: 'warn', detail: `${l.label}: the claude command is not installed.`, fix: 'Install Claude Code (claude.com/claude-code) and sign in once, or pick another language model in the dashboard.' });
  else if (l.keyRequired && !l.keyFound) Object.assign(lc, { level: 'warn', detail: `${l.label}: no key yet.`, fix: `Add ${l.keyEnv}=your-key to .env, or pick another language model in the dashboard.` });
  else if (l.provider === 'openai-compatible' && l.baseUrl && /127\.0\.0\.1|localhost/.test(l.baseUrl)) lc.detail = `${l.label}. Make sure it is running at ${l.baseUrl}.`;
  if (lc.level === 'warn' && p.fake) Object.assign(lc, { level: 'info', detail: `${lc.detail} Not needed in fake mode.` });
  add(lc);

  const g = p.gen();
  const gc: Check = g.ready
    ? { id: 'gen', label: 'Pictures and video', level: 'ok', detail: `${g.label}.` }
    : { id: 'gen', label: 'Pictures and video', level: 'warn', detail: g.problem || `${g.label}: not ready.`,
      fix: !g.provider ? 'Needed for real films only. Fake mode and the demo work without it.'
        : g.keyEnv && !g.keyFound ? `Add ${g.keyEnv}=your-key to .env, or set it up in the dashboard under Pictures and video.` : 'Set it up in the dashboard under Pictures and video.' };
  if (gc.level === 'warn' && p.fake) Object.assign(gc, { level: 'info', detail: `${gc.detail} Not needed in fake mode.` });
  add(gc);

  const loc = p.local();
  add(loc.ok
    ? { id: 'local', label: 'Local picture worker', level: 'ok', detail: `Ready${loc.models.length ? ` (${loc.models.join(', ')})` : ''}. Drawn looks can render here for free.` }
    : { id: 'local', label: 'Local picture worker', level: 'info', detail: `Optional, not available: ${loc.reason || 'no local worker'}.` });

  for (const [id, label, dir] of [['projects', 'Projects folder', p.dirs.projects], ['media', 'Media folder', p.dirs.media]] as const) {
    add(p.writable(dir)
      ? { id, label, level: 'ok', detail: `${where(dir)} is writable.` }
      : { id, label, level: 'fail', detail: `Cannot write to ${where(dir)}.`, fix: id === 'media' ? 'Fix the folder permissions, or set HEARTCUT_MEDIA_ROOT in .env to a folder you own.' : 'Fix the folder permissions, or set HEARTCUT_ROOT to a folder you own.' });
  }

  add(p.envExists()
    ? { id: 'env', label: '.env file', level: 'ok', detail: '.env found.' }
    : { id: 'env', label: '.env file', level: 'info', detail: 'No .env file. You only need one for API keys or a custom media folder.', fix: p.platform === 'win32' ? 'copy .env.example .env' : 'cp .env.example .env' });

  return { canRun: !checks.some((c) => c.level === 'fail'), ready: checks.every((c) => c.level === 'ok' || c.level === 'info'), fake: p.fake, checks };
}

const TAG: Record<Level, string> = { ok: 'ok  ', info: 'note', warn: 'todo', fail: 'FAIL' };

export function formatDoctor(r: DoctorReport): string {
  const L = ['Heartcut doctor', ''];
  for (const c of r.checks) {
    L.push(`  ${TAG[c.level]}  ${c.label}: ${c.detail}`);
    if (c.fix && c.level !== 'ok') L.push(`        ${c.level === 'info' ? 'Tip' : 'Fix'}: ${c.fix}`);
  }
  L.push('');
  if (!r.canRun) L.push('Heartcut cannot run yet. Fix the FAIL lines above, then run the doctor again.');
  else if (!r.ready) L.push(`Heartcut can run. Fake mode works now (npm run fake). Fix the todo lines to make real films.`);
  else L.push(r.fake ? 'All good. Fake mode is on: placeholders only, nothing is spent.' : 'All good. Heartcut is ready to make films.');
  return L.join('\n');
}

/** One short line per problem, for the server start-up message. */
export function problemLines(r: DoctorReport): string[] {
  return r.checks.filter((c) => c.level === 'warn' || c.level === 'fail').map((c) => `  ${c.level === 'fail' ? 'Problem' : 'To do'}: ${c.label}: ${c.detail}${c.fix ? ` ${c.fix}` : ''}`);
}
