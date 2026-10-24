// v6.1 Your own pictures: use as final (sheet, scene with no keyframe), use as context (sheet, scene), make a clean sheet.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-own-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';
process.env.HEARTCUT_PREFER_LOCAL = '0';

const store = await import('../src/store.ts');
const library = await import('../src/library.ts');
const images = await import('../src/stages/images.ts');
const sheets = await import('../src/stages/sheets.ts');
const scenes = await import('../src/stages/scenes.ts');
const kf = await import('../src/stages/keyframes.ts');
const clips = await import('../src/stages/clips.ts');
const models = await import('../src/gen/models.ts');
const { runStage, estimateStage } = await import('../src/pipeline.ts');
const { saveSettings } = await import('../src/settings.ts');
const { startServer } = await import('../src/server.ts');
const { seedProject } = await import('./fixtures/seed.ts');
const { FAKE_SCENES, FAKE_SCRIPT } = await import('../src/demo/demo.ts');
const { tinyPng } = await import('../src/demo/media.ts');
import type { LlmCall } from '../src/llm.ts';
import type { Project } from '../src/types.ts';

const emit = () => {};
const PNG = tinyPng();
saveSettings({ preferLocal: false });

function ready(title: string): Project {
  const p = seedProject(store, title);
  p.scenePrompts = structuredClone(FAKE_SCENES);
  store.saveProject(p);
  return store.loadProject(p.slug);
}

type Sent = { model: string; input: any };
async function capture<T>(mod: { hooks: { run: any } }, body: (sent: Sent[]) => Promise<T>): Promise<T> {
  const orig = mod.hooks.run;
  const sent: Sent[] = [];
  mod.hooks.run = async (m: string, input: any, ro: any) => { sent.push({ model: m, input }); return orig(m, input, ro); };
  try { return await body(sent); } finally { mod.hooks.run = orig; }
}
async function captureLlm<T>(mod: { hooks: { llm: any } }, body: (calls: LlmCall[]) => Promise<T>): Promise<T> {
  const orig = mod.hooks.llm;
  const calls: LlmCall[] = [];
  mod.hooks.llm = (c: LlmCall) => { calls.push(c); return orig(c); };
  try { return await body(calls); } finally { mod.hooks.llm = orig; }
}

// ---------- use as final ----------

test('final on a sheet: import appends, picks it, and dependents treat it like a generated pick', async () => {
  const p0 = ready('final-sheet');
  const slug = p0.slug;
  // pretend ilse_present_full was built from the face's option 0
  const p1 = store.loadProject(slug);
  p1.assets.find((a) => a.id === 'ilse_present_full')!.anchorIndex = 0;
  store.saveProject(p1);
  assert.deepEqual(sheets.anchorStale(store.loadProject(slug)), []);

  const p = library.importOption(slug, 'ilse_present_portrait', { filename: 'me.png', bytes: PNG });
  const face = p.assets.find((a) => a.id === 'ilse_present_portrait')!;
  assert.equal(face.chosen, face.options.length - 1, 'the upload is the pick');
  assert.deepEqual(face.sources?.at(-1), { kind: 'import', filename: 'me.png' });
  assert.deepEqual(sheets.anchorStale(p), ['ilse_present_full'], 'the dependent knows its face changed');

  // Rebuilding the dependent sends the imported face as the reference.
  await capture(images, async (sent) => {
    await images.run(p, { ids: ['ilse_present_full'], force: true }, emit);
    assert.ok(sent.length > 0);
    for (const s of sent) { assert.equal(s.model, models.QWEN_EDIT); assert.equal(s.input.image_urls[0], face.options[face.chosen!].path); }
  });
});

test('final on a scene with no keyframe: the import creates the start keyframe and clips animate it', async () => {
  const p0 = ready('final-scene');
  assert.equal((p0.keyframes ?? []).length, 0);
  const p = library.importKeyframeOption(p0.slug, 'kf_s1_start', { filename: 'shot.png', bytes: PNG });
  const k = p.keyframes!.find((x) => x.id === 'kf_s1_start')!;
  assert.equal(k.role, 'start');
  assert.equal(k.model, 'import');
  assert.equal(k.chosen, 0);
  const est = await clips.estimate(p, { ids: ['s1'] });
  assert.equal(est.items[0].model, models.SEEDANCE_I2V);
  assert.match(est.items[0].note!, /from keyframe/);
  await capture(clips, async (sent) => {
    await clips.run(store.loadProject(p0.slug), { ids: ['s1'] }, emit);
    assert.equal(sent[0].model, models.SEEDANCE_I2V);
    assert.equal(sent[0].input.image_url, k.options[0].path);
    assert.equal(sent[0].input.image_urls, undefined);
  });
});

// ---------- use as context: sheets ----------

test('context on a sheet: routes through the photo edit, priced as the edit, refs reach the input; removal undoes it', async () => {
  const p0 = ready('ctx-sheet');
  const slug = p0.slug;
  const plain = await images.estimate(p0, { ids: ['loc_barn'], force: true });
  assert.equal(plain.items[0].model, models.CINEMA);

  const { project: p, ref } = library.addContextRef(slug, { forAssetId: 'loc_barn', filename: 'place.png', bytes: PNG, note: 'the real stable' });
  assert.equal(ref.role, 'context');
  assert.ok(ref.path.startsWith(store.refsDir(slug)), 'stored under projects/<slug>/refs/');
  assert.equal(p.brief.refs.length, 0, 'context never joins the brief refs');
  assert.ok(store.staleness(p).images?.stale, 'images go stale: the sheet should be redrawn with the picture');

  const est = await images.estimate(p, { ids: ['loc_barn'], force: true });
  assert.equal(est.items[0].model, models.QWEN_EDIT);
  assert.equal(est.usd, 0.16, '4 edit calls at $0.04');
  assert.match(est.items[0].note!, /guided by 1 of your picture.*cannot take a picture/);
  // dryRun through the pipeline prices the same and spends nothing
  assert.equal((await estimateStage(slug, 'images', { ids: ['loc_barn'], force: true })).usd, 0.16);
  await runStage(slug, 'images', { ids: ['loc_barn'], force: true, dryRun: true }, emit);

  await capture(images, async (sent) => {
    await images.run(store.loadProject(slug), { ids: ['loc_barn'], force: true }, emit);
    assert.equal(sent.length, 4);
    for (const s of sent) {
      assert.equal(s.model, models.QWEN_EDIT);
      assert.deepEqual(s.input.image_urls, [ref.path]);
      assert.ok(String(s.input.prompt).includes(images.CONTEXT_CLAUSE));
    }
  });

  // A dependent keeps the face first and adds the context after it.
  const { ref: r2 } = library.addContextRef(slug, { forAssetId: 'ilse_present_full', filename: 'coat.png', bytes: PNG });
  await capture(images, async (sent) => {
    await images.run(store.loadProject(slug), { ids: ['ilse_present_full'], force: true }, emit);
    const face = store.loadProject(slug).assets.find((a) => a.id === 'ilse_present_portrait')!;
    assert.deepEqual(sent[0].input.image_urls, [face.options[face.chosen!].path, r2.path]);
  });

  const after = library.removeContextRef(slug, ref.id);
  assert.equal(fs.existsSync(ref.path), false, 'file deleted');
  assert.equal(store.contextFor(after, { assetId: 'loc_barn' }).length, 0);
  assert.equal((await images.estimate(after, { ids: ['loc_barn'], force: true })).items[0].model, models.CINEMA, 'back to the style model');
});

test('context on a sheet reaches the sheets LLM call as images, labelled with photoList', async () => {
  const p0 = ready('ctx-sheet-llm');
  const { ref } = library.addContextRef(p0.slug, { forAssetId: 'ilse_present_portrait', filename: 'me.png', bytes: PNG });
  await captureLlm(sheets, async (calls) => {
    await sheets.run(store.loadProject(p0.slug), {}, emit);
    assert.deepEqual(calls[0].images, [ref.path]);
    assert.ok(calls[0].user.includes(`- ${ref.path} : the director's own picture for sheet ilse_present_portrait`));
  });
  const { images: imgs } = sheets.sheetPhotos(store.loadProject(p0.slug), ['loc_barn']);
  assert.deepEqual(imgs, [], 'only the sheets asked about');
});

test('replace keeps the id and target, swaps the file', () => {
  const p0 = ready('ctx-replace');
  const { ref } = library.addContextRef(p0.slug, { forAssetId: 'loc_barn', filename: 'a.png', bytes: PNG });
  const p = library.replaceContextRef(p0.slug, ref.id, { filename: 'b.png', bytes: PNG });
  const r = p.contextRefs!.find((x) => x.id === ref.id)!;
  assert.equal(r.forAssetId, 'loc_barn');
  assert.notEqual(r.path, ref.path);
  assert.equal(fs.existsSync(ref.path), false);
  assert.throws(() => library.addContextRef(p0.slug, { forAssetId: 'nope', filename: 'a.png', bytes: PNG }), /no sheet nope/);
  assert.throws(() => library.addContextRef(p0.slug, { forAssetId: 'loc_barn', filename: 'a.txt', bytes: Buffer.from('hello') }), /png, jpg or webp/);
  assert.throws(() => library.addContextRef(p0.slug, { forAssetId: 'loc_barn', forSceneId: 's1', filename: 'a.png', bytes: PNG }), /exactly one/);
});

// ---------- use as context: scenes ----------

test('context on a scene: scenes + keyframes LLM see it, Qwen edit and Seedance refs carry it (cap 30)', async () => {
  const p0 = ready('ctx-scene');
  const slug = p0.slug;
  const { ref } = library.addContextRef(slug, { forSceneId: 's1', filename: 'frame.png', bytes: PNG });

  await captureLlm(scenes, async (calls) => {
    await scenes.run(store.loadProject(slug), {}, emit);
    assert.deepEqual(calls[0].images, [ref.path]);
    assert.ok(calls[0].user.includes(`${ref.path} : the director's own picture for scene s1`));
  });

  // Keyframes: the edit gets the sheets, then the scene's picture; the LLM sees it too.
  await captureLlm(kf, async (calls) => {
    await capture(kf, async (sent) => {
      await kf.run(store.loadProject(slug), { ids: ['s1'] }, emit);
      assert.equal(sent.length, kf.KEYFRAME_CALLS);
      assert.equal(sent[0].input.image_urls.at(-1), ref.path);
      assert.ok(sent[0].input.image_urls.length >= 2);
    });
    assert.deepEqual(calls[0].images, [ref.path]);
  });
  const kEst = await kf.estimate(store.loadProject(slug), { ids: ['s1'], force: true });
  assert.equal(kEst.usd, 0.08, 'price unchanged: the edit is flat per call');

  // Clips from the sheets (unpick the keyframe): Seedance reference-to-video gets the picture after the sheets.
  store.chooseKeyframe(slug, 'kf_s1_start', null);
  const p = store.loadProject(slug);
  const refs = clips.refPaths(p, p.scenePrompts!.find((s) => s.sceneId === 's1')!);
  assert.equal(refs.at(-1), ref.path);
  const est = await clips.estimate(p, { ids: ['s1'] });
  assert.match(est.items[0].note!, /\+ 1 of your picture/);
  await capture(clips, async (sent) => {
    await clips.run(store.loadProject(slug), { ids: ['s1'] }, emit);
    assert.equal(sent[0].model, models.SEEDANCE);
    assert.ok(sent[0].input.image_urls.includes(ref.path));
  });
  // one-take sequences carry it too, and the 30 cap holds
  assert.ok(clips.sequenceRefs(p, ['s1', 's2']).includes(ref.path));
  for (let i = 0; i < 35; i++) library.addContextRef(slug, { forSceneId: 's1', filename: `x${i}.png`, bytes: Buffer.concat([PNG, Buffer.from([i])]) });
  const big = store.loadProject(slug);
  assert.equal(clips.refPaths(big, big.scenePrompts!.find((s) => s.sceneId === 's1')!).length, 30);
  assert.equal(clips.sequenceRefs(big, ['s1', 's2']).length, 30);
});

// ---------- make a clean sheet from it ----------

test('clean sheet: the picture goes through the edit with the sheet prompt and the clean clause; options append, never picked', async () => {
  const p0 = ready('clean');
  const slug = p0.slug;
  const before0 = store.loadProject(slug).assets.find((a) => a.id === 'ilse_present_portrait')!;
  const { ref } = library.addContextRef(slug, { forAssetId: 'ilse_present_portrait', filename: 'messy.png', bytes: PNG });
  const opts = { ids: ['ilse_present_portrait'], cleanFrom: ref.id };

  const est = await images.estimate(store.loadProject(slug), opts);
  assert.equal(est.items.length, 1);
  assert.equal(est.items[0].model, models.QWEN_EDIT);
  assert.equal(est.usd, 0.16);
  assert.match(est.items[0].note!, /clean sheet from your picture/);
  await runStage(slug, 'images', { ...opts, dryRun: true }, emit);
  assert.equal(store.loadProject(slug).assets.find((a) => a.id === 'ilse_present_portrait')!.options.length, before0.options.length, 'dry run adds nothing');

  await capture(images, async (sent) => {
    await images.run(store.loadProject(slug), opts, emit);
    assert.equal(sent.length, images.DEPENDENT_CALLS);
    const s = sent[0];
    assert.equal(s.model, models.QWEN_EDIT);
    assert.equal(s.input.image_urls[0], ref.path);
    assert.match(s.input.prompt, /keep the face, hair, build, clothing and props of the person in the reference photo/);
    assert.match(s.input.prompt, /replace the background with a plain white seamless studio backdrop/);
    assert.match(s.input.prompt, /close-up portrait, head and shoulders/);
    assert.ok(s.input.prompt.includes(FAKE_SCRIPT.characters[0].wardrobe), 'the sheet prompt rides along');
  });
  const a = store.loadProject(slug).assets.find((x) => x.id === 'ilse_present_portrait')!;
  assert.equal(a.options.length, before0.options.length + images.DEPENDENT_CALLS, 'appended');
  assert.equal(a.chosen, before0.chosen, 'not auto-chosen: the old pick stays');
  assert.equal(a.jobId, before0.jobId, 'dependents built from the old pick stay valid');
  for (const src of a.sources!.slice(before0.options.length)) assert.deepEqual(src, { kind: 'generated', model: models.QWEN_EDIT, fromRef: ref.id });
  assert.ok(store.loadProject(slug).contextRefs!.some((r) => r.id === ref.id), 'the original stays as context');

  // Location clean-up uses the place clause.
  const { ref: lr } = library.addContextRef(slug, { forAssetId: 'loc_barn', filename: 'street.png', bytes: PNG });
  await capture(images, async (sent) => {
    await images.run(store.loadProject(slug), { ids: ['loc_barn'], cleanFrom: lr.id }, emit);
    assert.match(sent[0].input.prompt, /remove every person, vehicle, text, sign/);
  });
});

test('clean sheet refuses a photo of several people, a wrong sheet and more than one id', async () => {
  const p0 = ready('clean-refuse');
  const { ref } = library.addContextRef(p0.slug, { forAssetId: 'ilse_present_portrait', filename: 'group.png', bytes: PNG, who: 'several people' });
  const p = store.loadProject(p0.slug);
  await assert.rejects(images.estimate(p, { ids: ['ilse_present_portrait'], cleanFrom: ref.id }), /several people/);
  await assert.rejects(images.estimate(p, { ids: ['ilse_present_full'], cleanFrom: ref.id }), /no picture/);
  await assert.rejects(images.estimate(p, { ids: ['ilse_present_portrait', 'loc_barn'], cleanFrom: ref.id }), /exactly one/);
});

test('"Clean this up" copies an imported final into a context ref and leaves the option alone', () => {
  const p0 = ready('clean-from-final');
  const p1 = library.importOption(p0.slug, 'ilse_present_portrait', { filename: 'mine.png', bytes: PNG });
  const a = p1.assets.find((x) => x.id === 'ilse_present_portrait')!;
  const { project, ref } = library.contextFromOption(p0.slug, a.id, a.chosen!);
  assert.equal(ref.forAssetId, a.id);
  assert.notEqual(ref.path, a.options[a.chosen!].path);
  assert.equal(project.assets.find((x) => x.id === a.id)!.options.length, a.options.length);
});

// ---------- routes ----------

let srv: Awaited<ReturnType<typeof startServer>>;
let base = '';
before(async () => { srv = await startServer(0); base = `http://127.0.0.1:${srv.port}`; });
after(async () => { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
async function j(method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

test('routes: add, replace, remove context; from an option; clean estimate; errors', async () => {
  const p = ready('ctx-routes');
  const b64 = PNG.toString('base64');
  const add = await j('POST', `/api/projects/${p.slug}/context`, { forSceneId: 's2', filename: 'a.png', dataBase64: b64 });
  assert.equal(add.status, 201);
  assert.equal(add.body.contextRefs.length, 1);
  const id = add.body.ref.id;
  assert.equal((await j('POST', `/api/projects/${p.slug}/context/${id}/replace`, { filename: 'b.png', dataBase64: b64 })).status, 200);
  assert.equal((await j('POST', `/api/projects/${p.slug}/context/${id}/remove`)).body.contextRefs.length, 0);
  assert.equal((await j('POST', `/api/projects/${p.slug}/context/${id}/remove`)).status, 404);
  assert.equal((await j('POST', `/api/projects/${p.slug}/context`, { forSceneId: 'zzz', filename: 'a.png', dataBase64: b64 })).status, 404);
  assert.equal((await j('POST', `/api/projects/${p.slug}/context`, { forAssetId: 'loc_barn', filename: 'a.png', dataBase64: Buffer.from('nope').toString('base64') })).status, 400);
  const fromOpt = await j('POST', `/api/projects/${p.slug}/assets/loc_barn/context`, { index: 0 });
  assert.equal(fromOpt.status, 201);
  const est = await j('POST', `/api/projects/${p.slug}/estimate/images`, { ids: ['loc_barn'], cleanFrom: fromOpt.body.ref.id });
  assert.equal(est.status, 200);
  assert.equal(est.body.usd, 0.16);
  assert.equal((await j('POST', `/api/projects/${p.slug}/estimate/images`, { ids: ['loc_barn'], cleanFrom: 5 })).status, 400);
});
