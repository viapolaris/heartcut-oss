// Heartcut dashboard server: JSON API + SSE + media + static web/. Zero deps.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import {
  ROOT, PROJECTS_DIR, MEDIA_ROOT, newId, listProjects, loadProject, saveProject, createProject, addRef,
  stamp, staleness, staleCount, keepStage, setProjectStyle, removeOption, chooseKeyframe, removeKeyframeOption, renameEntity,
} from './store.ts';
import { listStyles, getStyle, saveStyle, deleteStyle, styleFor, soulStyles, IMAGE_MODELS, IDENTITY_MODELS, StyleError } from './styles.ts';
import { attachIdentityRefs } from './stages/script.ts';
import { listLibrary, adoptEntry, adoptOption, importOption, importNew, importKeyframeOption, addContextRef, removeContextRef, replaceContextRef, contextFromOption } from './library.ts';
import { getSettings, saveSettings } from './settings.ts';
import { readyLlm, llmJson, isFake } from './llm.ts';
import { llmOptions, checkLlmSettings } from './llm/config.ts';
import { loadEnv } from './env.ts';
import { isLocalAvailable } from './gen/local.ts';
import { checkGenSettings, genOptions } from './gen/config.ts';
import { getGenStatus } from './gen/status.ts';
import { runDoctor, problemLines } from './doctor.ts';
import { syncBlocks } from './stages/scenes.ts';
import { syncKeyframe } from './stages/keyframes.ts';
import { anchorStale } from './stages/sheets.ts';
import type { Project, RefRole, RunOptions, Stage, Staleness, Estimate, Spend, Emit, AssetKind, ScenePrompt, Keyframe, RefImage } from './types.ts';
import { STAGES } from './types.ts';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

// ---------- small helpers ----------

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type Req = http.IncomingMessage;
type Res = http.ServerResponse;
type Params = string[];
type Handler = (req: Req, res: Res, params: Params, url: URL) => Promise<void> | void;

function sendJson(res: Res, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store' });
  res.end(data);
}

async function readBody(req: Req, limit = 80 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson<T = any>(req: Req): Promise<T> {
  const raw = await readBody(req);
  if (!raw.length) return {} as T;
  try { return JSON.parse(raw.toString('utf8')) as T; } catch { throw new HttpError(400, 'invalid JSON'); }
}

function getProject(slug: string): Project {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new HttpError(400, 'bad slug');
  try { return loadProject(slug); } catch { throw new HttpError(404, `no project: ${slug}`); }
}

function parseStage(s: string): Stage {
  if (!(STAGES as string[]).includes(s)) throw new HttpError(400, `bad stage: ${s}`);
  return s as Stage;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge objects; arrays and scalars replace. */
export function deepMerge(base: any, patch: any): any {
  if (!isPlain(base) || !isPlain(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

// ---------- SSE + in-memory runs ----------

interface SseEvent { type: 'log' | 'job' | 'project'; slug: string; jobId?: string; line?: string; status?: string; stage?: string; error?: string }
const clients = new Set<Res>();

function broadcast(ev: SseEvent): void {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(data);
}

const runs = new Map<string, { slug: string; stage: Stage; status: string }>();

// ---------- lazy collaborators (owned by A / B) ----------

async function loadPipeline(): Promise<{ runStage: Function; estimateStage: Function } | null> {
  try {
    const m: any = await import(new URL('./pipeline.ts', import.meta.url).href);
    if (typeof m.runStage === 'function' && typeof m.estimateStage === 'function') return m;
  } catch { /* A has not landed it */ }
  return null;
}

async function loadSpend(): Promise<Omit<Spend, 'projectUsd'>> {
  try {
    // The provider layer: the Higgsfield CLI tool's own numbers, or Heartcut's ledger for the HTTP providers.
    const m: any = await import(new URL('./gen/provider.ts', import.meta.url).href);
    return await m.spend();
  } catch {
    return { sittingUsd: 0, capUsd: 5, remainingUsd: 5 };
  }
}

// ---------- API handlers ----------

const slimProject = (p: Project): Project & { staleCount: number } => ({ ...p, style: styleFor(p), jobs: (p.jobs ?? []).map((j) => ({ ...j, log: [] })), staleCount: staleCount(p) });

/** A project as the API returns it: the stored JSON plus the computed `staleness`. */
const view = (p: Project): Project & { staleness: Staleness; anchorStale: string[] } => ({ ...p, style: styleFor(p), staleness: staleness(p), anchorStale: anchorStale(p) });

const listAll: Handler = (_q, res) => sendJson(res, 200, listProjects().map(slimProject));

// First-run "Try the demo": a sample project with the demo brief (demo, demo-2, ...). Creating it is free; in fake mode
// every step after it is free too. The client explains how to start fake mode when it is off.
const demoProject: Handler = async (_q, res) => {
  const { DEMO_BRIEF } = await import('./demo/demo.ts');
  const taken = new Set(listProjects().map((p) => p.slug));
  let slug = 'demo';
  for (let n = 2; taken.has(slug); n++) slug = `demo-${n}`;
  const p = createProject({ title: 'Demo: the last apple', slug, briefText: DEMO_BRIEF, aspect: '16:9' });
  broadcast({ type: 'project', slug: p.slug });
  sendJson(res, 201, { ...p, fake: isFake() });
};

const create: Handler = async (req, res) => {
  const b = await readJson(req);
  if (!b.title || typeof b.title !== 'string') throw new HttpError(400, 'title required');
  try {
    const p = createProject({ title: b.title, briefText: String(b.briefText ?? ''), aspect: b.aspect });
    broadcast({ type: 'project', slug: p.slug });
    sendJson(res, 201, p);
  } catch (e) { throw new HttpError(409, (e as Error).message); }
};

const getOne: Handler = (_q, res, [slug]) => sendJson(res, 200, view(getProject(slug)));

// What a scenePrompts PATCH really changed. 'next-run' = only motion / durationSec / audio (settings for the next
// clip, like the tier: nothing already made is stale); 'endframe' = endFrame too (keyframe set changes); 'scenes' = anything else.
function scenePatchKind(before: ScenePrompt[] | undefined, after: ScenePrompt[] | undefined): 'next-run' | 'endframe' | 'scenes' {
  if (!before || !after || before.length !== after.length) return 'scenes';
  const strip = ({ motion, endFrame, durationSec, audio, ...rest }: ScenePrompt) => JSON.stringify(rest);
  if (!before.every((sp, i) => strip(sp) === strip(after[i]))) return 'scenes';
  return before.some((sp, i) => !!sp.endFrame !== !!after[i].endFrame) ? 'endframe' : 'next-run';
}

const patch: Handler = async (req, res, [slug]) => {
  const p = getProject(slug);
  const b = await readJson(req);
  if ('style' in b && !isPlain(b.style)) throw new HttpError(400, 'style must be an object');
  const allowed = ['title', 'aspect', 'brief', 'script', 'sheets', 'scenePrompts', 'keyframes', 'approvals', 'style'];
  if ('keyframes' in b && !Array.isArray(b.keyframes)) throw new HttpError(400, 'keyframes must be an array');
  const next: any = { ...p };
  for (const k of allowed) if (k in b) next[k] = deepMerge(k === 'style' ? styleFor(p) : p[k as keyof Project], b[k]);
  // A client that sends blocks gets prompt (and the NEGATIVES block) recomputed so the two never disagree.
  if (Array.isArray(b.scenePrompts)) next.scenePrompts = (next.scenePrompts as ScenePrompt[]).map(syncBlocks);
  if (Array.isArray(b.keyframes)) next.keyframes = (next.keyframes as Keyframe[]).map(syncKeyframe);
  const now = new Date().toISOString();
  if ('script' in b) stamp(next, 'script', now);
  if ('sheets' in b) stamp(next, 'sheets', now);
  if ('style' in b) stamp(next, 'brief', now); // a new look makes everything downstream stale
  if ('scenePrompts' in b) {
    const kind = scenePatchKind(p.scenePrompts, next.scenePrompts);
    if (kind !== 'next-run') stamp(next, kind === 'endframe' ? 'keyframes' : 'scenes', now);
  }
  if ('keyframes' in b) stamp(next, 'keyframes', now);
  const refsChanged = Array.isArray(b.brief?.refs) && JSON.stringify(b.brief.refs.filter((r: RefImage) => r.role !== 'music')) !== JSON.stringify(p.brief.refs.filter((r) => r.role !== 'music'));
  if ((typeof b.brief?.text === 'string' && b.brief.text !== p.brief.text) || (typeof b.brief?.notes === 'string' && b.brief.notes !== (p.brief.notes ?? '')) || refsChanged) stamp(next, 'brief', now);
  // Who-is-this edits link a face at once (no script run needed); the script still goes stale so it can re-read the photos.
  if (refsChanged && next.script) attachIdentityRefs(next as Project, next.script);
  saveProject(next);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(next));
};

const upload: Handler = async (req, res, [slug]) => {
  getProject(slug);
  const b = await readJson(req);
  const roles: RefRole[] = ['selfie', 'character', 'location', 'mood', 'music'];
  if (!roles.includes(b.role)) throw new HttpError(400, 'bad role');
  if (!b.filename || !b.dataBase64) throw new HttpError(400, 'filename and dataBase64 required');
  const ref = addRef(slug, {
    role: b.role, filename: String(b.filename), bytes: Buffer.from(String(b.dataBase64), 'base64'),
    note: b.note, forCharacterId: b.forCharacterId, forLocationId: b.forLocationId, who: typeof b.who === 'string' ? b.who : undefined,
  });
  broadcast({ type: 'project', slug });
  sendJson(res, 201, ref);
};

/** The body is the RunOptions; the v5 clip fields are checked so a typo cannot silently fall back to the default mode. */
function runOptionsOf(b: any): RunOptions {
  if (b.promptMode !== undefined && b.promptMode !== 'short' && b.promptMode !== 'full') throw new HttpError(400, 'promptMode must be short or full');
  if (b.sequence !== undefined && typeof b.sequence !== 'boolean') throw new HttpError(400, 'sequence must be a boolean');
  if (b.cleanFrom !== undefined && typeof b.cleanFrom !== 'string') throw new HttpError(400, 'cleanFrom must be a picture id');
  return b as RunOptions;
}

const estimate: Handler = async (req, res, [slug, stage]) => {
  getProject(slug);
  const opts = runOptionsOf(await readJson(req));
  const pipe = await loadPipeline();
  if (!pipe) return sendJson(res, 503, { error: 'pipeline not available' });
  try { sendJson(res, 200, (await pipe.estimateStage(slug, parseStage(stage), opts)) as Estimate); }
  catch (e) { sendJson(res, 500, { error: (e as Error).message }); }
};

const run: Handler = async (req, res, [slug, stageName]) => {
  getProject(slug);
  const stage = parseStage(stageName);
  const opts = runOptionsOf(await readJson(req));
  const pipe = await loadPipeline();
  if (!pipe) return sendJson(res, 503, { error: 'pipeline not available' });
  const jobId = newId('run');
  runs.set(jobId, { slug, stage, status: 'running' });
  broadcast({ type: 'job', slug, jobId, status: 'running', stage });
  sendJson(res, 202, { jobId });
  const emit: Emit = (line) => { broadcast({ type: 'log', slug, jobId, line, stage }); broadcast({ type: 'project', slug }); };
  void pipe.runStage(slug, stage, opts, emit).then(
    () => finishRun(jobId, slug, stage, 'done'),
    (e: Error) => { emit(`ERROR ${e.message}`); finishRun(jobId, slug, stage, 'failed', e.message); },
  );
};

function finishRun(jobId: string, slug: string, stage: Stage, status: 'done' | 'failed', error?: string): void {
  runs.set(jobId, { slug, stage, status });
  broadcast({ type: 'project', slug });
  broadcast({ type: 'job', slug, jobId, status, stage, error });
}

const choose: Handler = async (req, res, [slug]) => {
  const p = getProject(slug);
  const { assetId, index } = await readJson(req);
  const a = p.assets.find((x) => x.id === assetId);
  if (!a) throw new HttpError(404, 'no such asset');
  if (index === null) delete a.chosen;
  else if (!Number.isInteger(index) || index < 0 || index >= a.options.length) throw new HttpError(400, 'bad index');
  else a.chosen = index;
  stamp(p, 'images');
  saveProject(p);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

// ---------- keyframes (v5) ----------

const chooseKf: Handler = async (req, res, [slug]) => {
  const p0 = getProject(slug);
  const { keyframeId, index } = await readJson(req);
  const k = (p0.keyframes ?? []).find((x) => x.id === keyframeId);
  if (!k) throw new HttpError(404, 'no such keyframe');
  if (index !== null && (!Number.isInteger(index) || index < 0 || index >= k.options.length)) throw new HttpError(400, 'bad index');
  const p = chooseKeyframe(slug, keyframeId, index);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const removeKfPicture: Handler = async (req, res, [slug, keyframeId]) => {
  const p0 = getProject(slug);
  const k = (p0.keyframes ?? []).find((x) => x.id === keyframeId);
  if (!k) throw new HttpError(404, 'no such keyframe');
  const { index } = await readJson(req);
  if (!Number.isInteger(index) || index < 0 || index >= k.options.length) throw new HttpError(400, 'bad index');
  const p = removeKeyframeOption(slug, keyframeId, index);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const importKfPicture: Handler = async (req, res, [slug, keyframeId]) => {
  getProject(slug);
  const b = await readJson(req);
  if (!b.filename || !b.dataBase64) throw new HttpError(400, 'filename and dataBase64 required');
  const p = importKeyframeOption(slug, keyframeId, { filename: String(b.filename), bytes: Buffer.from(String(b.dataBase64), 'base64') });
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const approveClip: Handler = async (req, res, [slug]) => {
  const p = getProject(slug);
  const { clipId, approved } = await readJson(req);
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) throw new HttpError(404, 'no such clip');
  c.approved = !!approved;
  stamp(p, 'clips');
  saveProject(p);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const approveStage: Handler = async (req, res, [slug]) => {
  const p = getProject(slug);
  const { stage, approved } = await readJson(req);
  const s = parseStage(String(stage));
  if (approved === false) delete p.approvals[s]; else p.approvals[s] = new Date().toISOString();
  saveProject(p);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const keep: Handler = async (req, res, [slug]) => {
  getProject(slug);
  const { stage } = await readJson(req);
  const p = keepStage(slug, parseStage(String(stage)));
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const rename: Handler = async (req, res, [slug]) => {
  getProject(slug);
  const b = await readJson(req);
  if (b.kind !== 'character' && b.kind !== 'location') throw new HttpError(400, "kind must be 'character' or 'location'");
  if (typeof b.id !== 'string' || typeof b.name !== 'string') throw new HttpError(400, 'id and name are required');
  let p;
  try { p = renameEntity(slug, b.kind, b.id, b.name); } catch (e) {
    const m = (e as Error).message; throw new HttpError(m.startsWith('no ') ? 404 : 400, m);
  }
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

// ---------- library / import ----------

const library: Handler = (_q, res, _p, url) => {
  const kind = url.searchParams.get('kind');
  if (kind && kind !== 'character' && kind !== 'location') throw new HttpError(400, 'bad kind');
  sendJson(res, 200, listLibrary({
    kind: (kind as 'character' | 'location' | null) ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    excludeSlug: url.searchParams.get('exclude') ?? undefined,
  }));
};

const adopt: Handler = async (req, res, [slug]) => {
  getProject(slug);
  const b = await readJson(req);
  if (!b.entryId || typeof b.entryId !== 'string') throw new HttpError(400, 'entryId required');
  if (b.as !== undefined && b.as !== 'character' && b.as !== 'location') throw new HttpError(400, 'bad as');
  const r = adoptEntry(slug, b.entryId, b.as);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, { ...view(r.project), adopted: { kind: r.kind, id: r.id } });
};

const removePicture: Handler = async (req, res, [slug, assetId]) => {
  const p0 = getProject(slug);
  const a = p0.assets.find((x) => x.id === assetId);
  if (!a) throw new HttpError(404, 'no such asset');
  const { index } = await readJson(req);
  if (!Number.isInteger(index) || index < 0 || index >= a.options.length) throw new HttpError(400, 'bad index');
  const p = removeOption(slug, assetId, index);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const adoptPicture: Handler = async (req, res, [slug, assetId]) => {
  getProject(slug);
  const b = await readJson(req);
  if (!b.fromSlug || !b.fromAssetId) throw new HttpError(400, 'fromSlug and fromAssetId required');
  const p = adoptOption(slug, assetId, { fromSlug: String(b.fromSlug), fromAssetId: String(b.fromAssetId), index: Number(b.index) });
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const importPicture: Handler = async (req, res, [slug, assetId]) => {
  getProject(slug);
  const b = await readJson(req);
  if (!b.filename || !b.dataBase64) throw new HttpError(400, 'filename and dataBase64 required');
  const p = importOption(slug, assetId, { filename: String(b.filename), bytes: Buffer.from(String(b.dataBase64), 'base64') });
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const importNewPicture: Handler = async (req, res, [slug]) => {
  getProject(slug);
  const b = await readJson(req);
  if (!b.filename || !b.dataBase64) throw new HttpError(400, 'filename and dataBase64 required');
  const r = importNew(slug, {
    kind: b.kind as AssetKind, characterId: b.characterId, stateId: b.stateId, locationId: b.locationId,
    filename: String(b.filename), bytes: Buffer.from(String(b.dataBase64), 'base64'),
  });
  broadcast({ type: 'project', slug });
  sendJson(res, 201, { ...view(r.project), assetId: r.assetId });
};

// ---------- your own pictures as context (v6.1) ----------

const addContext: Handler = async (req, res, [slug]) => {
  getProject(slug);
  const b = await readJson(req);
  if (!b.filename || !b.dataBase64) throw new HttpError(400, 'filename and dataBase64 required');
  const r = addContextRef(slug, {
    forAssetId: typeof b.forAssetId === 'string' ? b.forAssetId : undefined, forSceneId: typeof b.forSceneId === 'string' ? b.forSceneId : undefined,
    filename: String(b.filename), bytes: Buffer.from(String(b.dataBase64), 'base64'),
    note: typeof b.note === 'string' ? b.note : undefined, who: typeof b.who === 'string' ? b.who : undefined,
  });
  broadcast({ type: 'project', slug });
  sendJson(res, 201, { ...view(r.project), ref: r.ref });
};

const contextFromPicture: Handler = async (req, res, [slug, assetId]) => {
  getProject(slug);
  const { index } = await readJson(req);
  const r = contextFromOption(slug, assetId, Number(index));
  broadcast({ type: 'project', slug });
  sendJson(res, 201, { ...view(r.project), ref: r.ref });
};

const removeContext: Handler = async (_req, res, [slug, refId]) => {
  getProject(slug);
  const p = removeContextRef(slug, refId);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const replaceContext: Handler = async (req, res, [slug, refId]) => {
  getProject(slug);
  const b = await readJson(req);
  if (!b.filename || !b.dataBase64) throw new HttpError(400, 'filename and dataBase64 required');
  const p = replaceContextRef(slug, refId, { filename: String(b.filename), bytes: Buffer.from(String(b.dataBase64), 'base64') });
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

// ---------- styles ----------

const styleErr = (e: unknown): never => { if (e instanceof StyleError) throw new HttpError(e.status, e.message); throw e; };

const stylesList: Handler = (_q, res) => sendJson(res, 200, listStyles());

const styleSave: Handler = async (req, res) => {
  const b = await readJson(req);
  const isNew = !(typeof b.id === 'string' && listStyles().some((s) => s.id === b.id && !s.builtin));
  try { sendJson(res, isNew ? 201 : 200, saveStyle(b)); } catch (e) { styleErr(e); }
};

const styleDelete: Handler = (_q, res, [id]) => {
  const name = decodeURIComponent(id);
  try { deleteStyle(name); } catch (e) { styleErr(e); }
  sendJson(res, 200, { deleted: name });
};

const soulStylesList: Handler = async (_q, res) => {
  try { sendJson(res, 200, await soulStyles()); } catch (e) { sendJson(res, 502, { error: (e as Error).message }); }
};

const imageModels: Handler = (_q, res) => sendJson(res, 200, {
  images: Object.entries(IMAGE_MODELS).map(([slug, m]) => ({ slug, ...m })),
  identity: Object.entries(IDENTITY_MODELS).map(([slug, m]) => ({ slug, ...m })),
});

// LLM status carries only the key's variable name and whether it is set, never the key itself.
async function llmStatus() {
  try {
    const r = await readyLlm();
    return { provider: r.provider, preset: r.preset ?? null, baseUrl: r.baseUrl ?? null, models: r.models, source: r.source, reason: r.reason ?? null, label: r.label, keyEnv: r.keyEnv ?? null, keyRequired: r.keyRequired, keyFound: r.keyFound, error: null };
  } catch (e) { return { provider: 'claude-cli', error: (e as Error).message, keyFound: false }; }
}
// genStatus carries only the key's variable name and whether it is set, never a key.
async function genView() {
  const m: any = await import(new URL('./gen/provider.ts', import.meta.url).href);
  return { genStatus: getGenStatus(), genOptions: genOptions(), genCoverage: m.coverage() };
}
const settingsView = async () => ({ ...getSettings(), local: isLocalAvailable(), llmStatus: await llmStatus(), llmOptions: llmOptions(), ...(await genView()), fake: isFake() });
const settingsGet: Handler = async (_q, res) => sendJson(res, 200, await settingsView());
const settingsPatch: Handler = async (req, res) => {
  const b = await readJson(req);
  const hasLocal = typeof b.preferLocal === 'boolean';
  if (!hasLocal && b.llm === undefined && b.gen === undefined) throw new HttpError(400, 'send preferLocal (boolean), llm and/or gen (object, or null to clear)');
  if (b.preferLocal !== undefined && !hasLocal) throw new HttpError(400, 'preferLocal must be a boolean');
  if (hasLocal && b.preferLocal && !isLocalAvailable().ok) throw new HttpError(409, `local rendering is not available: ${isLocalAvailable().reason}`);
  let llm;
  if (b.llm === null) llm = null;
  else if (b.llm !== undefined) { try { llm = checkLlmSettings(b.llm); } catch (e) { throw new HttpError(400, (e as Error).message); } }
  let gen;
  if (b.gen === null) gen = null;
  else if (b.gen !== undefined) { try { gen = checkGenSettings(b.gen); } catch (e) { throw new HttpError(400, (e as Error).message); } }
  saveSettings({ ...(hasLocal ? { preferLocal: b.preferLocal } : {}), ...(llm !== undefined ? { llm } : {}), ...(gen !== undefined ? { gen } : {}) });
  sendJson(res, 200, await settingsView());
};

// "Check" for the picture service: one free, read-only call (account, price list or style list). Never a generation.
// Body: {} checks the active service; { gen } checks unsaved form values. Errors come back as ok:false.
const genCheck: Handler = async (req, res) => {
  const b = await readJson(req);
  let override;
  if (b.gen !== undefined && b.gen !== null) { try { override = checkGenSettings(b.gen); } catch (e) { throw new HttpError(400, (e as Error).message); } }
  const m: any = await import(new URL('./gen/provider.ts', import.meta.url).href);
  sendJson(res, 200, await m.check(override));
};

// One tiny structured call, only when the user clicks "Test connection". On a paid API it costs a fraction of a cent.
// Body: {} tests the active config; { llm } tests unsaved form values. Errors come back as ok:false, not as HTTP errors.
const TEST_SCHEMA = { type: 'object', required: ['ok', 'word'], properties: { ok: { type: 'boolean' }, word: { type: 'string' } } };
const llmTest: Handler = async (req, res) => {
  const b = await readJson(req);
  let override;
  if (b.llm !== undefined && b.llm !== null) { try { override = checkLlmSettings(b.llm); } catch (e) { throw new HttpError(400, (e as Error).message); } }
  let cfg;
  try { cfg = await readyLlm(override); } catch (e) { return sendJson(res, 200, { ok: false, error: (e as Error).message, ms: 0 }); }
  const about = { provider: cfg.provider, preset: cfg.preset ?? null, model: cfg.models.haiku, label: cfg.label };
  if (isFake()) return sendJson(res, 200, { ok: true, fake: true, ms: 0, ...about, note: 'Fake mode is on (HEARTCUT_FAKE=1), so nothing was sent.' });
  const t0 = Date.now();
  try {
    const out = await llmJson<{ ok: boolean; word: string }>({
      system: 'You are a connection check. Answer with the JSON object asked for and nothing else.',
      user: 'Return {"ok": true, "word": "hello"}.', schema: TEST_SCHEMA, model: 'haiku', maxTokens: 1024, llm: override,
    });
    sendJson(res, 200, { ok: out.ok === true, ms: Date.now() - t0, ...about, reply: out });
  } catch (e) {
    sendJson(res, 200, { ok: false, ms: Date.now() - t0, ...about, error: (e as Error).message.slice(0, 1200) });
  }
};

const projectStyle: Handler = async (req, res, [slug]) => {
  getProject(slug);
  const { styleId } = await readJson(req);
  const style = typeof styleId === 'string' ? getStyle(styleId) : undefined;
  if (!style) throw new HttpError(404, `no style: ${styleId}`);
  const p = setProjectStyle(slug, style);
  broadcast({ type: 'project', slug });
  sendJson(res, 200, view(p));
};

const jobs: Handler = (_q, res, [slug]) => sendJson(res, 200, getProject(slug).jobs);

const spend: Handler = async (_q, res, _p, url) => {
  const base = await loadSpend();
  const slug = url.searchParams.get('slug');
  let projectUsd = 0;
  if (slug) projectUsd = getProject(slug).jobs.reduce((s, j) => s + (j.actualUsd ?? 0), 0);
  sendJson(res, 200, { projectUsd, ...base, fake: !!process.env.HEARTCUT_FAKE } satisfies Spend);
};

const events: Handler = (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`: connected\n\ndata: ${JSON.stringify({ type: 'project', slug: '' })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
};

// ---------- files ----------

/** Resolve rel under base; null on traversal or non-file. */
function safeFile(base: string, rel: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const abs = path.resolve(base, decoded);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  try { return fs.statSync(abs).isFile() ? abs : null; } catch { return null; }
}

function serveFile(req: Req, res: Res, file: string): void {
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const size = fs.statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(end, size - 1);
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return void res.end(); }
    res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return void fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'content-length': size });
  fs.createReadStream(file).pipe(res);
}

const fromDir = (baseOf: (params: Params) => string): Handler => (req, res, params) => {
  const file = safeFile(baseOf(params), params[params.length - 1]);
  if (!file) throw new HttpError(404, 'not found');
  serveFile(req, res, file);
};

const media = fromDir(([slug]) => path.join(MEDIA_ROOT, /^[a-z0-9-]+$/.test(slug) ? slug : '__bad__'));
const refs = fromDir(([slug]) => path.join(PROJECTS_DIR, /^[a-z0-9-]+$/.test(slug) ? slug : '__bad__', 'refs'));

const staticWeb: Handler = (req, res, [, rel], url) => {
  const name = url.pathname === '/' ? 'index.html' : rel;
  const file = safeFile(WEB_DIR, name);
  if (!file) throw new HttpError(404, 'not found');
  serveFile(req, res, file);
};

// ---------- router ----------

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/projects$/, listAll],
  ['POST', /^\/api\/projects$/, create],
  ['GET', /^\/api\/projects\/([^/]+)$/, getOne],
  ['PATCH', /^\/api\/projects\/([^/]+)$/, patch],
  ['POST', /^\/api\/projects\/([^/]+)\/refs$/, upload],
  ['POST', /^\/api\/projects\/([^/]+)\/estimate\/([^/]+)$/, estimate],
  ['POST', /^\/api\/projects\/([^/]+)\/run\/([^/]+)$/, run],
  ['POST', /^\/api\/projects\/([^/]+)\/choose$/, choose],
  ['POST', /^\/api\/projects\/([^/]+)\/keyframes\/choose$/, chooseKf],
  ['POST', /^\/api\/projects\/([^/]+)\/keyframes\/([^/]+)\/options\/remove$/, removeKfPicture],
  ['POST', /^\/api\/projects\/([^/]+)\/keyframes\/([^/]+)\/import$/, importKfPicture],
  ['POST', /^\/api\/projects\/([^/]+)\/approve$/, approveClip],
  ['POST', /^\/api\/projects\/([^/]+)\/approve-stage$/, approveStage],
  ['POST', /^\/api\/projects\/([^/]+)\/keep$/, keep],
  ['POST', /^\/api\/projects\/([^/]+)\/rename$/, rename],
  ['GET', /^\/api\/styles$/, stylesList],
  ['POST', /^\/api\/styles$/, styleSave],
  ['DELETE', /^\/api\/styles\/([^/]+)$/, styleDelete],
  ['GET', /^\/api\/soul-styles$/, soulStylesList],
  ['GET', /^\/api\/image-models$/, imageModels],
  ['GET', /^\/api\/doctor$/, async (_q, res) => { await readyLlm().catch(() => {}); sendJson(res, 200, runDoctor()); }],
  ['POST', /^\/api\/demo$/, demoProject],
  ['GET', /^\/api\/settings$/, settingsGet],
  ['PATCH', /^\/api\/settings$/, settingsPatch],
  ['POST', /^\/api\/llm\/test$/, llmTest],
  ['POST', /^\/api\/gen\/check$/, genCheck],
  ['POST', /^\/api\/projects\/([^/]+)\/style$/, projectStyle],
  ['GET', /^\/api\/library$/, library],
  ['POST', /^\/api\/projects\/([^/]+)\/adopt$/, adopt],
  ['POST', /^\/api\/projects\/([^/]+)\/assets\/import-new$/, importNewPicture],
  ['POST', /^\/api\/projects\/([^/]+)\/context$/, addContext],
  ['POST', /^\/api\/projects\/([^/]+)\/context\/([^/]+)\/remove$/, removeContext],
  ['POST', /^\/api\/projects\/([^/]+)\/context\/([^/]+)\/replace$/, replaceContext],
  ['POST', /^\/api\/projects\/([^/]+)\/assets\/([^/]+)\/context$/, contextFromPicture],
  ['POST', /^\/api\/projects\/([^/]+)\/assets\/([^/]+)\/adopt$/, adoptPicture],
  ['POST', /^\/api\/projects\/([^/]+)\/assets\/([^/]+)\/options\/remove$/, removePicture],
  ['POST', /^\/api\/projects\/([^/]+)\/assets\/([^/]+)\/import$/, importPicture],
  ['GET', /^\/api\/projects\/([^/]+)\/jobs$/, jobs],
  ['GET', /^\/api\/spend$/, spend],
  ['GET', /^\/api\/events$/, events],
  ['GET', /^\/media\/([^/]+)\/(.+)$/, media],
  ['GET', /^\/refs\/([^/]+)\/(.+)$/, refs],
  ['GET', /^\/$/, staticWeb],
  ['GET', /^\/(web\/)?([\w.-]+\.(?:js|css|svg))$/, staticWeb],
];

async function route(req: Req, res: Res): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  // keep raw (encoded) pathname for traversal checks; handlers decode themselves
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = re.exec(url.pathname);
    if (match) return void (await h(req, res, match.slice(1), url));
  }
  throw new HttpError(404, 'not found');
}

// A job still 'running' at boot was interrupted by a restart or a crash: nothing is polling it any
// more, so the UI would show "generating…" forever. Fail it loudly and let the user run again.
function failOrphanedJobs(): number {
  let n = 0;
  for (const p of listProjects()) {
    let touched = false;
    for (const j of p.jobs ?? []) {
      if (j.status !== 'running' && j.status !== 'queued') continue;
      j.status = 'failed';
      j.finishedAt = new Date().toISOString();
      j.error = 'Interrupted: the server stopped while this job ran. Check the spend bar and the provider dashboard, then run the step again.';
      (j.log ??= []).push(j.error);
      touched = true; n++;
    }
    if (touched) saveProject(p);
  }
  return n;
}

/** PORT or HEARTCUT_PORT (default 5088). HEARTCUT_HOST (default 127.0.0.1, this machine only). */
export function startServer(port = Number(process.env.HEARTCUT_PORT || process.env.PORT) || 5088, host = process.env.HEARTCUT_HOST || '127.0.0.1'): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  loadEnv(); // repo-root .env (gitignored): API keys for optional LLM providers
  const orphans = failOrphanedJobs();
  if (orphans) console.error(`heartcut: marked ${orphans} interrupted job(s) as failed`);
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : 500; // HttpError / LibraryError
      if (res.headersSent) return void res.end();
      sendJson(res, status, { error: (e as Error).message });
    });
  });
  const sockets = new Set<Duplex>();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve, reject) => {
    server.once('error', reject); // e.g. EADDRINUSE: serve() turns it into a plain sentence
    server.listen(port, host, () => {
      const actual = (server.address() as { port: number }).port;
      resolve({
        server, port: actual,
        close: () => new Promise<void>((r) => {
          for (const c of clients) c.end();
          clients.clear();
          for (const s of sockets) s.destroy();
          server.close(() => r());
        }),
      });
    });
  });
}

/** `npm start` / `heartcut serve`: start, say where to open it, then list anything the doctor wants fixed. */
/** `--port 5099` or `--port=5099` on the command line (works the same on every OS); undefined when absent. */
export function portArg(argv: string[] = process.argv): number | undefined {
  const i = argv.indexOf('--port');
  const v = i >= 0 ? argv[i + 1] : argv.find((x) => x.startsWith('--port='))?.slice(7);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`--port ${v} is not a port number`);
  return n;
}

export async function serve(): Promise<void> {
  // --fake is HEARTCUT_FAKE=1 without shell syntax, so `node src/server.ts --fake` works on every OS.
  if (process.argv.includes('--fake')) process.env.HEARTCUT_FAKE = '1';
  const host = process.env.HEARTCUT_HOST || '127.0.0.1';
  let port: number | undefined;
  try { port = portArg(); } catch (e) { console.error(`heartcut: ${(e as Error).message}`); process.exit(2); }
  let started;
  try { started = await startServer(port, host); } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EADDRINUSE') { console.error(`heartcut: port ${port ?? (Number(process.env.HEARTCUT_PORT || process.env.PORT) || 5088)} is in use. Is Heartcut already running? Start on another port with: node src/server.ts --port 5099`); process.exit(1); }
    throw e;
  }
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  console.log(`Heartcut is running. Open http://${shown.includes(':') ? `[${shown}]` : shown}:${started.port} in your browser.`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.log(`  Note: listening on ${host}, so other machines on your network can open it too.`);
  try {
    await readyLlm().catch(() => {});
    const r = runDoctor();
    const lines = problemLines(r);
    if (r.fake) console.log('  Fake mode is on: placeholders only, nothing is spent.');
    for (const l of lines) console.log(l);
    if (lines.length) console.log('  Run npm run doctor for the full checklist.');
  } catch (e) { console.log(`  The setup check failed: ${(e as Error).message}`); }
  console.log('  Press Ctrl+C to stop.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await serve();
