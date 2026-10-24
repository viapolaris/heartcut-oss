// Cross-project library: reuse a character/location (spec + chosen sheet pictures) or a single
// picture from any other project, and import your own images. Files are always copied, never moved.
import fs from 'node:fs';
import path from 'node:path';
import type {
  Asset, AssetKind, CharacterSpec, Keyframe, LibraryEntry, LocationSpec, MediaFile, Project, Provenance, RefImage, SheetPrompt,
} from './types.ts';
import { listProjects, loadProject, mediaDir, newId, refsDir, saveProject, stamp } from './store.ts';

export class LibraryError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

// ---------- listing ----------

function chosenSheets(p: Project, match: (a: Asset) => boolean): LibraryEntry['sheets'] {
  const out: LibraryEntry['sheets'] = [];
  for (const a of p.assets ?? []) {
    if (!match(a) || a.chosen === undefined) continue;
    const o = a.options?.[a.chosen];
    if (o?.path) out.push({ assetId: a.id, kind: a.kind, stateId: a.stateId, file: o.path, index: a.chosen });
  }
  return out;
}

function allSheets(p: Project, match: (a: Asset) => boolean): LibraryEntry['allSheets'] {
  const out: LibraryEntry['allSheets'] = [];
  for (const a of p.assets ?? []) {
    if (!match(a)) continue;
    (a.options ?? []).forEach((o, index) => { if (o.path) out.push({ assetId: a.id, kind: a.kind, stateId: a.stateId, file: o.path, index, chosen: a.chosen === index }); });
  }
  return out;
}

/** Saved scripts may lack optional text (an imported or hand-edited project), so never assume a string. */
const clip = (s: unknown): string => (typeof s === 'string' ? (s.length > 160 ? s.slice(0, 160) : s) : '');

export function listLibrary(opts: { kind?: 'character' | 'location'; q?: string; excludeSlug?: string } = {}): LibraryEntry[] {
  const q = opts.q?.trim().toLowerCase();
  const out: LibraryEntry[] = [];
  for (const p of listProjects()) { // newest project first
    if (p.slug === opts.excludeSlug || !p.script) continue;
    if (opts.kind !== 'location') {
      for (const c of p.script.characters ?? []) {
        out.push({
          id: `${p.slug}:${c.id}`, kind: 'character', projectSlug: p.slug, projectTitle: p.title, name: c.name ?? c.id,
          summary: clip(c.baseDescription), spec: c, sheets: chosenSheets(p, (a) => a.characterId === c.id), allSheets: allSheets(p, (a) => a.characterId === c.id), updatedAt: p.updatedAt,
        });
      }
    }
    if (opts.kind !== 'character') {
      for (const l of p.script.locations ?? []) {
        out.push({
          id: `${p.slug}:${l.id}`, kind: 'location', projectSlug: p.slug, projectTitle: p.title, name: l.name ?? l.id,
          summary: clip(l.description), spec: l, sheets: chosenSheets(p, (a) => a.locationId === l.id), allSheets: allSheets(p, (a) => a.locationId === l.id), updatedAt: p.updatedAt,
        });
      }
    }
  }
  const hit = (e: LibraryEntry): boolean => !q || `${e.name} ${e.summary} ${e.projectTitle} ${e.id}`.toLowerCase().includes(q);
  return out.filter(hit);
}

// ---------- helpers ----------

/** Entry ids are `${projectSlug}:${specId}`; slugs never contain ':'. A character and a location may share an id, so kind disambiguates. */
export function findEntry(entryId: string, as?: 'character' | 'location'): LibraryEntry {
  const i = entryId.indexOf(':');
  if (i < 1) throw new LibraryError(400, `bad entry id: ${entryId}`);
  const slug = entryId.slice(0, i);
  const hits = listLibrary({}).filter((e) => e.id === entryId && e.projectSlug === slug && (!as || e.kind === as));
  if (!hits.length) throw new LibraryError(404, `no library entry: ${entryId}${as ? ` (${as})` : ''}`);
  return hits[0];
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

function copyInto(slug: string, srcPath: string, stem: string): string {
  if (!srcPath || !fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) throw new LibraryError(404, `source file missing: ${srcPath}`);
  const dir = mediaDir(slug, 'assets');
  const ext = path.extname(srcPath) || '.png';
  let n = 1;
  let dest = path.join(dir, `${stem}${ext}`);
  while (fs.existsSync(dest)) dest = path.join(dir, `${stem}-${++n}${ext}`);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

function mediaCopy(slug: string, o: MediaFile, stem: string): MediaFile {
  const m: MediaFile = { path: copyInto(slug, o.path, stem) };
  if (o.width !== undefined) m.width = o.width;
  if (o.height !== undefined) m.height = o.height;
  return m;
}

function sheetId(kind: AssetKind, characterId: string | undefined, stateId: string | undefined, locationId: string | undefined): string {
  if (kind === 'location') return `loc_${locationId}`;
  return `${characterId}_${stateId}_${kind === 'character-portrait' ? 'portrait' : 'full'}`;
}

/** Keep `sources` parallel to `options` (missing entries are generated). */
function padSources(a: Asset): Provenance[] {
  const src = a.sources ?? [];
  while (src.length < a.options.length) src.push({ kind: 'generated' });
  a.sources = src;
  return src;
}

function ensureScript(p: Project): NonNullable<Project['script']> {
  const s = (p.script ??= { logline: '', emotionalCore: '', arc: '', characters: [], locations: [], scenes: [] });
  s.characters ??= []; s.locations ??= []; s.scenes ??= [];
  return s;
}

// ---------- adopt a whole character / location ----------

export function adoptEntry(slug: string, entryId: string, as?: 'character' | 'location'): { project: Project; kind: 'character' | 'location'; id: string } {
  const entry = findEntry(entryId, as);
  const p = loadProject(slug);
  const now = new Date().toISOString();
  const script = ensureScript(p);
  const sheets = (p.sheets ??= { items: [] });
  sheets.items ??= [];
  p.assets ??= [];
  const src = loadProject(entry.projectSlug);
  const sheetOf = (assetId: string): string | undefined => src.sheets?.items?.find((i) => i.id === assetId)?.prompt;
  let newSpecId: string;

  if (entry.kind === 'character') {
    const spec = structuredClone(entry.spec as CharacterSpec);
    newSpecId = uniqueId(spec.id, new Set(script.characters.map((c) => c.id)));
    spec.id = newSpecId;
    delete spec.identityRefId; // the selfie belongs to the other project
    script.characters.push(spec);
  } else {
    const spec = structuredClone(entry.spec as LocationSpec);
    newSpecId = uniqueId(spec.id, new Set(script.locations.map((l) => l.id)));
    spec.id = newSpecId;
    delete spec.refId;
    script.locations.push(spec);
  }

  for (const sh of entry.sheets) {
    const from = (src.assets ?? []).find((a) => a.id === sh.assetId);
    const opt = from?.options?.[sh.index];
    if (!from || !opt) continue;
    const characterId = entry.kind === 'character' ? newSpecId : undefined;
    const locationId = entry.kind === 'location' ? newSpecId : undefined;
    const id = sheetId(from.kind, characterId, from.stateId, locationId);
    if (p.assets.some((a) => a.id === id)) continue; // never clobber
    const prompt = sheetOf(from.id) ?? from.prompt;
    const item: SheetPrompt = { id, kind: from.kind, characterId, stateId: from.stateId, locationId, prompt };
    sheets.items.push(item);
    p.assets.push({
      id, kind: from.kind, characterId, stateId: from.stateId, locationId, prompt,
      model: 'library',
      options: [mediaCopy(slug, opt, `${id}-library`)],
      chosen: 0,
      sources: [{ kind: 'library', projectSlug: entry.projectSlug, assetId: from.id, index: sh.index }],
    });
  }

  stamp(p, 'script', now); stamp(p, 'sheets', now); stamp(p, 'images', now);
  saveProject(p);
  return { project: p, kind: entry.kind, id: newSpecId };
}

// ---------- swap / add a single picture ----------

function getAsset(p: Project, assetId: string): Asset {
  const a = (p.assets ?? []).find((x) => x.id === assetId);
  if (!a) throw new LibraryError(404, `no asset ${assetId}`);
  return a;
}

export function adoptOption(slug: string, assetId: string, from: { fromSlug: string; fromAssetId: string; index: number }): Project {
  const p = loadProject(slug);
  const a = getAsset(p, assetId);
  let src: Project;
  try { src = loadProject(from.fromSlug); } catch { throw new LibraryError(404, `no project: ${from.fromSlug}`); }
  const sa = src.assets.find((x) => x.id === from.fromAssetId);
  if (!sa) throw new LibraryError(404, `no asset ${from.fromAssetId} in ${from.fromSlug}`);
  if (!Number.isInteger(from.index) || from.index < 0 || from.index >= sa.options.length) throw new LibraryError(400, `index ${from.index} out of range`);
  const file = mediaCopy(slug, sa.options[from.index], `${a.id}-library`);
  padSources(a);
  a.options.push(file);
  a.sources!.push({ kind: 'library', projectSlug: from.fromSlug, assetId: from.fromAssetId, index: from.index });
  a.chosen = a.options.length - 1;
  stamp(p, 'images');
  saveProject(p);
  return p;
}

// ---------- import your own image ----------

/** png / jpg / webp by magic bytes (the filename is not trusted). */
export function sniffImage(bytes: Buffer): '.png' | '.jpg' | '.webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function checkImage(bytes: Buffer): '.png' | '.jpg' | '.webp' {
  if (!bytes.length) throw new LibraryError(400, 'empty file');
  if (bytes.length > MAX_IMPORT_BYTES) throw new LibraryError(413, 'image too large (15 MB max)');
  const ext = sniffImage(bytes);
  if (!ext) throw new LibraryError(400, 'not an image: png, jpg or webp only');
  return ext;
}

function writeImport(slug: string, assetId: string, bytes: Buffer, ext: string, sub: 'assets' | 'keyframes' = 'assets'): string {
  const dir = mediaDir(slug, sub);
  let n = fs.readdirSync(dir).filter((f) => f.startsWith(`${assetId}-import-`)).length + 1; // numbered across extensions
  let dest: string;
  while (fs.existsSync((dest = path.join(dir, `${assetId}-import-${n}${ext}`)))) n++;
  fs.writeFileSync(dest, bytes);
  return dest;
}

export function importOption(slug: string, assetId: string, input: { filename: string; bytes: Buffer }): Project {
  const ext = checkImage(input.bytes);
  const p = loadProject(slug);
  const a = getAsset(p, assetId);
  const file = writeImport(slug, a.id, input.bytes, ext);
  padSources(a);
  a.options.push({ path: file });
  a.sources!.push({ kind: 'import', filename: path.basename(input.filename) });
  a.chosen = a.options.length - 1;
  stamp(p, 'images');
  saveProject(p);
  return p;
}

export function importNew(slug: string, input: { kind: AssetKind; characterId?: string; stateId?: string; locationId?: string; filename: string; bytes: Buffer }): { project: Project; assetId: string } {
  if (!['character-portrait', 'character-full', 'location'].includes(input.kind)) throw new LibraryError(400, `bad kind: ${input.kind}`);
  if (input.kind === 'location' ? !input.locationId : !input.characterId || !input.stateId) {
    throw new LibraryError(400, input.kind === 'location' ? 'locationId required' : 'characterId and stateId required');
  }
  const ext = checkImage(input.bytes);
  const p = loadProject(slug);
  const isLoc = input.kind === 'location';
  const characterId = isLoc ? undefined : input.characterId;
  const stateId = isLoc ? undefined : input.stateId;
  const locationId = isLoc ? input.locationId : undefined;
  const id = sheetId(input.kind, characterId, stateId, locationId);
  p.assets ??= [];
  if (p.assets.some((a) => a.id === id)) throw new LibraryError(409, `asset ${id} exists: use the import endpoint on it`);
  const sheets = (p.sheets ??= { items: [] });
  sheets.items ??= [];
  if (!sheets.items.some((i) => i.id === id)) sheets.items.push({ id, kind: input.kind, characterId, stateId, locationId, prompt: '(imported)' });
  p.assets.push({
    id, kind: input.kind, characterId, stateId, locationId, prompt: '(imported)', model: 'import',
    options: [{ path: writeImport(slug, id, input.bytes, ext) }], chosen: 0,
    sources: [{ kind: 'import', filename: path.basename(input.filename) }],
  });
  const now = new Date().toISOString();
  stamp(p, 'sheets', now); stamp(p, 'images', now);
  saveProject(p);
  return { project: p, assetId: id };
}

// ---------- import a keyframe picture (v5) ----------

/** Append an uploaded still to a keyframe and choose it. `keyframeId` may name a keyframe that does not exist yet
 *  (`kf_<sceneId>_<start|end>` for a beat with a scene prompt): a minimal one is created with prompt '(imported)'. */
export function importKeyframeOption(slug: string, keyframeId: string, input: { filename: string; bytes: Buffer }): Project {
  const ext = checkImage(input.bytes);
  const p = loadProject(slug);
  p.keyframes ??= [];
  let k = p.keyframes.find((x) => x.id === keyframeId);
  if (!k) {
    const m = /^kf_(.+)_(start|end)$/.exec(keyframeId);
    const sp = m ? p.scenePrompts?.find((x) => x.sceneId === m[1]) : undefined;
    if (!m || !sp) throw new LibraryError(404, `no keyframe ${keyframeId}`);
    k = { id: keyframeId, sceneId: m[1], role: m[2] as Keyframe['role'], prompt: '(imported)', negatives: [], refAssetIds: [...sp.refAssetIds], model: 'import', options: [], sources: [] };
    p.keyframes.push(k);
  }
  const src = (k.sources ??= []);
  while (src.length < k.options.length) src.push({ kind: 'generated' });
  k.options.push({ path: writeImport(slug, k.id, input.bytes, ext, 'keyframes') });
  src.push({ kind: 'import', filename: path.basename(input.filename) });
  k.chosen = k.options.length - 1;
  stamp(p, 'keyframes');
  saveProject(p);
  return p;
}

// ---------- context pictures (v6.1) ----------
// The user's own pictures attached to one sheet or one scene as guidance (not as the result). Stored like brief refs:
// files under projects/<slug>/refs/, same 15 MB / png-jpg-webp check. They live in Project.contextRefs, never in
// Brief.refs, so the script stage does not read them and adding one does not make the whole film stale.

export interface ContextTarget { forAssetId?: string; forSceneId?: string }

function checkTarget(p: Project, t: ContextTarget): void {
  if (!!t.forAssetId === !!t.forSceneId) throw new LibraryError(400, 'give exactly one of forAssetId or forSceneId');
  if (t.forAssetId && !(p.sheets?.items ?? []).some((i) => i.id === t.forAssetId) && !(p.assets ?? []).some((a) => a.id === t.forAssetId)) throw new LibraryError(404, `no sheet ${t.forAssetId}`);
  if (t.forSceneId && !(p.script?.scenes ?? []).some((b) => b.id === t.forSceneId) && !(p.scenePrompts ?? []).some((sp) => sp.sceneId === t.forSceneId)) throw new LibraryError(404, `no scene ${t.forSceneId}`);
}

function writeRef(slug: string, filename: string, bytes: Buffer): { id: string; dest: string } {
  const id = newId('ref');
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = path.join(refsDir(slug), `${id}-${safe}`);
  fs.writeFileSync(dest, bytes);
  return { id, dest };
}

/** A context picture changes what the sheet prompt (or scene prompt) should say: stamp that stage. */
const stampFor = (p: Project, t: ContextTarget): void => stamp(p, t.forAssetId ? 'sheets' : 'scenes');

export function addContextRef(slug: string, input: ContextTarget & { filename: string; bytes: Buffer; note?: string; who?: string }): { project: Project; ref: RefImage } {
  const ext = checkImage(input.bytes);
  const p = loadProject(slug);
  checkTarget(p, input);
  const name = /\.(png|jpe?g|webp)$/i.test(input.filename) ? input.filename : `${input.filename}${ext}`;
  const { id, dest } = writeRef(slug, name, input.bytes);
  const ref: RefImage = { id, role: 'context', path: dest, ...(input.note ? { note: input.note } : {}), ...(input.who?.trim() ? { who: input.who.trim() } : {}),
    ...(input.forAssetId ? { forAssetId: input.forAssetId } : { forSceneId: input.forSceneId }) };
  (p.contextRefs ??= []).push(ref);
  stampFor(p, input);
  saveProject(p);
  return { project: p, ref };
}

function getContext(p: Project, refId: string): RefImage {
  const r = (p.contextRefs ?? []).find((x) => x.id === refId);
  if (!r) throw new LibraryError(404, `no context picture ${refId}`);
  return r;
}

/** Delete the file only when it is this project's own refs copy and no other ref points at it. */
function unlinkRef(p: Project, file: string): void {
  const root = refsDir(p.slug) + path.sep;
  const abs = path.resolve(file);
  if (!abs.startsWith(root)) return;
  if ((p.contextRefs ?? []).some((r) => path.resolve(r.path) === abs) || (p.brief?.refs ?? []).some((r) => path.resolve(r.path) === abs)) return;
  try { fs.unlinkSync(abs); } catch { /* already gone */ }
}

export function removeContextRef(slug: string, refId: string): Project {
  const p = loadProject(slug);
  const r = getContext(p, refId);
  p.contextRefs = (p.contextRefs ?? []).filter((x) => x.id !== refId);
  unlinkRef(p, r.path);
  stampFor(p, r);
  saveProject(p);
  return p;
}

/** Swap the picture of a context ref in place (same id, same target, new file). */
export function replaceContextRef(slug: string, refId: string, input: { filename: string; bytes: Buffer }): Project {
  checkImage(input.bytes);
  const p = loadProject(slug);
  const r = getContext(p, refId);
  const old = r.path;
  r.path = writeRef(slug, input.filename, input.bytes).dest;
  unlinkRef(p, old);
  stampFor(p, r);
  saveProject(p);
  return p;
}

/** "Clean this up": copy one option of a sheet (usually an imported final) into a context ref for that sheet, so a
 *  clean sheet can be made from it while the original stays where it is. */
export function contextFromOption(slug: string, assetId: string, index: number): { project: Project; ref: RefImage } {
  const p = loadProject(slug);
  const a = getAsset(p, assetId);
  const opt = Number.isInteger(index) ? a.options[index] : undefined;
  if (!opt?.path || !fs.existsSync(opt.path)) throw new LibraryError(400, `index ${index} out of range`);
  return addContextRef(slug, { forAssetId: assetId, filename: path.basename(opt.path), bytes: fs.readFileSync(opt.path) });
}
