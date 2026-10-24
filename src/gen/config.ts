// Which picture-and-video service Heartcut uses, and the per-sitting spending cap.
// Same pattern as src/llm/config.ts: keys come only from the environment (or the repo .env), never from settings.
// Precedence: saved setting (projects/_settings.json `gen`) > env (HEARTCUT_GEN_PROVIDER) > auto.
// Auto = an external Higgsfield CLI tool when HEARTCUT_HIGGSFIELD_TOOL names a file that exists, else the first
// provider whose key is found (Higgsfield API, fal, Replicate), else none.
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../env.ts';

export type GenProvider = 'higgsfield-tool' | 'higgsfield' | 'fal' | 'replicate';
export const GEN_PROVIDERS: GenProvider[] = ['higgsfield-tool', 'higgsfield', 'fal', 'replicate'];
/** Auto-pick order for the HTTP providers. */
const AUTO_ORDER: GenProvider[] = ['higgsfield', 'fal', 'replicate'];

/** What Heartcut asks a provider to do. Each provider maps these to its own model ids (src/gen/<provider>.ts). */
export type Capability = 'faces' | 'places' | 'drawn' | 'edit' | 'refVideo' | 'i2v';
export const CAPABILITIES: Capability[] = ['faces', 'places', 'drawn', 'edit', 'refVideo', 'i2v'];
export const CAPABILITY_LABELS: Record<Capability, string> = {
  faces: 'Character sheets (photoreal faces)', places: 'Location sheets', drawn: 'Drawn styles (anime, illustration)',
  edit: 'Photo edit from several pictures (same face)', refVideo: 'Video from sheets', i2v: 'Video from a start (and end) frame',
};

export const DEFAULT_CAP_USD = 5;
/** Counted against the cap for a video clip whose price is not known before submit (the Higgsfield CLI tool uses the same). */
export const DEFAULT_VIDEO_RESERVE_USD = 2.5;

/** Saved in projects/_settings.json. Never holds a key. `provider` absent = auto. `models` overrides a capability's model id. */
export interface GenSettings {
  provider?: GenProvider;
  models?: Partial<Record<Capability, string>>;
  capUsd?: number;
}

interface Meta { label: string; short: string; keyEnv: string | null; extraEnv?: string[]; site: string; paid: boolean }
export const GEN_META: Record<GenProvider, Meta> = {
  'higgsfield-tool': { label: 'Higgsfield CLI tool', short: 'Higgsfield', keyEnv: null, site: 'https://higgsfield.ai', paid: true },
  higgsfield: { label: 'Higgsfield API', short: 'Higgsfield', keyEnv: 'HIGGSFIELD_API_KEY', extraEnv: ['HIGGSFIELD_API_SECRET'], site: 'https://cloud.higgsfield.ai', paid: true },
  fal: { label: 'fal.ai', short: 'fal.ai', keyEnv: 'FAL_KEY', site: 'https://fal.ai/dashboard/keys', paid: true },
  replicate: { label: 'Replicate', short: 'Replicate', keyEnv: 'REPLICATE_API_TOKEN', site: 'https://replicate.com/account/api-tokens', paid: true },
};

/** The external Higgsfield CLI tool, only ever from HEARTCUT_HIGGSFIELD_TOOL (empty when unset). */
export function higgsfieldToolPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.HEARTCUT_HIGGSFIELD_TOOL ? path.resolve(env.HEARTCUT_HIGGSFIELD_TOOL) : '';
}
/** Test seam: whether the tool file exists. */
export const genHooks = { toolExists: (env: NodeJS.ProcessEnv = process.env): boolean => { const f = higgsfieldToolPath(env); return !!f && fs.existsSync(f); } };

const ALIASES: Record<string, GenProvider> = {
  'higgsfield-tool': 'higgsfield-tool', tool: 'higgsfield-tool', 'higgsfield-cli': 'higgsfield-tool',
  higgsfield: 'higgsfield', 'higgsfield-api': 'higgsfield', fal: 'fal', 'fal.ai': 'fal', replicate: 'replicate',
};

function capOk(v: unknown, where: string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000) throw new Error(`${where} must be a dollar amount between 0 and 1000`);
  return Math.round(n * 100) / 100;
}

/** Throws a plain message on a bad shape. Rejects anything that looks like a key. */
export function checkGenSettings(v: unknown): GenSettings {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('gen must be an object');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (/key|token|secret|password/i.test(k)) throw new Error('API keys are never saved in settings. Put them in the .env file in the Heartcut folder.');
    if (!['provider', 'models', 'capUsd'].includes(k)) throw new Error(`gen.${k} is not a setting`);
  }
  const out: GenSettings = {};
  if (o.provider !== undefined && o.provider !== null && o.provider !== '') {
    if (!GEN_PROVIDERS.includes(o.provider as GenProvider)) throw new Error(`gen.provider must be one of ${GEN_PROVIDERS.join(', ')}`);
    out.provider = o.provider as GenProvider;
  }
  if (o.models !== undefined && o.models !== null) {
    if (typeof o.models !== 'object' || Array.isArray(o.models)) throw new Error('gen.models must be an object');
    const m: NonNullable<GenSettings['models']> = {};
    for (const [k, val] of Object.entries(o.models as Record<string, unknown>)) {
      if (!CAPABILITIES.includes(k as Capability)) throw new Error(`gen.models.${k}: use ${CAPABILITIES.join(', ')}`);
      if (val === undefined || val === null || val === '') continue;
      if (typeof val !== 'string' || val.length > 200 || /\s/.test(val.trim())) throw new Error(`gen.models.${k} must be a model id`);
      m[k as Capability] = val.trim();
    }
    if (Object.keys(m).length) out.models = m;
  }
  if (o.capUsd !== undefined && o.capUsd !== null && o.capUsd !== '') out.capUsd = capOk(o.capUsd, 'gen.capUsd');
  return out;
}

/** The key for a provider, or undefined. Only read here and by the HTTP clients; never returned to a client. */
export function genKey(provider: GenProvider, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const k = GEN_META[provider].keyEnv;
  return (k && env[k]) || undefined;
}
/** An optional second secret (Higgsfield's API secret). Never returned. */
export function genSecret(provider: GenProvider, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const k = GEN_META[provider].extraEnv?.[0];
  return (k && env[k]) || undefined;
}

export interface ResolvedGen {
  provider: GenProvider | null;
  source: 'saved' | 'env' | 'auto' | 'none';
  label: string;
  keyEnv: string | null;
  keyFound: boolean;
  ready: boolean;
  problem?: string;
  capUsd: number;
  capSource: 'saved' | 'env' | 'default';
  models: Partial<Record<Capability, string>>;
}

function keyFoundFor(p: GenProvider, env: NodeJS.ProcessEnv): boolean {
  return p === 'higgsfield-tool' ? genHooks.toolExists(env) : !!genKey(p, env);
}

/**
 * The active picture-and-video service. `saved` is the stored setting (undefined for none); `override` wins over it
 * (the Check button tries unsaved form values).
 */
export function resolveGen(saved: GenSettings | undefined, override?: GenSettings, env: NodeJS.ProcessEnv = process.env): ResolvedGen {
  if (env === process.env) loadEnv();
  const s = override ? { ...saved, ...checkGenSettings(override) } : saved;
  let provider: GenProvider | null = null;
  let source: ResolvedGen['source'] = 'none';
  let problem: string | undefined;
  if (s?.provider) { provider = s.provider; source = 'saved'; }
  else {
    const name = (env.HEARTCUT_GEN_PROVIDER || '').trim().toLowerCase();
    if (name && name !== 'auto') {
      if (ALIASES[name]) { provider = ALIASES[name]; source = 'env'; }
      else problem = `HEARTCUT_GEN_PROVIDER=${name} is not known. Use ${GEN_PROVIDERS.join(', ')} or auto`;
    }
    if (!provider) {
      if (genHooks.toolExists(env)) provider = 'higgsfield-tool';
      else provider = AUTO_ORDER.find((p) => !!genKey(p, env)) ?? null;
      if (provider) source = 'auto';
    }
  }
  let capUsd = DEFAULT_CAP_USD;
  let capSource: ResolvedGen['capSource'] = 'default';
  if (s?.capUsd !== undefined) { capUsd = s.capUsd; capSource = 'saved'; }
  else if (env.HEARTCUT_SPEND_CAP) {
    try { capUsd = capOk(env.HEARTCUT_SPEND_CAP, 'HEARTCUT_SPEND_CAP'); capSource = 'env'; } catch (e) { problem ??= (e as Error).message; }
  }
  const meta = provider ? GEN_META[provider] : null;
  const keyFound = provider ? keyFoundFor(provider, env) : false;
  if (!provider) {
    problem ??= 'No picture service is set up. Add FAL_KEY, REPLICATE_API_TOKEN or HIGGSFIELD_API_KEY to the .env file in the Heartcut folder. No restart is needed.';
  } else if (!keyFound) {
    problem = provider === 'higgsfield-tool'
      ? (higgsfieldToolPath(env) ? `The Higgsfield CLI tool is not at ${higgsfieldToolPath(env)}. Fix HEARTCUT_HIGGSFIELD_TOOL, or pick another service.` : 'HEARTCUT_HIGGSFIELD_TOOL is not set. Point it at a Higgsfield CLI tool, or pick another service.')
      : `${meta!.keyEnv} is not set. Add ${meta!.keyEnv}=... to the .env file in the Heartcut folder, or export it.`;
  } else if (provider === 'higgsfield' && !genKey(provider, env)!.includes(':') && !genSecret(provider, env)) {
    problem = 'HIGGSFIELD_API_SECRET is not set. Higgsfield gives you a key id and a secret: put the id in HIGGSFIELD_API_KEY and the secret in HIGGSFIELD_API_SECRET (or HIGGSFIELD_API_KEY=id:secret).';
  }
  return {
    provider, source, label: meta?.label ?? 'Not set up', keyEnv: meta?.keyEnv ?? null, keyFound,
    ready: !!provider && keyFound && !problem, ...(problem ? { problem } : {}),
    capUsd, capSource, models: { ...(s?.models ?? {}) },
  };
}

/** What the dashboard needs to draw the picker. No keys, only variable names. */
export const genOptions = () => ({
  providers: GEN_PROVIDERS.map((p) => ({ id: p, label: GEN_META[p].label, keyEnv: GEN_META[p].keyEnv, extraEnv: GEN_META[p].extraEnv ?? [], site: GEN_META[p].site })),
  capabilities: CAPABILITIES.map((c) => ({ id: c, label: CAPABILITY_LABELS[c] })),
  defaultCapUsd: DEFAULT_CAP_USD,
});
