// Stage: sheets — Script -> one portrait (humans only) + one full-body prompt per (character,state), one per location.
import { notesSection } from './script.ts';
import type { CharacterSpec, Emit, Estimate, Project, RunOptions, Script, SheetPrompt, Sheets, StyleSpec } from '../types.ts';
import { llmJson, loadPrompt, photoList } from '../llm.ts';
import { contextFor, saveProject } from '../store.ts';
import { appendNegatives, appendOnce, isDefaultStyle, replacesRealism, scrubRealism, styleFor, styleSection } from '../styles.ts';

const str = { type: 'string' };

export const SHEETS_SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'prompt'],
        properties: {
          id: str,
          kind: { type: 'string', enum: ['character-portrait', 'character-full', 'location'] },
          characterId: str, stateId: str, locationId: str, prompt: str,
        },
      },
    },
  },
};

export const MIN_PROMPT = 200;
export const IDENTITY_TAG = '[identity: ref]';
export const anchorTag = (id: string) => `[anchor: ${id}]`;
/** Test seam: swap the LLM call (tests assert on the `images` it gets). */
export const hooks = { llm: llmJson };

/** The user's context pictures for these sheet ids, as `images` paths plus the photoList() lines that label them. */
export function sheetPhotos(p: Project, ids: string[]): { images: string[]; lines: string } {
  const refs = ids.flatMap((id) => contextFor(p, { assetId: id }).map((r) => ({ r, id })));
  return {
    images: refs.map(({ r }) => r.path),
    lines: photoList(refs.map(({ r, id }) => ({ path: r.path, label: `the director's own picture for sheet ${id}${r.note ? `, note="${r.note}"` : ''}: describe what it shows (face, hair, build, clothes, props, or the place) in that sheet's prompt, keeping the sheet's own background and framing rules` }))).trim(),
  };
}

const ANCHOR_CLAUSE = 'the same character as the reference image, same face, same hair, same markings';

/**
 * The sheet a character's other pictures are built from. Humans: the first state's portrait (the face).
 * Animals and others: the first state's full body. Returns undefined for the anchor itself, for locations
 * and for unknown ids. Every non-anchor sheet of the character depends on it.
 */
export function anchorFor(script: Script, sheetId: string): string | undefined {
  for (const c of script.characters ?? []) {
    const states = c.states ?? [];
    const first = states[0];
    if (!first) continue;
    const anchor = `${c.id}_${first.id}_${c.species === 'human' ? 'portrait' : 'full'}`;
    if (states.some((s) => sheetId === `${c.id}_${s.id}_portrait` || sheetId === `${c.id}_${s.id}_full`)) {
      if (sheetId === anchor) return undefined;
      if (sheetId.endsWith('_portrait') && c.species !== 'human') return undefined;
      return anchor;
    }
  }
  return undefined;
}

/** Asset ids whose anchor was re-picked, regenerated or unpicked since they were built from it. */
export function anchorStale(p: Project): string[] {
  const out: string[] = [];
  for (const a of p.assets ?? []) {
    if (a.anchorIndex === undefined) continue;
    const anchorId = p.sheets?.items?.find((s) => s.id === a.id)?.dependsOn ?? (p.script ? anchorFor(p.script, a.id) : undefined);
    if (!anchorId) continue;
    const anchor = (p.assets ?? []).find((x) => x.id === anchorId);
    if (!anchor || anchor.chosen !== a.anchorIndex || (a.anchorJob !== undefined && anchor.jobId !== a.anchorJob)) out.push(a.id);
  }
  return out;
}

// The deterministic list of sheets a script requires.
export function expectedItems(script: Script): Omit<SheetPrompt, 'prompt'>[] {
  const out: Omit<SheetPrompt, 'prompt'>[] = [];
  for (const c of script.characters) {
    for (const s of c.states) {
      // Animals (and 'other') get one full-body picture; only humans need a separate face portrait.
      if (c.species === 'human') out.push({ id: `${c.id}_${s.id}_portrait`, kind: 'character-portrait', characterId: c.id, stateId: s.id });
      out.push({ id: `${c.id}_${s.id}_full`, kind: 'character-full', characterId: c.id, stateId: s.id });
    }
  }
  for (const l of script.locations) out.push({ id: `loc_${l.id}`, kind: 'location', locationId: l.id });
  for (const o of out) { const a = anchorFor(script, o.id); if (a) o.dependsOn = a; }
  return out;
}

function sameWardrobe(prompt: string, c: CharacterSpec): boolean {
  return prompt.toLowerCase().includes(c.wardrobe.trim().toLowerCase());
}

// Words that make an image model draw an annotated design page (labels, arrows, side views, swatches)
// instead of one clean picture. Seen live 2026-10-11 on Qwen: "character model sheet" → a titled chart.
const SHEET_WORDS: [RegExp, string][] = [
  [/character (reference|model|design) sheet,?\s*full[- ]body/gi, 'full body view, head to toe'],
  [/character (reference|model|design) sheet/gi, 'single full-body picture of the character'],
  [/character sprite sheet/gi, 'single full-body sprite of the character'],
  [/sprite sheet/gi, 'single sprite'],
  [/(reference|model|design|character) sheet/gi, 'single picture'],
  [/full[- ]body turnaround( presentation| render)?/gi, 'standing and facing the viewer'],
  [/turnaround/gi, 'standing pose'],
  [/\bsheet\b/gi, 'picture'],
];
export function scrubSheetWords(prompt: string): string {
  let out = prompt;
  for (const [re, to] of SHEET_WORDS) out = out.replace(re, to);
  return out;
}

/**
 * Make a sheet prompt obey the style even when the model drifted (and in fake mode, where the canned prompts
 * are photographic). Non-photo styles lose camera brands, lens specs and texture tags; every style gets its
 * look and negatives appended unless already present. Characters get `sheetLook ?? look`; locations get `look`
 * (sheetLook describes a character sheet: plain background, turnaround). The default style is left alone.
 */
export function applyStyle(prompt: string, kind: SheetPrompt['kind'], style: StyleSpec): string {
  prompt = scrubSheetWords(prompt);
  if (isDefaultStyle(style)) return prompt;
  let out = replacesRealism(style) ? scrubRealism(prompt) : prompt;
  out = appendOnce(out, kind === 'location' ? style.look : style.sheetLook ?? style.look);
  return appendNegatives(out, style.negatives);
}

// Apply the deterministic invariants to the LLM's raw items. Returns the usable
// items plus the ids still missing/too short (to be re-requested).
export function normalize(script: Script, raw: { id: string; prompt: string }[], style?: StyleSpec): { items: SheetPrompt[]; missing: string[] } {
  const byId = new Map(raw.map((r) => [r.id, r.prompt]));
  const items: SheetPrompt[] = [];
  const missing: string[] = [];
  for (const e of expectedItems(script)) {
    let prompt = (byId.get(e.id) ?? '').trim();
    if (prompt.length < MIN_PROMPT) { missing.push(e.id); continue; }
    const c = script.characters.find((x) => x.id === e.characterId);
    if (style) prompt = applyStyle(prompt, e.kind, style); // after the length check: scrubbing may shorten it
    if (c) {
      if (!sameWardrobe(prompt, c)) prompt = `${c.wardrobe}, ${prompt}`;
      if (c.identityRefId && !prompt.startsWith(IDENTITY_TAG)) prompt = `${IDENTITY_TAG} ${prompt}`;
      if (e.dependsOn) {
        // Built from the anchor's chosen picture: say so in words the image model reads, then tag it for the engine.
        if (!/reference image/i.test(prompt)) prompt = prompt.replace(/^(\[identity: ref\]\s*)?/, `$1${ANCHOR_CLAUSE}, `);
        prompt = `${anchorTag(e.dependsOn)} ${prompt}`;
      }
    }
    items.push({ ...e, prompt });
  }
  return { items, missing };
}

async function ask(p: Project, script: Script, only?: string[]): Promise<{ id: string; prompt: string }[]> {
  const system = `${loadPrompt('system-sheets')}\n\n# Block library\n\n${loadPrompt('blocks')}`;
  const want = only ?? expectedItems(script).map((e) => e.id);
  const photos = sheetPhotos(p, want);
  const user = [
    `Aspect ratio: ${p.aspect}`,
    `Return one item for each of these ids, using exactly these ids (kind: *_portrait = character-portrait, *_full = character-full, loc_* = location): ${want.join(', ')}`,
    `Sheets that depend on an anchor (every sheet of a character except the first state's portrait, or for animals the first state's full body) start with the tag [anchor: <anchorId>] and say "the same character as the reference image, same face, same hair, same markings, same <wardrobe line>". Anchors: ${expectedItems(script).filter((e) => e.dependsOn).map((e) => `${e.id} -> ${e.dependsOn}`).join(', ') || 'none'}.`,
    `Each prompt must be at least ${MIN_PROMPT} characters. Every character's portrait (humans only) and full-body prompts must contain that character's wardrobe line verbatim.`,
    styleSection(styleFor(p)),
    notesSection(p).trim(),
    photos.lines,
    `# Script\n${JSON.stringify(script, null, 2)}`,
  ].filter(Boolean).join('\n\n');
  const out = await hooks.llm<Sheets>({ system, user, schema: SHEETS_SCHEMA, maxTokens: 16000, ...(photos.images.length ? { images: photos.images } : {}) });
  return out.items;
}

export async function run(p: Project, _opts: RunOptions, emit: Emit): Promise<Project> {
  if (!p.script) throw new Error('sheets needs a script — run the script stage first');
  const script = p.script;
  emit('writing sheet prompts');
  let raw = await ask(p, script);
  const style = styleFor(p);
  let result = normalize(script, raw, style);
  for (let attempt = 1; attempt <= 2 && result.missing.length; attempt++) {
    emit(`re-requesting ${result.missing.length} missing sheet prompt(s): ${result.missing.join(', ')}`);
    raw = [...raw, ...(await ask(p, script, result.missing))];
    // later duplicates win over earlier short ones
    result = normalize(script, [...new Map(raw.map((r) => [r.id, r])).values()], style);
  }
  if (result.missing.length) throw new Error(`sheets: model did not produce usable prompts for ${result.missing.join(', ')}`);
  p.sheets = { items: result.items };
  saveProject(p);
  emit(`sheets saved: ${result.items.length} prompts`);
  return p;
}

export async function estimate(_p: Project, _opts: RunOptions): Promise<Estimate> {
  return { usd: 0, items: [] };
}
