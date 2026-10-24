import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-stages-'));
process.env.HEARTCUT_ROOT = tmp;
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';
const store = await import('../src/store.ts');
const script = await import('../src/stages/script.ts');
const sheets = await import('../src/stages/sheets.ts');
const scenes = await import('../src/stages/scenes.ts');
const { DEMO_BRIEF, FAKE_SCRIPT, FAKE_SHEETS } = await import('../src/demo/demo.ts');

const lines: string[] = [];
const emit = (l: string) => lines.push(l);

test('demo brief is 150-250 words', () => {
  const n = DEMO_BRIEF.trim().split(/\s+/).length;
  assert.ok(n >= 150 && n <= 250, `${n} words`);
});

test('script stage: invariants and identity ref', async () => {
  let p = store.createProject({ title: 'S', briefText: DEMO_BRIEF });
  const ref = store.addRef('s', { role: 'selfie', filename: 'me.png', bytes: Buffer.from('x') });
  p = store.loadProject('s');
  p = await script.run(p, {}, emit);
  const s = p.script!;
  assert.ok(s.scenes.length >= 6 && s.scenes.length <= 12);
  for (const b of s.scenes) assert.ok(b.durationSec >= 4 && b.durationSec <= 10);
  assert.ok(s.scenes.some((b) => b.matchCutFrom));
  assert.ok(s.characters.every((c) => c.states.length >= 2 && /\d/.test(c.baseDescription)));
  assert.equal(s.characters.find((c) => c.species === 'human')!.identityRefId, ref.id);
  assert.equal(s.characters.find((c) => c.species === 'animal')!.identityRefId, undefined);
  assert.equal(store.loadProject('s').script!.scenes.length, s.scenes.length);
  assert.deepEqual(await script.estimate(p, {}), { usd: 0, items: [] });
});

test('sheets stage: ids, lengths, wardrobe, identity tag', async () => {
  let p = store.loadProject('s');
  await assert.rejects(sheets.run(store.createProject({ title: 'NoScript', briefText: DEMO_BRIEF }), {}, emit), /needs a script/);
  p = await sheets.run(p, {}, emit);
  const items = p.sheets!.items;
  assert.equal(items.length, 9); // human: portrait + full per state; animal: full only
  const ids = new Set(items.map((i) => i.id));
  for (const c of p.script!.characters) for (const st of c.states) {
    assert.ok(ids.has(`${c.id}_${st.id}_full`));
    assert.equal(ids.has(`${c.id}_${st.id}_portrait`), c.species === 'human', `${c.id} portrait`);
  }
  for (const l of p.script!.locations) assert.ok(ids.has(`loc_${l.id}`));
  for (const i of items) {
    assert.ok(i.prompt.length >= 200, i.id);
    const c = p.script!.characters.find((x) => x.id === i.characterId);
    if (c) assert.ok(i.prompt.includes(c.wardrobe), `${i.id} wardrobe`);
    assert.equal(i.prompt.replace(/^\[anchor: [^\]]+\]\s*/, '').startsWith('[identity: ref]'), !!c?.identityRefId, i.id);
    assert.equal(i.prompt.startsWith('[anchor: '), !!i.dependsOn, i.id);
  }
});

test('sheets.normalize fills wardrobe and flags short/missing prompts', () => {
  const sc = structuredClone(FAKE_SCRIPT);
  const raw = FAKE_SHEETS.items.map((i) => ({ id: i.id, prompt: i.prompt }));
  raw.find((r) => r.id === 'ilse_past_full')!.prompt = 'a'.repeat(250); // no wardrobe line
  raw.find((r) => r.id === 'fenna_past_full')!.prompt = 'too short';
  const out = sheets.normalize(sc, raw.filter((r) => r.id !== 'loc_orchard'));
  assert.deepEqual(out.missing.sort(), ['fenna_past_full', 'loc_orchard']);
  const dep = out.items.find((i) => i.id === 'ilse_past_full')!;
  assert.equal(dep.dependsOn, 'ilse_present_portrait');
  assert.ok(dep.prompt.startsWith('[anchor: ilse_present_portrait] the same character as the reference image'), dep.prompt);
  assert.ok(dep.prompt.includes(sc.characters[0].wardrobe));
});

test('scenes stage: refs, negatives, duration, aspect', async () => {
  let p = store.loadProject('s');
  const bare = store.createProject({ title: 'Bare', briefText: DEMO_BRIEF });
  bare.script = p.script;
  await assert.rejects(scenes.run(bare, {}, emit), /needs sheets/);
  p = await scenes.run(p, {}, emit);
  const sp = p.scenePrompts!;
  assert.equal(sp.length, p.script!.scenes.length);
  for (const [i, s] of sp.entries()) {
    const beat = p.script!.scenes[i];
    assert.equal(s.sceneId, beat.id);
    assert.equal(s.durationSec, beat.durationSec);
    assert.equal(s.aspect, p.aspect);
    assert.equal(s.audio, false);
    assert.ok(s.refAssetIds.includes(`loc_${beat.locationId}`));
    for (const ch of beat.characters) assert.ok(s.refAssetIds.includes(`${ch.characterId}_${ch.stateId}_full`));
    assert.ok(s.negatives.length > 0);
    for (const n of s.negatives) assert.ok(s.prompt.toLowerCase().includes(n), `${s.sceneId}: ${n}`);
  }
});

test('scenes.finish appends missing negatives and extracts "no" clauses', () => {
  const p = store.loadProject('s');
  const out = scenes.finish(p, p.script!.scenes[0], { prompt: 'a calm shot, no zoom, warm light', negatives: ['no morphing'] });
  assert.deepEqual(out.negatives.sort(), ['no morphing', 'no zoom']);
  assert.ok(out.prompt.endsWith('no morphing'));
  assert.equal(out.prompt.match(/no zoom/g)!.length, 1);
});

test('scenes stage returns blocks: library order, locked flags, prompt joined, NEGATIVES in sync', async () => {
  const p = store.loadProject('s');
  const names = ['SHOT', 'SUBJECT', 'IDENTITY', 'PERFORM', 'PHYSICS', 'MATCHCUT', 'LOCATION', 'LIGHT', 'GRADE', 'CAMERA', 'QUALITY', 'NEGATIVES'];
  for (const sp of p.scenePrompts!) {
    const beat = p.script!.scenes.find((b) => b.id === sp.sceneId)!;
    assert.ok(sp.blocks && sp.blocks.length >= 10, sp.sceneId);
    const got = sp.blocks!.map((b) => b.name);
    assert.deepEqual(got, names.filter((n) => got.includes(n)), `${sp.sceneId} order`);
    assert.equal(got.at(-1), 'NEGATIVES');
    assert.equal(got.includes('MATCHCUT'), !!beat.matchCutFrom, `${sp.sceneId} MATCHCUT only on the match-cut beat`);
    for (const b of sp.blocks!) assert.equal(!!b.locked, ['SUBJECT', 'IDENTITY', 'LOCATION', 'LIGHT', 'GRADE'].includes(b.name), `${sp.sceneId} ${b.name} locked`);
    assert.equal(sp.blocks!.at(-1)!.text, sp.negatives.join(', '));
    assert.equal(sp.prompt, sp.blocks!.map((b) => b.text).join(', '));
  }
  assert.equal(p.scenePrompts!.length, 9);
});

test('joinBlocks / finish with blocks / syncBlocks (the PATCH path)', () => {
  const p = store.loadProject('s');
  const blocks = [
    { name: 'QUALITY', text: 'cinematic' },
    { name: 'SHOT', text: 'static medium shot' },
    { name: 'LIGHT', text: 'soft window light' },
    { name: 'NEGATIVES', text: 'no zoom, no morphing' },
  ];
  assert.equal(scenes.joinBlocks(blocks, ['no zoom', 'no morphing']), 'cinematic, static medium shot, soft window light, no zoom, no morphing');
  assert.equal(scenes.joinBlocks([{ name: 'SHOT', text: 'wide,' }, { name: 'NEGATIVES', text: 'ignored: negatives win' }], ['no zoom', 'no gore']), 'wide, no zoom, no gore');
  assert.equal(scenes.joinBlocks([{ name: 'SHOT', text: 'wide' }], []), 'wide');

  const out = scenes.finish(p, p.script!.scenes[0], { blocks, negatives: ['No Gore'] });
  assert.deepEqual(out.blocks!.map((b) => b.name), ['SHOT', 'LIGHT', 'QUALITY', 'NEGATIVES'], 'sorted into library order');
  assert.equal(out.blocks!.find((b) => b.name === 'LIGHT')!.locked, true);
  assert.equal(out.blocks!.find((b) => b.name === 'SHOT')!.locked, undefined);
  assert.deepEqual([...out.negatives].sort(), ['no gore', 'no morphing', 'no zoom']);
  assert.equal(out.blocks!.at(-1)!.text, out.negatives.join(', '));
  assert.equal(out.prompt, scenes.joinBlocks(out.blocks!, out.negatives));
  assert.equal(out.prompt.match(/no zoom/g)!.length, 1);
  assert.equal(out.prompt, out.blocks!.map((b) => b.text).join(', '));

  // a client edits the SHOT block and drops a negative chip: prompt follows
  const edited = scenes.syncBlocks({ ...out, blocks: out.blocks!.map((b) => (b.name === 'SHOT' ? { ...b, text: 'slow push-in' } : b)), negatives: ['no gore'] });
  assert.equal(edited.prompt, 'slow push-in, soft window light, cinematic, no gore');
  assert.equal(edited.blocks!.at(-1)!.text, 'no gore');
  // no negatives array -> derived from the NEGATIVES block text
  const noneg = scenes.syncBlocks({ ...out, negatives: undefined as any, blocks: [{ name: 'SHOT', text: 'wide' }, { name: 'NEGATIVES', text: 'no fog, no rain' }] });
  assert.deepEqual(noneg.negatives, ['no fog', 'no rain']);
  assert.equal(noneg.prompt, 'wide, no fog, no rain');
  // plain items pass through untouched
  const plain = { ...out, blocks: undefined, prompt: 'hand written' };
  assert.equal(scenes.syncBlocks(plain), plain);
  // a plain `prompt` from the model is still accepted
  assert.equal(scenes.finish(p, p.script!.scenes[0], { prompt: 'legacy, no zoom' }).blocks, undefined);
});

test('scrubSheetWords: sheet/turnaround words become single-picture phrasing', () => {
  assert.ok(sheets.scrubSheetWords('character reference sheet, full body, a cat').startsWith('full body view, head to toe, a cat'));
  const anime = sheets.scrubSheetWords('2D anime character model sheet, clean lineart, full-body turnaround presentation');
  assert.ok(anime.includes('single full-body picture of the character'), anime);
  assert.ok(anime.includes('standing and facing the viewer'), anime);
  assert.ok(!/sheet|turnaround/i.test(anime), anime);
});

test('applyStyle with anime-2d leaves no sheet/turnaround words', async () => {
  const { getStyle } = await import('../src/styles.ts');
  const out = sheets.applyStyle('character reference sheet, full body turnaround presentation, a cat', 'character-full', getStyle('anime-2d')!);
  assert.ok(!/sheet|turnaround/i.test(out), out);
});

test('every style preset sheetLook is free of sheet/turnaround/chart words', async () => {
  const { listStyles } = await import('../src/styles.ts');
  for (const s of listStyles()) if (s.sheetLook) assert.ok(!/sheet|turnaround|chart/i.test(s.sheetLook), `${s.id}: ${s.sheetLook}`);
  const raw = JSON.parse(fs.readFileSync(new URL('../prompts/styles.json', import.meta.url), 'utf8')) as { id: string; sheetLook?: string }[];
  for (const s of raw) assert.ok(!/sheet|turnaround|chart/i.test(s.sheetLook ?? ''), `${s.id} (json)`);
});

test('images stage sends a scrubbed prompt even when the stored one has sheet words', async () => {
  const images = await import('../src/stages/images.ts');
  let p = store.createProject({ title: 'Scrub', slug: 'scrub', briefText: DEMO_BRIEF });
  p.script = FAKE_SCRIPT;
  p.sheets = { items: [{ id: 'ilse_present_portrait', kind: 'character-portrait', characterId: 'ilse', stateId: 'present',
    prompt: 'character reference sheet, full body, a woman in a grey jacket, standing, plain background, ' + 'x'.repeat(200) }] };
  store.saveProject(p);
  const sent: string[] = [];
  const orig = images.hooks.run;
  images.hooks.run = (async (m: any, input: any, ro: any) => { sent.push(String(input.prompt)); return orig(m, input, ro); }) as typeof orig;
  try { await images.run(store.loadProject('scrub'), {}, emit); } finally { images.hooks.run = orig; }
  assert.ok(sent.length >= 1);
  for (const s of sent) { assert.ok(!/sheet|turnaround/i.test(s), s); assert.ok(s.includes('full body view, head to toe'), s); }
});
