import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-lib-'));
process.env.HEARTCUT_ROOT = tmp;
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';
const store = await import('../src/store.ts');
const lib = await import('../src/library.ts');
const sheetsMod = await import('../src/stages/sheets.ts');
const { seedProject } = await import('./fixtures/seed.ts');
const { tinyPng } = await import('../src/demo/media.ts');

const alpha = seedProject(store, 'Alpha');
alpha.script!.characters[0].identityRefId = 'ref_selfie';
store.saveProject(alpha);
const beta = seedProject(store, 'Beta', { sheets: false }); // has the script (so ilse exists) but no pictures

test('listLibrary scans every project, filters by kind / q / exclude', () => {
  const all = lib.listLibrary();
  assert.equal(all.length, 10); // 2 characters + 3 locations, in two projects
  const chars = lib.listLibrary({ kind: 'character' });
  assert.ok(chars.every((e) => e.kind === 'character') && chars.length === 4);
  assert.equal(lib.listLibrary({ kind: 'location' }).length, 6);
  assert.equal(lib.listLibrary({ q: 'pony mare' }).length, 2);
  assert.equal(lib.listLibrary({ excludeSlug: 'beta' }).every((e) => e.projectSlug === 'alpha'), true);
  const ilse = all.find((e) => e.id === 'alpha:ilse')!;
  assert.equal(ilse.projectTitle, 'Alpha');
  assert.equal(ilse.sheets.length, 4); // 2 states x portrait/full, chosen options only
  assert.deepEqual(ilse.sheets.map((s) => s.index), [0, 0, 0, 0]);
  assert.ok(fs.existsSync(ilse.sheets[0].file));
  assert.ok(ilse.summary.length <= 160);
  assert.equal(all.find((e) => e.id === 'beta:ilse')!.sheets.length, 0, 'spec-only entries still appear');
  assert.ok(ilse.allSheets.length >= ilse.sheets.length);
  assert.equal(ilse.allSheets.filter((s) => s.chosen).length, ilse.sheets.length);
  assert.ok(ilse.allSheets.every((s) => fs.existsSync(s.file) && Number.isInteger(s.index)));
  assert.equal(all.find((e) => e.id === 'beta:ilse')!.allSheets.length, 0);
});

test('adoptEntry copies files, remaps a colliding id, creates assets + sheet prompts, stamps', () => {
  const before = store.loadProject('beta');
  assert.equal(before.assets.length, 0);
  const r = lib.adoptEntry('beta', 'alpha:ilse');
  assert.equal(r.id, 'ilse-2');
  assert.equal(r.kind, 'character');
  const p = store.loadProject('beta');
  assert.deepEqual(p.script!.characters.map((c) => c.id), ['ilse', 'fenna', 'ilse-2']);
  assert.equal(p.script!.characters[2].identityRefId, undefined);
  assert.equal(p.script!.characters[2].name, 'Ilse');
  const ids = p.assets.map((a) => a.id).sort();
  assert.deepEqual(ids, ['ilse-2_past_full', 'ilse-2_past_portrait', 'ilse-2_present_full', 'ilse-2_present_portrait']);
  for (const a of p.assets) {
    assert.equal(a.characterId, 'ilse-2');
    assert.equal(a.model, 'library');
    assert.equal(a.chosen, 0);
    assert.equal(a.options.length, 1);
    assert.ok(a.options[0].path.startsWith(path.join(process.env.HEARTCUT_MEDIA_ROOT!, 'beta', 'assets')));
    assert.ok(fs.existsSync(a.options[0].path));
    assert.equal(a.sources![0].kind, 'library');
    assert.equal((a.sources![0] as any).projectSlug, 'alpha');
    assert.ok(p.sheets!.items.some((i) => i.id === a.id && i.characterId === 'ilse-2' && i.prompt === a.prompt));
  }
  // originals untouched (copied, not moved)
  for (const s of lib.listLibrary().find((e) => e.id === 'alpha:ilse')!.sheets) assert.ok(fs.existsSync(s.file));
  assert.ok(p.stamps!.script && p.stamps!.sheets && p.stamps!.images);
  assert.equal(lib.adoptEntry('beta', 'alpha:ilse').id, 'ilse-3');
});

test('adoptEntry for a location, and errors', () => {
  const r = lib.adoptEntry('beta', 'alpha:orchard');
  assert.equal(r.id, 'orchard-2');
  assert.ok(store.loadProject('beta').assets.some((a) => a.id === 'loc_orchard-2' && a.locationId === 'orchard-2'));
  assert.throws(() => lib.adoptEntry('beta', 'alpha:nobody'), /no library entry/);
  assert.throws(() => lib.adoptEntry('beta', 'alpha:ilse', 'location'), /no library entry/);
  assert.throws(() => lib.adoptEntry('beta', 'nocolon'), /bad entry id/);
});

test('adoptOption appends one picture from another project and chooses it', () => {
  const p = lib.adoptOption('beta', 'ilse-2_present_full', { fromSlug: 'alpha', fromAssetId: 'ilse_past_full', index: 1 });
  const a = p.assets.find((x) => x.id === 'ilse-2_present_full')!;
  assert.equal(a.options.length, 2);
  assert.equal(a.chosen, 1);
  assert.deepEqual(a.sources![1], { kind: 'library', projectSlug: 'alpha', assetId: 'ilse_past_full', index: 1 });
  assert.ok(fs.existsSync(a.options[1].path));
  assert.throws(() => lib.adoptOption('beta', 'ilse-2_present_full', { fromSlug: 'alpha', fromAssetId: 'ilse_past_full', index: 9 }), /out of range/);
  assert.throws(() => lib.adoptOption('beta', 'nope', { fromSlug: 'alpha', fromAssetId: 'x', index: 0 }), /no asset/);
});

test('importOption rejects a non-image and accepts a PNG / JPEG / WebP', () => {
  assert.throws(() => lib.importOption('beta', 'ilse-2_past_full', { filename: 'x.png', bytes: Buffer.from('definitely not an image') }), /not an image/);
  assert.throws(() => lib.importOption('beta', 'ilse-2_past_full', { filename: 'x.png', bytes: Buffer.alloc(0) }), /empty/);
  const big = Buffer.concat([tinyPng(), Buffer.alloc(lib.MAX_IMPORT_BYTES)]);
  assert.throws(() => lib.importOption('beta', 'ilse-2_past_full', { filename: 'big.png', bytes: big }), /too large/);
  const p = lib.importOption('beta', 'ilse-2_past_full', { filename: 'my photo.png', bytes: tinyPng() });
  const a = p.assets.find((x) => x.id === 'ilse-2_past_full')!;
  assert.equal(a.options.length, 2);
  assert.equal(a.chosen, 1);
  assert.deepEqual(a.sources![1], { kind: 'import', filename: 'my photo.png' });
  assert.match(path.basename(a.options[1].path), /^ilse-2_past_full-import-1\.png$/);
  assert.deepEqual(fs.readFileSync(a.options[1].path), tinyPng());
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  assert.equal(lib.sniffImage(jpg), '.jpg');
  assert.equal(lib.sniffImage(webp), '.webp');
  const p2 = lib.importOption('beta', 'ilse-2_past_full', { filename: 'a.jpg', bytes: jpg });
  assert.match(path.basename(p2.assets.find((x) => x.id === 'ilse-2_past_full')!.options[2].path), /-import-2\.jpg$/);
});

test('importNew creates an asset and a minimal sheet prompt', () => {
  const r = lib.importNew('beta', { kind: 'location', locationId: 'rooftop', filename: 'roof.png', bytes: tinyPng() });
  assert.equal(r.assetId, 'loc_rooftop');
  const a = r.project.assets.find((x) => x.id === 'loc_rooftop')!;
  assert.equal(a.chosen, 0);
  assert.equal(a.model, 'import');
  assert.deepEqual(a.sources, [{ kind: 'import', filename: 'roof.png' }]);
  assert.equal(r.project.sheets!.items.find((i) => i.id === 'loc_rooftop')!.prompt, '(imported)');
  const c = lib.importNew('beta', { kind: 'character-full', characterId: 'fenna', stateId: 'future', filename: 'b.png', bytes: tinyPng() });
  assert.equal(c.assetId, 'fenna_future_full');
  assert.throws(() => lib.importNew('beta', { kind: 'location', locationId: 'rooftop', filename: 'roof.png', bytes: tinyPng() }), /exists/);
  assert.throws(() => lib.importNew('beta', { kind: 'character-full', filename: 'b.png', bytes: tinyPng() }), /required/);
  assert.throws(() => lib.importNew('beta', { kind: 'location', locationId: 'x', filename: 'b.txt', bytes: Buffer.from('hi') }), /not an image/);
});

// Regression: a hand-edited or partly written project.json (optional script/sheet fields missing) once made
// listLibrary throw, which turned GET /api/library and the library drawer into a 500.
test('listLibrary and adopt survive a script with missing optional fields', () => {
  const bare = store.createProject({ title: 'Sparse', briefText: 'a brief that is long enough to be a brief, honestly' });
  const raw: any = store.loadProject(bare.slug);
  raw.script = { logline: 'L', characters: [{ id: 'nobody', name: 'Nobody' }, { id: 'nameless' }], locations: [{ id: 'void' }] }; // no scenes, no descriptions, no states
  delete raw.assets;
  store.saveProject(raw);
  const entries = lib.listLibrary().filter((e) => e.projectSlug === 'sparse');
  assert.deepEqual(entries.map((e) => [e.id, e.name, e.summary]), [['sparse:nobody', 'Nobody', ''], ['sparse:nameless', 'nameless', ''], ['sparse:void', 'void', '']]);
  assert.deepEqual(entries.map((e) => e.sheets.length + e.allSheets.length), [0, 0, 0]);
  assert.equal(lib.listLibrary({ q: 'nobody' }).length, 1);
  const r = lib.adoptEntry('beta', 'sparse:nobody');
  assert.equal(r.id, 'nobody');
  const s = sheetsMod.anchorStale(store.loadProject('sparse'));
  assert.deepEqual(s, []);
  assert.equal(store.staleCount(store.loadProject('sparse')), 0);
  fs.rmSync(path.join(tmp, 'projects', 'sparse'), { recursive: true, force: true });
});
