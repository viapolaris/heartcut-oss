// Sheets -> Assets. Each SheetPrompt becomes one Asset with 4 options (qwen identity edit gives 1).
// The style picks the model. Soul 2 and Soul Cinema take batch_size:4, so one submit makes the 4 options.
// qwen t2i, z-image and recraft have no batch field (probed 2026-10-11), so those loop 4 sequential
// submits and the options are collected in order concurrently
// (HEARTCUT_GEN_CONCURRENCY, default 4) and fall back to one at a time if Higgsfield refuses. Sheets stay sequential.
import { anchorFor, scrubSheetWords } from './sheets.ts';
import type { Asset, Emit, Estimate, MediaFile, Project, Provenance, RefImage, RunOptions, SheetPrompt, StyleSpec } from '../types.ts';
import { SEVERAL_PEOPLE } from '../types.ts';
import path from 'node:path';
import fs from 'node:fs';
import { contextFor, mediaDir, saveProject } from '../store.ts';
import { isGroupWho } from './script.ts';
// The provider layer (src/gen/provider.ts): the Higgsfield CLI tool, the Higgsfield API, fal or Replicate, whichever is active.
import * as hf from '../gen/provider.ts';
import { SpendCapError, failHeadline, priceNote, providerLabel } from '../gen/provider.ts';
import * as local from '../gen/local.ts';
import { FALLBACK, IMAGE_MODELS, LOCAL_EDIT, LOCAL_TWIN, QWEN_EDIT, TO_LOCAL, buildSheetInput, callsPerSheet, isLocalModel, isModelUnavailable, sheetModel } from '../gen/models.ts';
import { replacesRealism, styleFor } from '../styles.ts';
import { getSettings, resolveModels } from '../settings.ts';
import { probe } from '../ffmpeg.ts';
import { attachJob, usd } from './_job.ts';

/** Test seam: swap the submit function. */
export const hooks = { run: hf.run, local: local.run };
/** Set once Higgsfield refuses parallel submits; later sheets then go one at a time. */
let serialOnly = false;
export function resetConcurrencyFallback() { serialOnly = false; }
export function isRateLimit(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\b(400|429)\b|concurrent|limit|too many|rate/i.test(m) && /concurrent|limit|too many|rate/i.test(m);
}
function shortName(m: string): string { return m.split('/').find((x) => /qwen|z-image|recraft/.test(x))?.replace(/-image-3$/, '') ?? m; }
function elapsed(t0: number): string {
  const s = Math.round((Date.now() - t0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** A sheet with nothing to draw from: no prompt at all, or the "(imported)" placeholder an uploaded picture carries. */
export const hasPrompt = (s: { prompt?: string }): boolean => !!s.prompt && s.prompt.trim() !== '' && s.prompt.trim() !== '(imported)';

const IDENTITY_TAG = /^\s*\[identity:\s*ref\]\s*/i;
// Any leading run of [identity: ref] / [anchor: id] tags, in either order.
const LEADING_TAGS = /^(\s*\[(?:identity:\s*ref|anchor:\s*[^\]]*)\]\s*)+/i;

/** Dependents are built from the chosen anchor picture: Qwen Image Edit on Higgsfield, 4 calls, one reference image each time. */
export const DEPENDENT_CALLS = 4;
/** Photo edits run on this Mac when the setting is on and the edit weights are in the cache. */
const localEdit = (): boolean => getSettings().preferLocal && local.isLocalAvailable().models.includes(LOCAL_EDIT);
export const DEPENDENT_LOG = 'full body / other states need the chosen face as a reference — using Qwen Image Edit on Higgsfield ($0.04 each)';

interface Plan {
  sheet: SheetPrompt; model: string; input: Record<string, unknown>; calls: number; fallback?: { model: string; input: Record<string, unknown> }; skip?: string; note?: string;
  append?: boolean;                     // clean sheet (v6.1): add the new options to the asset and keep its pick, instead of replacing it
  fromRef?: string;                     // clean sheet: the context picture it is made from (Provenance.fromRef)
  anchorId?: string;                    // set on dependents
  waiting?: { anchor: string; queued: boolean }; // dependent that cannot be built yet; queued == its anchor is being (re)generated in this very run
}

// Portrait sheets are 3:4, full-body 2:3 (both valid Soul ratios); locations follow the film's aspect.
function sheetAspect(sheet: SheetPrompt, p: Project): string {
  if (sheet.kind === 'character-portrait') return '3:4';
  if (sheet.kind === 'character-full') return '2:3';
  return p.aspect;
}

const IMAGE_LABEL = (m: string): string => IMAGE_MODELS[m]?.label ?? m;

/** Put freshly made options on the sheet's asset. A normal run replaces the asset (the user picks again); a clean sheet
 *  (`pl.append`) adds to it and keeps the current pick and jobId, so dependents built from that pick stay valid. */
function landOptions(p: Project, pl: Plan, options: MediaFile[], models: string[], paid: number, jobId: string | undefined, assetModel: string): void {
  const id = pl.sheet.id;
  const prov = (model: string): Provenance => ({ kind: 'generated', model, ...(pl.anchorId ? { anchor: pl.anchorId } : {}), ...(pl.fromRef ? { fromRef: pl.fromRef } : {}) });
  const at = p.assets.findIndex((a) => a.id === id);
  if (pl.append && at >= 0) {
    const a = p.assets[at];
    while ((a.sources ??= []).length < a.options.length) a.sources.push({ kind: 'generated', model: a.model });
    a.options.push(...options);
    a.sources.push(...models.map(prov));
    a.costUsd = Math.round(((a.costUsd ?? 0) + paid) * 1000) / 1000;
    return;
  }
  const asset: Asset = {
    id, kind: pl.sheet.kind, characterId: pl.sheet.characterId, stateId: pl.sheet.stateId, locationId: pl.sheet.locationId,
    prompt: pl.sheet.prompt, model: assetModel, options, jobId, costUsd: Math.round(paid * 1000) / 1000,
    sources: models.map(prov),
  };
  if (pl.anchorId) {
    const anchor = p.assets.find((a) => a.id === pl.anchorId);
    if (anchor?.chosen != null) { asset.anchorIndex = anchor.chosen; if (anchor.jobId) asset.anchorJob = anchor.jobId; }
  }
  if (at >= 0) p.assets[at] = asset; else p.assets.push(asset);
}

/** Context pictures of one sheet whose files are still on disk. */
const contextPaths = (p: Project, sheetId: string): string[] => contextFor(p, { assetId: sheetId }).map((r) => r.path).filter((f) => fs.existsSync(f));

/** Appended to an edit prompt whose extra reference pictures are the user's context pictures, so the edit reads them as guidance. */
export const CONTEXT_CLAUSE = 'use the extra reference pictures as a guide for look and detail, not as the finished picture';

// Background lines of the house sheet rules (prompts/blocks.md STUDIO SHEET BLOCK; prompts/system-sheets.md step 6).
const BG_PORTRAIT = 'plain white seamless studio backdrop, broad soft frontal light, even and shadowless';
const BG_FULL = 'plain white seamless studio backdrop, broad soft even light from the front, a faint shadow on the floor under the feet';
const BG_ANIMAL = 'plain light grey studio backdrop, soft neutral light';

/** The clean-up instruction for an edit that turns the user's own picture into a sheet that obeys the sheet rules. Pure. */
export function cleanClause(sheet: Pick<SheetPrompt, 'kind'>, opts: { species?: string; style?: StyleSpec } = {}): string {
  if (sheet.kind === 'location') {
    return 'keep the layout, architecture, materials and landmarks of the place in the reference photo, remove every person, vehicle, text, sign and piece of clutter, light and frame it exactly as described next, one clean picture, nothing written on it';
  }
  const animal = !!opts.species && opts.species !== 'human';
  const drawn = !!opts.style && replacesRealism(opts.style);
  const bg = drawn ? `plain clean background, ${(opts.style!.sheetLook ?? opts.style!.look).trim()}` : animal ? BG_ANIMAL : sheet.kind === 'character-portrait' ? BG_PORTRAIT : BG_FULL;
  const frame = sheet.kind === 'character-portrait' ? 'close-up portrait, head and shoulders, facing camera' : animal ? 'full body, head to tail, standing and facing camera' : 'full body shot, head to toe, standing and facing camera';
  const who = animal ? 'animal' : 'person';
  return `keep the face, hair, build, clothing and props of the ${who} in the reference photo exactly as they are, replace the background with a ${bg}, reframe as a ${frame}, one ${who} only, no other people, nothing written on the picture`;
}

/** When a sheet has no prompt of its own (an imported picture), build one from the script so the clean-up still follows the spec. */
function specPrompt(p: Project, sheet: SheetPrompt): string {
  if (hasPrompt(sheet)) return sheet.prompt.replace(LEADING_TAGS, '');
  const c = p.script?.characters.find((x) => x.id === sheet.characterId);
  if (c) return [c.baseDescription, c.wardrobe, c.states.find((x) => x.id === sheet.stateId)?.description].filter(Boolean).join(', ');
  const l = p.script?.locations.find((x) => x.id === sheet.locationId);
  return l ? [l.description, l.lighting, l.palette, l.cameraPackage].filter(Boolean).join(', ') : '';
}

/** One clean-sheet plan: the user's picture (plus the sheet's other context pictures) through the photo edit, with the sheet
 *  prompt and the clean clause. Appends options; never picks one. Refuses a photo of several people. */
function cleanPlan(p: Project, opts: RunOptions): Plan {
  const ids = opts.ids ?? [];
  if (ids.length !== 1) throw new Error('a clean sheet needs exactly one sheet id');
  const id = ids[0];
  const a = p.assets.find((x) => x.id === id);
  const sheet: SheetPrompt | undefined = (p.sheets?.items ?? []).find((s) => s.id === id)
    ?? (a ? { id: a.id, kind: a.kind, characterId: a.characterId, stateId: a.stateId, locationId: a.locationId, prompt: a.prompt ?? '' } : undefined);
  if (!sheet) throw new Error(`no sheet ${id}`);
  const ref = (p.contextRefs ?? []).find((r) => r.id === opts.cleanFrom && r.forAssetId === id);
  if (!ref) throw new Error(`no picture ${opts.cleanFrom} on ${id}: add it with "Make a clean sheet from it" first`);
  if (!fs.existsSync(ref.path)) throw new Error(`the picture file for ${ref.id} is missing`);
  const character = p.script?.characters.find((c) => c.id === sheet.characterId);
  if (sheet.kind !== 'location' && (ref.who === SEVERAL_PEOPLE || isGroupWho(ref.who, (p.script?.characters ?? []).map((c) => c.name)))) {
    throw new Error('this photo shows several people: a clean sheet needs a photo of one person. Crop it to one person and add it again');
  }
  const style = styleFor(p);
  const prompt = `${cleanClause(sheet, { species: character?.species, style })}, ${scrubSheetWords(specPrompt(p, sheet))}`;
  const editModel = localEdit() ? LOCAL_EDIT : QWEN_EDIT;
  const refPaths = [ref.path, ...contextPaths(p, id).filter((f) => f !== ref.path)];
  const input = buildSheetInput(prompt, { aspect: sheetAspect(sheet, p), model: editModel, refPaths });
  const calls = editModel === LOCAL_EDIT ? callsPerSheet(LOCAL_EDIT) : DEPENDENT_CALLS;
  return { sheet, model: editModel, input, calls, append: true, fromRef: ref.id,
    note: `clean sheet from your picture${refPaths.length > 1 ? ` (+${refPaths.length - 1} more)` : ''}, ${editModel === LOCAL_EDIT ? 'local GPU, free' : 'Qwen Image edit'}, ${calls} options, you pick one` };
}

function plan(p: Project, opts: RunOptions): Plan[] {
  if (opts.cleanFrom) return [cleanPlan(p, opts)];
  const style = resolveModels(styleFor(p));
  const items = (p.sheets?.items ?? []).filter((s) => !opts.ids || opts.ids.includes(s.id));
  // An asset with no sheet item (imported, adopted, or left over from an earlier script) the dashboard still shows a
  // Regenerate button for. Only when the ids name it explicitly: it must never join a whole-step run. Without a prompt
  // there is nothing to draw from, so it prices at $0 and says why instead of vanishing from the estimate.
  const orphans: SheetPrompt[] = (opts.ids ?? [])
    .filter((id) => !items.some((s) => s.id === id) && !(p.sheets?.items ?? []).some((s) => s.id === id))
    .flatMap((id) => { const a = p.assets.find((x) => x.id === id); return a ? [{ id: a.id, kind: a.kind, characterId: a.characterId, stateId: a.stateId, locationId: a.locationId, prompt: a.prompt ?? '' }] : []; });
  const plans: Plan[] = [...items, ...orphans].map((sheet) => {
    const existing = p.assets.find((a) => a.id === sheet.id);
    const raw = hasPrompt(sheet) ? sheet.prompt : '';
    const tagged = IDENTITY_TAG.test(raw.replace(/^\s*\[anchor:\s*[^\]]*\]\s*/i, ''));
    let prompt = raw.replace(LEADING_TAGS, '');
    const character = p.script?.characters.find((c) => c.id === sheet.characterId);
    const anchorId = sheet.dependsOn ?? (p.script ? anchorFor(p.script, sheet.id) : undefined);
    if (anchorId && raw) {
      // Dependent: always the Higgsfield image edit (local Qwen-Image has no image-to-image), referencing the chosen face (+ the selfie).
      const anchor = p.assets.find((a) => a.id === anchorId);
      const face = anchor && anchor.chosen != null ? anchor.options[anchor.chosen]?.path : undefined;
      const selfie = character?.identityRefId ? p.brief.refs.find((r) => r.id === character.identityRefId)?.path : undefined;
      const ctx = contextPaths(p, sheet.id);
      const refPaths = [face, selfie, ...ctx].filter((x): x is string => !!x);
      prompt = scrubSheetWords(prompt);
      if (ctx.length) prompt = `${prompt}, ${CONTEXT_CLAUSE}`;
      const editModel = localEdit() ? LOCAL_EDIT : QWEN_EDIT;
      const input = buildSheetInput(prompt, { aspect: sheetAspect(sheet, p), model: editModel, refPaths });
      const out: Plan = { sheet, model: editModel, input, calls: editModel === LOCAL_EDIT ? callsPerSheet(LOCAL_EDIT) : DEPENDENT_CALLS, anchorId, note: `built from ${anchorId}${ctx.length ? ` + ${ctx.length} of your pictures` : ''}${editModel === LOCAL_EDIT ? ', local GPU, free' : ''}` };
      if (existing?.options.length && !opts.force) out.skip = 'already has options';
      return out;
    }
    // A photo linked after the sheets were written still counts: the link lives on the character, not in the prompt text.
    const ref = (tagged || (sheet.kind !== 'location' && character?.species === 'human')) && character?.identityRefId ? p.brief.refs.find((r) => r.id === character.identityRefId) : undefined;
    // Context pictures need a model that takes pictures. The style's face/place models are text-only, so such a sheet is drawn
    // by the photo edit instead (the same edit the selfie path uses), and the estimate prices that edit.
    const ctx = contextPaths(p, sheet.id);
    let model = (ref || ctx.length) && localEdit() ? LOCAL_EDIT : ref ? sheetModel(sheet.kind, true, style) : ctx.length ? QWEN_EDIT : sheetModel(sheet.kind, false, style);
    let unavailable = '';
    if (model === LOCAL_EDIT || (ctx.length && model === QWEN_EDIT)) { /* the edit: no local/text twin swap */ } else if (isLocalModel(model)) {
      const a = local.isLocalAvailable();
      if (!a.models.includes(model)) { unavailable = a.reason ?? 'the local worker is not available'; model = LOCAL_TWIN[model]; }
    } else if (TO_LOCAL[model] && getSettings().preferLocal && !local.isLocalAvailable().ok) {
      unavailable = local.isLocalAvailable().reason ?? 'the local worker is not available'; // setting is on but the Mac cannot do it
    }
    // Stored prompts from before the scrubber existed still carry the words; clean at send time too.
    prompt = scrubSheetWords(prompt);
    if (ctx.length) prompt = `${prompt}, ${CONTEXT_CLAUSE}`;
    const editRefs = ref || ctx.length ? [...(ref ? [ref.path] : []), ...ctx] : undefined;
    const input = buildSheetInput(prompt, { aspect: sheetAspect(sheet, p), identityRefPath: ref?.path, refPaths: editRefs && (model === LOCAL_EDIT || model === QWEN_EDIT) ? editRefs : undefined, style, model });
    // A context-only edit makes 4 options like any sheet (one image per call); the selfie edit keeps its single image.
    const out: Plan = { sheet, model, input, calls: ctx.length && !ref && model === QWEN_EDIT ? DEPENDENT_CALLS : callsPerSheet(model) };
    if (ctx.length) out.note = `guided by ${ctx.length} of your picture${ctx.length === 1 ? '' : 's'}: drawn with ${model === LOCAL_EDIT ? 'the local photo edit, free' : 'Qwen Image edit'} because ${IMAGE_LABEL(sheetModel(sheet.kind, false, style))} cannot take a picture`;
    if (unavailable) out.note = `local GPU unavailable (${unavailable}) - using ${model} on ${providerLabel()} instead, THIS COSTS MONEY`;
    const fb = isLocalModel(model) ? undefined : FALLBACK[model];
    if (fb && out.calls > 1) out.fallback = { model: fb, input: buildSheetInput(prompt, { aspect: sheetAspect(sheet, p), style, model: fb }) };
    if (existing?.options.length && !opts.force) out.skip = 'already has options';
    if (!raw) out.skip = 'skipped: no prompt to draw from (imported picture)';
    if (tagged && !ref) out.note = (out.note ? out.note + '; ' : '') + 'identity tag without a usable reference image — using the style\'s face model instead';
    if (ref) out.note = (out.note ? out.note + '; ' : '') + (model === LOCAL_EDIT ? `from your photo, local GPU, free, ${out.calls} options` : 'identity edit returns 1 image, not 4');
    return out;
  });
  // Dependents need their anchor picked. An anchor regenerated in this same run loses its pick, so its dependents wait too.
  for (const pl of plans) {
    if (!pl.anchorId || pl.skip) continue;
    const anchorPlan = plans.find((x) => x.sheet.id === pl.anchorId);
    if (anchorPlan && !anchorPlan.skip) { pl.waiting = { anchor: pl.anchorId, queued: true }; continue; }
    const anchor = p.assets.find((a) => a.id === pl.anchorId);
    if (!anchor || anchor.chosen == null || !anchor.options[anchor.chosen]?.path) pl.waiting = { anchor: pl.anchorId, queued: false };
  }
  return plans.sort((a, b) => Number(!!a.anchorId) - Number(!!b.anchorId)); // anchors first (stable)
}

export async function estimate(p: Project, opts: RunOptions): Promise<Estimate> {
  const items: Estimate['items'] = [];
  let total = 0;
  for (const pl of plan(p, opts)) {
    if (pl.skip) { items.push({ id: pl.sheet.id, model: pl.model, usd: 0, note: pl.skip }); continue; }
    if (pl.waiting) { items.push({ id: pl.sheet.id, model: pl.model, usd: 0, note: `waiting for ${pl.waiting.anchor} to be picked` }); continue; }
    const price = (await hf.estimate(pl.model, pl.input)) * pl.calls;
    total += price;
    const where = await priceNote(pl.model, pl.input);
    items.push({ id: pl.sheet.id, model: pl.model, usd: Math.round(price * 1000) / 1000, note: [pl.note, isLocalModel(pl.model) ? 'local GPU, free' : pl.calls > 1 ? `${pl.calls} calls` : '', where].filter(Boolean).join('; ') || undefined });
  }
  return { usd: Math.round(total * 1000) / 1000, items };
}

export async function run(p: Project, opts: RunOptions, emit: Emit): Promise<Project> {
  const h = attachJob(p, 'images', emit);
  const all = plan(p, opts);
  // Asked for by name but cannot be built yet: fail before anything is spent.
  const blocked = all.filter((pl) => pl.waiting && !pl.waiting.queued && opts.ids?.includes(pl.sheet.id));
  if (blocked.length) throw new Error(`cannot build ${blocked.map((b) => b.sheet.id).join(', ')} yet: pick a picture for ${[...new Set(blocked.map((b) => b.waiting!.anchor))].join(', ')} first (every other picture is built from that face)`);
  let announced = false;
  const failures: { id: string; err: unknown }[] = [];
  const skipped: string[] = [];
  let accountDown = '';
  for (const [n, pl] of all.entries()) {
    const id = pl.sheet.id;
    if (accountDown && !isLocalModel(pl.model) && !pl.skip && !pl.waiting) { h.log(`skip ${id}: ${accountDown}`); skipped.push(id); continue; }
    try {
      if (pl.skip) { h.log(`skip ${id}: ${pl.skip}`); continue; }
      if (pl.waiting) { h.log(`skip ${id}: waiting for ${pl.waiting.anchor} to be picked`); continue; }
      if (pl.anchorId && !opts.dryRun && !announced) { announced = true; h.log(DEPENDENT_LOG); }
      if (pl.note) h.log(`${id}: ${pl.note}`);
      const price = (await hf.estimate(pl.model, pl.input)) * pl.calls;
      h.log(`estimate ${usd(price)} for asset ${id} (${pl.model}${isLocalModel(pl.model) ? ', local GPU, one worker run' : pl.calls > 1 ? `, ${pl.calls} calls` : ''})`);
      if (opts.dryRun) { h.log(`dry run — ${id} not generated`); continue; }

      h.log(`generating ${id}…`);
      const t0 = Date.now();
      if (isLocalModel(pl.model)) { await runLocal(p, pl, id, n, all.length, h); continue; }
      const done: Array<{ files: string[]; usd: number; model: string } | undefined> = new Array(pl.calls).fill(undefined);
      let finished = 0;
      let failure: unknown;
      const submit = async (i: number) => {
        const name = pl.calls > 1 ? `${id}-v${i + 1}` : id;
        const ro = { project: p.slug, name, sub: 'assets' as const, emit: h.log };
        let model = pl.model;
        let res;
        try { res = await hooks.run(pl.model, pl.input, ro); } catch (e) {
          if (!pl.fallback || !isModelUnavailable(e)) throw e;
          h.log(`${shortName(pl.model)} unavailable — variant ${i + 1} on ${pl.fallback.model} instead`);
          model = pl.fallback.model;
          res = await hooks.run(model, pl.fallback.input, ro);
        }
        done[i] = { files: res.files, usd: res.usd, model };
        finished++;
        if (pl.calls > 1) h.log(`sheet ${n + 1}/${all.length} · ${id} · variant ${finished}/${pl.calls} done (${elapsed(t0)})`);
      };
      // Never retry a failed submit (no idempotency key) - except one the account refused for concurrency, which was never accepted.
      const pending = Array.from({ length: pl.calls }, (_, i) => i);
      if (pl.calls > 1 && !serialOnly) {
        const cap = Math.max(1, Math.min(pl.calls, Number(process.env.HEARTCUT_GEN_CONCURRENCY) || 4));
        const refused = new Set<number>();
        const queue = [...pending];
        let stop = false;
        const worker = async () => {
          for (let i = queue.shift(); i !== undefined && !stop && !serialOnly; i = queue.shift()) {
            try { await submit(i); } catch (e) {
              if (isRateLimit(e)) { refused.add(i); serialOnly = true; } else { failure ??= e; if (!isModelUnavailable(e)) stop = true; }
            }
          }
        };
        await Promise.allSettled(Array.from({ length: cap }, worker));
        const left = pending.filter((i) => !done[i]);
        pending.length = 0;
        if (!failure || isModelUnavailable(failure)) pending.push(...left.filter((i) => refused.has(i) || queue.includes(i)));
        if (serialOnly && (!failure || isModelUnavailable(failure))) h.log('Higgsfield refused parallel submits — continuing one at a time');
      } else if (pl.calls > 1) h.log(`${id}: submitting one at a time (parallel was refused earlier)`);
      if (!failure || isModelUnavailable(failure)) {
        for (const i of pending) {
          if (done[i]) continue;
          try { await submit(i); } catch (e) { failure ??= e; if (!isModelUnavailable(e)) break; }
        }
      }
      const files = done.flatMap((d) => d?.files ?? []);
      const models = done.flatMap((d) => (d ? d.files.map(() => d.model) : []));
      const paid = done.reduce((t, d) => t + (d?.usd ?? 0), 0);
      if (failure && pl.calls > 1 && files.length) h.log(`${done.filter(Boolean).length} of ${pl.calls} variants done for ${id}`);
      const options = await Promise.all(files.map(async (path) => {
        try { const m = await probe(path); return { path, width: m.width, height: m.height }; } catch { return { path }; }
      }));
      if (options.length) {
        landOptions(p, pl, options, models.length === options.length ? models : options.map(() => pl.model), paid, h.job?.id, pl.model);
        h.addOutputs(options, paid);
        saveProject(p);
        h.log(`downloaded ${options.length} file(s) for ${id}`);
      }
      if (failure) throw failure;
    } catch (e) {
      // One sheet failing must not stop the others: free local sheets keep going when Higgsfield is out of credits.
      failures.push({ id, err: e });
      const head = e instanceof SpendCapError ? 'the $ sitting cap is reached' : failHeadline(String((e as Error)?.message ?? e));
      h.log(`${id} failed: ${head ?? String((e as Error)?.message ?? e).slice(0, 300)}`);
      if (e instanceof SpendCapError || (head && /out of credits|refused the login|no picture service/i.test(head))) accountDown = `${providerLabel()} unavailable (${head})`;
    }
  }
  if (failures.length) {
    const first = failures[0].err as Error;
    const head = first instanceof SpendCapError ? 'the sitting spend cap is reached' : failHeadline(String(first?.message ?? first)) ?? String(first?.message ?? first).split('\n')[0].slice(0, 200);
    // Count what this run actually produced, including sheets that failed part-way but kept some pictures.
    const fresh = (id: string) => p.assets.find((a) => a.id === id && a.jobId === h.job?.id)?.options.length ?? 0;
    const partial = failures.filter((f) => fresh(f.id) > 0);
    const done = all.filter((pl) => !pl.skip && !pl.waiting && !failures.some((f) => f.id === pl.sheet.id) && !skipped.includes(pl.sheet.id)).length;
    const missing = [...failures.filter((f) => !fresh(f.id)).map((f) => f.id), ...skipped];
    const parts = [
      done ? `${done} sheet${done === 1 ? '' : 's'} made` : '',
      partial.length ? `${partial.map((f) => `${f.id} only part-made (${fresh(f.id)} picture${fresh(f.id) === 1 ? '' : 's'})`).join(', ')}` : '',
      missing.length ? `not made: ${missing.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`${parts}. ${head}`);
  }
  return p;
}

/** One worker invocation per sheet: all variants share a single model load. Falls back to the local sibling model on a
 *  generation failure, and to the paid Higgsfield twin only when the worker cannot run at all. */
async function runLocal(p: Project, pl: Plan, id: string, n: number, total: number, h: ReturnType<typeof attachJob>): Promise<void> {
  const { width, height } = pl.input as { width: number; height: number };
  const prompt = String(pl.input.prompt);
  const images = ((pl.input as { images?: string[] }).images ?? []).filter(Boolean);
  const t0 = Date.now();
  const mk = (): local.LocalItem[] => Array.from({ length: pl.calls }, (_, i) => ({
    id: `${id}-v${i + 1}`, prompt, seed: local.seedFor(id, i + 1), outFile: path.join(mediaDir(p.slug, 'assets'), `${id}-v${i + 1}.png`),
    ...(images.length ? { images } : {}),
  }));
  let model = pl.model;
  let files: string[] = [];
  let paid = 0;
  let failure: unknown;
  for (;;) {
    try {
      files = (await hooks.local(model, mk(), { width, height, emit: (l) => h.log(`sheet ${n + 1}/${total} · ${id} · ${l}`) })).files;
      failure = undefined;
      break;
    } catch (e) {
      failure = e;
      files = (e as { files?: string[] }).files ?? [];
      if (files.length) break; // keep what landed; the failure is rethrown after saving
      if (e instanceof local.LocalUnavailableError) {
        const twin = LOCAL_TWIN[model];
        h.log(`LOCAL GPU UNAVAILABLE for ${id} (${(e as Error).message.slice(0, 300)}) - falling back to ${twin} on ${providerLabel()}. THIS COSTS MONEY.`);
        const input = buildSheetInput(prompt, { aspect: sheetAspect(pl.sheet, p), model: twin, refPaths: images.length ? images : undefined });
        const ro = { project: p.slug, name: id, sub: 'assets' as const, emit: h.log };
        const done: Array<{ files: string[]; usd: number }> = [];
        try {
          for (let i = 0; i < callsPerSheet(twin); i++) done.push(await hooks.run(twin, input, { ...ro, name: `${id}-v${i + 1}` }));
          failure = undefined;
        } catch (e2) { failure = e2; }
        files = done.flatMap((d) => d.files);
        paid = done.reduce((t, d) => t + d.usd, 0);
        model = twin;
        break;
      }
      const sibling = FALLBACK[model];
      if (!sibling || !isLocalModel(sibling)) break;
      h.log(`local ${model} failed (${(e as Error).message.slice(0, 200)}) - trying ${sibling}`);
      model = sibling;
    }
  }
  if (failure && files.length) h.log(`${files.length} of ${pl.calls} variants done for ${id}`);
  const options = await Promise.all(files.map(async (path) => {
    try { const m = await probe(path); return { path, width: m.width, height: m.height }; } catch { return { path }; }
  }));
  if (options.length) {
    landOptions(p, pl, options, options.map(() => model), paid, h.job?.id, model);
    h.addOutputs(options, paid);
    saveProject(p);
    h.log(`downloaded ${options.length} file(s) for ${id} (${elapsed(t0)}${isLocalModel(model) ? ', local GPU, $0.00' : ''})`);
  }
  if (failure) throw failure;
}
