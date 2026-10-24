// Project store: one JSON file per project, refs beside it, media in media/ (or HEARTCUT_MEDIA_ROOT).
// Extend this file; do not rename its exports (docs/CONTRACT.md).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.ts';
import { STAGES } from './types.ts';
import type { Aspect, Job, Keyframe, Project, RefImage, RefRole, Stage, Staleness, StyleSpec } from './types.ts';

// Read .env before the folders below are fixed, so HEARTCUT_ROOT / HEARTCUT_MEDIA_ROOT set there take effect.
loadEnv();

export const ROOT = process.env.HEARTCUT_ROOT
  ? path.resolve(process.env.HEARTCUT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECTS_DIR = path.join(ROOT, 'projects');
/** Where pictures and clips go. Default: media/ beside projects/ (gitignored). HEARTCUT_MEDIA_ROOT moves it anywhere. */
export const MEDIA_ROOT = defaultMediaRoot(process.env, ROOT);

export function defaultMediaRoot(env: NodeJS.ProcessEnv, root: string): string {
  return env.HEARTCUT_MEDIA_ROOT ? path.resolve(env.HEARTCUT_MEDIA_ROOT) : path.join(root, 'media');
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
}

function projectFile(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`bad slug: ${slug}`);
  return path.join(PROJECTS_DIR, slug, 'project.json');
}

export function listProjects(): Project[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR)
    .filter((d) => fs.existsSync(path.join(PROJECTS_DIR, d, 'project.json')))
    .map((d) => loadProject(d))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function loadProject(slug: string): Project {
  const f = projectFile(slug);
  if (!fs.existsSync(f)) throw new Error(`no project: ${slug}`);
  return JSON.parse(fs.readFileSync(f, 'utf8')) as Project;
}

export function saveProject(p: Project): void {
  const f = projectFile(p.slug);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  p.updatedAt = new Date().toISOString();
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, f);
}

export function createProject(input: { title: string; slug?: string; briefText: string; aspect?: Aspect }): Project {
  const slug = input.slug ? slugify(input.slug) : slugify(input.title);
  if (fs.existsSync(projectFile(slug))) throw new Error(`project exists: ${slug}`);
  const now = new Date().toISOString();
  const p: Project = {
    id: newId('prj'),
    slug,
    title: input.title,
    owner: 'viaPolaris',
    aspect: input.aspect ?? '16:9',
    createdAt: now,
    updatedAt: now,
    brief: { text: input.briefText, refs: [] },
    assets: [],
    clips: [],
    exports: [],
    jobs: [],
    approvals: {},
  };
  saveProject(p);
  fs.mkdirSync(path.join(PROJECTS_DIR, slug, 'refs'), { recursive: true });
  return p;
}

export function refsDir(slug: string): string {
  const d = path.join(path.dirname(projectFile(slug)), 'refs');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function addRef(slug: string, input: { role: RefRole; filename: string; bytes: Buffer; note?: string; forCharacterId?: string; forLocationId?: string; who?: string }): RefImage {
  const p = loadProject(slug);
  const id = newId('ref');
  const safe = path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = path.join(refsDir(slug), `${id}-${safe}`);
  fs.writeFileSync(dest, input.bytes);
  const ref: RefImage = { id, role: input.role, path: dest, note: input.note, forCharacterId: input.forCharacterId, forLocationId: input.forLocationId, who: input.who?.trim() || undefined };
  p.brief.refs.push(ref);
  if (input.role === 'music') p.brief.musicPath = dest;
  else stamp(p, 'brief'); // a new picture changes what the script is written from
  saveProject(p);
  return ref;
}

export type MediaSub = 'assets' | 'keyframes' | 'clips' | 'export';

export function mediaDir(slug: string, sub: MediaSub): string {
  const d = path.join(MEDIA_ROOT, slug, sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function addJob(p: Project, job: Omit<Job, 'id' | 'startedAt' | 'status' | 'outputs' | 'log' | 'projectSlug'> & Partial<Job>): Job {
  const j: Job = {
    id: newId('job'),
    startedAt: new Date().toISOString(),
    status: 'queued',
    outputs: [],
    log: [],
    ...job,
    projectSlug: p.slug,
  };
  p.jobs.push(j);
  return j;
}

export function updateJob(p: Project, id: string, patch: Partial<Job>): Job {
  const j = p.jobs.find((x) => x.id === id);
  if (!j) throw new Error(`no job ${id}`);
  Object.assign(j, patch);
  return j;
}

// --- selection / approval helpers shared by the CLI and the server ---

/** Pick option `index`, or pass null to unpick (clears `chosen`). */
export function chooseAsset(slug: string, assetId: string, index: number | null): Project {
  const p = loadProject(slug);
  const a = p.assets.find((x) => x.id === assetId);
  if (!a) throw new Error(`no asset ${assetId}`);
  if (index === null) {
    delete a.chosen;
    stamp(p, 'images');
    saveProject(p);
    return p;
  }
  if (!Number.isInteger(index) || index < 0 || index >= a.options.length) {
    throw new Error(`index ${index} out of range (asset has ${a.options.length} options)`);
  }
  a.chosen = index;
  stamp(p, 'images');
  saveProject(p);
  return p;
}

/** Delete a picture file, but only this project's own copy (under its media folder) and only when no asset or keyframe
 *  option still points at it. An adopted picture's original in another project or the library is never touched. */
function unlinkIfOrphan(p: Project, gone: { path?: string } | undefined): void {
  const root = path.join(MEDIA_ROOT, p.slug) + path.sep;
  const file = gone?.path ? path.resolve(gone.path) : '';
  if (!file.startsWith(root)) return;
  const still = (opts: { path?: string }[]) => opts.some((o) => o.path && path.resolve(o.path) === file);
  if (p.assets.some((x) => still(x.options)) || (p.keyframes ?? []).some((k) => still(k.options))) return;
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

function spliceOption(target: { options: { path?: string }[]; sources?: unknown[]; chosen?: number }, index: number, what: string): { path?: string } | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= target.options.length) {
    throw new Error(`index ${index} out of range (${what} has ${target.options.length} options)`);
  }
  const [gone] = target.options.splice(index, 1);
  if (target.sources) target.sources.splice(index, 1);
  if (target.chosen === index) delete target.chosen;
  else if (target.chosen !== undefined && target.chosen > index) target.chosen -= 1;
  return gone;
}

/** Remove one picture from an asset: its option, its `sources` entry, and the file only when it lives under this
 *  project's own media folder (an adopted picture's original in another project or the library is never touched). */
export function removeOption(slug: string, assetId: string, index: number): Project {
  const p = loadProject(slug);
  const a = p.assets.find((x) => x.id === assetId);
  if (!a) throw new Error(`no asset ${assetId}`);
  const gone = spliceOption(a, index, 'asset');
  unlinkIfOrphan(p, gone);
  stamp(p, 'images');
  saveProject(p);
  return p;
}

// --- keyframes (v5) ---

export function getKeyframe(p: Project, keyframeId: string): Keyframe {
  const k = (p.keyframes ?? []).find((x) => x.id === keyframeId);
  if (!k) throw new Error(`no keyframe ${keyframeId}`);
  return k;
}

/** Pick keyframe option `index`, or pass null to unpick. Stamps `keyframes`. */
export function chooseKeyframe(slug: string, keyframeId: string, index: number | null): Project {
  const p = loadProject(slug);
  const k = getKeyframe(p, keyframeId);
  if (index === null) delete k.chosen;
  else {
    if (!Number.isInteger(index) || index < 0 || index >= k.options.length) {
      throw new Error(`index ${index} out of range (keyframe has ${k.options.length} options)`);
    }
    k.chosen = index;
  }
  stamp(p, 'keyframes');
  saveProject(p);
  return p;
}

/** Remove one picture from a keyframe; same file-deletion safety as removeOption. Stamps `keyframes`. */
export function removeKeyframeOption(slug: string, keyframeId: string, index: number): Project {
  const p = loadProject(slug);
  const k = getKeyframe(p, keyframeId);
  const gone = spliceOption(k, index, 'keyframe');
  unlinkIfOrphan(p, gone);
  stamp(p, 'keyframes');
  saveProject(p);
  return p;
}

export function approveClip(slug: string, clipId: string, approved: boolean): Project {
  const p = loadProject(slug);
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) throw new Error(`no clip ${clipId}`);
  c.approved = approved;
  stamp(p, 'clips');
  saveProject(p);
  return p;
}

export function projectSpend(p: Project): number {
  return (p.jobs ?? []).reduce((s, j) => s + (j.actualUsd ?? 0), 0);
}

// --- staleness: a stage is stale when any upstream stage's content changed after it ---

/** Record that a stage's content changed. Does not save. `at` lets one action stamp several stages at the same instant. */
export function stamp(p: Project, stage: Stage, at: string = new Date().toISOString()): void {
  (p.stamps ??= {})[stage] = at;
}

function hasContent(p: Project, stage: Stage): boolean {
  switch (stage) {
    case 'brief': return (p.brief?.text ?? '').trim().length > 0;
    case 'script': return !!p.script;
    case 'sheets': return !!p.sheets;
    case 'images': return (p.assets?.length ?? 0) > 0;
    case 'scenes': return !!p.scenePrompts;
    case 'keyframes': return (p.keyframes?.length ?? 0) > 0;
    case 'clips': return (p.clips?.length ?? 0) > 0;
    case 'export': return (p.exports?.length ?? 0) > 0;
  }
}

/** Pure. A missing stamp counts as createdAt, so projects that predate stamps are never falsely stale. */
export function staleness(p: Project): Staleness {
  const at = (s: Stage): string => p.stamps?.[s] ?? p.createdAt;
  const out: Staleness = {};
  STAGES.forEach((stage, i) => {
    if (!hasContent(p, stage)) return;
    // Report the nearest upstream stage that moved on after this one.
    let because: Stage | undefined;
    for (let u = i - 1; u >= 0; u--) if (at(STAGES[u]) > at(stage)) { because = STAGES[u]; break; }
    out[stage] = because ? { stale: true, because } : { stale: false };
  });
  return out;
}

export function staleCount(p: Project): number {
  return Object.values(staleness(p)).filter((v) => v?.stale).length;
}

/** "Keep anyway": acknowledge upstream changes without regenerating. */
export function keepStage(slug: string, stage: Stage): Project {
  const p = loadProject(slug);
  stamp(p, stage);
  saveProject(p);
  return p;
}

/** Snapshot a style onto a project. Everything downstream of the brief goes stale, which is correct. */
export function setProjectStyle(slug: string, style: StyleSpec): Project {
  const p = loadProject(slug);
  p.style = structuredClone(style);
  stamp(p, 'brief');
  saveProject(p);
  return p;
}

// Rename a character or location. The id never changes, so pictures, refs and placeholders stay linked.
// The old name is replaced as a whole word in every prompt text the project holds, so prompts keep agreeing
// with the script. Nothing is stamped: a name changes no picture, so no step goes stale.
export function renameEntity(slug: string, kind: 'character' | 'location', id: string, name: string): Project {
  const p = loadProject(slug);
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('name must not be empty');
  if (clean.length > 60) throw new Error('name must be 60 characters or fewer');
  const list: { id: string; name: string }[] = kind === 'character' ? p.script?.characters ?? [] : p.script?.locations ?? [];
  const ent = list.find((x) => x.id === id);
  if (!ent) throw new Error(`no ${kind} ${id}`);
  const old = ent.name;
  ent.name = clean;
  if (old && old !== clean) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
    const sub = (s: string | undefined) => (typeof s === 'string' ? s.replace(re, clean) : s);
    const s = p.script!;
    s.logline = sub(s.logline)!; s.emotionalCore = sub(s.emotionalCore)!; s.arc = sub(s.arc)!;
    for (const b of s.scenes) { b.title = sub(b.title)!; b.actionSimple = sub(b.actionSimple)!; b.mood = sub(b.mood)!; b.cameraSimple = sub(b.cameraSimple)!; b.notes = sub(b.notes); }
    for (const c of s.characters) { c.baseDescription = sub(c.baseDescription)!; c.wardrobe = sub(c.wardrobe)!; for (const st of c.states) st.description = sub(st.description)!; }
    for (const l of s.locations) l.description = sub(l.description)!;
    for (const it of p.sheets?.items ?? []) it.prompt = sub(it.prompt)!;
    for (const a of p.assets) a.prompt = sub(a.prompt)!;
    for (const sp of p.scenePrompts ?? []) { sp.prompt = sub(sp.prompt)!; sp.motion = sub(sp.motion); for (const b of sp.blocks ?? []) b.text = sub(b.text)!; }
    for (const k of p.keyframes ?? []) { k.prompt = sub(k.prompt)!; for (const b of k.blocks ?? []) b.text = sub(b.text)!; }
  }
  saveProject(p);
  return p;
}

// --- context pictures (v6.1): the user's own pictures that guide one sheet or one scene ---

/** Context pictures attached to a sheet (`assetId`) or a scene (`sceneId`), in upload order. Pure. */
export function contextFor(p: Project, target: { assetId?: string; sceneId?: string }): RefImage[] {
  return (p.contextRefs ?? []).filter((r) => (target.assetId !== undefined && r.forAssetId === target.assetId) || (target.sceneId !== undefined && r.forSceneId === target.sceneId));
}
