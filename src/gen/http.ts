// Shared plumbing for the HTTP generation providers: one fetch with a timeout, the "was it sent?" classification that
// the never-double-bill rule rests on, polling with a deadline, downloads, and local files as inputs.
import fs from 'node:fs';
import path from 'node:path';

/** The request never reached the provider, or the provider refused it outright: nothing is billed, safe to report as such. */
export class NotSentError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.name = 'NotSentError'; this.status = status; }
}
/** The submit may have reached the provider (timeout, dropped connection, 5xx). Never resubmit: it could bill twice. */
export class MaybeSentError extends Error {
  constructor(message: string) { super(message); this.name = 'MaybeSentError'; }
}
/** The job ran on the provider and failed there. */
export class JobFailedError extends Error {
  requestId?: string;
  /** false only when the provider documents that a failed job is not charged; otherwise the reservation is kept. */
  billed?: boolean;
  constructor(message: string, requestId?: string, billed?: boolean) { super(message); this.name = 'JobFailedError'; this.requestId = requestId; this.billed = billed; }
}

/** Test seams: the clock and the sleep between polls. */
export const httpHooks = {
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
  now: (): number => Date.now(),
};

// Errors that prove the request never left this machine (DNS, refused, bad URL).
const NEVER_SENT = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ERR_INVALID_URL|EHOSTUNREACH|ENETUNREACH|CERT_|UNABLE_TO_VERIFY/;
function causeCode(e: unknown): string {
  const c = (e as { cause?: { code?: string; message?: string } })?.cause;
  return `${c?.code ?? ''} ${c?.message ?? ''} ${(e as Error)?.message ?? ''}`;
}

export interface Sent { status: number; body: any; text: string; headers: Headers }

/**
 * One request, no retries. `submit: true` marks a request that may start a paid job: a timeout or dropped
 * connection then throws MaybeSentError, and a 4xx throws NotSentError (the provider did not accept it).
 */
export async function call(url: string, init: RequestInit & { timeoutMs?: number; submit?: boolean; what: string }): Promise<Sent> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    const code = causeCode(e);
    if (NEVER_SENT.test(code)) throw new NotSentError(`${init.what}: could not reach ${new URL(url).host} (${code.trim().split(' ')[0] || 'network error'})`);
    const msg = `${init.what}: no answer from ${new URL(url).host} (${ctl.signal.aborted ? 'timed out' : 'connection dropped'})`;
    throw init.submit ? new MaybeSentError(`${msg}. The job may still run and be billed, so it was NOT sent again. Check the provider's dashboard before you run the step again.`) : new Error(msg);
  }
  let text = '';
  try { text = await res.text(); } catch { /* empty body */ }
  clearTimeout(timer);
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = (typeof body?.detail === 'string' ? body.detail : body?.detail ? JSON.stringify(body.detail) : body?.error?.message ?? body?.error ?? body?.message ?? text).toString().slice(0, 600);
    const msg = `${init.what} -> ${res.status} ${detail}`.trim();
    if (init.submit && res.status >= 500) throw new MaybeSentError(`${msg}. The job may still run, so it was NOT sent again.`);
    if (res.status < 500) throw new NotSentError(msg, res.status);
    throw new Error(msg);
  }
  return { status: res.status, body, text, headers: res.headers };
}

/** Poll until `done` returns a value, or the deadline passes (HEARTCUT_GEN_TIMEOUT_SEC, default 1200 s). */
export async function pollUntil<T>(step: () => Promise<T | undefined>, opts: { what: string; provider: string; intervalMs?: number; limitSec?: number }): Promise<T> {
  const limitSec = opts.limitSec ?? Number(process.env.HEARTCUT_GEN_TIMEOUT_SEC || 1200);
  const end = httpHooks.now() + limitSec * 1000;
  let wait = opts.intervalMs ?? 2000;
  for (;;) {
    let got: T | undefined;
    try { got = await step(); } catch (e) {
      if (e instanceof JobFailedError) throw e;
      // The job was accepted, so nothing from here on may count as "not sent" (that would release the reservation).
      if (e instanceof NotSentError && [401, 403, 404].includes(e.status ?? 0)) throw new JobFailedError(`${opts.what}: status check refused (${e.message.slice(0, 300)})`);
      // Any other failed status read is not a failed job: keep polling until the deadline.
      if (httpHooks.now() > end) throw new MaybeSentError(`${opts.what}: gave up after ${limitSec}s (last status check failed: ${(e as Error).message.slice(0, 200)}) - the request may still finish on ${opts.provider}'s side; run the step again later`);
    }
    if (got !== undefined) return got;
    if (httpHooks.now() > end) throw new MaybeSentError(`${opts.what}: gave up after ${limitSec}s - the request may still finish on ${opts.provider}'s side; run the step again later`);
    await httpHooks.sleep(wait);
    wait = Math.min(10_000, Math.round(wait * 1.3));
  }
}

const MIME_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };
export function extFrom(url: string, contentType?: string | null): string {
  const ct = (contentType ?? '').split(';')[0].trim();
  if (MIME_EXT[ct]) return MIME_EXT[ct];
  try { const e = path.extname(new URL(url).pathname).toLowerCase(); if (/^\.(png|jpe?g|webp|mp4|mov)$/.test(e)) return e === '.jpeg' ? '.jpg' : e; } catch { /* data: url */ }
  return ct.startsWith('video/') ? '.mp4' : '.png';
}

/** Download one output to `destNoExt` + its extension. Returns the file. */
export async function download(url: string, destNoExt: string, headers: Record<string, string> = {}): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10 * 60_000);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error(`download ${new URL(url).host} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('download returned an empty file');
    const file = destNoExt + extFrom(url, res.headers.get('content-type'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return file;
  } finally { clearTimeout(timer); }
}

const FILE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };
export const mimeOf = (f: string): string => FILE_MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream';
export const isLocalPath = (v: unknown): v is string => typeof v === 'string' && path.isAbsolute(v) && !/^[a-z]+:\/\//i.test(v) && v.length < 2048;

export function dataUri(file: string): string {
  return `data:${mimeOf(file)};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Replace every absolute local file path in an input (any depth) with what `toUrl` returns. Uploads one file once. */
export async function mapLocalFiles(input: unknown, toUrl: (file: string) => Promise<string>): Promise<unknown> {
  const seen = new Map<string, Promise<string>>();
  const walk = async (v: unknown): Promise<unknown> => {
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await walk(x)); return out; }
    if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) o[k] = await walk(x); return o; }
    if (isLocalPath(v) && fs.existsSync(v) && fs.statSync(v).isFile()) {
      if (!seen.has(v)) seen.set(v, toUrl(v));
      return seen.get(v)!;
    }
    return v;
  };
  return walk(input);
}
