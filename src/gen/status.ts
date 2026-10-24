// One-line status of the picture-and-video service, for `heartcut doctor`, the dashboard and the first-run screen.
// Carries only the key's variable name and whether it is set, never the key itself.
import { resolveGen, type GenSettings } from './config.ts';
import { storedGen } from '../settings.ts';
import { isLocalAvailable } from './local.ts';

export interface GenStatus {
  provider: string | null;
  label: string;
  keyEnv: string | null;
  keyFound: boolean;
  ready: boolean;
  problem?: string;
  /** Extra, safe to show: where the choice came from, the cap, and whether the free local worker can draw. */
  source?: 'saved' | 'env' | 'auto' | 'none';
  capUsd?: number;
  capSource?: 'saved' | 'env' | 'default';
  approxPrices?: boolean;
  local?: { ok: boolean; reason?: string };
}

export function getGenStatus(override?: GenSettings): GenStatus {
  let r;
  try { r = resolveGen(storedGen(), override); } catch (e) {
    return { provider: null, label: 'Not set up', keyEnv: null, keyFound: false, ready: false, problem: (e as Error).message };
  }
  const l = isLocalAvailable();
  let problem = r.problem;
  if (!r.ready && l.ok) problem = `${problem ?? ''} Drawn-style pictures can still be made free on this Mac; photoreal sheets and video need a service.`.trim();
  return {
    provider: r.provider, label: r.label, keyEnv: r.keyEnv, keyFound: r.keyFound, ready: r.ready, ...(problem ? { problem } : {}),
    source: r.source, capUsd: r.capUsd, capSource: r.capSource,
    // Higgsfield (tool or API) prices from its own /estimate; fal and Replicate from Heartcut's dated tables.
    approxPrices: r.provider === 'fal' || r.provider === 'replicate',
    local: { ok: l.ok, ...(l.reason ? { reason: l.reason } : {}) },
  };
}
