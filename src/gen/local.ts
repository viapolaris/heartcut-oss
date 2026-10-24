// Local image worker: renders drawn-medium sheets on this Mac with MLX (free). The worker ships in the repo at
// tools/local-image.py (setup in its header; HEARTCUT_LOCAL_WORKER points at another copy): one JSON job on stdin,
// progress lines on stderr. It runs under `uv run`, or under HEARTCUT_LOCAL_PYTHON when that is set.
// One process per SHEET (all variants in one invocation): model load is ~10 s, never one process per image.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Emit } from '../types.ts';
import { LOCAL_EDIT, LOCAL_QWEN, LOCAL_Z } from './models.ts';
import { tinyPng } from '../demo/media.ts';
import { findOnPath } from '../which.ts';

/** Model slug -> the worker's VARIANTS name, its Hugging Face cache folder, and its default step count. */
export const LOCAL_MODELS: Record<string, { worker: string; repo: string; hf?: string; steps: number; short: string; optional?: boolean;
  lightning?: { repo: string; file: string; steps: number; guidance: number } }> = {
  [LOCAL_QWEN]: { worker: 'qwen_image', repo: 'models--Qwen--Qwen-Image', hf: 'Qwen/Qwen-Image', steps: 20, short: 'qwen-image' },
  [LOCAL_Z]: { worker: 'z_image_turbo', repo: 'models--Tongyi-MAI--Z-Image-Turbo', steps: 8, short: 'z-image-turbo' },
  // Optional: without its weights the text-to-image models still run; photo edits then go to Higgsfield.
  [LOCAL_EDIT]: { worker: 'qwen_image_edit_2511', repo: 'models--Qwen--Qwen-Image-Edit-2511', hf: 'Qwen/Qwen-Image-Edit-2511', steps: 20, short: 'qwen-image-edit', optional: true,
    // Apache-2.0 speed-up adapter: 8 steps at guidance 1.0 instead of 20 at 4.0, used when it is in the cache.
    lightning: { repo: 'models--lightx2v--Qwen-Image-Edit-2511-Lightning', file: 'Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors', steps: 8, guidance: 1.0 } },
};
const TIMEOUT_MS = 30 * 60 * 1000;

const fake = () => process.env.HEARTCUT_FAKE === '1';
/** The repo copy of the worker. */
export const REPO_WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'local-image.py');
export const workerPath = (): string => process.env.HEARTCUT_LOCAL_WORKER || REPO_WORKER;
/** A plain Python with the worker's requirements installed (tools/requirements-local.txt), instead of uv. */
const localPython = (): string | undefined => process.env.HEARTCUT_LOCAL_PYTHON || undefined;
const hubDir = () => path.join(process.env.HF_HUB_CACHE || path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache/huggingface'), 'hub'));

/** The worker cannot run at all (no uv, no weights, no script): the caller may fall back to the paid twin. */
export class LocalUnavailableError extends Error {
  files: string[];
  constructor(message: string, files: string[] = []) { super(message); this.name = 'LocalUnavailableError'; this.files = files; }
}
/** The worker ran and failed. `files` are the outputs that did land (partial results). */
export class LocalRunError extends Error {
  files: string[];
  constructor(message: string, files: string[]) { super(message); this.name = 'LocalRunError'; this.files = files; }
}

export interface LocalAvailability { ok: boolean; reason?: string; models: string[] }

/** What the availability check asks of the machine. Tests pass their own; nothing else changes it. */
export interface LocalHost { platform: NodeJS.Platform; arch: string; onPath: (bin: string) => boolean; exists: (file: string) => boolean }
export const realHost = (): LocalHost => ({ platform: process.platform, arch: process.arch, onPath: (bin) => findOnPath(bin) !== null, exists: (f) => fs.existsSync(f) });
// Weights count only when fully downloaded: a snapshot with a transformer folder whose every file link resolves, and
// no half-written blob left in the repo. A download in progress must never route work to a model that cannot load.
function hasWeights(repo: string): boolean {
  try {
    const root = path.join(hubDir(), repo);
    try { if (fs.readdirSync(path.join(root, 'blobs')).some((b) => b.endsWith('.incomplete'))) return false; } catch { /* no blobs dir: plain copy */ }
    const snaps = path.join(root, 'snapshots');
    const complete = (dir: string): boolean => fs.readdirSync(dir, { withFileTypes: true }).every((e) => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) return complete(f);
      try { return fs.statSync(f).size > 0; } catch { return false; } // a dangling link = blob not there yet
    });
    return fs.readdirSync(snaps).some((s) => {
      const t = path.join(snaps, s, 'transformer');
      return fs.existsSync(t) && fs.readdirSync(t).length > 0 && complete(path.join(snaps, s));
    });
  } catch { return false; }
}

export function checkAvailable(host: LocalHost = realHost()): LocalAvailability {
  const models = Object.entries(LOCAL_MODELS).filter(([, m]) => hasWeights(m.repo)).map(([slug]) => slug);
  const why: string[] = [];
  if (host.platform !== 'darwin' || host.arch !== 'arm64') why.push('local pictures need an Apple Silicon Mac (MLX)');
  const py = localPython();
  if (py ? !(path.isAbsolute(py) ? host.exists(py) : host.onPath(py)) : !host.onPath('uv')) why.push(py ? `HEARTCUT_LOCAL_PYTHON not found: ${py}` : 'uv is not installed (brew install uv), see tools/local-image.py');
  if (!host.exists(workerPath())) why.push(`worker missing: ${workerPath()}`);
  for (const [slug, m] of Object.entries(LOCAL_MODELS)) if (!models.includes(slug) && !m.optional) why.push(`${m.short} weights not in the Hugging Face cache (${m.repo})`);
  return why.length ? { ok: false, reason: why.join('; '), models: why.some((w) => /uv|worker|PYTHON|Apple Silicon/.test(w)) ? [] : models } : { ok: true, models };
}

/** Test seam: swap the availability check. */
export const hooks = { available: (): LocalAvailability => checkAvailable() };
export function isLocalAvailable(): LocalAvailability { return hooks.available(); }

/** Stable seed from "<assetId>-v<n>" so a rerun reproduces the same picture. */
export function seedFor(assetId: string, n: number): number {
  return crypto.createHash('sha1').update(`${assetId}-v${n}`).digest().readUInt32BE(0);
}

/** The cached speed-up adapter for a model, when there is one and it is fully downloaded. */
export function lightningFor(model: string): { path: string; steps: number; guidance: number } | undefined {
  const l = LOCAL_MODELS[model]?.lightning;
  if (!l || process.env.HEARTCUT_LOCAL_LIGHTNING === '0') return undefined;
  try {
    const snaps = path.join(hubDir(), l.repo, 'snapshots');
    for (const s of fs.readdirSync(snaps)) {
      const f = path.join(snaps, s, l.file);
      try { if (fs.statSync(f).size > 1e6) return { path: f, steps: l.steps, guidance: l.guidance }; } catch { /* not this snapshot */ }
    }
  } catch { /* not downloaded */ }
  return undefined;
}

export function stepsFor(model: string): number {
  const env = Number(process.env.HEARTCUT_LOCAL_STEPS);
  return Number.isFinite(env) && env > 0 ? Math.round(env) : lightningFor(model)?.steps ?? LOCAL_MODELS[model]?.steps ?? 8;
}

export interface LocalItem { id: string; prompt: string; seed: number; outFile: string; images?: string[] }
export interface LocalOpts { width: number; height: number; steps?: number; emit?: Emit }
export interface LocalResult { files: string[]; secs: number }

function landed(items: LocalItem[]): string[] {
  return items.map((i) => i.outFile).filter((f) => { try { return fs.statSync(f).size > 0; } catch { return false; } });
}

// One worker at a time on this Mac: two big models at once spill into swap and both crawl (seen 2026-10-11: a
// dashboard run and a probe ran together and the second picture never finished in 30 minutes).
let queue: Promise<unknown> = Promise.resolve();
export function run(model: string, items: LocalItem[], opts: LocalOpts): Promise<LocalResult> {
  const waiting = queue;
  const mine = waiting.catch(() => undefined).then(() => runNow(model, items, opts));
  queue = mine.catch(() => undefined);
  return mine;
}

/** Time budget: model load plus a per-picture allowance that grows with steps and size. */
export function timeoutMs(items: number, steps: number, width: number, height: number): number {
  const perStep = 20_000 * Math.max(1, (width * height) / (1024 * 1024));
  return Math.max(TIMEOUT_MS, 10 * 60_000 + items * steps * perStep);
}

async function runNow(model: string, items: LocalItem[], opts: LocalOpts): Promise<LocalResult> {
  const info = LOCAL_MODELS[model];
  if (!info) throw new Error(`not a local model: ${model}`);
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 100) / 10;
  const say = (n: number) => opts.emit?.(`local ${info.short}: ${n}/${items.length} done (${Math.round((Date.now() - t0) / 1000)}s)`);
  if (fake()) {
    for (const [i, it] of items.entries()) { fs.mkdirSync(path.dirname(it.outFile), { recursive: true }); fs.writeFileSync(it.outFile, tinyPng()); say(i + 1); }
    return { files: items.map((i) => i.outFile), secs: secs() };
  }
  const a = isLocalAvailable();
  if (!a.models.includes(model)) throw new LocalUnavailableError(a.reason ?? `${info.short} weights are not available`);
  for (const it of items) fs.mkdirSync(path.dirname(it.outFile), { recursive: true });
  const fast = lightningFor(model);
  const job = { model: info.worker, ...(info.hf ? { model_name: info.hf } : {}), steps: opts.steps ?? stepsFor(model), width: opts.width, height: opts.height, items,
    ...(fast ? { lora_paths: [fast.path], lora_scales: [1.0], guidance: fast.guidance } : {}) };
  const limit = timeoutMs(items.length, job.steps, opts.width, opts.height);
  return new Promise<LocalResult>((resolve, reject) => {
    const py = localPython();
    const child = py ? spawn(py, [workerPath()], { stdio: ['pipe', 'pipe', 'pipe'] }) : spawn('uv', ['run', '--quiet', workerPath()], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', carry = '', timedOut = false;
    opts.emit?.(`local ${info.short}: loading model, ${items.length} image(s) at ${opts.width}x${opts.height}, ${job.steps} steps${fast ? ' (Lightning)' : ''}`);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, limit);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
      const parts = (carry + d).split(/[\r\n]+/);
      carry = parts.pop() ?? '';
      for (const l of parts) { const m = /^progress (\d+)\/(\d+)$/.exec(l.trim()); if (m) say(Number(m[1])); }
    });
    child.on('error', (e) => { clearTimeout(timer); reject(new LocalUnavailableError(`could not run ${py ?? 'uv'}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let res: { ok?: boolean; stage?: string; error?: string } | undefined;
      for (const line of out.trim().split('\n').reverse()) {
        if (!line.trim().startsWith('{')) continue;
        try { const j = JSON.parse(line.trim()); if (typeof j.ok === 'boolean') { res = j; break; } } catch { /* not the envelope */ }
      }
      const files = landed(items);
      if (res?.ok && files.length === items.length) return resolve({ files, secs: secs() });
      const detail = timedOut ? `timed out after ${Math.round(limit / 60_000)} minutes`
        : res ? `worker failed at ${res.stage}: ${String(res.error).slice(0, 600)}`
        : `worker exited ${code} without a result: ${err.trim().split('\n').slice(-4).join(' | ').slice(0, 600)}`;
      // Missing weights surface as an import/load failure; a bad prompt or OOM surfaces at generate:<id>.
      const unrecoverable = !files.length && !timedOut && (!res || /^(parse|import|model_config|variant|import_variant|load)/.test(res.stage ?? ''));
      reject(unrecoverable ? new LocalUnavailableError(detail, files) : new LocalRunError(detail, files));
    });
    child.stdin.write(JSON.stringify(job));
    child.stdin.end();
  });
}
