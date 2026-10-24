// Stage: keyframes (v5) — one still per shot, written by the LLM in KEYFRAME block order and drawn by the Qwen
// image edit from the chosen sheets (characters first, location last), so the face is relit to the scene before
// anything moves. Optional: clips still run from the sheets alone when a beat has no chosen keyframe.
import fs from 'node:fs';
import path from 'node:path';
import type { Emit, Estimate, Keyframe, KeyframeRole, Project, PromptBlock, RunOptions, SceneBeat, ScenePrompt } from '../types.ts';
import { KEYFRAME_BLOCKS } from '../types.ts';
import { llmJson, loadPrompt, photoList } from '../llm.ts';
import { contextFor, mediaDir, saveProject } from '../store.ts';
// The provider layer (src/gen/provider.ts): whichever picture-and-video service is active.
import * as hf from '../gen/provider.ts';
import { priceNote } from '../gen/provider.ts';
import { QWEN_EDIT, aspectFor, stripRefTags } from '../gen/models.ts';
import { joinBlocks, refAssetIdsFor } from './scenes.ts';
import { isDefaultStyle, styleFor, styleSection } from '../styles.ts';
import { probe } from '../ffmpeg.ts';
import { attachJob, usd } from './_job.ts';

export { KEYFRAME_BLOCKS };
export const KEYFRAME_MODEL = QWEN_EDIT;
/** Two sequential submits per keyframe: the edit returns one image per call. */
export const KEYFRAME_CALLS = 2;
/** Blocks copied from the script/sheets/style: the UI shows them dashed and says "edit upstream". */
export const KEYFRAME_LOCKED = new Set(['SUBJECT', 'IDENTITY', 'LOCATION', 'GRADE', 'LOOK']);

/** Test seams: swap the submit function and the LLM call. */
export const hooks = { run: hf.run, llm: llmJson };

/** The scene's context pictures (v6.1) whose files exist, in upload order. */
export const sceneContextPaths = (p: Project, sceneId: string): string[] => contextFor(p, { sceneId }).map((r) => r.path).filter((f) => fs.existsSync(f));

/** Everything the edit gets for one keyframe: the chosen sheets (characters first, location last), then the scene's own pictures. */
export function keyframeRefs(p: Project, sceneId: string, refAssetIds: string[]): string[] {
  return [...new Set([...refFiles(p, refAssetIds), ...sceneContextPaths(p, sceneId)])];
}

const str = { type: 'string' };
export const KEYFRAMES_SCHEMA = {
  type: 'object',
  required: ['keyframes'],
  properties: {
    keyframes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sceneId', 'role'],
        properties: {
          sceneId: str,
          role: { type: 'string', enum: ['start', 'end'] },
          blocks: { type: 'array', items: { type: 'object', required: ['name', 'text'], properties: { name: str, text: str } } },
          negatives: { type: 'array', items: str },
        },
      },
    },
  },
};

export interface RawKeyframe { sceneId?: string; role?: KeyframeRole; blocks?: PromptBlock[]; negatives?: string[] }

export const keyframeId = (sceneId: string, role: KeyframeRole): string => `kf_${sceneId}_${role}`;

/** `kf_<sceneId>_<role>` -> its parts (scene ids may themselves contain underscores). */
export function parseKeyframeId(id: string): { sceneId: string; role: KeyframeRole } | undefined {
  const m = /^kf_(.+)_(start|end)$/.exec(id);
  return m ? { sceneId: m[1], role: m[2] as KeyframeRole } : undefined;
}

/** The roles a beat wants: always `start`, plus `end` when the user switched it on. */
export const rolesFor = (sp: Pick<ScenePrompt, 'endFrame'>): KeyframeRole[] => (sp.endFrame ? ['start', 'end'] : ['start']);

const splitList = (t: string): string[] => t.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const lc = (list: string[]): string[] => list.map((n) => n.trim().toLowerCase()).filter(Boolean);

/** Canonical KEYFRAME order, locked flags, NEGATIVES last and in sync with `negatives`. Pure. */
export function normalizeKeyframeBlocks(blocks: PromptBlock[], negatives: string[]): PromptBlock[] {
  const rank = (n: string): number => { const i = (KEYFRAME_BLOCKS as readonly string[]).indexOf(n); return i < 0 ? KEYFRAME_BLOCKS.length - 1.5 : i; };
  const out = blocks
    .filter((b) => b.name !== 'NEGATIVES' && b.text.trim())
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rank(x.b.name) - rank(y.b.name) || x.i - y.i)
    // Trailing commas/periods go, so prompt === blocks.map(b => b.text).join(', ') holds exactly.
    .map(({ b }): PromptBlock => { const text = b.text.trim().replace(/[,.\s]+$/, ''); return KEYFRAME_LOCKED.has(b.name) ? { name: b.name, text, locked: true } : { name: b.name, text }; });
  out.push({ name: 'NEGATIVES', text: negatives.join(', ') });
  return out;
}

/** prompt = blocks (minus NEGATIVES) joined with ', ' + the negatives once at the end. Pure. */
export const joinKeyframe = (blocks: PromptBlock[], negatives: string[]): string => joinBlocks(blocks, negatives);

/** Re-derive prompt/negatives from a Keyframe that carries blocks (the PATCH path). Items without blocks pass through. */
export function syncKeyframe(k: Keyframe): Keyframe {
  if (!k.blocks?.length) return k;
  const fromBlock = splitList(k.blocks.find((b) => b.name === 'NEGATIVES')?.text ?? '');
  const negatives = Array.isArray(k.negatives) ? k.negatives.map((n) => n.trim()).filter(Boolean) : fromBlock;
  const blocks = normalizeKeyframeBlocks(k.blocks, negatives);
  return { ...k, blocks, negatives, prompt: joinKeyframe(blocks, negatives) };
}

/** `{{char:id}}` / `{{loc:id}}` in the text -> the sheet ids they stand for (the beat's state for a character; the
 *  full-body sheet, else the portrait), only those that exist in the project's sheets. */
export function placeholderAssetIds(p: Project, beat: SceneBeat, text: string): string[] {
  const have = new Set((p.sheets?.items ?? []).map((i) => i.id));
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{(char|loc):([^}]+)\}\}/g)) {
    const id = m[2].trim();
    if (m[1] === 'loc') { if (have.has(`loc_${id}`)) out.push(`loc_${id}`); continue; }
    const stateId = beat.characters.find((c) => c.characterId === id)?.stateId
      ?? p.script?.characters.find((c) => c.id === id)?.states.find((s) => s.id === beat.era)?.id
      ?? p.script?.characters.find((c) => c.id === id)?.states[0]?.id;
    if (!stateId) continue;
    const full = `${id}_${stateId}_full`;
    const portrait = `${id}_${stateId}_portrait`;
    if (have.has(full)) out.push(full); else if (have.has(portrait)) out.push(portrait);
  }
  return [...new Set(out)];
}

/** The beat's references exactly as the scenes stage derives them, plus any placeholder the keyframe text tags that
 *  the beat did not list. Characters first, location last. */
export function keyframeRefAssetIds(p: Project, beat: SceneBeat, blocks: PromptBlock[] = []): string[] {
  const ids = new Set([...refAssetIdsFor(p, beat), ...placeholderAssetIds(p, beat, blocks.map((b) => b.text).join(' '))]);
  return [...ids].sort((a, b) => Number(a.startsWith('loc_')) - Number(b.startsWith('loc_')));
}

/** Chosen files of `refAssetIds`, characters first and the location last (the order the edit reads them in). Throws on an unpicked asset. */
export function refFiles(p: Project, refAssetIds: string[]): string[] {
  const assets = refAssetIds.map((id) => {
    const a = p.assets.find((x) => x.id === id);
    if (!a) throw new Error(`referenced asset ${id} does not exist`);
    const opt = a.chosen === undefined ? undefined : a.options[a.chosen];
    if (!opt?.path) throw new Error(`asset ${id} has no chosen option — pick one in Images before generating keyframes`);
    return { a, path: opt.path };
  });
  return assets.sort((x, y) => Number(x.a.kind === 'location') - Number(y.a.kind === 'location')).map((x) => x.path);
}

/** The chosen picture of a beat's keyframe, if any (clips use it as image_url / end_image_url). */
export function chosenKeyframeFile(p: Project, sceneId: string, role: KeyframeRole): string | undefined {
  const k = (p.keyframes ?? []).find((x) => x.sceneId === sceneId && x.role === role);
  const opt = k && k.chosen !== undefined ? k.options[k.chosen] : undefined;
  return opt?.path;
}

/** Turn the model's raw blocks into a Keyframe (no pictures yet): style LOOK + negatives merged for non-default looks,
 *  locked flags, prompt joined, references resolved. Pure apart from reading `p`. */
export function finishKeyframe(p: Project, beat: SceneBeat, role: KeyframeRole, raw: RawKeyframe, existing?: Keyframe): Keyframe {
  const style = styleFor(p);
  let others = (raw.blocks ?? []).filter((b) => b.name !== 'NEGATIVES');
  const negBlock = (raw.blocks ?? []).filter((b) => b.name === 'NEGATIVES').flatMap((b) => splitList(b.text));
  let negatives = [...new Set([...lc(raw.negatives ?? []), ...negBlock])];
  if (!isDefaultStyle(style)) {
    if (style.look.trim() && !others.some((b) => b.name === 'LOOK')) others = [...others, { name: 'LOOK', text: style.look.trim() }];
    negatives = [...new Set([...negatives, ...lc(style.negatives)])];
  }
  const blocks = normalizeKeyframeBlocks(others, negatives);
  return {
    id: keyframeId(beat.id, role), sceneId: beat.id, role,
    prompt: joinKeyframe(blocks, negatives), blocks, negatives,
    refAssetIds: keyframeRefAssetIds(p, beat, blocks),
    model: KEYFRAME_MODEL,
    options: existing?.options ?? [],
    ...(existing?.chosen !== undefined ? { chosen: existing.chosen } : {}),
    ...(existing?.sources ? { sources: existing.sources } : {}),
    ...(existing?.jobId ? { jobId: existing.jobId } : {}),
    ...(existing?.costUsd !== undefined ? { costUsd: existing.costUsd } : {}),
  };
}

const hasPrompt = (k?: Keyframe): boolean => !!k && k.prompt.trim() !== '' && k.prompt.trim() !== '(imported)';

export function buildKeyframeInput(p: Project, prompt: string, refs: string[]): Record<string, unknown> {
  return { prompt: stripRefTags(prompt), image_urls: refs, resolution: '1k', aspect_ratio: aspectFor(KEYFRAME_MODEL, p.aspect) };
}

interface Target {
  sp: ScenePrompt; beat: SceneBeat; role: KeyframeRole; id: string; existing?: Keyframe;
  needPrompt: boolean;   // no prompt yet (or force)
  needPictures: boolean; // no options yet (or force)
  refs: string[];        // chosen files, characters first, location last
}

function targets(p: Project, opts: RunOptions): Target[] {
  if (!p.script) throw new Error('keyframes needs a script — run the script stage first');
  if (!p.scenePrompts) throw new Error('keyframes needs scene prompts — run the scenes stage first');
  const beats = [...p.script.scenes].sort((a, b) => a.order - b.order);
  const prompts = p.scenePrompts;
  if (opts.ids) {
    const missing = opts.ids.filter((id) => !prompts.some((sp) => sp.sceneId === id));
    if (missing.length) throw new Error(`no scene prompt for: ${missing.join(', ')}`);
  }
  const out: Target[] = [];
  for (const beat of beats) {
    if (opts.ids && !opts.ids.includes(beat.id)) continue;
    const sp = prompts.find((x) => x.sceneId === beat.id);
    if (!sp) continue;
    for (const role of rolesFor(sp)) {
      const id = keyframeId(beat.id, role);
      const existing = (p.keyframes ?? []).find((k) => k.id === id);
      const refIds = existing?.refAssetIds?.length ? existing.refAssetIds : keyframeRefAssetIds(p, beat, existing?.blocks);
      out.push({
        sp, beat, role, id, existing,
        needPrompt: !!opts.force || !hasPrompt(existing),
        needPictures: !!opts.force || !existing?.options.length,
        refs: keyframeRefs(p, beat.id, refIds),
      });
    }
  }
  return out;
}

async function ask(p: Project, want: Target[]): Promise<RawKeyframe[]> {
  const script = p.script!;
  const beatIds = [...new Set(want.map((t) => t.beat.id))];
  const beats = script.scenes.filter((b) => beatIds.includes(b.id));
  const system = `${loadPrompt('system-keyframes')}\n\n# Block library\n\n${loadPrompt('blocks')}`;
  const ctx = beatIds.flatMap((sceneId) => sceneContextPaths(p, sceneId).map((path) => ({ path, sceneId })));
  const user = [
    `Aspect ratio: ${p.aspect}`,
    `Return one entry per (sceneId, role): ${want.map((t) => `${t.beat.id}/${t.role}`).join(', ')}. Return blocks in KEYFRAME order (${KEYFRAME_BLOCKS.join(', ')}); POSE is the frozen instant of the action, mid-action, never a static pose (role "end" = the last instant of the beat); LIGHT is the location's light plus the relight clause for the face and clothes; put the "no ..." clauses only in the NEGATIVES block and list them in negatives. Repeat each character's wardrobe line verbatim.`,
    styleSection(styleFor(p)),
    `# Script\n${JSON.stringify({ ...script, scenes: beats }, null, 2)}`,
    `# Scene prompts (copy SUBJECT, IDENTITY, LOCATION, GRADE and CAMERA from these)\n${JSON.stringify(p.scenePrompts!.filter((sp) => beatIds.includes(sp.sceneId)).map((sp) => ({ sceneId: sp.sceneId, blocks: sp.blocks ?? [{ name: 'PROMPT', text: sp.prompt }], negatives: sp.negatives, motion: sp.motion })), null, 2)}`,
    `# Sheet prompts (the continuity source)\n${JSON.stringify((p.sheets?.items ?? []).map((i) => ({ id: i.id, prompt: i.prompt })), null, 2)}`,
    photoList(ctx.map((c) => ({ path: c.path, label: `the director's own picture for scene ${c.sceneId}: use it for that still's framing, set dressing and light; it is also attached as a reference image` }))).trim(),
  ].filter(Boolean).join('\n\n');
  return (await hooks.llm<{ keyframes: RawKeyframe[] }>({ system, user, schema: KEYFRAMES_SCHEMA, maxTokens: 24000, ...(ctx.length ? { images: ctx.map((c) => c.path) } : {}) })).keyframes;
}

export async function estimate(p: Project, opts: RunOptions): Promise<Estimate> {
  const items: Estimate['items'] = [];
  let total = 0;
  for (const t of targets(p, opts)) {
    if (!t.needPictures) { items.push({ id: t.id, model: KEYFRAME_MODEL, usd: 0, note: 'already has options' }); continue; }
    const input = buildKeyframeInput(p, hasPrompt(t.existing) ? t.existing!.prompt : '(written at run)', t.refs);
    const price = (await hf.estimate(KEYFRAME_MODEL, input)) * KEYFRAME_CALLS;
    total += price;
    const where = await priceNote(KEYFRAME_MODEL, input);
    items.push({ id: t.id, model: KEYFRAME_MODEL, usd: Math.round(price * 1000) / 1000, note: `${KEYFRAME_CALLS} calls${t.needPrompt ? '; prompt written at run ($0)' : ''}${where ? `; ${where}` : ''}` });
  }
  return { usd: Math.round(total * 1000) / 1000, items };
}

function nextFile(dir: string, id: string, from: number): { file: string; n: number } {
  let n = from;
  let file = path.join(dir, `${id}-v${n}.png`);
  while (fs.existsSync(file)) file = path.join(dir, `${id}-v${++n}.png`);
  return { file, n };
}

export async function run(p: Project, opts: RunOptions, emit: Emit): Promise<Project> {
  const h = attachJob(p, 'keyframes', emit);
  const all = targets(p, opts);
  if (!all.length) { h.log('no beats to make keyframes for'); return p; }
  p.keyframes ??= [];

  // 1. Prompts ($0): one LLM call for everything that has none yet, re-asking once for anything the model skipped.
  const wantPrompt = all.filter((t) => t.needPrompt);
  if (wantPrompt.length && opts.dryRun) h.log(`dry run — ${wantPrompt.length} keyframe prompt(s) would be written`);
  else if (wantPrompt.length) {
    h.log(`writing ${wantPrompt.length} keyframe prompt(s)`);
    const key = (sceneId: string, role: string) => `${sceneId}/${role}`;
    const has = (r?: RawKeyframe): boolean => !!r?.blocks?.length;
    const got = new Map<string, RawKeyframe>();
    const take = (rs: RawKeyframe[]) => { for (const r of rs) if (r.sceneId && r.role) got.set(key(r.sceneId, r.role), r); };
    take(await ask(p, wantPrompt));
    for (let attempt = 1; attempt <= 2; attempt++) {
      const missing = wantPrompt.filter((t) => !has(got.get(key(t.beat.id, t.role))));
      if (!missing.length) break;
      h.log(`re-requesting missing keyframe prompt(s): ${missing.map((t) => t.id).join(', ')}`);
      take(await ask(p, missing));
    }
    const still = wantPrompt.filter((t) => !has(got.get(key(t.beat.id, t.role))));
    if (still.length) throw new Error(`keyframes: model did not produce prompts for ${still.map((t) => t.id).join(', ')}`);
    for (const t of wantPrompt) {
      const k = finishKeyframe(p, t.beat, t.role, got.get(key(t.beat.id, t.role))!, t.existing);
      const at = p.keyframes.findIndex((x) => x.id === k.id);
      if (at >= 0) p.keyframes[at] = k; else p.keyframes.push(k);
      t.existing = k;
      t.refs = keyframeRefs(p, t.beat.id, k.refAssetIds);
    }
    saveProject(p);
    h.log(`keyframe prompts saved: ${wantPrompt.length}`);
  }

  // 2. Pictures: two sequential edits per keyframe, appended as options.
  for (const t of all) {
    if (!t.needPictures) { h.log(`skip ${t.id}: already has options`); continue; }
    const prompt = hasPrompt(t.existing) ? t.existing!.prompt : '(written at run)';
    const input = buildKeyframeInput(p, prompt, t.refs);
    const price = (await hf.estimate(KEYFRAME_MODEL, input)) * KEYFRAME_CALLS;
    h.log(`estimate ${usd(price)} for keyframe ${t.id} (${KEYFRAME_MODEL}, ${KEYFRAME_CALLS} calls)`);
    if (opts.dryRun) { h.log(`dry run — ${t.id} not generated`); continue; }
    const k = t.existing!;
    const dir = mediaDir(p.slug, 'keyframes');
    let paid = 0;
    let failure: unknown;
    const added: Keyframe['options'] = [];
    for (let i = 0; i < KEYFRAME_CALLS; i++) {
      const { file, n } = nextFile(dir, k.id, k.options.length + 1);
      try {
        // Never retry a failed submit (no idempotency key).
        const res = await hooks.run(KEYFRAME_MODEL, input, { project: p.slug, name: `${k.id}-v${n}`, sub: 'keyframes', emit: h.log });
        const src = res.files[0];
        if (!src) throw new Error('generation returned no image file');
        if (path.resolve(src) !== path.resolve(file)) fs.renameSync(src, file);
        let meta: { width?: number; height?: number } = {};
        try { meta = await probe(file); } catch { /* keep the picture even if probing fails */ }
        const opt = { path: file, width: meta.width, height: meta.height };
        while ((k.sources ??= []).length < k.options.length) k.sources.push({ kind: 'generated', model: KEYFRAME_MODEL });
        k.options.push(opt);
        k.sources.push({ kind: 'generated', model: KEYFRAME_MODEL });
        added.push(opt);
        paid += res.usd;
        h.log(`keyframe ${t.id} · option ${i + 1}/${KEYFRAME_CALLS} done`);
      } catch (e) { failure = e; break; }
    }
    k.model = KEYFRAME_MODEL;
    k.jobId = h.job?.id;
    k.costUsd = Math.round(((k.costUsd ?? 0) + paid) * 1000) / 1000;
    if (added.length) { h.addOutputs(added, paid); saveProject(p); }
    if (failure) throw failure;
  }
  return p;
}
