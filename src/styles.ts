// Styles: the built-in presets (prompts/styles.json), the user's own (projects/_styles.json), validation,
// the STYLE section the LLM stages inject, and the small text helpers the stage post-processing shares.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Project, StyleFamily, StyleSpec } from './types.ts';
import { PROJECTS_DIR, slugify } from './store.ts';
import { IDENTITY_MODELS, IMAGE_MODELS, QWEN_EDIT, QWEN_T2I, SOUL } from './gen/models.ts';
import { higgsfieldToolPath, resolveGen } from './gen/config.ts';
import { apiSoulStyles } from './gen/higgsfield-api.ts';
import { storedGen } from './settings.ts';

export { IMAGE_MODELS, IDENTITY_MODELS };

export const DEFAULT_STYLE_ID = 'cinematic-realism';
export const FAMILIES: StyleFamily[] = ['photoreal', 'film', 'anime', 'cartoon', 'illustration', '3d', 'custom'];

const BUILTIN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'styles.json');

/** Thrown for bad input (400), unknown ids (404) and attempts to touch a built-in (403). */
export class StyleError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = 'StyleError'; this.status = status; }
}

function userFile(): string { return path.join(PROJECTS_DIR, '_styles.json'); }

let builtinCache: StyleSpec[] | undefined;
function builtins(): StyleSpec[] {
  builtinCache ??= (JSON.parse(fs.readFileSync(BUILTIN_FILE, 'utf8')) as StyleSpec[]).map((s) => ({ ...s, builtin: true }));
  return builtinCache;
}

function userStyles(): StyleSpec[] {
  try {
    const raw = JSON.parse(fs.readFileSync(userFile(), 'utf8'));
    return Array.isArray(raw) ? raw.map((s: StyleSpec) => ({ ...s, builtin: undefined })) : [];
  } catch { return []; }
}

/** Built-ins first (in file order), then the user's. On an id clash the user's style wins in place. */
export function listStyles(): StyleSpec[] {
  const user = userStyles();
  const byId = new Map(user.map((s) => [s.id, s]));
  const out = builtins().map((b) => byId.get(b.id) ?? structuredClone(b));
  for (const u of user) if (!out.some((s) => s.id === u.id)) out.push(u);
  return out.map((s) => structuredClone(s));
}

export function getStyle(id: string): StyleSpec | undefined {
  return listStyles().find((s) => s.id === id);
}

/** The style a project uses: its snapshot, or the default preset when it has none. */
export function styleFor(p: Pick<Project, 'style'>): StyleSpec {
  return p.style ?? getStyle(DEFAULT_STYLE_ID)!;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Validate and normalise a user style. Throws StyleError(400). Pure apart from reading `existing` ids. */
function clean(input: any, id: string): StyleSpec {
  if (!input || typeof input !== 'object') throw new StyleError(400, 'style body required');
  const name = isStr(input.name) ? input.name.trim() : '';
  if (!name) throw new StyleError(400, 'name required');
  if (!FAMILIES.includes(input.family)) throw new StyleError(400, `family must be one of ${FAMILIES.join(', ')}`);
  const family = input.family as StyleFamily;
  const m = input.models ?? {};
  const drawn = ['anime', 'cartoon', 'illustration', '3d'].includes(family);
  const faces = m.faces ?? (drawn ? QWEN_T2I : SOUL);
  const places = m.places ?? faces;
  for (const [what, slug] of [['faces', faces], ['places', places]] as const) {
    if (!IMAGE_MODELS[slug]) throw new StyleError(400, `models.${what}: unknown image model "${slug}" (one of ${Object.keys(IMAGE_MODELS).join(', ')})`);
    if (IMAGE_MODELS[slug].kind === 'photo' && drawn) {
      throw new StyleError(400, `models.${what}: ${IMAGE_MODELS[slug].label} only draws photographs, it cannot serve a ${family} style`);
    }
  }
  const identity = m.identity ?? QWEN_EDIT;
  if (!IDENTITY_MODELS[identity]) throw new StyleError(400, `models.identity: unknown identity model "${identity}"`);
  const soulStyleId = isStr(input.soulStyleId) && input.soulStyleId.trim() ? input.soulStyleId.trim() : undefined;
  if (soulStyleId && faces !== SOUL) throw new StyleError(400, 'soulStyleId only works when models.faces is Soul 2');
  const negatives = Array.isArray(input.negatives) ? input.negatives.filter(isStr).map((n: string) => n.trim()).filter(Boolean) : [];
  const spec: StyleSpec = {
    id, name, family,
    description: isStr(input.description) ? input.description.trim() : '',
    look: isStr(input.look) ? input.look.trim() : '',
    negatives,
    videoHints: isStr(input.videoHints) ? input.videoHints.trim() : '',
    models: { faces, places, identity },
    updatedAt: new Date().toISOString(),
  };
  if (isStr(input.sheetLook) && input.sheetLook.trim()) spec.sheetLook = input.sheetLook.trim();
  if (soulStyleId) spec.soulStyleId = soulStyleId;
  return spec;
}

function writeUser(list: StyleSpec[]): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const f = userFile();
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, f);
}

/**
 * Save a user style. Without `id`, or with the id of a built-in or an unknown id, it is a new style whose id is
 * slugified from the name (made unique). With the id of an existing user style it updates that one.
 * `builtin` is always stripped. Returns the saved spec.
 */
export function saveStyle(input: Partial<StyleSpec> & Record<string, unknown>): StyleSpec {
  const user = userStyles();
  const builtinIds = new Set(builtins().map((b) => b.id));
  const updating = isStr(input.id) && user.some((s) => s.id === input.id) && !builtinIds.has(input.id);
  let id: string;
  if (updating) id = input.id as string;
  else {
    const base = slugify(isStr(input.name) ? input.name : '') || 'style';
    const taken = new Set([...builtinIds, ...user.map((s) => s.id)]);
    id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  }
  const spec = clean(input, id);
  writeUser(updating ? user.map((s) => (s.id === id ? spec : s)) : [...user, spec]);
  return spec;
}

/** Delete a user style. Built-ins are 403, unknown ids 404. */
export function deleteStyle(id: string): void {
  if (builtins().some((b) => b.id === id) && !userStyles().some((s) => s.id === id)) throw new StyleError(403, 'built-in styles cannot be deleted');
  const user = userStyles();
  if (!user.some((s) => s.id === id)) throw new StyleError(404, `no style: ${id}`);
  writeUser(user.filter((s) => s.id !== id));
}

// ---------- how a style changes the prompts ----------

/** The default look is the engine's own vocabulary, so the stages leave its prompts untouched. */
export const isDefaultStyle = (s: StyleSpec): boolean => s.id === DEFAULT_STYLE_ID;

/** True when the LOOK text replaces the realism and camera-stock vocabulary (anime, cartoon, illustration, 3d,
 *  and a custom style unless it draws faces with a photographic model). */
export function replacesRealism(s: StyleSpec): boolean {
  if (s.family === 'photoreal' || s.family === 'film') return false;
  if (s.family === 'custom') return IMAGE_MODELS[s.models.faces]?.kind !== 'photo';
  return true;
}

// Comma-separated pieces of a prompt that only make sense for a photograph.
const REALISM = [
  /\b(ARRI|Alexa|Hasselblad|Sony A7|A7R|RED Komodo|Canon|Nikon|Leica|Panavision)\b/i,
  /\b\d+(\s*(to|-)\s*\d+)?\s*mm\b/i,
  /\bf\/\d/i, /\bT\d(\.\d)?\b/,
  /\b(8k|4k|photorealistic|hyper-?realistic|ultra[- ]realistic|documentary realism|photograph|photography)\b/i,
  /\b(skin pores|peach fuzz|subsurface scattering|film stock|film grain|35mm|anamorphic|bokeh|highlight rolloff|octabox|cyclorama)\b/i,
  /\b(large-format|medium-format|full-frame|cinema camera|stills camera|highlight roll-?off|film colou?r|fine grain|skin with pores|visible pores|retouching|documentary feel|natural skin texture|studio backdrop|filmed not rendered)\b/i,
];

/** Drop the comma pieces that carry camera brands, lens specs and photographic texture tags. */
export function scrubRealism(text: string): string {
  return text.split(/,\s*/).filter((piece) => piece.trim() && !REALISM.some((re) => re.test(piece))).join(', ');
}

/** Append `add` unless the text already contains its first 20 characters (case-insensitive). */
export function appendOnce(text: string, add: string): string {
  const a = add.trim();
  if (!a || text.toLowerCase().includes(a.slice(0, 20).toLowerCase())) return text;
  return `${text.replace(/[,.\s]+$/, '')}, ${a}`;
}

/** Append each missing style negative to the end of a prompt (t2i models have no negative field). */
export function appendNegatives(text: string, negatives: string[]): string {
  const lower = text.toLowerCase();
  const absent = negatives.map((n) => n.trim()).filter((n) => n && !lower.includes(n.toLowerCase()));
  return absent.length ? `${text.replace(/[,.\s]+$/, '')}, ${absent.join(', ')}` : text;
}

/** The STYLE section of the user message for the sheets and scenes stages. */
export function styleSection(s: StyleSpec): string {
  const rule = replacesRealism(s)
    ? 'This is not a photographic style: LOOK replaces the realism and camera-stock vocabulary. No camera brands, lens specs, skin pores or "photorealistic" tags.'
    : 'This is a photographic style: keep the realism vocabulary of the block library and add LOOK on top.';
  return [
    '# STYLE',
    `Name: ${s.name}`,
    `Family: ${s.family}`,
    `LOOK: ${s.look}`,
    `SHEET LOOK (character sheets): ${s.sheetLook ?? s.look}`,
    `STYLE NEGATIVES: ${s.negatives.join(', ') || '(none)'}`,
    `VIDEO HINTS (end every scene prompt with these): ${s.videoHints || '(none)'}`,
    rule,
  ].join('\n');
}

// ---------- Soul style ids ----------

let soulCache: Promise<{ id: string; name: string }[]> | undefined;

/** FAKE mode: a fixed list of five real ids so the picker works offline. */
export const FAKE_SOUL_STYLES = [
  { id: '069f5a5f-8c4b-4591-a3dd-bde488672228', name: 'Retro BW' },
  { id: '2c109e42-bf29-47a2-ae16-aa6cbbba8b8a', name: 'Warm contrast film' },
  { id: '5e87c5bd-86b6-491a-94ab-046891d1e35e', name: 'Flash editorial' },
  { id: '95151de0-e0e5-4e04-bd45-c58c8a4ac023', name: 'Street photography' },
  { id: '74abc530-cec8-4c13-88a6-2b3f78bfd0ff', name: 'Digital camera' },
];

/** `higgsfield.mjs styles` (tab-separated "id<TAB>name" lines), cached for the life of the process. */
export function soulStyles(): Promise<{ id: string; name: string }[]> {
  if (process.env.HEARTCUT_FAKE === '1') return Promise.resolve(FAKE_SOUL_STYLES);
  // Soul styles are a Higgsfield feature: the API lists them for a Higgsfield key; fal and Replicate have none.
  const g = resolveGen(storedGen());
  if (g.provider === 'higgsfield') return apiSoulStyles();
  if (g.provider !== 'higgsfield-tool') return Promise.reject(new Error(`Soul styles need Higgsfield; the active service is ${g.label}`));
  soulCache ??= new Promise((resolve, reject) => {
    const tool = higgsfieldToolPath();
    execFile(process.execPath, [tool, 'styles'], { maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`higgsfield styles failed: ${(stderr || err.message).trim().slice(0, 300)}`));
      resolve(stdout.split('\n').map((l) => l.split('\t')).filter((c) => /^[0-9a-f-]{36}$/.test(c[0]) && c[1]).map((c) => ({ id: c[0], name: c[1].trim() })));
    });
  });
  soulCache.catch(() => { soulCache = undefined; }); // a failure is not cached
  return soulCache;
}
