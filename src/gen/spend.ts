// The per-sitting spending cap for the HTTP providers (Higgsfield API, fal, Replicate). The external Higgsfield CLI tool has its own
// cap, so with `higgsfield-tool` this ledger is not used and /api/spend reports what the tool reports.
//
// A sitting is the last 6 hours, the same window the Higgsfield CLI tool uses. Every paid submit first takes a reservation:
// the quoted price, or for a video clip whose price is not known before submit, at least the reserve ($2.50 by
// default, HEARTCUT_VIDEO_RESERVE). A reservation that would cross the cap is refused before anything is sent. When the
// job finishes the reservation becomes the actual cost if the provider reports one, else the quote. A submit that
// may have reached the server and then failed or timed out keeps its reservation: it may still be billed.
// The ledger lives in projects/_spend.json, so a restart keeps counting.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECTS_DIR } from '../store.ts';
import { DEFAULT_VIDEO_RESERVE_USD } from './config.ts';

export const SITTING_MS = 6 * 60 * 60 * 1000;

export class SpendCapError extends Error {
  constructor(message: string) { super(message); this.name = 'SpendCapError'; }
}

export interface SpendEntry {
  id: string;
  at: string;              // ISO time the reservation was taken
  provider: string;
  model: string;
  usd: number;             // what counts against the cap now
  state: 'reserved' | 'done' | 'kept' | 'released';
  exact?: boolean;         // usd is the provider's own number
  requestId?: string;
}

const file = () => path.join(PROJECTS_DIR, '_spend.json');
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function read(): SpendEntry[] {
  try { const v = JSON.parse(fs.readFileSync(file(), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(list: SpendEntry[]): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
  fs.renameSync(tmp, file());
}

/** Entries still inside the sitting window (older ones are dropped from the file on the next write). */
function current(now = Date.now()): SpendEntry[] {
  return read().filter((e) => now - Date.parse(e.at) < SITTING_MS);
}

export function videoReserve(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.HEARTCUT_VIDEO_RESERVE);
  return Number.isFinite(n) && n >= 0 && env.HEARTCUT_VIDEO_RESERVE !== '' && env.HEARTCUT_VIDEO_RESERVE !== undefined ? n : DEFAULT_VIDEO_RESERVE_USD;
}

export function sitting(capUsd: number, now = Date.now()): { sittingUsd: number; capUsd: number; remainingUsd: number } {
  const spent = r3(current(now).filter((e) => e.state !== 'released').reduce((t, e) => t + e.usd, 0));
  return { sittingUsd: spent, capUsd, remainingUsd: r3(Math.max(0, capUsd - spent)) };
}

/** What a job counts against the cap before it is sent: the quote, or at least the reserve for a video with no exact price. */
export function holdFor(quoteUsd: number, opts: { exact: boolean; video: boolean }): number {
  return r3(opts.video && !opts.exact ? Math.max(quoteUsd, videoReserve()) : quoteUsd);
}

export function capMessage(holdUsd: number, s: { sittingUsd: number; capUsd: number }): string {
  return `This would cross the spending cap: $${holdUsd.toFixed(2)} on top of $${s.sittingUsd.toFixed(2)} spent in the last 6 hours, cap $${s.capUsd.toFixed(2)}. Nothing was sent. Raise the cap in the Brief step (Pictures and video), or set HEARTCUT_SPEND_CAP in .env, or wait for the 6-hour window to roll over.`;
}

/** Take a reservation or throw SpendCapError. Call it inside the generation lock so two jobs cannot both pass. */
export function reserve(e: { provider: string; model: string; holdUsd: number; capUsd: number }): SpendEntry {
  const s = sitting(e.capUsd);
  if (e.holdUsd > 0 && s.sittingUsd + e.holdUsd > e.capUsd + 1e-9) throw new SpendCapError(capMessage(e.holdUsd, s));
  const entry: SpendEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), provider: e.provider, model: e.model, usd: r3(e.holdUsd), state: 'reserved' };
  write([...current(), entry]);
  return entry;
}

function update(id: string, patch: Partial<SpendEntry>): void {
  const list = current();
  const at = list.findIndex((x) => x.id === id);
  if (at < 0) return;
  list[at] = { ...list[at], ...patch };
  write(list);
}

/** The job finished: record the provider's actual cost when it gave one, else the quote. */
export function settle(t: SpendEntry, quoteUsd: number, actualUsd?: number, requestId?: string): number {
  const exact = actualUsd !== undefined && Number.isFinite(actualUsd);
  const usd = r3(exact ? actualUsd! : quoteUsd);
  update(t.id, { usd, state: 'done', ...(exact ? { exact: true } : {}), ...(requestId ? { requestId } : {}) });
  return usd;
}
/** The request may have reached the server: keep counting the reservation. */
export function keep(t: SpendEntry, requestId?: string): void { update(t.id, { state: 'kept', ...(requestId ? { requestId } : {}) }); }
/** The server definitely did not take the job (refused it, or it never left this machine): nothing is billed. */
export function release(t: SpendEntry): void { update(t.id, { state: 'released', usd: 0 }); }

/** Test seam. */
export function clearLedger(): void { try { fs.rmSync(file()); } catch { /* none */ } }
