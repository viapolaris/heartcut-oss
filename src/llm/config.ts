// Which language model Heartcut talks to. Keys come only from the environment (or the repo .env).
// Precedence: saved setting (projects/_settings.json `llm`) > env (HEARTCUT_LLM_PROVIDER) > auto.
// Auto = the claude CLI when the `claude` command is on PATH, else the first API key found (AUTO_KEYS order),
// else a local Ollama or LM Studio server that answers its free model list, else none.
import { loadEnv } from '../env.ts';
import { findOnPath } from '../which.ts';

export type LlmProvider = 'claude-cli' | 'anthropic' | 'openai-compatible';
export type LlmPreset = 'openai' | 'xai' | 'gemini' | 'openrouter' | 'ollama' | 'lmstudio' | 'custom';
export type LlmTier = 'sonnet' | 'opus' | 'haiku';
export const TIERS: LlmTier[] = ['opus', 'sonnet', 'haiku'];
export const PROVIDERS: LlmProvider[] = ['claude-cli', 'anthropic', 'openai-compatible'];
export const PRESETS: LlmPreset[] = ['openai', 'xai', 'gemini', 'openrouter', 'ollama', 'lmstudio', 'custom'];

/** Saved in projects/_settings.json. Never holds a key. `models.all` sets one model for every tier. */
export interface LlmSettings {
  provider: LlmProvider;
  preset?: LlmPreset;
  baseUrl?: string;
  models?: Partial<Record<LlmTier | 'all', string>>;
}

interface Meta { label: string; baseUrl?: string; keyEnv?: string; keyRequired: boolean; models: Record<LlmTier, string>; note?: string }

// Default model ids, checked 2026-10-24: Anthropic from the Claude API model table; OpenAI from
// developers.openai.com/api/docs/models; Gemini from ai.google.dev/gemini-api/docs/models;
// xAI and OpenRouter from openrouter.ai/api/v1/models. Local servers have no default: you name the model you pulled.
const BLANK: Record<LlmTier, string> = { opus: '', sonnet: '', haiku: '' };
export const META: Record<'claude-cli' | 'anthropic' | LlmPreset, Meta> = {
  'claude-cli': { label: 'Claude CLI (subscription)', keyRequired: false, models: { opus: 'opus', sonnet: 'sonnet', haiku: 'haiku' }, note: 'Uses the `claude` command and your Claude plan. No key.' },
  anthropic: { label: 'Anthropic API', baseUrl: 'https://api.anthropic.com/v1', keyEnv: 'ANTHROPIC_API_KEY', keyRequired: true, models: { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' } },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', keyRequired: true, models: { opus: 'gpt-6-astra', sonnet: 'gpt-6.1-sol', haiku: 'gpt-6-luna' } },
  xai: { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY', keyRequired: true, models: { opus: 'grok-4.7', sonnet: 'grok-4.7', haiku: 'grok-4.3' } },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', keyRequired: true, models: { opus: 'gemini-4-argon', sonnet: 'gemini-3.8-flash', haiku: 'gemini-3.5-flash-lite' } },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', keyRequired: true, models: { opus: 'anthropic/claude-opus-5.5', sonnet: 'anthropic/claude-sonnet-5.5', haiku: 'anthropic/claude-haiku-5.5' } },
  ollama: { label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', keyRequired: false, models: BLANK, note: 'Free, on this machine. Name a model you pulled, ideally one that can see pictures.' },
  lmstudio: { label: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1', keyRequired: false, models: BLANK, note: 'Free, on this machine. Name the model you loaded.' },
  custom: { label: 'Custom (OpenAI-compatible)', keyEnv: 'HEARTCUT_LLM_API_KEY', keyRequired: false, models: BLANK, note: 'Any server that speaks the OpenAI chat completions API.' },
};

export interface ResolvedLlm {
  provider: LlmProvider;
  preset?: LlmPreset;
  baseUrl?: string;
  models: Record<LlmTier, string>;
  /** auto: picked from what this machine has (see `reason`). none: nothing found; llmJson refuses with `reason`. */
  source: 'saved' | 'env' | 'auto' | 'none';
  /** Why auto picked this, or why nothing was found. Plain words, never a key. */
  reason?: string;
  label: string;
  keyEnv?: string;      // the variable to set
  keyRequired: boolean;
  keyFound: boolean;
}

const PROVIDER_ALIASES: Record<string, Pick<LlmSettings, 'provider' | 'preset'>> = {
  cli: { provider: 'claude-cli' }, 'claude-cli': { provider: 'claude-cli' }, claude: { provider: 'claude-cli' },
  api: { provider: 'anthropic' }, anthropic: { provider: 'anthropic' },
  'openai-compatible': { provider: 'openai-compatible' },
  ...Object.fromEntries(PRESETS.map((p) => [p, { provider: 'openai-compatible' as const, preset: p }])),
  grok: { provider: 'openai-compatible', preset: 'xai' },
};

/** Throws a plain message on a bad shape. Rejects anything that looks like a key. */
export function checkLlmSettings(v: unknown): LlmSettings {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('llm must be an object');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (/key|token|secret|password/i.test(k)) throw new Error('API keys are never saved in settings. Put them in the .env file in the Heartcut folder.');
    if (!['provider', 'preset', 'baseUrl', 'models'].includes(k)) throw new Error(`llm.${k} is not a setting`);
  }
  if (!PROVIDERS.includes(o.provider as LlmProvider)) throw new Error(`llm.provider must be one of ${PROVIDERS.join(', ')}`);
  const out: LlmSettings = { provider: o.provider as LlmProvider };
  if (o.preset !== undefined && o.preset !== null && o.preset !== '') {
    if (!PRESETS.includes(o.preset as LlmPreset)) throw new Error(`llm.preset must be one of ${PRESETS.join(', ')}`);
    out.preset = o.preset as LlmPreset;
  }
  if (o.baseUrl !== undefined && o.baseUrl !== null && o.baseUrl !== '') {
    if (typeof o.baseUrl !== 'string' || !/^https?:\/\/[^\s]+$/.test(o.baseUrl) || o.baseUrl.length > 500) throw new Error('llm.baseUrl must be an http(s) URL');
    out.baseUrl = o.baseUrl.replace(/\/+$/, '');
  }
  if (o.models !== undefined && o.models !== null) {
    if (typeof o.models !== 'object' || Array.isArray(o.models)) throw new Error('llm.models must be an object');
    const m: NonNullable<LlmSettings['models']> = {};
    for (const [k, val] of Object.entries(o.models as Record<string, unknown>)) {
      if (![...TIERS, 'all'].includes(k)) throw new Error(`llm.models.${k}: use opus, sonnet, haiku or all`);
      if (val === undefined || val === null || val === '') continue;
      if (typeof val !== 'string' || val.length > 200 || /\s/.test(val.trim())) throw new Error(`llm.models.${k} must be a model id`);
      m[k as LlmTier | 'all'] = val.trim();
    }
    if (Object.keys(m).length) out.models = m;
  }
  if (out.provider === 'openai-compatible' && !out.preset) out.preset = 'custom';
  if (out.provider !== 'openai-compatible') delete out.preset;
  return out;
}

function envModels(env: NodeJS.ProcessEnv): LlmSettings['models'] | undefined {
  const models: Record<string, string> = {};
  if (env.HEARTCUT_LLM_MODEL) models.all = env.HEARTCUT_LLM_MODEL;
  for (const t of TIERS) { const v = env[`HEARTCUT_LLM_MODEL_${t.toUpperCase()}`]; if (v) models[t] = v; }
  return Object.keys(models).length ? models : undefined;
}

function fromEnv(env: NodeJS.ProcessEnv): LlmSettings | undefined {
  const name = (env.HEARTCUT_LLM_PROVIDER || env.HEARTCUT_LLM || '').trim().toLowerCase();
  if (!name || name === 'auto') return undefined;
  const base = PROVIDER_ALIASES[name];
  if (!base) throw new Error(`HEARTCUT_LLM_PROVIDER=${name} is not known. Use auto, claude-cli, anthropic, ${PRESETS.join(', ')}`);
  const s: LlmSettings = { ...base };
  if (env.HEARTCUT_LLM_PRESET && s.provider === 'openai-compatible') s.preset = env.HEARTCUT_LLM_PRESET as LlmPreset;
  if (env.HEARTCUT_LLM_BASE_URL) s.baseUrl = env.HEARTCUT_LLM_BASE_URL;
  const models = envModels(env);
  if (models) s.models = models;
  return checkLlmSettings(s);
}

// ---------- auto-pick ----------

/** Auto-pick order for API keys. */
export const AUTO_KEYS: { keyEnv: string; pick: Pick<LlmSettings, 'provider' | 'preset'> }[] = [
  { keyEnv: 'ANTHROPIC_API_KEY', pick: { provider: 'anthropic' } },
  { keyEnv: 'OPENAI_API_KEY', pick: { provider: 'openai-compatible', preset: 'openai' } },
  { keyEnv: 'XAI_API_KEY', pick: { provider: 'openai-compatible', preset: 'xai' } },
  { keyEnv: 'GEMINI_API_KEY', pick: { provider: 'openai-compatible', preset: 'gemini' } },
  { keyEnv: 'OPENROUTER_API_KEY', pick: { provider: 'openai-compatible', preset: 'openrouter' } },
];
/** Local servers auto may use, in order. Only these two loopback URLs are ever probed, and only their free model list. */
const LOCAL_ORDER: ('ollama' | 'lmstudio')[] = ['ollama', 'lmstudio'];
const PROBE_TIMEOUT_MS = 500;
const CACHE_MS = 30_000;

/** Test seams: PATH lookup, the fetch used for the local probe, and the clock. */
export const llmHooks = {
  which: (bin: string): string | null => findOnPath(bin),
  fetch: (url: string, init?: RequestInit): Promise<Response> => globalThis.fetch(url, init),
  now: (): number => Date.now(),
};

export interface LocalLlm { preset: 'ollama' | 'lmstudio'; model: string }
let whichCache: { at: number; path: string | null } | undefined;
let localCache: { at: number; found: LocalLlm | null } | undefined;
let inflight: Promise<LocalLlm | null> | undefined;

/** Forget cached probe results (tests, and the dashboard after you change something). */
export function resetLlmProbe(): void { whichCache = undefined; localCache = undefined; inflight = undefined; }

const fresh = (c: { at: number } | undefined): boolean => !!c && llmHooks.now() - c.at < CACHE_MS;

function claudeOnPath(): string | null {
  if (!fresh(whichCache)) whichCache = { at: llmHooks.now(), path: llmHooks.which('claude') };
  return whichCache!.path;
}

async function askLocal(preset: 'ollama' | 'lmstudio'): Promise<LocalLlm | null> {
  try {
    const r = await llmHooks.fetch(`${META[preset].baseUrl}/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!r.ok) return null;
    const j = await r.json() as { data?: { id?: unknown }[] };
    const id = j?.data?.find((m) => typeof m?.id === 'string' && m.id)?.id;
    return typeof id === 'string' ? { preset, model: id } : null;
  } catch { return null; }
}

/** Ask Ollama and LM Studio on this machine for their model list (free, loopback only, ~500 ms at most). Cached. */
export async function probeLocalLlm(): Promise<LocalLlm | null> {
  if (fresh(localCache)) return localCache!.found;
  inflight ??= (async () => {
    const found = await Promise.all(LOCAL_ORDER.map(askLocal));
    localCache = { at: llmHooks.now(), found: found.find(Boolean) ?? null };
    inflight = undefined;
    return localCache.found;
  })();
  return inflight;
}

/**
 * Run the local probe only when auto would reach it: nothing saved, no HEARTCUT_LLM_PROVIDER, no `claude`, no key.
 * Fake mode never probes. Call before resolveLlm wherever the answer matters (llmJson, status, the doctor).
 */
export async function primeLlmAuto(saved: LlmSettings | undefined, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env === process.env) loadEnv();
  if (saved || env.HEARTCUT_FAKE === '1') return;
  try { if (fromEnv(env)) return; } catch { return; }
  if (claudeOnPath() || AUTO_KEYS.some((k) => env[k.keyEnv])) return;
  await probeLocalLlm();
}

const NONE_REASON = 'No language model found. The claude command is not installed, no API key is set, and no Ollama or LM Studio server is running on this computer.';

function autoPick(env: NodeJS.ProcessEnv): { s?: LlmSettings; reason: string } {
  if (claudeOnPath()) return { s: { provider: 'claude-cli' }, reason: 'the claude command is installed' };
  for (const k of AUTO_KEYS) if (env[k.keyEnv]) return { s: { ...k.pick }, reason: `${k.keyEnv} is set` };
  // The last probe answer, even if older than CACHE_MS: primeLlmAuto refreshes it, sync callers keep a stable answer.
  const local = localCache?.found ?? null;
  if (local) return { s: { provider: 'openai-compatible', preset: local.preset, models: { all: local.model } }, reason: `${META[local.preset].label} is running with ${local.model}` };
  return { reason: NONE_REASON };
}

/** The key for a resolved config, or undefined. Only ever read here and by the HTTP adapters; never returned to a client. */
export function apiKeyFor(r: Pick<ResolvedLlm, 'provider' | 'preset'>, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (r.provider === 'claude-cli') return undefined;
  const meta = r.provider === 'anthropic' ? META.anthropic : META[r.preset ?? 'custom'];
  return (meta.keyEnv && env[meta.keyEnv]) || env.HEARTCUT_LLM_API_KEY || undefined;
}

/**
 * The active config. `saved` is the stored setting (pass `undefined` for none); `override` wins over both
 * (used by the connection test to try unsaved form values).
 */
export function resolveLlm(saved: LlmSettings | undefined, override?: LlmSettings, env: NodeJS.ProcessEnv = process.env): ResolvedLlm {
  if (env === process.env) loadEnv();
  let s: LlmSettings | undefined;
  let source: ResolvedLlm['source'] = 'none';
  let reason: string | undefined;
  if (override) { s = checkLlmSettings(override); source = 'saved'; }
  else if (saved) { s = saved; source = 'saved'; }
  else { s = fromEnv(env); if (s) source = 'env'; }
  if (!s) {
    const a = autoPick(env);
    reason = a.reason;
    if (a.s) {
      s = a.s; source = 'auto';
      const m = envModels(env);
      if (m) s.models = { ...s.models, ...m };
    }
  }
  if (!s) {
    // Nothing found. Report it as not set up; llmJson refuses with `reason` instead of trying a missing command.
    return { provider: 'claude-cli', models: { ...META['claude-cli'].models }, source: 'none', reason, label: 'Not set up', keyRequired: false, keyFound: false };
  }
  const meta = s.provider === 'openai-compatible' ? META[s.preset ?? 'custom'] : META[s.provider];
  const models = Object.fromEntries(TIERS.map((t) => [t, s.models?.[t] || s.models?.all || meta.models[t]])) as Record<LlmTier, string>;
  const r: ResolvedLlm = {
    provider: s.provider, preset: s.provider === 'openai-compatible' ? s.preset ?? 'custom' : undefined,
    baseUrl: s.provider === 'claude-cli' ? undefined : (s.baseUrl || meta.baseUrl),
    models, source, ...(reason ? { reason } : {}), label: meta.label, keyEnv: meta.keyEnv, keyRequired: meta.keyRequired, keyFound: false,
  };
  r.keyFound = !!apiKeyFor(r, env);
  return r;
}

/** What the dashboard needs to draw the picker. No keys, only variable names. */
export const llmOptions = () => ({
  providers: PROVIDERS.map((p) => ({ id: p, label: p === 'openai-compatible' ? 'ChatGPT, Grok, Gemini, OpenRouter or local' : META[p].label })),
  presets: PRESETS.map((p) => ({ id: p, label: META[p].label, baseUrl: META[p].baseUrl ?? '', keyEnv: META[p].keyEnv ?? '', keyRequired: META[p].keyRequired, models: META[p].models, note: META[p].note ?? '' })),
  defaults: { 'claude-cli': META['claude-cli'].models, anthropic: META.anthropic.models },
  keyEnv: { anthropic: META.anthropic.keyEnv },
});
