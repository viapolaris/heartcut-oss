// ScenePrompts -> Clips. Draft = Seedance 2.5 480p silent; final = 720p with the scene's audio flag.
// Seedance has no seed, so "final" is a fresh generation from the same prompt and refs, not an upscale.
//
// v5 sources: a beat whose `start` keyframe has a chosen picture animates that still (image-to-video, the keyframe
// carries identity, default prompt = the short motion text); otherwise the sheets ride along (reference-to-video,
// full prompt) as before. `sequence` makes ONE reference-to-video take over several beats with hard cuts inside it.
import type { Asset, Clip, ClipSource, ClipTier, Emit, Estimate, Project, PromptMode, RunOptions, SceneBeat, ScenePrompt } from '../types.ts';
import { newId, saveProject } from '../store.ts';
// The provider layer (src/gen/provider.ts): whichever picture-and-video service is active.
import * as hf from '../gen/provider.ts';
import { priceNote } from '../gen/provider.ts';
import { buildVideoInput, clampDuration, videoModel } from '../gen/models.ts';
import { probe } from '../ffmpeg.ts';
import { attachJob, usd } from './_job.ts';
import { chosenKeyframeFile, sceneContextPaths } from './keyframes.ts';

interface Plan {
  sp: ScenePrompt; tier: ClipTier; label: string; detail: string; input: Record<string, unknown>;
  source: ClipSource; mode: PromptMode; prompt: string; model: string; sceneIds?: string[];
}

/** Test seam: swap the submit function. */
export const hooks = { run: hf.run };

export const SHORT_MIN = 150;
export const SHORT_MAX = 450;

function assetPath(a: Asset): string {
  const opt = a.chosen === undefined ? undefined : a.options[a.chosen];
  if (!opt) throw new Error(`asset ${a.id} has no chosen option — pick one in Images before generating clips`);
  return opt.path;
}

function assetsOf(p: Project, ids: string[], sceneId: string): Asset[] {
  return ids.map((id) => {
    const a = p.assets.find((x) => x.id === id);
    if (!a) throw new Error(`scene ${sceneId}: referenced asset ${id} does not exist`);
    return a;
  });
}

// Character sheets first, location last (the order Seedance reads references in); stable otherwise. Then the scene's own
// context pictures (v6.1). Seedance takes at most 30 image_urls.
export function refPaths(p: Project, sp: ScenePrompt): string[] {
  const rank = (a: Asset) => (a.kind === 'location' ? 1 : 0);
  const sheets = [...assetsOf(p, sp.refAssetIds, sp.sceneId)].sort((a, b) => rank(a) - rank(b)).map(assetPath);
  return [...new Set([...sheets, ...sceneContextPaths(p, sp.sceneId)])].slice(0, 30);
}

function hasApprovedDraft(p: Project, sceneId: string): boolean {
  return p.clips.some((c) => c.sceneId === sceneId && c.tier === 'draft' && c.approved && c.status === 'done' && (c.source ?? 'reference') !== 'sequence');
}

const sameIds = (a: string[] | undefined, b: string[]): boolean => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

function hasApprovedSequenceDraft(p: Project, sceneIds: string[]): boolean {
  return p.clips.some((c) => c.source === 'sequence' && c.tier === 'draft' && c.approved && c.status === 'done' && sameIds(c.sceneIds, sceneIds));
}

function sceneLabel(p: Project, sceneId: string): string {
  const beat = p.script?.scenes.find((s) => s.id === sceneId);
  return beat ? `Scene ${beat.order}` : `Scene ${sceneId}`;
}

const text = (sp: ScenePrompt, name: string): string => sp.blocks?.find((b) => b.name === name)?.text.trim().replace(/[,.\s]+$/, '') ?? '';

/** The "no camera movement / no zoom / no slow push-in / no morphing" family: negatives about motion, not appearance. */
export const isMotionNegative = (n: string): boolean =>
  /\b(camera|zoom\w*|push|pull|pans?|panning|tilt\w*|dolly|crane|track\w*|drift\w*|morph\w*|cuts?|dissolv\w*|blend\w*|movement|motion|shak\w*|jitter|speed ramp|slow motion|fast)\b/i.test(n);

/** Trim a comma list to at most `max` characters, cutting at a clause boundary. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(', ', max);
  return (cut > 0 ? s.slice(0, cut) : s.slice(0, max)).replace(/[,.\s]+$/, '');
}

/** Short-mode text: `sp.motion` when the scenes stage wrote it; otherwise SHOT + PERFORM + PHYSICS block texts plus the
 *  motion negatives only, kept between SHORT_MIN and SHORT_MAX characters where the material allows. */
export function shortPrompt(sp: ScenePrompt): string {
  if (sp.motion?.trim()) return sp.motion.trim();
  const negs = sp.negatives.filter(isMotionNegative).join(', ');
  const room = SHORT_MAX - (negs ? negs.length + 2 : 0);
  const parts = sp.blocks?.length ? ['SHOT', 'PERFORM', 'PHYSICS'].map((n) => text(sp, n)).filter(Boolean) : [clip(sp.prompt, room)];
  let body = '';
  for (const part of parts) {
    const next = body ? `${body}, ${part}` : part;
    if (next.length <= room) { body = next; continue; }
    // Too long: take as much of this part as fits only when the body is still under the floor.
    if (body.length < SHORT_MIN) body = clip(next, room);
    break;
  }
  return negs ? `${body}, ${negs}` : body;
}

/** Beats in script order for the given ids (throws when an id has no scene prompt). */
function beatsFor(p: Project, sceneIds: string[]): { beat: SceneBeat; sp: ScenePrompt }[] {
  const prompts = p.scenePrompts ?? [];
  const missing = sceneIds.filter((id) => !prompts.some((sp) => sp.sceneId === id));
  if (missing.length) throw new Error(`no scene prompt for: ${missing.join(', ')}`);
  const beats = p.script?.scenes ?? [];
  return [...sceneIds]
    .map((id) => ({ beat: beats.find((b) => b.id === id) ?? ({ id, order: Number.MAX_SAFE_INTEGER, durationSec: prompts.find((sp) => sp.sceneId === id)!.durationSec } as SceneBeat), sp: prompts.find((sp) => sp.sceneId === id)! }))
    .sort((a, b) => a.beat.order - b.beat.order);
}

const uniq = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** Deterministic one-take prompt: "<N> hard cuts, one continuous sequence, same location, same light: " then one
 *  "cut k (Ns): SHOT, PERFORM, PHYSICS, CAMERA" per beat, then IDENTITY, LOCATION, LIGHT, GRADE, QUALITY once (deduped
 *  across the beats), then the negatives (hard cuts not dissolves, no morphing between cuts, plus the union of the
 *  scenes' negatives). Pure. */
export function buildSequencePrompt(p: Project, sceneIds: string[]): string {
  const items = beatsFor(p, sceneIds);
  if (items.length < 2) throw new Error('a sequence needs at least 2 scene ids');
  const cuts = items.map(({ beat, sp }, i) => {
    const body = uniq(['SHOT', 'PERFORM', 'PHYSICS', 'CAMERA'].map((n) => text(sp, n))).join(', ') || sp.prompt;
    return `cut ${i + 1} (${Math.round(beat.durationSec || sp.durationSec)}s): ${body}`;
  });
  const tail = ['IDENTITY', 'LOCATION', 'LIGHT', 'GRADE', 'QUALITY'].flatMap((n) => uniq(items.map(({ sp }) => text(sp, n))));
  const negatives = uniq(['hard cuts not dissolves', 'no morphing between cuts', ...items.flatMap(({ sp }) => sp.negatives.map((n) => n.toLowerCase()))]);
  return [`${items.length} hard cuts, one continuous sequence, same location, same light: ${cuts.join('; ')}`, ...tail, ...negatives].join(', ');
}

/** image_urls of a one-take: chosen start keyframes of the beats in order, then the characters' full-body sheets, then the location(s); at most 30. */
export function sequenceRefs(p: Project, sceneIds: string[]): string[] {
  const items = beatsFor(p, sceneIds);
  const starts = items.map(({ beat }) => chosenKeyframeFile(p, beat.id, 'start')).filter((f): f is string => !!f);
  const assets = items.flatMap(({ sp }) => assetsOf(p, sp.refAssetIds, sp.sceneId));
  const chars = assets.filter((a) => a.kind !== 'location');
  const locs = assets.filter((a) => a.kind === 'location');
  const ctx = items.flatMap(({ beat }) => sceneContextPaths(p, beat.id));
  return [...new Set([...starts, ...chars.map(assetPath), ...locs.map(assetPath), ...ctx])].slice(0, 30);
}

export function sequenceDuration(p: Project, sceneIds: string[]): number {
  return clampDuration(beatsFor(p, sceneIds).reduce((s, { beat, sp }) => s + (beat.durationSec || sp.durationSec), 0));
}

function planSequence(p: Project, opts: RunOptions, tier: ClipTier): Plan {
  const ids = opts.ids ?? [];
  if (ids.length < 2) throw new Error('a sequence needs at least 2 scene ids (--ids a,b)');
  const items = beatsFor(p, ids);
  const sceneIds = items.map(({ beat }) => beat.id);
  if (tier === 'final' && !opts.force && !hasApprovedSequenceDraft(p, sceneIds)) {
    throw new Error(`one take ${sceneIds.join('+')}: final needs an approved draft of the same sequence first (or force)`);
  }
  const first = items[0].sp;
  const prompt = buildSequencePrompt(p, sceneIds);
  const durationSec = sequenceDuration(p, sceneIds);
  const sp: ScenePrompt = { ...first, durationSec, audio: items.some(({ sp: x }) => x.audio) };
  const input = buildVideoInput(sp, sequenceRefs(p, sceneIds), tier, { prompt, durationSec });
  const model = videoModel('sequence');
  return { sp, tier, label: `Scenes ${items.map(({ beat }) => beat.order).join('+')} one take ${tier}`, detail: `${durationSec}s, ${sceneIds.length} cuts`, input, source: 'sequence', mode: 'full', prompt, model, sceneIds };
}

function plan(p: Project, opts: RunOptions): Plan[] {
  const tier: ClipTier = opts.tier ?? 'draft';
  if (opts.sequence) return [planSequence(p, opts, tier)];
  const prompts = (p.scenePrompts ?? []).filter((sp) => !opts.ids || opts.ids.includes(sp.sceneId));
  if (opts.ids) {
    const missing = opts.ids.filter((id) => !prompts.some((sp) => sp.sceneId === id));
    if (missing.length) throw new Error(`no scene prompt for: ${missing.join(', ')}`);
  }
  return prompts.map((sp) => {
    if (tier === 'final' && !opts.force && !hasApprovedDraft(p, sp.sceneId)) {
      throw new Error(`${sceneLabel(p, sp.sceneId)}: final needs an approved draft first (or force)`);
    }
    const startImage = chosenKeyframeFile(p, sp.sceneId, 'start');
    const source: ClipSource = startImage ? 'keyframe' : 'reference';
    const mode: PromptMode = opts.promptMode ?? (source === 'keyframe' ? 'short' : 'full');
    const prompt = mode === 'short' ? shortPrompt(sp) : sp.prompt;
    const model = videoModel(source);
    const input = startImage
      ? buildVideoInput(sp, [], tier, { prompt, startImage, endImage: chosenKeyframeFile(p, sp.sceneId, 'end') })
      : buildVideoInput(sp, refPaths(p, sp), tier, { prompt });
    const ctxN = sceneContextPaths(p, sp.sceneId).length;
    const ctxNote = ctxN ? (startImage ? `, your ${ctxN} picture${ctxN === 1 ? '' : 's'} not sent (the keyframe carries the look)` : `, + ${ctxN} of your picture${ctxN === 1 ? '' : 's'}`) : '';
    return { sp, tier, label: `${sceneLabel(p, sp.sceneId)} ${tier}`, detail: `${source === 'keyframe' ? 'from keyframe' : 'from sheets'}, ${mode} prompt${ctxNote}`, input, source, mode, prompt, model };
  });
}

export async function estimate(p: Project, opts: RunOptions): Promise<Estimate> {
  const items: Estimate['items'] = [];
  let total = 0;
  for (const pl of plan(p, opts)) {
    const price = await hf.estimate(pl.model, pl.input);
    total += price;
    const where = await priceNote(pl.model, pl.input);
    items.push({ id: pl.sceneIds ? pl.sceneIds.join('+') : pl.sp.sceneId, model: pl.model, usd: price, note: `${pl.label} · ${pl.detail}${where ? ` · ${where}` : ''}` });
  }
  return { usd: Math.round(total * 1000) / 1000, items };
}

export async function run(p: Project, opts: RunOptions, emit: Emit): Promise<Project> {
  const h = attachJob(p, 'clips', emit);
  // plan() validates every scene up front so a missing choice fails before anything is billed.
  for (const pl of plan(p, opts)) {
    const price = await hf.estimate(pl.model, pl.input);
    h.log(`${pl.label} — ${usd(price)} — ${pl.detail} — ${opts.dryRun ? 'dry run, not generating' : 'generating…'}`);
    if (opts.dryRun) continue;

    const clip: Clip = {
      id: newId('clip'), sceneId: pl.sp.sceneId, tier: pl.tier, model: pl.model,
      resolution: pl.tier === 'draft' ? '480p' : '720p',
      jobId: h.job?.id, status: 'pending', approved: false, createdAt: new Date().toISOString(),
      source: pl.source, mode: pl.mode, prompt: pl.prompt,
      ...(pl.sceneIds ? { sceneIds: pl.sceneIds } : {}),
    };
    p.clips.push(clip);
    saveProject(p);
    try {
      // Seedance is formula-priced, so the tool needs --allow-unpriced (and counts $2.50 against its cap).
      const name = `${pl.sceneIds ? pl.sceneIds.join('+') : pl.sp.sceneId}-${pl.tier}-${clip.id}`;
      const res = await hooks.run(pl.model, pl.input, { project: p.slug, name, sub: 'clips', allowUnpriced: true, emit: h.log });
      const path = res.files[0];
      if (!path) throw new Error('generation returned no video file');
      let meta: { width?: number; height?: number; durationSec?: number } = {};
      try { meta = await probe(path); } catch { /* keep the clip even if probing fails */ }
      clip.file = { path, width: meta.width, height: meta.height, durationSec: meta.durationSec };
      clip.costUsd = res.usd;
      clip.status = 'done';
      h.addOutputs([clip.file], res.usd);
      h.log(`${pl.label} done`);
    } catch (err) {
      clip.status = 'failed';
      throw err;
    } finally {
      saveProject(p);
    }
  }
  return p;
}
