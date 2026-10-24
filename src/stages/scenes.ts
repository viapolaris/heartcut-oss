// Stage: scenes — one video prompt per beat, post-processed into the contract invariants.
import type { Emit, Estimate, Project, PromptBlock, RunOptions, SceneBeat, ScenePrompt, StyleSpec } from '../types.ts';
import { llmJson, loadPrompt, photoList } from '../llm.ts';
import { contextFor, saveProject } from '../store.ts';
import { isDefaultStyle, replacesRealism, scrubRealism, styleFor, styleSection } from '../styles.ts';

const str = { type: 'string' };

/** Test seam: swap the LLM call (tests assert on the `images` it gets). */
export const hooks = { llm: llmJson };

/** The user's context pictures for these scene ids, as `images` paths plus the photoList() lines that label them. */
export function scenePhotos(p: Project, sceneIds: string[]): { images: string[]; lines: string } {
  const refs = sceneIds.flatMap((id) => contextFor(p, { sceneId: id }).map((r) => ({ r, id })));
  return {
    images: refs.map(({ r }) => r.path),
    lines: photoList(refs.map(({ r, id }) => ({ path: r.path, label: `the director's own picture for scene ${id}${r.note ? `, note="${r.note}"` : ''}: use it for that scene's framing, set dressing, light and action; it is also attached to the shot as a reference image` }))).trim(),
  };
}

export const SCENES_SCHEMA = {
  type: 'object',
  required: ['scenes'],
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sceneId'],
        properties: {
          sceneId: str,
          prompt: str, // accepted for robustness; `blocks` is what the prompt asks for
          blocks: { type: 'array', items: { type: 'object', required: ['name', 'text'], properties: { name: str, text: str } } },
          negatives: { type: 'array', items: str },
          motion: str, // v5: 2-3 sentences, motion + camera movement only (the short video prompt)
        },
      },
    },
  },
};

// "no zoom", "no hard cuts" ... up to the next comma/period/semicolon.
export function extractNegatives(prompt: string): string[] {
  return (prompt.match(/\bno\s+[a-z][^,.;\n]*/gi) ?? []).map((s) => s.trim().toLowerCase());
}

export function refAssetIdsFor(p: Project, beat: SceneBeat): string[] {
  const have = new Set((p.sheets?.items ?? []).map((i) => i.id));
  const ids: string[] = [];
  for (const ch of beat.characters) {
    const full = `${ch.characterId}_${ch.stateId}_full`;
    const portrait = `${ch.characterId}_${ch.stateId}_portrait`;
    ids.push(have.has(full) || !have.has(portrait) ? full : portrait);
  }
  ids.push(`loc_${beat.locationId}`);
  return [...new Set(ids)];
}

/** Block names in block-library order (prompts/blocks.md). */
export const BLOCK_NAMES = ['SHOT', 'SUBJECT', 'IDENTITY', 'PERFORM', 'PHYSICS', 'MATCHCUT', 'LOCATION', 'LIGHT', 'GRADE', 'CAMERA', 'LOOK', 'QUALITY', 'NEGATIVES'] as const;
/** Blocks derived from the script/sheets/style: the UI shows them dashed and says "edit upstream". */
export const LOCKED_BLOCKS = new Set(['SUBJECT', 'IDENTITY', 'LOCATION', 'LIGHT', 'GRADE', 'LOOK']);

/**
 * prompt = every block except NEGATIVES joined with ', ', then the negatives joined once at the end.
 * That is exactly blocks.map(b => b.text).join(', ') once the NEGATIVES block text equals negatives.join(', '). Pure.
 */
export function joinBlocks(blocks: PromptBlock[], negatives: string[]): string {
  const body = blocks.filter((b) => b.name !== 'NEGATIVES').map((b) => b.text.trim().replace(/[,.\s]+$/, '')).filter(Boolean);
  const tail = negatives.map((n) => n.trim()).filter(Boolean).join(', ');
  return (tail ? [...body, tail] : body).join(', ');
}

const splitList = (t: string): string[] => t.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Canonical order, locked flags, NEGATIVES last and in sync with `negatives`. Pure. */
export function normalizeBlocks(blocks: PromptBlock[], negatives: string[]): PromptBlock[] {
  const rank = (n: string): number => { const i = (BLOCK_NAMES as readonly string[]).indexOf(n); return i < 0 ? BLOCK_NAMES.length - 1.5 : i; };
  const out = blocks
    .filter((b) => b.name !== 'NEGATIVES' && b.text.trim())
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rank(x.b.name) - rank(y.b.name) || x.i - y.i)
    .map(({ b }): PromptBlock => (LOCKED_BLOCKS.has(b.name) ? { name: b.name, text: b.text.trim(), locked: true } : { name: b.name, text: b.text.trim() }));
  out.push({ name: 'NEGATIVES', text: negatives.join(', ') });
  return out;
}

/**
 * Re-derive prompt/negatives from a ScenePrompt that carries blocks (used by PATCH). `negatives`
 * wins over the NEGATIVES block text; if the item has no negatives array, the block's comma list is used.
 */
export function syncBlocks(sp: ScenePrompt): ScenePrompt {
  if (!sp.blocks?.length) return sp;
  const fromBlock = splitList(sp.blocks.find((b) => b.name === 'NEGATIVES')?.text ?? '');
  const negatives = Array.isArray(sp.negatives) ? sp.negatives.map((n) => n.trim()).filter(Boolean) : fromBlock;
  const blocks = normalizeBlocks(sp.blocks, negatives);
  return { ...sp, blocks, negatives, prompt: joinBlocks(blocks, negatives) };
}

export interface RawScene { sceneId?: string; prompt?: string; blocks?: PromptBlock[]; negatives?: string[]; motion?: string }

const lc = (list: string[]): string[] => list.map((n) => n.trim().toLowerCase()).filter(Boolean);

/**
 * Make a scene obey the style (also when the model drifted, and in fake mode): realism vocabulary scrubbed from
 * the unlocked blocks (SHOT, PERFORM, PHYSICS, CAMERA, QUALITY: the locked ones copy the script) for non-photo styles, a locked LOOK block added, the style's videoHints at the end of the
 * QUALITY block (so they are the tail of the prompt, just before NEGATIVES), style negatives merged in.
 * The default style is left alone. Returns the blocks without NEGATIVES, and the merged negatives.
 */
function styleBlocks(blocks: PromptBlock[], negatives: string[], style: StyleSpec): { blocks: PromptBlock[]; negatives: string[] } {
  const scrub = replacesRealism(style);
  const out = blocks
    .filter((b) => b.name !== 'LOOK')
    .map((b) => ({ ...b, text: scrub && !LOCKED_BLOCKS.has(b.name) ? scrubRealism(b.text) : b.text }));
  if (style.look.trim()) out.push({ name: 'LOOK', text: style.look.trim() });
  const hints = style.videoHints.trim();
  if (hints) {
    const q = out.find((b) => b.name === 'QUALITY');
    if (!q) out.push({ name: 'QUALITY', text: hints });
    else if (!q.text.toLowerCase().includes(hints.slice(0, 20).toLowerCase())) q.text = q.text.trim() ? `${q.text.trim().replace(/[,.\s]+$/, '')}, ${hints}` : hints;
  }
  return { blocks: out, negatives: [...new Set([...negatives, ...lc(style.negatives)])] };
}

export function finish(p: Project, beat: SceneBeat, raw: RawScene): ScenePrompt {
  const style = styleFor(p);
  const styled = !isDefaultStyle(style);
  const motion = typeof raw.motion === 'string' && raw.motion.trim() ? raw.motion.trim() : undefined;
  const base = {
    sceneId: beat.id,
    refAssetIds: refAssetIdsFor(p, beat),
    durationSec: beat.durationSec,
    aspect: p.aspect,
    audio: false,
    ...(motion ? { motion } : {}),
  };
  if (raw.blocks?.length) {
    let others = raw.blocks.filter((b) => b.name !== 'NEGATIVES');
    const negBlock = raw.blocks.filter((b) => b.name === 'NEGATIVES').flatMap((b) => splitList(b.text));
    let negatives = [...new Set([...(raw.negatives ?? []).map((n) => n.trim().toLowerCase()), ...negBlock])].filter(Boolean); // no scraping of other blocks: "almost no visible pupil" is a description, not a negative
    if (styled) ({ blocks: others, negatives } = styleBlocks(others, negatives, style));
    const blocks = normalizeBlocks(others, negatives);
    return { ...base, prompt: joinBlocks(blocks, negatives), blocks, negatives };
  }
  let rawPrompt = raw.prompt ?? '';
  if (styled && replacesRealism(style)) rawPrompt = scrubRealism(rawPrompt);
  let negatives = [...new Set([...(raw.negatives ?? []).map((n) => n.trim().toLowerCase()), ...extractNegatives(rawPrompt)])].filter(Boolean);
  let prompt = rawPrompt.trim();
  if (styled) {
    negatives = [...new Set([...negatives, ...lc(style.negatives)])];
    for (const add of [style.look, style.videoHints]) {
      if (add.trim() && !prompt.toLowerCase().includes(add.trim().slice(0, 20).toLowerCase())) prompt = `${prompt.replace(/[,.\s]+$/, '')}, ${add.trim()}`;
    }
  }
  const lower = prompt.toLowerCase();
  const absent = negatives.filter((n) => !lower.includes(n));
  if (absent.length) prompt = `${prompt.replace(/[,.\s]+$/, '')}, ${absent.join(', ')}`;
  return { ...base, prompt, negatives };
}

async function ask(p: Project, only?: string[]): Promise<RawScene[]> {
  const script = p.script!;
  const beats = script.scenes.filter((b) => !only || only.includes(b.id));
  const system = `${loadPrompt('system-scenes')}\n\n# Block library\n\n${loadPrompt('blocks')}`;
  const photos = scenePhotos(p, beats.map((b) => b.id));
  const user = [
    `Aspect ratio: ${p.aspect}`,
    `Return one entry per scene id: ${beats.map((b) => b.id).join(', ')}. Return blocks (the block names, in order, MATCHCUT only on a match-cut beat) per scene; put the "no ..." clauses only in the NEGATIVES block and list them in negatives. Repeat each character's wardrobe line verbatim in every scene they appear in. Also return "motion": 2-3 present-tense sentences of what the body does and what the camera does as movement words (no appearance, no wardrobe, no location, no lens brand, no object named as a camera).`,
    styleSection(styleFor(p)),
    `# Script\n${JSON.stringify({ ...script, scenes: beats }, null, 2)}`,
    `# Sheet prompts (the continuity source)\n${JSON.stringify(p.sheets!.items.map((i) => ({ id: i.id, prompt: i.prompt })), null, 2)}`,
    photos.lines,
  ].filter(Boolean).join('\n\n');
  return (await hooks.llm<{ scenes: RawScene[] }>({ system, user, schema: SCENES_SCHEMA, maxTokens: 24000, ...(photos.images.length ? { images: photos.images } : {}) })).scenes;
}

export async function run(p: Project, _opts: RunOptions, emit: Emit): Promise<Project> {
  if (!p.script) throw new Error('scenes needs a script — run the script stage first');
  if (!p.sheets) throw new Error('scenes needs sheets — run the sheets stage first');
  const beats = [...p.script.scenes].sort((a, b) => a.order - b.order);
  emit(`writing ${beats.length} scene prompts`);
  const has = (r?: RawScene): boolean => !!(r?.blocks?.length || r?.prompt?.trim());
  const got = new Map((await ask(p)).map((r) => [r.sceneId!, r]));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const missing = beats.filter((b) => !has(got.get(b.id))).map((b) => b.id);
    if (!missing.length) break;
    emit(`re-requesting missing scene prompt(s): ${missing.join(', ')}`);
    for (const r of await ask(p, missing)) got.set(r.sceneId!, r);
  }
  const stillMissing = beats.filter((b) => !has(got.get(b.id))).map((b) => b.id);
  if (stillMissing.length) throw new Error(`scenes: model did not produce prompts for ${stillMissing.join(', ')}`);
  const prev = new Map((p.scenePrompts ?? []).map((sp) => [sp.sceneId, sp]));
  p.scenePrompts = beats.map((b) => {
    const sp = finish(p, b, got.get(b.id)!);
    // endFrame is the user's wish for this beat, not the model's output: it survives a rewrite.
    if (prev.get(b.id)?.endFrame) sp.endFrame = true;
    return sp;
  });
  saveProject(p);
  emit(`scenes saved: ${p.scenePrompts.length} prompts`);
  return p;
}

export async function estimate(_p: Project, _opts: RunOptions): Promise<Estimate> {
  return { usd: 0, items: [] };
}
