// App settings (projects/_settings.json): `preferLocal` (render drawn-medium sheets on this Mac for free) and
// `llm` (which language model to use; see src/llm/config.ts). API keys are never stored here.
import fs from 'node:fs';
import path from 'node:path';
import type { StyleSpec } from './types.ts';
import { PROJECTS_DIR } from './store.ts';
import { TO_LOCAL } from './gen/models.ts';
import { isLocalAvailable } from './gen/local.ts';
import { checkLlmSettings, type LlmSettings } from './llm/config.ts';
import { checkGenSettings, type GenSettings } from './gen/config.ts';

/** `gen`: which picture-and-video service and the sitting cap (src/gen/config.ts). */
export interface Settings { preferLocal: boolean; llm?: LlmSettings; gen?: GenSettings }

const file = () => path.join(PROJECTS_DIR, '_settings.json');

function stored(): Partial<Settings> {
  try { const raw = JSON.parse(fs.readFileSync(file(), 'utf8')); return raw && typeof raw === 'object' ? raw : {}; } catch { return {}; }
}

/** The saved LLM choice, or undefined. A hand-edited bad value is ignored rather than breaking every call. */
export function storedLlm(): LlmSettings | undefined {
  const v = stored().llm;
  if (!v) return undefined;
  try { return checkLlmSettings(v); } catch { return undefined; }
}

/** The saved picture-service choice, or undefined. A hand-edited bad value is ignored. */
export function storedGen(): GenSettings | undefined {
  const v = stored().gen;
  if (!v) return undefined;
  try { const g = checkGenSettings(v); return Object.keys(g).length ? g : undefined; } catch { return undefined; }
}

function preferLocalNow(s: Partial<Settings>): boolean {
  if (typeof s.preferLocal === 'boolean') return s.preferLocal;
  const env = process.env.HEARTCUT_PREFER_LOCAL;
  if (env === '0' || env === '1') return env === '1';
  return isLocalAvailable().ok;
}

/** preferLocal: saved choice, else HEARTCUT_PREFER_LOCAL=0|1, else on when the Mac can do it. llm: saved choice only. */
export function getSettings(): Settings {
  const s = stored();
  const llm = storedLlm();
  const gen = storedGen();
  return { preferLocal: preferLocalNow(s), ...(llm ? { llm } : {}), ...(gen ? { gen } : {}) };
}

/** `llm: null` clears the saved choice (back to env / the claude CLI). `gen: null` clears the picture-service choice (back to env / auto). */
// Only what was saved or patched is written, so an untouched preferLocal keeps following env and the Mac.
export function saveSettings(patch: Partial<Omit<Settings, 'llm' | 'gen'>> & { llm?: LlmSettings | null; gen?: GenSettings | null }): Settings {
  const next: Partial<Settings> = { ...stored() };
  if (typeof patch.preferLocal === 'boolean') next.preferLocal = patch.preferLocal;
  if (patch.llm === null) delete next.llm;
  else if (patch.llm !== undefined) next.llm = checkLlmSettings(patch.llm);
  if (patch.gen === null) delete next.gen;
  else if (patch.gen !== undefined) { const g = checkGenSettings(patch.gen); if (Object.keys(g).length) next.gen = g; else delete next.gen; }
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file());
  return getSettings();
}

/** The setting is on AND the Mac can actually do it. */
export const localInEffect = (): boolean => getSettings().preferLocal && isLocalAvailable().ok;

/** The style with faces/places mapped to their local twins when local is in effect. The identity edit stays on Higgsfield. */
export function resolveModels<T extends Pick<StyleSpec, 'models'>>(style: T, on: boolean = localInEffect()): T {
  if (!on) return style;
  const m = style.models;
  return { ...style, models: { ...m, faces: TO_LOCAL[m.faces] ?? m.faces, places: TO_LOCAL[m.places] ?? m.places } };
}
