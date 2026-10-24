// Anchor chaining: one face is locked first, every other picture of the character is built from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-anchor-'));
process.env.HEARTCUT_FAKE = '1';
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');

const store = await import('../src/store.ts');
const pipeline = await import('../src/pipeline.ts');
const sheets = await import('../src/stages/sheets.ts');
const images = await import('../src/stages/images.ts');
const local = await import('../src/gen/local.ts');
const { saveSettings } = await import('../src/settings.ts');
const models = await import('../src/gen/models.ts');
const { FAKE_SCRIPT, FAKE_SHEETS, DEMO_BRIEF } = await import('../src/demo/demo.ts');
const uiFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/ui-project.json', import.meta.url), 'utf8'));
import type { Project } from '../src/types.ts';

const emit = () => {};

function project(slug: string, withSelfie = false): Project {
  store.createProject({ title: slug, slug, briefText: DEMO_BRIEF });
  const p = store.loadProject(slug);
  p.script = structuredClone(FAKE_SCRIPT);
  if (withSelfie) {
    const ref = store.addRef(slug, { role: 'selfie', filename: 'me.png', bytes: Buffer.from('x') });
    p.script.characters[0].identityRefId = ref.id;
    p.brief.refs = store.loadProject(slug).brief.refs;
  }
  p.sheets = sheets.normalize(p.script, FAKE_SHEETS.items.map((i) => ({ id: i.id, prompt: i.prompt }))).items.length
    ? { items: sheets.normalize(p.script, FAKE_SHEETS.items.map((i) => ({ id: i.id, prompt: i.prompt }))).items } : undefined;
  store.saveProject(p);
  return store.loadProject(slug);
}

test('anchorFor: humans anchor on the first state portrait, animals on the first full body', () => {
  assert.equal(sheets.anchorFor(FAKE_SCRIPT, 'ilse_present_portrait'), undefined);
  assert.equal(sheets.anchorFor(FAKE_SCRIPT, 'ilse_present_full'), 'ilse_present_portrait');
  assert.equal(sheets.anchorFor(FAKE_SCRIPT, 'ilse_past_portrait'), 'ilse_present_portrait');
  assert.equal(sheets.anchorFor(FAKE_SCRIPT, 'ilse_past_full'), 'ilse_present_portrait');
  assert.equal(sheets.anchorFor(FAKE_SCRIPT, 'fenna_present_full'), undefined);
  assert.equal(sheets.anchorFor(FAKE_SCRIPT, 'fenna_past_full'), 'fenna_present_full');
  assert.equal(sheets.anchorFor(FAKE_SCRIPT, 'loc_barn'), undefined);
  const deps = Object.fromEntries(sheets.expectedItems(FAKE_SCRIPT).filter((e) => e.dependsOn).map((e) => [e.id, e.dependsOn]));
  assert.deepEqual(deps, { ilse_present_full: 'ilse_present_portrait', ilse_past_portrait: 'ilse_present_portrait', ilse_past_full: 'ilse_present_portrait', fenna_past_full: 'fenna_present_full' });
});

test('normalize tags dependents with [anchor: id] and the same-character instruction', () => {
  const p = project('anchor-tags');
  const full = p.sheets!.items.find((i) => i.id === 'ilse_present_full')!;
  assert.ok(full.prompt.startsWith('[anchor: ilse_present_portrait] '), full.prompt);
  assert.match(full.prompt, /reference image/);
  assert.ok(full.prompt.includes(FAKE_SCRIPT.characters[0].wardrobe));
  assert.ok(!p.sheets!.items.find((i) => i.id === 'ilse_present_portrait')!.prompt.includes('[anchor'));
  assert.ok(!p.sheets!.items.find((i) => i.id === 'loc_barn')!.prompt.includes('[anchor'));
});

test('dependents are priced zero and skipped until the anchor is picked; explicit ids name the anchor', async () => {
  const p = project('anchor-wait');
  const est = await images.estimate(p, {});
  const byId = Object.fromEntries(est.items.map((i) => [i.id, i]));
  assert.equal(byId.ilse_present_full.usd, 0);
  assert.match(byId.ilse_present_full.note!, /waiting for ilse_present_portrait to be picked/);
  assert.ok(byId.ilse_present_portrait.usd > 0);

  const lines: string[] = [];
  await images.run(p, {}, (l) => lines.push(l));
  const ids = p.assets.map((a) => a.id).sort();
  assert.deepEqual(ids, ['fenna_present_full', 'loc_orchard', 'loc_hill', 'loc_barn', 'ilse_present_portrait'].sort());
  assert.ok(lines.some((l) => /skip ilse_present_full: waiting for ilse_present_portrait/.test(l)));

  await assert.rejects(images.run(p, { ids: ['ilse_present_full'] }, emit), /ilse_present_portrait/);
  assert.equal(p.assets.length, 5, 'nothing was spent by the refused run');
});

test('after the pick, dependents use Qwen Image Edit on Higgsfield with the face (+ selfie), even with preferLocal on', async () => {
  saveSettings({ preferLocal: true });
  const origAvail = local.hooks.available;
  local.hooks.available = () => ({ ok: true, models: [models.LOCAL_QWEN, models.LOCAL_Z] });
  const calls: { model: string; input: any }[] = [];
  const origRun = images.hooks.run;
  images.hooks.run = (async (m: string, input: any, ro: any) => { calls.push({ model: m, input }); return origRun(m, input, ro); }) as typeof origRun;
  try {
    const p = project('anchor-route', true);
    await images.run(p, {}, emit); // anchors (+ locations)
    const portrait = p.assets.find((a) => a.id === 'ilse_present_portrait')!;
    const fenna = p.assets.find((a) => a.id === 'fenna_present_full')!;
    store.chooseAsset('anchor-route', portrait.id, 0);
    store.chooseAsset('anchor-route', fenna.id, 1);
    const q = store.loadProject('anchor-route');
    const selfie = q.brief.refs.find((r) => r.role === 'selfie')!.path;

    const est = await images.estimate(q, {});
    const dep = est.items.filter((i) => ['ilse_present_full', 'ilse_past_portrait', 'ilse_past_full', 'fenna_past_full'].includes(i.id));
    assert.equal(dep.length, 4);
    for (const d of dep) { assert.equal(d.model, models.QWEN_EDIT); assert.equal(d.usd, 0.16); }

    calls.length = 0;
    const lines: string[] = [];
    const out = await images.run(q, {}, (l) => lines.push(l));
    assert.equal(lines.filter((l) => /need the chosen face as a reference/.test(l)).length, 1);
    assert.equal(calls.length, 16, '4 dependents x 4 calls');
    assert.ok(calls.every((c) => c.model === models.QWEN_EDIT), 'never local');
    const ilseFull = out.assets.find((a) => a.id === 'ilse_present_full')!;
    assert.deepEqual(ilseFull.options.length, 4);
    assert.equal(ilseFull.anchorIndex, 0);
    assert.deepEqual(ilseFull.sources!.map((s) => s.kind === 'generated' && s.anchor), Array(4).fill('ilse_present_portrait'));
    const faceFile = out.assets.find((a) => a.id === 'ilse_present_portrait')!.options[0].path;
    const forIlse = calls.filter((c) => /standing upright|full body/.test(String(c.input.prompt)) || true).map((c) => c.input.image_urls as string[]);
    assert.ok(forIlse.some((u) => u.length === 2 && u[0] === faceFile && u[1] === selfie), 'face then selfie');
    const fennaFace = out.assets.find((a) => a.id === 'fenna_present_full')!.options[1].path;
    assert.ok(forIlse.some((u) => u.length === 1 && u[0] === fennaFace), 'animal: face only (no selfie)');
    assert.ok(calls.every((c) => !/\[anchor/.test(String(c.input.prompt))), 'tag stripped before sending');
  } finally {
    images.hooks.run = origRun; local.hooks.available = origAvail; saveSettings({ preferLocal: false });
  }
});

test('anchorStale: re-picking or regenerating the anchor marks its dependents', async () => {
  project('anchor-stale');
  await pipeline.runStage('anchor-stale', 'images', {}, emit);
  store.chooseAsset('anchor-stale', 'ilse_present_portrait', 0);
  store.chooseAsset('anchor-stale', 'fenna_present_full', 0);
  await pipeline.runStage('anchor-stale', 'images', {}, emit);
  let q = store.loadProject('anchor-stale');
  assert.deepEqual(sheets.anchorStale(q), []);
  store.chooseAsset('anchor-stale', 'ilse_present_portrait', 2);
  q = store.loadProject('anchor-stale');
  assert.deepEqual(sheets.anchorStale(q).sort(), ['ilse_past_full', 'ilse_past_portrait', 'ilse_present_full']);
  store.chooseAsset('anchor-stale', 'ilse_present_portrait', 0);
  assert.deepEqual(sheets.anchorStale(store.loadProject('anchor-stale')), []);
  // Regenerating the anchor and picking the same index again is still a changed face.
  await pipeline.runStage('anchor-stale', 'images', { ids: ['ilse_present_portrait'], force: true }, emit);
  store.chooseAsset('anchor-stale', 'ilse_present_portrait', 0);
  assert.deepEqual(sheets.anchorStale(store.loadProject('anchor-stale')).sort(), ['ilse_past_full', 'ilse_past_portrait', 'ilse_present_full']);
  // The UI fixture carries one rebuilt-from-an-old-face asset (ilse_past_full).
  const ui = uiFixture as Project;
  assert.deepEqual(sheets.anchorStale(ui).sort(), ['ilse_past_full']);
});
