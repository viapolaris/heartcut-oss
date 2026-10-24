// The generation provider layer. Every generating stage calls estimate() / run() here with Heartcut's model slugs and
// inputs (src/gen/models.ts); this file picks the active service (src/gen/config.ts) and hands the job over:
//   higgsfield-tool  an external Higgsfield CLI tool set by HEARTCUT_HIGGSFIELD_TOOL (src/gen/higgsfield.ts, subprocess). It owns its own spend cap.
//   higgsfield       Higgsfield's public API with your key (src/gen/higgsfield-api.ts)
//   fal              fal.ai queue API (src/gen/fal.ts)
//   replicate        Replicate predictions API (src/gen/replicate.ts)
// Local models (src/gen/local.ts) never reach this file's providers: the stages run them directly.
//
// Rules every HTTP provider gets from here:
//   - HEARTCUT_FAKE=1 short-circuits before any provider (placeholder files, Higgsfield table prices).
//   - One paid job at a time (a process-wide lock), so the cap check and the submit cannot interleave.
//   - The spending cap (src/gen/spend.ts): a reservation before each submit, refused before anything is sent.
//   - Submit once. Never resend after a timeout or dropped connection; poll by id; idempotency key where supported.
import crypto from 'node:crypto';
import path from 'node:path';
import * as tool from './higgsfield.ts';
import { mediaDir } from '../store.ts';
import { storedGen } from '../settings.ts';
import { resolveGen, GEN_META, type GenSettings, type ResolvedGen, type GenProvider } from './config.ts';
import { CINEMA, QWEN_EDIT, QWEN_T2I, SEEDANCE, SEEDANCE_I2V, SOUL, fakePrice, isFormulaPriced, isLocalModel, withoutRefTags } from './models.ts';
import { SpendCapError, holdFor, keep, release, reserve, settle, sitting } from './spend.ts';
import { download, JobFailedError, NotSentError } from './http.ts';
import { higgsfieldApi } from './higgsfield-api.ts';
import { fal } from './fal.ts';
import { replicate } from './replicate.ts';
import type { HttpProvider, Quote } from './provider-types.ts';
import type { GenResult, RunOpts } from './higgsfield.ts';

export { SpendCapError };
export type { GenResult, RunOpts, Quote };

export const PROVIDERS: Record<Exclude<GenProvider, 'higgsfield-tool'>, HttpProvider> = { higgsfield: higgsfieldApi, fal, replicate };

const fake = () => process.env.HEARTCUT_FAKE === '1';

/** The service run() would use right now: saved setting > HEARTCUT_GEN_PROVIDER > auto. */
export const activeGen = (override?: GenSettings): ResolvedGen => resolveGen(storedGen(), override);

/** A plain first line for failures a person can act on. Works for every provider; the tool's own wording first. */
export function failHeadline(out: string): string | undefined {
  const who = /\b(fal|replicate) (submit|status|result|check|upload|file)/i.exec(out)?.[1];
  const name = who ? (who.toLowerCase() === 'fal' ? 'fal.ai' : 'Replicate') : undefined;
  if (name) {
    if (/-> 402|insufficient|balance|credit|billing|payment required|exhausted/i.test(out)) return `${name} account is out of credits (nothing was charged). Top up, then run the step again`;
    if (/-> 401|-> 403|unauthori[sz]ed|invalid (api )?(key|token)/i.test(out)) return `${name} refused the login (check the key in .env)`;
    if (/-> 429|throttled|rate limit/i.test(out)) return `${name} is rate-limiting; wait a minute and run the step again`;
    const http = /-> (\d{3}) ([^\n]*)/.exec(out);
    if (http) return `${name} said ${http[1]} ${http[2].trim().slice(0, 200)}`;
  }
  if (/This would cross the spending cap/.test(out)) return 'the sitting spend cap is reached';
  const t = tool.failHeadline(out);
  if (/No picture service is set up/.test(out)) return 'no picture service is set up (see Settings, Pictures and video)';
  return t;
}

export interface PriceInfo extends Quote { provider: string | null; unsupported?: string }

/** The price of one job on the active service, with where the number came from. Never throws for a missing key. */
export async function quote(model: string, input: Record<string, unknown>, g: ResolvedGen = activeGen()): Promise<PriceInfo> {
  if (fake()) return { usd: fakePrice(model, input), exact: true, source: 'fake mode', provider: g.provider };
  if (isLocalModel(model)) return { usd: 0, exact: true, source: 'local GPU', provider: 'local' };
  if (g.provider === 'higgsfield-tool') return { usd: await tool.estimate(model, input), exact: !isFormulaPriced(model), source: 'Higgsfield CLI tool', provider: g.provider };
  const table = (why: string, unsupported?: string): PriceInfo => ({ usd: fakePrice(model, input), exact: false, source: why, provider: g.provider, ...(unsupported ? { unsupported } : {}) });
  if (!g.provider) return table('Higgsfield price table (no service set up)', g.problem);
  const impl = PROVIDERS[g.provider];
  const reason = impl.supports(model, input);
  if (reason) return table(`Higgsfield price table (${impl.label} cannot run this)`, reason);
  if (g.provider === 'higgsfield' && !g.ready) return table('Higgsfield price table (no key yet)');
  try { return { ...(await impl.quote(model, input)), provider: g.provider }; } catch (e) {
    if (g.provider === 'higgsfield') return table(`Higgsfield price table (/estimate failed: ${(e as Error).message.slice(0, 120)})`);
    throw e;
  }
}

/** Price only (the stages' estimate()). */
export async function estimate(model: string, input: object): Promise<number> {
  return (await quote(model, input as Record<string, unknown>)).usd;
}

/** A note for an estimate line: "approx." when the price is from a table, or why the service cannot run it. */
export async function priceNote(model: string, input: Record<string, unknown>): Promise<string | undefined> {
  if (fake() || isLocalModel(model)) return undefined;
  const q = await quote(model, input);
  if (q.unsupported) return `cannot run here: ${q.unsupported}`;
  return q.exact ? undefined : `approx. (${q.source})`;
}

// One paid job at a time across the whole process.
let lock: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const mine = lock.catch(() => undefined).then(fn);
  lock = mine.catch(() => undefined);
  return mine;
}

/** Submits exactly once per picture or clip. Never retried after a timeout. */
export async function run(model: string, input: object, opts: RunOpts): Promise<GenResult> {
  input = withoutRefTags(input); // a stage that forgot to clean its prompt still never sends {{char:..}} as text
  if (fake()) return tool.run(model, input, opts);
  const g = activeGen();
  if (g.provider === 'higgsfield-tool') return tool.run(model, input, opts);
  if (!g.provider || !g.ready) throw new Error(g.problem ?? 'No picture service is set up.');
  const impl = PROVIDERS[g.provider];
  const inp = input as Record<string, unknown>;
  const reason = impl.supports(model, inp);
  if (reason) throw new Error(`${impl.label} cannot make this: ${reason}. Pick another service in Settings (Pictures and video).`);
  const q = await quote(model, inp, g);
  if (opts.dryRun) return { files: [], usd: q.usd };
  return serial(() => runPaid(g, impl, model, inp, q, opts));
}

async function runPaid(g: ResolvedGen, impl: HttpProvider, model: string, input: Record<string, unknown>, q: Quote, opts: RunOpts): Promise<GenResult> {
  const batch = Math.max(1, Number(input.batch_size ?? 1));
  const per = impl.perCall?.(model);
  const calls = per && per < batch ? Math.ceil(batch / per) : 1;
  const one = calls > 1 ? { ...input, batch_size: per } : input;
  const each = q.usd / calls;
  const video = isFormulaPriced(model);
  const files: string[] = [];
  let paid = 0;
  let lastId: string | undefined;
  for (let i = 0; i < calls; i++) {
    const t = reserve({ provider: impl.id, model, holdUsd: holdFor(each, { exact: q.exact, video }), capUsd: g.capUsd }); // throws SpendCapError, nothing sent
    let requestId: string | undefined;
    let res;
    try {
      res = await impl.run(model, one, { emit: opts.emit, idempotencyKey: crypto.randomUUID(), onSubmitted: (id) => { requestId = id; } });
    } catch (e) {
      if (e instanceof NotSentError || (e instanceof JobFailedError && e.billed === false)) release(t);
      else keep(t, requestId);
      if (files.length) { opts.emit?.(`${files.length} of ${batch} pictures made; the rest failed: ${(e as Error).message.slice(0, 300)}`); break; }
      throw e;
    }
    lastId = res.requestId;
    paid += settle(t, each, res.usd, res.requestId);
    for (const url of res.urls) {
      const e = opts.sub ?? (video ? 'clips' : 'assets');
      files.push(await download(url, path.join(mediaDir(opts.project, e), `${opts.name}-${files.length + 1}`), res.downloadHeaders));
    }
  }
  if (!files.length) throw new JobFailedError(`${impl.label} returned no file`, lastId);
  return { files, usd: Math.round(paid * 1000) / 1000, requestId: lastId };
}

/** The sitting-spend numbers for the dashboard header. With the Higgsfield CLI tool, the tool's own numbers. */
export async function spend(): Promise<{ sittingUsd: number; capUsd: number; remainingUsd: number }> {
  if (fake()) return tool.spend();
  const g = activeGen();
  if (g.provider === 'higgsfield-tool') return tool.spend();
  return sitting(g.capUsd);
}

/** The free "Check" button: a read-only call (account, model list, style list). Never a generation. */
export async function check(override?: GenSettings): Promise<{ ok: boolean; provider: string | null; label: string; detail?: string; error?: string; fake?: boolean; ms: number }> {
  let g: ResolvedGen;
  try { g = activeGen(override); } catch (e) { return { ok: false, provider: null, label: 'Not set up', error: (e as Error).message, ms: 0 }; }
  const about = { provider: g.provider, label: g.label };
  if (fake()) return { ok: true, fake: true, ...about, detail: 'Fake mode is on (HEARTCUT_FAKE=1), so nothing was sent.', ms: 0 };
  if (!g.provider) return { ok: false, ...about, error: g.problem, ms: 0 };
  if (g.provider === 'higgsfield-tool') {
    return g.keyFound ? { ok: true, ...about, detail: 'The Higgsfield CLI tool is installed. It keeps its own key and spending cap.', ms: 0 } : { ok: false, ...about, error: g.problem, ms: 0 };
  }
  if (!g.ready) return { ok: false, ...about, error: g.problem, ms: 0 };
  const t0 = Date.now();
  try { const r = await PROVIDERS[g.provider].check(); return { ...about, ...r, ms: Date.now() - t0 }; } catch (e) {
    return { ok: false, ...about, error: failHeadline((e as Error).message) ?? (e as Error).message.slice(0, 600), ms: Date.now() - t0 };
  }
}

/** Which Heartcut capabilities the active service covers, for the settings table. */
export function coverage(g: ResolvedGen = activeGen()): { capability: string; model: string | null; note?: string }[] {
  const rows: [string, string][] = [['faces', SOUL], ['places', CINEMA], ['drawn', QWEN_T2I], ['edit', QWEN_EDIT], ['refVideo', SEEDANCE], ['i2v', SEEDANCE_I2V]];
  return rows.map(([capability, slug]) => {
    if (!g.provider) return { capability, model: null, note: 'no service' };
    if (g.provider === 'higgsfield-tool' || g.provider === 'higgsfield') return { capability, model: slug };
    const impl = PROVIDERS[g.provider];
    const why = impl.supports(slug);
    return why ? { capability, model: null, note: why } : { capability, model: impl.modelFor(slug) ?? slug };
  });
}

export const providerLabel = (g: ResolvedGen = activeGen()): string => (g.provider ? GEN_META[g.provider].short : 'no picture service');
