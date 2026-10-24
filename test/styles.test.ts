// Styles: presets, user styles, prompt post-processing, per-model request bodies, images routing, API routes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-styles-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';

const styles = await import('../src/styles.ts');
const store = await import('../src/store.ts');
const models = await import('../src/gen/models.ts');
const script = await import('../src/stages/script.ts');
const sheets = await import('../src/stages/sheets.ts');
const scenes = await import('../src/stages/scenes.ts');
const images = await import('../src/stages/images.ts');
const { startServer } = await import('../src/server.ts');
const { DEMO_BRIEF } = await import('../src/demo/demo.ts');

const emit = () => {};
let srv: Awaited<ReturnType<typeof startServer>>;
let base = '';
before(async () => { srv = await startServer(0); base = `http://127.0.0.1:${srv.port}`; });
after(async () => { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function j(method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

const PRESET_IDS = ['cinematic-realism', 'documentary-natural', 'film-noir-bw', 'nostalgia-35mm', 'y2k-flash', 'anime-2d', 'anime-painterly', 'lofi-anime',
  'cartoon-flat-kids', 'storybook-watercolour', 'comic-ink', 'pixel-art', 'claymation', 'animated-3d-feature'];

test('built-in presets: ids, models in the allow-list, soul styles only with Soul 2, nothing named', () => {
  const list = styles.listStyles();
  assert.deepEqual(list.map((s) => s.id), PRESET_IDS);
  assert.equal(styles.DEFAULT_STYLE_ID, 'cinematic-realism');
  const banned = /ghibli|pixar|disney|simpsons|naruto|miyazaki|dreamworks|aardman|marvel|studio\s+\w+\s+(animation|film)|south park|peppa|bluey|minecraft|nintendo/i;
  for (const s of list) {
    assert.equal(s.builtin, true, s.id);
    assert.ok(s.name && s.look.length > 40 && s.description, s.id);
    assert.ok(styles.FAMILIES.includes(s.family), s.id);
    assert.ok(models.IMAGE_MODELS[s.models.faces] && models.IMAGE_MODELS[s.models.places], `${s.id} models`);
    assert.ok(models.IDENTITY_MODELS[s.models.identity!], `${s.id} identity`);
    if (s.soulStyleId) assert.equal(s.models.faces, models.SOUL, s.id);
    assert.ok(!banned.test(JSON.stringify(s)), `${s.id} names a studio or show`);
    if (!['photoreal', 'film'].includes(s.family)) {
      assert.equal(models.IMAGE_MODELS[s.models.faces].kind, 'any', `${s.id} drawn styles cannot use a photo model`);
      assert.ok(!/ARRI|photorealistic|skin pores/i.test(s.look + (s.sheetLook ?? '')), `${s.id} look carries realism words`);
      assert.ok(s.negatives.length >= 2 && s.videoHints, s.id);
    }
  }
  const by = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.equal(by['film-noir-bw'].soulStyleId, '069f5a5f-8c4b-4591-a3dd-bde488672228');
  assert.equal(by['nostalgia-35mm'].soulStyleId, '2c109e42-bf29-47a2-ae16-aa6cbbba8b8a');
  assert.equal(by['y2k-flash'].soulStyleId, '5e87c5bd-86b6-491a-94ab-046891d1e35e');
  assert.equal(by['anime-2d'].models.faces, models.QWEN_T2I);
  assert.equal(by['cartoon-flat-kids'].models.faces, models.RECRAFT);
  assert.deepEqual(by['anime-2d'].negatives.slice(0, 3), ['no photorealism', 'no 3D render', 'no live-action skin texture']);
  assert.match(by['anime-2d'].videoHints, /cel shading/);
});

test('user styles: save, update, id rules, delete, validation', () => {
  assert.equal(fs.existsSync(path.join(store.PROJECTS_DIR, '_styles.json')), false);
  const a = styles.saveStyle({ name: 'My Noir Rain', family: 'film', look: 'rainy night, neon puddles', negatives: ['no colour', ''], videoHints: 'slow dolly', builtin: true } as any);
  assert.equal(a.id, 'my-noir-rain');
  assert.equal(a.builtin, undefined);
  assert.deepEqual(a.negatives, ['no colour']);
  assert.deepEqual(a.models, { faces: models.SOUL, places: models.SOUL, identity: models.QWEN_EDIT });
  assert.ok(a.updatedAt);
  assert.equal(styles.listStyles().length, PRESET_IDS.length + 1);
  assert.equal(styles.listStyles().at(-1)!.id, 'my-noir-rain');
  assert.equal(styles.getStyle('my-noir-rain')!.look, 'rainy night, neon puddles');

  // same name again: new style with a unique id; with its id: update in place
  const b = styles.saveStyle({ name: 'My Noir Rain', family: 'film', look: 'second' });
  assert.equal(b.id, 'my-noir-rain-2');
  const u = styles.saveStyle({ ...a, look: 'edited look' });
  assert.equal(u.id, 'my-noir-rain');
  assert.equal(styles.getStyle('my-noir-rain')!.look, 'edited look');
  assert.equal(styles.listStyles().length, PRESET_IDS.length + 2);
  // a built-in id is never overwritten: it becomes a new style
  const c = styles.saveStyle({ ...styles.getStyle('anime-2d')!, name: 'Anime 2D', look: 'mine' });
  assert.equal(c.id, 'anime-2d-2');
  assert.equal(styles.getStyle('anime-2d')!.builtin, true);
  // non-photo family with no models defaults to a drawing model
  assert.equal(styles.saveStyle({ name: 'Doodles', family: 'illustration', look: 'x' }).models.faces, models.QWEN_T2I);

  const bad = (input: any, re: RegExp) => assert.throws(() => styles.saveStyle(input), (e: any) => e instanceof styles.StyleError && e.status === 400 && re.test(e.message));
  bad({ name: '  ', family: 'film' }, /name/);
  bad({ family: 'film' }, /name/);
  bad({ name: 'x', family: 'vaporwave' }, /family/);
  bad({ name: 'x', family: 'film', models: { faces: 'made/up' } }, /unknown image model/);
  bad({ name: 'x', family: 'film', models: { faces: models.SOUL, places: 'made/up' } }, /places/);
  bad({ name: 'x', family: 'film', models: { identity: 'made/up' } }, /identity/);
  bad({ name: 'x', family: 'anime', models: { faces: models.SOUL } }, /photograph/);
  bad({ name: 'x', family: 'film', models: { faces: models.QWEN_T2I }, soulStyleId: 'abc' }, /soulStyleId/);
  assert.equal(styles.saveStyle({ name: 'Soul ok', family: 'film', soulStyleId: 'abc', look: 'x' }).soulStyleId, 'abc');

  assert.throws(() => styles.deleteStyle('anime-2d'), (e: any) => e.status === 403);
  assert.throws(() => styles.deleteStyle('nope'), (e: any) => e.status === 404);
  styles.deleteStyle('my-noir-rain');
  assert.equal(styles.getStyle('my-noir-rain'), undefined);
  fs.rmSync(path.join(store.PROJECTS_DIR, '_styles.json'));
  assert.equal(styles.listStyles().length, PRESET_IDS.length);
});

test('styleFor: default when missing, the snapshot when set', () => {
  assert.equal(styles.styleFor({}).id, 'cinematic-realism');
  const anime = styles.getStyle('anime-2d')!;
  assert.equal(styles.styleFor({ style: anime }).id, 'anime-2d');
});

test('models: request body per model (snapshot)', () => {
  const noir = styles.getStyle('film-noir-bw')!;
  const anime = styles.getStyle('anime-2d')!;
  const kids = styles.getStyle('cartoon-flat-kids')!;
  assert.deepEqual(models.buildSheetInput('P', { aspect: '3:4', style: noir, model: models.SOUL }),
    { prompt: 'P', resolution: '1080p', aspect_ratio: '3:4', batch_size: 4, enhance_prompt: false, style_id: '069f5a5f-8c4b-4591-a3dd-bde488672228' });
  assert.deepEqual(models.buildSheetInput('P', { aspect: '21:9', style: noir, model: models.CINEMA }),
    { prompt: 'P', resolution: '1080p', aspect_ratio: '16:9', batch_size: 4, enhance_prompt: false });
  assert.deepEqual(models.buildSheetInput('P', { aspect: '16:9', identityRefPath: '/s.png', style: anime, model: models.QWEN_EDIT }), { prompt: 'P', image_urls: ['/s.png'] });
  assert.deepEqual(models.buildSheetInput('P', { aspect: '21:9', style: anime, model: models.QWEN_T2I }), { prompt: 'P', resolution: '1k', aspect_ratio: '21:9' });
  assert.deepEqual(models.buildSheetInput('P', { aspect: '2:3', style: anime, model: models.Z_IMAGE }), { prompt: 'P', resolution: '1k', aspect_ratio: '2:3' });
  assert.deepEqual(models.buildSheetInput('P', { aspect: '3:4', style: kids, model: models.RECRAFT }), { prompt: 'P', resolution: '1k', aspect_ratio: '3:4', output_format: 'png' });
  assert.equal(models.buildSheetInput('P', { aspect: '21:9', style: kids, model: models.RECRAFT }).aspect_ratio, '2:1', 'recraft has no 21:9');
  assert.equal(models.buildSheetInput('P', { aspect: '4:3', style: kids, model: models.RECRAFT }).aspect_ratio, '4:3');
  // no style_id unless the style has one, and never on Cinema
  assert.equal('style_id' in models.buildSheetInput('P', { aspect: '1:1', style: styles.getStyle('cinematic-realism')!, model: models.SOUL }), false);
  // model inferred from the style when omitted
  assert.deepEqual(Object.keys(models.buildSheetInput('P', { aspect: '1:1', style: anime })), ['prompt', 'resolution', 'aspect_ratio']);

  assert.equal(models.sheetModel('character-full', false, anime), models.QWEN_T2I);
  assert.equal(models.sheetModel('character-full', true, anime), models.QWEN_EDIT);
  assert.equal(models.sheetModel('location', true, anime), models.QWEN_T2I);
  assert.equal(models.sheetModel('location', false, noir), models.CINEMA);
  assert.equal(models.sheetModel('character-portrait', false, kids), models.RECRAFT);
  assert.equal(models.sheetModel('character-portrait', false), models.SOUL);

  assert.equal(models.fakePrice(models.QWEN_T2I, { resolution: '1k' }), 0.04);
  assert.equal(models.fakePrice(models.QWEN_T2I, { resolution: '2k' }), 0.075);
  assert.equal(models.fakePrice(models.Z_IMAGE, {}), 0.015);
  assert.equal(models.fakePrice(models.RECRAFT, {}), 0.035);
  assert.deepEqual([models.SOUL, models.CINEMA, models.QWEN_T2I, models.Z_IMAGE, models.RECRAFT, models.QWEN_EDIT].map(models.callsPerSheet), [1, 1, 4, 4, 4, 1]);
});

function animeProject(slug: string, styleId: string) {
  store.createProject({ title: slug, slug, briefText: DEMO_BRIEF });
  store.setProjectStyle(slug, styles.getStyle(styleId)!);
  return store.loadProject(slug);
}

test('sheets with anime-2d: look present, realism words gone, negatives merged, wardrobe and identity kept', async () => {
  const anime = styles.getStyle('anime-2d')!;
  let p = animeProject('anime-a', 'anime-2d');
  store.addRef('anime-a', { role: 'selfie', filename: 'me.png', bytes: Buffer.from('x') });
  p = await script.run(store.loadProject('anime-a'), {}, emit);
  p = await sheets.run(p, {}, emit);
  assert.equal(p.sheets!.items.length, 9);
  for (const i of p.sheets!.items) {
    assert.ok(i.prompt.length >= 200, i.id);
    assert.ok(!/ARRI|Hasselblad|Sony A7|\b\d+mm\b|f\/\d|skin pores|8k|photorealistic|cyclorama/i.test(i.prompt), `${i.id}: ${i.prompt}`);
    for (const n of anime.negatives) assert.ok(i.prompt.toLowerCase().includes(n.toLowerCase()), `${i.id} negative ${n}`);
    const c = p.script!.characters.find((x) => x.id === i.characterId);
    if (c) {
      assert.ok(i.prompt.includes(c.wardrobe), `${i.id} wardrobe`);
      assert.ok(i.prompt.includes(anime.sheetLook!.slice(0, 20)), `${i.id} sheetLook`);
      assert.equal(i.prompt.replace(/^\[anchor: [^\]]+\]\s*/, '').startsWith('[identity: ref]'), !!c.identityRefId);
    } else {
      assert.ok(i.prompt.includes(anime.look.slice(0, 20)), `${i.id} look`);
    }
    assert.ok(i.prompt.endsWith(anime.negatives.at(-1)!), i.id);
  }
});

test('sheets with the default style are untouched; a film style keeps its photographic words and gains its look', async () => {
  const dflt = await sheets.run(await script.run(store.createProject({ title: 'dflt', briefText: DEMO_BRIEF }), {}, emit), {}, emit);
  assert.ok(dflt.sheets!.items.some((i) => /medium-format portrait look/.test(i.prompt)));
  assert.ok(!dflt.sheets!.items.some((i) => i.prompt.includes(styles.getStyle('cinematic-realism')!.look.slice(0, 20))));
  const noir = styles.getStyle('film-noir-bw')!;
  const p = animeProject('noir-a', 'film-noir-bw');
  const out = await sheets.run(await script.run(p, {}, emit), {}, emit);
  const full = out.sheets!.items.find((i) => i.id === 'ilse_present_full')!;
  assert.ok(full.prompt.includes('full-frame stills camera'), 'photographic styles keep camera words');
  assert.ok(full.prompt.includes(noir.sheetLook!.slice(0, 20)));
  assert.ok(out.sheets!.items.find((i) => i.id === 'loc_barn')!.prompt.includes(noir.look.slice(0, 20)), 'locations get look, not sheetLook');
});

test('applyStyle: appends once, scrubs only drawn styles', () => {
  const anime = styles.getStyle('anime-2d')!;
  const once = sheets.applyStyle('a girl, shot on a full-frame stills camera, 50mm lens, f/8, 8k, photorealistic, blue coat', 'character-full', anime);
  assert.ok(once.startsWith('a girl, blue coat, '), once);
  assert.equal(sheets.applyStyle(once, 'character-full', anime), once, 'idempotent');
  assert.equal(sheets.applyStyle('keep ARRI', 'location', styles.getStyle('cinematic-realism')!), 'keep ARRI');
});

test('scenes with anime-2d: LOOK block, no ARRI/photoreal words, style negatives, videoHints at the tail, prompt == joinBlocks', async () => {
  const anime = styles.getStyle('anime-2d')!;
  let p = store.loadProject('anime-a');
  p = await scenes.run(p, {}, emit);
  assert.equal(p.scenePrompts!.length, 9);
  for (const sp of p.scenePrompts!) {
    assert.ok(!/ARRI|Alexa|photorealistic|\b\d+ ?mm\b|photorealistic skin/i.test(sp.prompt), `${sp.sceneId}: ${sp.prompt}`);
    for (const n of anime.negatives) assert.ok(sp.negatives.includes(n.toLowerCase()), `${sp.sceneId} negative ${n}`);
    assert.ok(sp.prompt.endsWith(`${anime.videoHints}, ${sp.negatives.join(', ')}`), `${sp.sceneId} tail: ${sp.prompt.slice(-200)}`);
    const names = sp.blocks!.map((b) => b.name);
    assert.ok(names.indexOf('LOOK') > names.indexOf('CAMERA') && names.indexOf('LOOK') < names.indexOf('QUALITY'), names.join());
    assert.equal(sp.blocks!.find((b) => b.name === 'LOOK')!.text, anime.look);
    assert.equal(sp.blocks!.find((b) => b.name === 'LOOK')!.locked, true);
    assert.equal(names.at(-1), 'NEGATIVES');
    assert.equal(sp.blocks!.at(-1)!.text, sp.negatives.join(', '));
    assert.equal(sp.prompt, scenes.joinBlocks(sp.blocks!, sp.negatives));
    assert.equal(sp.prompt, sp.blocks!.map((b) => b.text).join(', '));
    assert.ok(sp.prompt.includes('{{'), 'placeholders survive');
  }
  // the PATCH path (syncBlocks) keeps the invariant with a LOOK block in play
  const first = p.scenePrompts![0];
  assert.equal(scenes.syncBlocks(first).prompt, first.prompt);
});

test('scenes.finish with a plain prompt and a film style', () => {
  const p = animeProject('plain-a', 'anime-2d');
  const anime = styles.getStyle('anime-2d')!;
  const out = scenes.finish(p, { id: 's', order: 1, title: '', era: 'present', characters: [], locationId: 'l', cameraSimple: '', actionSimple: '', mood: '', durationSec: 5 },
    { prompt: 'a girl waves, shot on ARRI Alexa 35, no zoom', negatives: [] });
  assert.ok(!/ARRI/.test(out.prompt));
  assert.ok(out.prompt.includes(anime.look) && out.prompt.includes(anime.videoHints));
  assert.ok(out.prompt.endsWith(anime.negatives.map((n) => n.toLowerCase()).join(', ')), out.prompt);
  assert.ok(out.negatives.includes('no zoom') && out.negatives.includes('no photorealism'));
  assert.ok(out.prompt.indexOf(anime.look) < out.prompt.indexOf(anime.videoHints), 'look, then videoHints, then the appended negatives');
});

test('images: anime routes to qwen t2i (4 sequential calls), noir to Soul with style_id, kids to Recraft', async () => {
  const anime = animeProject('anime-img', 'anime-2d');
  anime.script = store.loadProject('anime-a').script;
  anime.sheets = { items: store.loadProject('anime-a').sheets!.items.filter((i) => ['ilse_present_portrait', 'loc_barn'].includes(i.id)) };
  store.saveProject(anime);
  const est = await images.estimate(anime, {});
  assert.equal(est.items.length, 2);
  for (const it of est.items) { assert.equal(it.model, models.QWEN_T2I); assert.equal(it.usd, 0.16); assert.match(it.note!, /4 calls/); }
  assert.equal(est.usd, 0.32);
  const done = await images.run(store.loadProject('anime-img'), {}, emit);
  for (const a of done.assets) {
    assert.equal(a.model, models.QWEN_T2I);
    assert.equal(a.options.length, 4);
    assert.equal(new Set(a.options.map((o) => o.path)).size, 4, 'four distinct files');
    assert.equal(a.costUsd, 0.16);
  }

  const noir = animeProject('noir-img', 'film-noir-bw');
  noir.script = anime.script;
  noir.sheets = anime.sheets;
  store.saveProject(noir);
  const n = await images.estimate(noir, {});
  assert.deepEqual(n.items.map((i) => [i.model, i.usd]), [[models.SOUL, 0.023], [models.CINEMA, 0.022]]);

  const kids = animeProject('kids-img', 'cartoon-flat-kids');
  kids.script = anime.script;
  kids.sheets = anime.sheets;
  store.saveProject(kids);
  assert.deepEqual((await images.estimate(kids, {})).items.map((i) => [i.model, i.usd]), [[models.RECRAFT, 0.14], [models.RECRAFT, 0.14]]);
});

test('routes: styles CRUD, soul styles, project style, PATCH style, view default', async () => {
  const list = await j('GET', '/api/styles');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, PRESET_IDS.length);
  assert.equal(list.body[0].id, 'cinematic-realism');

  const made = await j('POST', '/api/styles', { name: 'Route Style', family: 'anime', look: 'l', models: { faces: models.QWEN_T2I } });
  assert.equal(made.status, 201);
  assert.equal(made.body.id, 'route-style');
  assert.equal(made.body.builtin, undefined);
  const upd = await j('POST', '/api/styles', { ...made.body, look: 'l2' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.look, 'l2');
  assert.equal((await j('GET', '/api/styles')).body.length, PRESET_IDS.length + 1);
  assert.equal((await j('POST', '/api/styles', { name: '', family: 'anime' })).status, 400);
  assert.equal((await j('POST', '/api/styles', { name: 'x', family: 'nope' })).status, 400);

  assert.equal((await j('DELETE', '/api/styles/anime-2d')).status, 403);
  assert.equal((await j('DELETE', '/api/styles/ghost')).status, 404);
  assert.equal((await j('DELETE', '/api/styles/route-style')).status, 200);
  assert.equal((await j('GET', '/api/styles')).body.length, PRESET_IDS.length);

  const soul = await j('GET', '/api/soul-styles');
  assert.equal(soul.status, 200);
  assert.equal(soul.body.length, 5);
  assert.ok(soul.body.every((s: any) => /^[0-9a-f-]{36}$/.test(s.id) && s.name));

  const models_ = await j('GET', '/api/image-models');
  assert.ok(models_.body.images.some((m: any) => m.slug === models.QWEN_T2I && m.calls === 4));

  await j('POST', '/api/projects', { title: 'Route Proj', briefText: 'b' });
  const fresh = await j('GET', '/api/projects/route-proj');
  assert.equal(fresh.body.style.id, 'cinematic-realism', 'missing style resolves to the default');
  assert.equal(store.loadProject('route-proj').style, undefined, 'and is not written back');

  const before = store.loadProject('route-proj').stamps?.brief;
  await new Promise((r) => setTimeout(r, 5));
  const set = await j('POST', '/api/projects/route-proj/style', { styleId: 'anime-2d' });
  assert.equal(set.status, 200);
  assert.equal(set.body.style.id, 'anime-2d');
  assert.equal(set.body.style.models.faces, models.QWEN_T2I);
  assert.ok(set.body.stamps.brief > (before ?? ''));
  assert.equal((await j('POST', '/api/projects/route-proj/style', { styleId: 'ghost' })).status, 404);
  assert.equal((await j('POST', '/api/projects/missing-one/style', { styleId: 'anime-2d' })).status, 404);

  await new Promise((r) => setTimeout(r, 5));
  const b1 = set.body.stamps.brief;
  const patched = await j('PATCH', '/api/projects/route-proj', { style: { look: 'edited look' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.style.look, 'edited look');
  assert.equal(patched.body.style.id, 'anime-2d', 'deep-merged over the current style');
  assert.deepEqual(patched.body.style.negatives, styles.getStyle('anime-2d')!.negatives);
  assert.ok(patched.body.stamps.brief > b1, 'PATCH style stamps brief');
  assert.equal((await j('PATCH', '/api/projects/route-proj', { style: 'nope' })).status, 400);
  assert.equal((await j('GET', '/api/projects')).body.find((p: any) => p.slug === 'route-proj').style.id, 'anime-2d');
});

test('cli: styles lists all presets, style sets the project style', async () => {
  const { execFileSync } = await import('node:child_process');
  const env = { ...process.env };
  const cli = path.join(import.meta.dirname, '..', 'src', 'cli.ts');
  const out = execFileSync('node', [cli, 'styles'], { env, encoding: 'utf8' });
  assert.equal(out.trim().split('\n').length, PRESET_IDS.length);
  assert.match(out, /anime-2d\s+Anime 2D\s+anime\s+faces Qwen Image 3/);
  store.createProject({ title: 'Cli Proj', briefText: 'b' });
  const set = execFileSync('node', [cli, 'style', 'cli-proj', 'claymation'], { env, encoding: 'utf8' });
  assert.match(set, /Claymation/);
  assert.equal(store.loadProject('cli-proj').style!.id, 'claymation');
});
