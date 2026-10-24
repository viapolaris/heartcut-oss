import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-local-'));
process.env.HEARTCUT_FAKE = '1';
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_ENV_FILE = path.join(tmp, 'no.env'); // never the developer's own .env
delete process.env.HEARTCUT_PREFER_LOCAL;

const models = await import('../src/gen/models.ts');
const local = await import('../src/gen/local.ts');
const settings = await import('../src/settings.ts');
const images = await import('../src/stages/images.ts');
const { getStyle } = await import('../src/styles.ts');
import type { Project } from '../src/types.ts';

const ok = (): ReturnType<typeof local.isLocalAvailable> => ({ ok: true, models: [models.LOCAL_QWEN, models.LOCAL_Z] });
const down = (): ReturnType<typeof local.isLocalAvailable> => ({ ok: false, reason: 'uv is not on PATH', models: [] });
const orig = local.hooks.available;
const stub = (a: typeof ok) => { local.hooks.available = a; };
test.afterEach(() => { local.hooks.available = orig; fs.rmSync(path.join(tmp, 'root', 'projects', '_settings.json'), { force: true }); });

function drawn(): Project {
  return {
    id: 'prj_l', slug: 'loc', title: 'L', owner: 'viaPolaris', aspect: '16:9', createdAt: '', updatedAt: '',
    brief: { text: 'b', refs: [] }, style: getStyle('anime-2d')!,
    script: { logline: '', emotionalCore: '', arc: '', characters: [], locations: [{ id: 'loc1', name: 'L', description: '', lighting: '', cameraPackage: '', palette: '' }], scenes: [] },
    sheets: { items: [{ id: 'loc1', kind: 'location', locationId: 'loc1', prompt: 'ruined hall' }] },
    assets: [], scenePrompts: [], clips: [], exports: [], jobs: [], approvals: {},
  };
}

test('local models: inputs, sizes, price, fallback table', () => {
  assert.deepEqual(models.buildSheetInput('x', { aspect: '3:4', model: models.LOCAL_QWEN }), { prompt: 'x', width: 896, height: 1152 });
  assert.deepEqual(models.localSize('2:3'), { width: 832, height: 1248 });
  assert.deepEqual(models.localSize('16:9'), { width: 1280, height: 720 });
  assert.deepEqual(models.localSize('1:1'), { width: 1024, height: 1024 });
  assert.deepEqual(models.localSize('9:16'), { width: 720, height: 1280 });
  for (const m of [models.LOCAL_QWEN, models.LOCAL_Z]) {
    assert.equal(models.IMAGE_MODELS[m].usd, 0);
    assert.equal(models.IMAGE_MODELS[m].local, true);
    assert.equal(models.fakePrice(m, {}), 0);
  }
  assert.equal(models.FALLBACK[models.LOCAL_QWEN], models.LOCAL_Z);
  assert.equal(models.LOCAL_TWIN[models.LOCAL_QWEN], models.QWEN_T2I);
  assert.equal(models.LOCAL_TWIN[models.LOCAL_Z], models.Z_IMAGE);
});

test('local.run (fake): four files in one invocation, stable seeds, progress lines', async () => {
  const items = [1, 2, 3, 4].map((n) => ({ id: `a-v${n}`, prompt: 'p', seed: local.seedFor('a', n), outFile: path.join(tmp, 'o', `a-v${n}.png`) }));
  const lines: string[] = [];
  const r = await local.run(models.LOCAL_QWEN, items, { width: 896, height: 1152, emit: (l) => lines.push(l) });
  assert.equal(r.files.length, 4);
  for (const f of r.files) assert.ok(fs.statSync(f).size > 0);
  assert.ok(lines.some((l) => /^local qwen-image: 4\/4 done \(\d+s\)$/.test(l)), lines.join('\n'));
  assert.equal(local.seedFor('a', 1), local.seedFor('a', 1));
  assert.notEqual(local.seedFor('a', 1), local.seedFor('a', 2));
  assert.equal(local.stepsFor(models.LOCAL_Z), 8);
  assert.equal(local.stepsFor(models.LOCAL_QWEN), 20);
  process.env.HEARTCUT_LOCAL_STEPS = '3';
  try { assert.equal(local.stepsFor(models.LOCAL_QWEN), 3); } finally { delete process.env.HEARTCUT_LOCAL_STEPS; }
});

test('mapping: on swaps the drawn models, off leaves them, identity stays', () => {
  const style = getStyle('anime-2d')!;
  assert.equal(style.models.faces, models.QWEN_T2I);
  const on = settings.resolveModels(style, true);
  assert.equal(on.models.faces, models.LOCAL_QWEN);
  assert.equal(on.models.places, models.LOCAL_QWEN);
  assert.equal(on.models.identity, style.models.identity);
  assert.equal(settings.resolveModels(style, false).models.faces, models.QWEN_T2I);
  const z = settings.resolveModels({ models: { faces: models.Z_IMAGE, places: models.Z_IMAGE, identity: models.QWEN_EDIT } }, true);
  assert.equal(z.models.faces, models.LOCAL_Z);
  const photo = getStyle('cinematic-realism')!;
  assert.equal(settings.resolveModels(photo, true).models.faces, photo.models.faces);
});

test('settings: default follows availability; saved choice wins; never effective when unavailable', () => {
  stub(ok); assert.equal(settings.getSettings().preferLocal, true);
  stub(down); assert.equal(settings.getSettings().preferLocal, false);
  stub(ok);
  settings.saveSettings({ preferLocal: false });
  assert.equal(settings.getSettings().preferLocal, false);
  assert.equal(settings.localInEffect(), false);
  settings.saveSettings({ preferLocal: true });
  stub(down);
  assert.equal(settings.getSettings().preferLocal, true);
  assert.equal(settings.localInEffect(), false, 'on but unavailable is not in effect');
});

test('images: local on -> one worker run per sheet, $0, provenance, partial-safe', async () => {
  stub(ok); settings.saveSettings({ preferLocal: true });
  const p = drawn();
  const est = await images.estimate(p, {});
  assert.equal(est.usd, 0);
  assert.equal(est.items[0].model, models.LOCAL_QWEN);
  const origLocal = images.hooks.local, origRun = images.hooks.run;
  let invocations = 0;
  images.hooks.local = async (m, items, o) => { invocations++; return origLocal(m, items, o); };
  images.hooks.run = async () => { throw new Error('Higgsfield must not be called'); };
  const lines: string[] = [];
  try { await images.run(p, {}, (l) => lines.push(l)); } finally { images.hooks.local = origLocal; images.hooks.run = origRun; }
  assert.equal(invocations, 1);
  const a = p.assets[0];
  assert.equal(a.options.length, 4);
  assert.equal(a.model, models.LOCAL_QWEN);
  assert.equal(a.costUsd, 0);
  assert.deepEqual(a.sources, Array(4).fill({ kind: 'generated', model: models.LOCAL_QWEN }));
  assert.deepEqual(a.options.map((o) => path.basename(o.path)), [1, 2, 3, 4].map((n) => `loc1-v${n}.png`));
  assert.ok(lines.some((l) => /local qwen-image: 4\/4 done/.test(l)), lines.join('\n'));
});

test('images: a local failure keeps what landed and rethrows', async () => {
  stub(ok); settings.saveSettings({ preferLocal: true });
  const p = drawn();
  const origLocal = images.hooks.local;
  images.hooks.local = async (_m, items) => {
    fs.mkdirSync(path.dirname(items[0].outFile), { recursive: true });
    fs.writeFileSync(items[0].outFile, 'x'); fs.writeFileSync(items[1].outFile, 'x');
    throw new local.LocalRunError('worker failed at generate:loc1-v3: OOM', [items[0].outFile, items[1].outFile]);
  };
  try { await assert.rejects(images.run(p, {}, () => {}), /OOM/); } finally { images.hooks.local = origLocal; }
  assert.equal(p.assets[0].options.length, 2);
});

test('images: a generation failure on qwen falls back to local z-image', async () => {
  stub(ok); settings.saveSettings({ preferLocal: true });
  const p = drawn();
  const origLocal = images.hooks.local;
  const seen: string[] = [];
  images.hooks.local = async (m, items, o) => { seen.push(m); if (m === models.LOCAL_QWEN) throw new local.LocalRunError('worker failed at generate:x: boom', []); return origLocal(m, items, o); };
  try { await images.run(p, {}, () => {}); } finally { images.hooks.local = origLocal; }
  assert.deepEqual(seen, [models.LOCAL_QWEN, models.LOCAL_Z]);
  assert.equal(p.assets[0].model, models.LOCAL_Z);
});

test('images: local unavailable at plan time -> Higgsfield twin, priced, logged as costing money', async () => {
  stub(ok); settings.saveSettings({ preferLocal: true });
  stub(down);
  const p = drawn();
  p.style = { ...p.style!, models: { ...p.style!.models, faces: models.LOCAL_QWEN, places: models.LOCAL_QWEN } }; // a style that names the local model itself
  const est = await images.estimate(p, {});
  assert.equal(est.items[0].model, models.QWEN_T2I);
  assert.ok(est.usd > 0);
  assert.match(est.items[0].note ?? '', /THIS COSTS MONEY/);
  const lines: string[] = [];
  await images.run(p, {}, (l) => lines.push(l));
  assert.equal(p.assets[0].model, models.QWEN_T2I);
  assert.ok(lines.some((l) => /THIS COSTS MONEY/.test(l)));
});

test('images: worker dies at runtime (uv/weights) -> Higgsfield twin, loudly', async () => {
  stub(ok); settings.saveSettings({ preferLocal: true });
  const p = drawn();
  const origLocal = images.hooks.local;
  images.hooks.local = async () => { throw new local.LocalUnavailableError('could not run uv: ENOENT'); };
  const lines: string[] = [];
  try { await images.run(p, {}, (l) => lines.push(l)); } finally { images.hooks.local = origLocal; }
  const a = p.assets[0];
  assert.equal(a.model, models.QWEN_T2I);
  assert.equal(a.options.length, 4);
  assert.deepEqual(a.sources![0], { kind: 'generated', model: models.QWEN_T2I });
  assert.ok((a.costUsd ?? 0) > 0);
  assert.ok(lines.some((l) => /LOCAL GPU UNAVAILABLE.*falling back to alibaba\/qwen-image-3\/text-to-image.*THIS COSTS MONEY/.test(l)), lines.join('\n'));
});

test('images: preferLocal on but the Mac cannot render -> stays on Higgsfield, with the costs-money note', async () => {
  settings.saveSettings({ preferLocal: true });
  stub(down);
  const est = await images.estimate(drawn(), {});
  assert.equal(est.items[0].model, models.QWEN_T2I);
  assert.match(est.items[0].note ?? '', /THIS COSTS MONEY/);
});

test('images estimate: an orphan asset named by ids is priced; imported / prompt-less sheets skip at $0 instead of failing', async () => {
  settings.saveSettings({ preferLocal: false }); // price on Higgsfield so the orphan has a nonzero price
  const p = drawn();
  p.assets.push({ id: 'orph', kind: 'location', locationId: 'loc1', prompt: 'a lantern', model: 'import', options: [{ path: 'x' }] });
  p.assets.push({ id: 'imp', kind: 'location', locationId: 'loc1', prompt: '(imported)', model: 'import', options: [{ path: 'y' }] });
  p.sheets!.items.push({ id: 'imp2', kind: 'location', locationId: 'loc1', prompt: '(imported)' }, { id: 'bare', kind: 'location', locationId: 'loc1' } as any);
  const est = await images.estimate(p, { ids: ['loc1', 'orph', 'imp', 'imp2', 'bare', 'ghost'], force: true });
  const by = Object.fromEntries(est.items.map((i) => [i.id, i]));
  assert.ok(by.orph && by.orph.usd > 0, 'orphan asset with a prompt gets a price');
  for (const id of ['imp', 'imp2', 'bare']) { assert.equal(by[id].usd, 0); assert.match(by[id].note ?? '', /skipped: no prompt/); }
  assert.equal(by.ghost, undefined);
  // never part of a whole-step run
  const all = await images.estimate(p, {});
  assert.ok(!all.items.some((i) => i.id === 'orph'));
});

test('images: a photo-locked face uses the local edit model when its weights are present, with the photo as input; Higgsfield otherwise', async () => {
  const selfie = path.join(tmp, 'selfie.jpg'); fs.writeFileSync(selfie, 'x');
  const withFace = (): Project => {
    const p = drawn();
    p.brief.refs = [{ id: 'r1', role: 'selfie', path: selfie, who: 'Ana' }];
    p.script!.characters = [{ id: 'ana', name: 'Ana', species: 'human', baseDescription: '', wardrobe: '', states: [{ id: 'now', label: 'now', description: '' }], identityRefId: 'r1' }];
    p.sheets = { items: [{ id: 'ana_now_portrait', kind: 'character-portrait', characterId: 'ana', stateId: 'now', prompt: '[identity: ref] a girl on white' }] };
    return p;
  };
  settings.saveSettings({ preferLocal: true });
  stub(() => ({ ok: true, models: [models.LOCAL_QWEN, models.LOCAL_Z, models.LOCAL_EDIT] }));
  const est = await images.estimate(withFace(), {});
  assert.equal(est.items[0].model, models.LOCAL_EDIT);
  assert.equal(est.usd, 0);
  const p = withFace();
  const origLocal = images.hooks.local, origRun = images.hooks.run;
  let seen: string[] | undefined;
  images.hooks.local = async (m, items, o) => { seen = items[0].images; return origLocal(m, items, o); };
  images.hooks.run = async () => { throw new Error('Higgsfield must not be called'); };
  try { await images.run(p, {}, () => {}); } finally { images.hooks.local = origLocal; images.hooks.run = origRun; }
  assert.deepEqual(seen, [selfie]);
  assert.equal(p.assets[0].model, models.LOCAL_EDIT);
  assert.equal(p.assets[0].costUsd, 0);
  stub(ok); // edit weights missing -> the paid identity edit, as before
  const est2 = await images.estimate(withFace(), {});
  assert.equal(est2.items[0].model, models.QWEN_EDIT);
});

test('local availability: missing edit weights do not switch local off', () => {
  const info = local.LOCAL_MODELS[models.LOCAL_EDIT];
  assert.equal(info.optional, true);
  assert.equal(info.worker, 'qwen_image_edit_2511');
});

test('local availability: a half-downloaded model does not count until every blob is in', async () => {
  const hub = path.join(tmp, 'hub'); process.env.HF_HUB_CACHE = hub;
  const mk = (repo: string, done: boolean) => {
    const snap = path.join(hub, repo, 'snapshots', 'abc', 'transformer'); fs.mkdirSync(snap, { recursive: true });
    const blobs = path.join(hub, repo, 'blobs'); fs.mkdirSync(blobs, { recursive: true });
    fs.writeFileSync(path.join(blobs, done ? 'b1' : 'b1.incomplete'), done ? 'w' : '');
    if (done) fs.symlinkSync(path.join(blobs, 'b1'), path.join(snap, 'w.safetensors'));
    else fs.symlinkSync(path.join(blobs, 'b1'), path.join(snap, 'w.safetensors')); // dangling until the blob lands
  };
  for (const m of Object.values(local.LOCAL_MODELS)) mk(m.repo, m.worker !== 'qwen_image_edit_2511');
  // The machine is injected: an Apple Silicon Mac with uv and the worker, whatever this test runs on.
  const mac: import('../src/gen/local.ts').LocalHost = { platform: 'darwin', arch: 'arm64', onPath: (b) => b === 'uv', exists: () => true };
  try {
    const a = local.checkAvailable(mac);
    assert.ok(!a.models.includes(models.LOCAL_EDIT), 'half-downloaded edit model is not available');
    assert.ok(a.models.includes(models.LOCAL_QWEN));
    assert.equal(a.ok, true, a.reason ?? '');
    const pc = local.checkAvailable({ ...mac, platform: 'linux', arch: 'x64' });
    assert.equal(pc.ok, false);
    assert.match(pc.reason!, /Apple Silicon/);
    assert.deepEqual(pc.models, [], 'not on this computer: no model counts');
    const noUv = local.checkAvailable({ ...mac, onPath: () => false });
    assert.match(noUv.reason!, /uv is not installed/);
    assert.deepEqual(noUv.models, []);
  } finally { delete process.env.HF_HUB_CACHE; }
});

test('images: Higgsfield out of credits on one sheet -> free local sheets still made, later paid sheets skipped, one clear error', async () => {
  stub(ok); settings.saveSettings({ preferLocal: true });
  // A Higgsfield key that is never used: hooks.run below is stubbed, so nothing is sent.
  const hadKey = process.env.HIGGSFIELD_API_KEY;
  process.env.HIGGSFIELD_API_KEY = 'test-id:test-secret';
  test.after(() => { if (hadKey === undefined) delete process.env.HIGGSFIELD_API_KEY; else process.env.HIGGSFIELD_API_KEY = hadKey; });
  const selfie = path.join(tmp, 'selfie2.jpg'); fs.writeFileSync(selfie, 'x');
  const p = drawn();
  p.brief.refs = [{ id: 'r1', role: 'selfie', path: selfie, who: 'Ana' }, { id: 'r2', role: 'selfie', path: selfie, who: 'Bo' }];
  p.script!.characters = ['ana', 'bo'].map((id, i) => ({ id, name: ['Ana', 'Bo'][i], species: 'human' as const, baseDescription: '', wardrobe: '', states: [{ id: 'now', label: 'now', description: '' }], identityRefId: `r${i + 1}` }));
  p.sheets = { items: [
    { id: 'ana_now_portrait', kind: 'character-portrait', characterId: 'ana', stateId: 'now', prompt: '[identity: ref] a girl' },
    { id: 'bo_now_portrait', kind: 'character-portrait', characterId: 'bo', stateId: 'now', prompt: '[identity: ref] a toddler' },
    { id: 'loc1', kind: 'location', locationId: 'loc1', prompt: 'a trail' },
  ] };
  const origRun = images.hooks.run;
  let paidCalls = 0;
  images.hooks.run = async () => { paidCalls++; throw new Error('Higgsfield account is out of credits (nothing was charged). Top up at open.higgsfield.ai, then run the step again: higgsfield: POST /x -> 403 insufficient credits'); };
  const lines: string[] = [];
  try {
    await assert.rejects(images.run(p, {}, (l) => lines.push(l)), /1 sheet made; not made: ana_now_portrait, bo_now_portrait\. Higgsfield account is out of credits/);
  } finally { images.hooks.run = origRun; }
  assert.equal(paidCalls, 1, 'stops calling Higgsfield after the first out-of-credits');
  assert.equal(p.assets.find((a) => a.id === 'loc1')?.options.length, 4, 'the free location was still made');
  assert.ok(lines.some((l) => /skip bo_now_portrait: Higgsfield unavailable/.test(l)), lines.join('\n'));
});

test('local: Lightning adapter is used only when fully downloaded; time budget grows with the job', () => {
  const hub = path.join(tmp, 'hub-l'); process.env.HF_HUB_CACHE = hub;
  try {
    assert.equal(local.lightningFor(models.LOCAL_EDIT), undefined, 'no adapter in the cache');
    const l = local.LOCAL_MODELS[models.LOCAL_EDIT].lightning!;
    const dir = path.join(hub, l.repo, 'snapshots', 's1'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, l.file), Buffer.alloc(2_000_000));
    assert.deepEqual(local.lightningFor(models.LOCAL_EDIT), { path: path.join(dir, l.file), steps: 8, guidance: 1 });
    assert.equal(local.stepsFor(models.LOCAL_EDIT), 8);
    assert.equal(local.lightningFor(models.LOCAL_QWEN), undefined, 'text-to-image has no adapter');
  } finally { delete process.env.HF_HUB_CACHE; }
  assert.equal(local.timeoutMs(1, 8, 896, 1152), 30 * 60_000, 'small jobs keep the 30-minute floor');
  assert.ok(local.timeoutMs(4, 20, 896, 1152) > 30 * 60_000, 'big jobs get more time');
});
