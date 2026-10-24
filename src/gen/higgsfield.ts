// Subprocess wrapper around an external Higgsfield CLI tool set by HEARTCUT_HIGGSFIELD_TOOL. The tool owns credentials,
// the sitting spend cap, polling and download; we never touch the API or the creds file.
//
// Observed output shapes (2026-10-10):
//   estimate  stdout: JSON  {"type":"estimate","credits":"0.360","usd":"0.023","discount":null}
//             or            {"type":"description","pricing_description":"..."}  (formula-priced)
//             HTTP failure: exit 1, message on stderr
//   run       stderr: progress lines ("estimate: {...}", "sitting ...", "submitted <id>", "  queued... 4s\r")
//             stdout (only on a real run): JSON {request_id, owner, estimate, saved:[abs paths]}
//             --dry-run: exit 0, empty stdout, stderr ends "dry run - nothing submitted"
//             exit 3: spend cap refused, nothing submitted (message on stderr)
//   spend     stdout lines: "sitting (last 6h): $0.00 spent" / "cap in force: $5.00" / "remaining: $5.00" ...
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Emit } from '../types.ts';
import { mediaDir } from '../store.ts';
import type { MediaSub } from '../store.ts';
import { fakePrice, isLocalModel } from './models.ts';
import { higgsfieldToolPath } from './config.ts';
import { tinyMp4Path, tinyPng } from '../demo/media.ts';

export interface GenResult { files: string[]; usd: number; requestId?: string; raw?: unknown }
export interface RunOpts {
  /** Project slug: names the tool output (heartcut-<project>-<name>) and the media folder. */
  project: string;
  /** Base filename for the outputs, e.g. "ch_girl_portrait" or "scene_4_draft". */
  name: string;
  dryRun?: boolean;
  allowUnpriced?: boolean;
  emit?: Emit;
  /** Where copies go; default by extension (.mp4/.mov -> clips, else assets). */
  sub?: MediaSub;
}

// One class for every provider, so `instanceof SpendCapError` works whichever service refused.
import { SpendCapError } from './spend.ts';
export { SpendCapError };

const fake = () => process.env.HEARTCUT_FAKE === '1';

function toolPath(): string {
  return higgsfieldToolPath();
}

interface Proc { code: number; stdout: string; stderr: string }

function exec(args: string[], emit?: Emit): Promise<Proc> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [toolPath(), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let lastStatus = '';
    let carry = '';
    const onLine = (line: string) => {
      const l = line.trimEnd();
      if (!l.trim()) return;
      // Polling spam ("  queued... 12s") collapses to one line per status change.
      const poll = l.match(/^\s*(\w+)\.\.\. \d+s$/);
      if (poll) {
        if (poll[1] === lastStatus) return;
        lastStatus = poll[1];
        emit?.(`status: ${poll[1]}`);
        return;
      }
      emit?.(l.trim());
    };
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      const parts = (carry + d).split(/[\r\n]+/);
      carry = parts.pop() ?? '';
      parts.forEach(onLine);
    });
    // Hard ceiling even if the tool itself hangs: a stuck Higgsfield request once held an images
    // job open for over an hour (2026-10-11). The tool has its own --max-wait; this is the backstop.
    const limitSec = Number(process.env.HEARTCUT_GEN_TIMEOUT_SEC || 1200);
    const timer = setTimeout(() => {
      stderr += `\nheartcut: gave up after ${limitSec}s - the request may still finish on Higgsfield's side; run the step again later`;
      child.kill('SIGTERM');
    }, limitSec * 1000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (carry) onLine(carry);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function fail(p: Proc, what: string): never {
  const msg = (p.stderr.trim().split('\n').filter(Boolean).slice(-6).join('\n') || p.stdout.trim()).slice(0, 1200);
  if (p.code === 3) throw new SpendCapError(msg);
  throw new Error(`${failHeadline(p.stderr + '\n' + p.stdout) ?? `higgsfield ${what} failed (exit ${p.code})`}: ${msg}`);
}

/** A plain first line for the failures a person can act on; the raw tool output still follows it. */
export function failHeadline(out: string): string | undefined {
  if (/insufficient credits|not_enough_credits/i.test(out)) return 'Higgsfield account is out of credits (nothing was charged). Top up at open.higgsfield.ai, then run the step again';
  if (/-> 401|-> 403 (?!insufficient)|unauthori[sz]ed|invalid (api )?key/i.test(out)) return 'Higgsfield refused the login (check the API key)';
  if (/-> 429|rate limit/i.test(out)) return 'Higgsfield is rate-limiting; wait a minute and run the step again';
  const http = /-> (\d{3}) ([^\n]*)/.exec(out);
  return http ? `Higgsfield said ${http[1]} ${http[2].trim()}` : undefined;
}

// /estimate does not validate file contents and the tool uploads every existing local path it
// finds in --input, even for estimate. Swap paths for a placeholder URL so pricing never uploads.
function forEstimate(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(forEstimate);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, forEstimate(x)]));
  if (typeof v === 'string' && path.isAbsolute(v) && v.length < 1024 && fs.existsSync(v) && fs.statSync(v).isFile()) {
    return 'https://example.com/placeholder.png';
  }
  return v;
}

function usdOf(est: any, model: string, input: object): number {
  if (est && est.type !== 'description' && est.usd !== undefined && Number.isFinite(Number(est.usd))) return Number(est.usd);
  // Formula-priced (Seedance): compute from the published per-second rate.
  return fakePrice(model, input as Record<string, unknown>);
}

export async function estimate(model: string, input: object): Promise<number> {
  if (fake() || isLocalModel(model)) return fakePrice(model, input as Record<string, unknown>);
  const p = await exec(['estimate', model, '--input', JSON.stringify(forEstimate(input))]);
  if (p.code !== 0) fail(p, 'estimate');
  return usdOf(JSON.parse(p.stdout), model, input);
}

function ext(f: string) { return path.extname(f).toLowerCase() || '.bin'; }

function copyOutputs(files: string[], opts: RunOpts): string[] {
  return files.map((src, i) => {
    const e = ext(src);
    const sub = opts.sub ?? (e === '.mp4' || e === '.mov' ? 'clips' : 'assets');
    const dest = path.join(mediaDir(opts.project, sub), `${opts.name}-${i + 1}${e}`);
    fs.copyFileSync(src, dest);
    return dest;
  });
}

function fakeRun(model: string, input: Record<string, unknown>, opts: RunOpts): GenResult {
  const usd = fakePrice(model, input);
  if (opts.dryRun) return { files: [], usd };
  const isVideo = model.includes('seedance');
  const n = isVideo ? 1 : Number(input.batch_size ?? 1);
  const dest: string[] = [];
  for (let i = 0; i < n; i++) {
    const e = isVideo ? '.mp4' : '.png';
    const f = path.join(mediaDir(opts.project, opts.sub ?? (isVideo ? 'clips' : 'assets')), `${opts.name}-${i + 1}${e}`);
    if (isVideo) fs.copyFileSync(tinyMp4Path(), f);
    else fs.writeFileSync(f, tinyPng());
    dest.push(f);
  }
  opts.emit?.(`fake generation: wrote ${dest.length} placeholder file(s)`);
  return { files: dest, usd, requestId: 'fake_request' };
}

/** Submits exactly once — a submit has no idempotency key, so a retry could double-bill. */
export async function run(model: string, input: object, opts: RunOpts): Promise<GenResult> {
  if (fake()) return fakeRun(model, input as Record<string, unknown>, opts);
  const args = ['run', model, '--input', JSON.stringify(input), '--name', `heartcut-${opts.project}-${opts.name}`];
  // The tool files its own copy under an owner folder; HEARTCUT_HIGGSFIELD_OWNER names it (not sent when unset).
  if (process.env.HEARTCUT_HIGGSFIELD_OWNER) args.push('--owner', process.env.HEARTCUT_HIGGSFIELD_OWNER);
  if (opts.dryRun) args.push('--dry-run');
  if (opts.allowUnpriced) args.push('--allow-unpriced');
  const p = await exec(args, opts.emit);
  if (p.code !== 0) fail(p, 'run');
  if (opts.dryRun) {
    const m = p.stderr.match(/^estimate: (\{.*\})$/m);
    return { files: [], usd: usdOf(m ? JSON.parse(m[1]) : null, model, input) };
  }
  const out = JSON.parse(p.stdout.trim());
  const files = copyOutputs(out.saved ?? [], opts);
  return { files, usd: usdOf(out.estimate, model, input), requestId: out.request_id, raw: out };
}

export async function upload(filePath: string): Promise<string> {
  if (fake()) return `https://example.invalid/${path.basename(filePath)}`;
  const p = await exec(['upload', filePath]);
  if (p.code !== 0) fail(p, 'upload');
  return p.stdout.trim();
}

export async function spend(): Promise<{ sittingUsd: number; capUsd: number; remainingUsd: number }> {
  if (fake()) return { sittingUsd: 0, capUsd: 5, remainingUsd: 5 };
  const p = await exec(['spend']);
  if (p.code !== 0) fail(p, 'spend');
  const num = (re: RegExp) => Number(p.stdout.match(re)?.[1] ?? NaN);
  return {
    sittingUsd: num(/\$([\d.]+) spent/),
    capUsd: num(/cap in force: \$([\d.]+)/),
    remainingUsd: num(/remaining: \$([\d.]+)/),
  };
}
