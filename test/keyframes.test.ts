// Keyframes stage (v5): prompt join, placeholder -> refAssetIds, estimate counts, fake run, choose/remove.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-kf-'));
process.env.HEARTCUT_ROOT = tmp;
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';
const store = await import('../src/store.ts');
const kf = await import('../src/stages/keyframes.ts');
const { runStage } = await import('../src/pipeline.ts');
const { seedProject } = await import('./fixtures/seed.ts');
const { FAKE_SCENES, FAKE_KEYFRAMES, fakeEndKeyframe } = await import('../src/demo/demo.ts');
const { KEYFRAME_BLOCKS, STAGES } = await import('../src/types.ts');
import type { Project } from '../src/types.ts';

const emit = () => {};

function ready(title: string): Project {
  const p = seedProject(store, title);
  p.scenePrompts = structuredClone(FAKE_SCENES);
  store.saveProject(p);
  return p;
}

test('STAGES has keyframes between scenes and clips; KEYFRAME_BLOCKS is the spec order', () => {
  assert.deepEqual(STAGES, ['brief', 'script', 'sheets', 'images', 'scenes', 'keyframes', 'clips', 'export']);
  assert.deepEqual([...KEYFRAME_BLOCKS], ['SHOT', 'SUBJECT', 'IDENTITY', 'POSE', 'LOCATION', 'LIGHT', 'GRADE', 'CAMERA', 'LOOK', 'QUALITY', 'NEGATIVES']);
  assert.deepEqual(kf.KEYFRAME_BLOCKS, KEYFRAME_BLOCKS);
  assert.equal(kf.KEYFRAME_CALLS, 2);
  assert.equal(kf.KEYFRAME_MODEL, 'alibaba/qwen-image-3/edit');
  assert.deepEqual(kf.parseKeyframeId('kf_s1_start'), { sceneId: 's1', role: 'start' });
  assert.deepEqual(kf.parseKeyframeId('kf_scene_two_end'), { sceneId: 'scene_two', role: 'end' });
  assert.equal(kf.parseKeyframeId('ilse_present_full'), undefined);
  assert.equal(kf.keyframeId('s1', 'end'), 'kf_s1_end');
});

test('joinKeyframe / normalizeKeyframeBlocks: KEYFRAME order, locked set, NEGATIVES last and once', () => {
  const blocks = [
    { name: 'QUALITY', text: 'film still' },
    { name: 'POSE', text: 'frozen mid-throw,' },
    { name: 'LIGHT', text: 'late sun, face relit' },
    { name: 'SHOT', text: 'wide' },
    { name: 'LOOK', text: 'painterly' },
    { name: 'IDENTITY', text: 'red scarf' },
    { name: 'NEGATIVES', text: 'ignored: negatives win' },
  ];
  const negatives = ['no zoom', 'no shiny plastic skin'];
  const out = kf.normalizeKeyframeBlocks(blocks, negatives);
  assert.deepEqual(out.map((b) => b.name), ['SHOT', 'IDENTITY', 'POSE', 'LIGHT', 'LOOK', 'QUALITY', 'NEGATIVES']);
  for (const b of out) assert.equal(!!b.locked, ['SUBJECT', 'IDENTITY', 'LOCATION', 'GRADE', 'LOOK'].includes(b.name), `${b.name} locked`);
  assert.equal(out.find((b) => b.name === 'LIGHT')!.locked, undefined, 'LIGHT is editable on a keyframe (relight clause)');
  assert.equal(out.at(-1)!.text, 'no zoom, no shiny plastic skin');
  const prompt = kf.joinKeyframe(out, negatives);
  assert.equal(prompt, 'wide, red scarf, frozen mid-throw, late sun, face relit, painterly, film still, no zoom, no shiny plastic skin');
  assert.equal(prompt, out.map((b) => b.text).join(', '));
  // the PATCH path: edited blocks + a dropped negative chip re-join
  const k = kf.syncKeyframe({ id: 'kf_s1_start', sceneId: 's1', role: 'start', prompt: 'STALE', blocks: out.map((b) => (b.name === 'SHOT' ? { ...b, text: 'tight' } : b)), negatives: ['no zoom'], refAssetIds: [], model: 'm', options: [] });
  assert.equal(k.prompt, 'tight, red scarf, frozen mid-throw, late sun, face relit, painterly, film still, no zoom');
  assert.equal(k.blocks!.at(-1)!.text, 'no zoom');
  const plain = { id: 'kf_s1_start', sceneId: 's1', role: 'start' as const, prompt: '(imported)', negatives: [], refAssetIds: [], model: 'import', options: [] };
  assert.equal(kf.syncKeyframe(plain), plain);
});

test('placeholders resolve to the sheet ids the scenes stage would attach: characters first, location last', () => {
  const p = ready('Refs');
  const beat = p.script!.scenes.find((b) => b.id === 's2')!; // ilse + fenna in the barn
  assert.deepEqual(kf.placeholderAssetIds(p, beat, 'a woman {{char:ilse}} and her pony {{char:fenna}} in the stable {{loc:barn}}'), ['ilse_present_full', 'fenna_present_full', 'loc_barn']);
  // a character the beat does not list still resolves through the beat's era
  const solo = p.script!.scenes.find((b) => b.id === 's3')!; // fenna only, era present
  assert.deepEqual(kf.placeholderAssetIds(p, solo, '{{char:ilse}} watches {{char:fenna}} {{loc:barn}}'), ['ilse_present_full', 'fenna_present_full', 'loc_barn']);
  // unknown ids and unknown sheets are dropped
  assert.deepEqual(kf.placeholderAssetIds(p, solo, '{{char:ghost}} {{loc:nowhere}}'), []);
  // the union with refAssetIdsFor keeps the beat's own references and puts the location last
  const ids = kf.keyframeRefAssetIds(p, solo, [{ name: 'SUBJECT', text: 'she {{char:ilse}} and the pony {{char:fenna}} {{loc:barn}}' }]);
  assert.deepEqual(ids, ['fenna_present_full', 'ilse_present_full', 'loc_barn']);
  assert.deepEqual(kf.keyframeRefAssetIds(p, solo), ['fenna_present_full', 'loc_barn']);
  // chosen files follow the same order
  const files = kf.refFiles(p, ['loc_barn', 'ilse_present_full']);
  assert.ok(files[0].includes('ilse_present_full') && files[1].includes('loc_barn'));
  store.chooseAsset(p.slug, 'loc_barn', null);
  assert.throws(() => kf.refFiles(store.loadProject(p.slug), ['loc_barn']), /no chosen option/);
});

test('finishKeyframe: fake fixture -> Keyframe with joined prompt, relight clause, fakeness negatives, refs', () => {
  const p = ready('Finish');
  const beat = p.script!.scenes[0];
  const k = kf.finishKeyframe(p, beat, 'start', FAKE_KEYFRAMES[0]);
  assert.equal(k.id, 'kf_s1_start');
  assert.deepEqual(k.blocks!.map((b) => b.name), ['SHOT', 'SUBJECT', 'IDENTITY', 'POSE', 'LOCATION', 'LIGHT', 'GRADE', 'CAMERA', 'QUALITY', 'NEGATIVES']);
  assert.equal(k.prompt, k.blocks!.map((b) => b.text).join(', '));
  assert.match(k.blocks!.find((b) => b.name === 'LIGHT')!.text, /take this scene's light/);
  assert.match(k.blocks!.find((b) => b.name === 'POSE')!.text, /^held mid-|^held still/);
  for (const n of ['no waxy skin', 'no oversharpening', 'no oversaturated colours']) assert.ok(k.negatives.includes(n), n);
  assert.deepEqual(k.refAssetIds, ['ilse_present_full', 'loc_barn']);
  assert.equal(k.model, 'alibaba/qwen-image-3/edit');
  assert.deepEqual(k.options, []);
  // an end keyframe keeps everything but POSE
  const e = kf.finishKeyframe(p, beat, 'end', fakeEndKeyframe(FAKE_KEYFRAMES[0]));
  assert.equal(e.id, 'kf_s1_end');
  assert.match(e.blocks!.find((b) => b.name === 'POSE')!.text, /^the last instant of the beat/);
  // existing options/chosen survive a prompt rewrite
  const again = kf.finishKeyframe(p, beat, 'start', FAKE_KEYFRAMES[0], { ...k, options: [{ path: '/x.png' }], chosen: 0 });
  assert.equal(again.options.length, 1);
  assert.equal(again.chosen, 0);
  // the user message to the model always includes the shot-grammar essentials: one start per beat is what the fixture carries
  assert.equal(FAKE_KEYFRAMES.length, FAKE_SCENES.length);
  assert.ok(FAKE_KEYFRAMES.every((r) => r.role === 'start'));
  assert.ok(FAKE_SCENES.every((sp) => sp.motion && sp.motion.length >= 100 && sp.motion.length <= 450), 'fixture scenes carry a short motion text');
});

test('estimate: 2 calls x $0.04 per keyframe without options; end frames add one; force prices everything', async () => {
  const p = ready('Est');
  const e = await kf.estimate(p, {});
  assert.equal(e.items.length, 9);
  assert.equal(e.usd, 0.72);
  assert.ok(e.items.every((i) => i.usd === 0.08 && i.model === 'alibaba/qwen-image-3/edit' && /2 calls/.test(i.note ?? '')));
  p.scenePrompts![3].endFrame = true;
  const e2 = await kf.estimate(p, {});
  assert.equal(e2.items.length, 10);
  assert.ok(e2.items.some((i) => i.id === 'kf_s4_end'));
  assert.equal(e2.usd, 0.8);
  const e3 = await kf.estimate(p, { ids: ['s1', 's4'] });
  assert.deepEqual(e3.items.map((i) => i.id), ['kf_s1_start', 'kf_s4_start', 'kf_s4_end']);
  await assert.rejects(kf.estimate(p, { ids: ['nope'] }), /no scene prompt for: nope/);
});

test('fake run: prompts written, 2 placeholder options per keyframe under media/<slug>/keyframes, skip then force', async () => {
  const p = ready('Run Me');
  p.scenePrompts![0].endFrame = true;
  store.saveProject(p);
  const lines: string[] = [];
  const out = await runStage(p.slug, 'keyframes', {}, (l) => lines.push(l));
  assert.equal(out.keyframes!.length, 10);
  const first = out.keyframes!.find((k) => k.id === 'kf_s1_start')!;
  const end = out.keyframes!.find((k) => k.id === 'kf_s1_end')!;
  assert.equal(first.options.length, 2);
  assert.equal(end.options.length, 2);
  assert.deepEqual(first.options.map((o) => path.basename(o.path)), ['kf_s1_start-v1.png', 'kf_s1_start-v2.png']);
  for (const k of out.keyframes!) for (const o of k.options) {
    assert.ok(o.path.startsWith(path.join(tmp, 'media', p.slug, 'keyframes') + path.sep), o.path);
    assert.ok(fs.existsSync(o.path));
  }
  assert.deepEqual(first.sources, [{ kind: 'generated', model: 'alibaba/qwen-image-3/edit' }, { kind: 'generated', model: 'alibaba/qwen-image-3/edit' }]);
  assert.equal(first.costUsd, 0.08);
  assert.equal(first.chosen, undefined);
  assert.ok(first.prompt.length > 200 && first.prompt === first.blocks!.map((b) => b.text).join(', '));
  const job = out.jobs.find((j) => j.stage === 'keyframes')!;
  assert.equal(job.kind, 'keyframe');
  assert.equal(job.status, 'done');
  assert.equal(job.outputs.length, 20);
  assert.equal(job.actualUsd, 0.8);
  assert.ok(out.stamps!.keyframes);
  assert.ok(lines.some((l) => l.startsWith('writing 10 keyframe prompt')));
  // nothing to pay for now
  const e = await kf.estimate(out, {});
  assert.equal(e.usd, 0);
  assert.ok(e.items.every((i) => /already has options/.test(i.note ?? '')));
  const again = await runStage(p.slug, 'keyframes', {}, emit);
  assert.equal(again.keyframes!.find((k) => k.id === 'kf_s1_start')!.options.length, 2, 'skipped, nothing appended');
  // force on one beat appends two more options and keeps the old ones
  const forced = await runStage(p.slug, 'keyframes', { ids: ['s2'], force: true }, emit);
  const s2 = forced.keyframes!.find((k) => k.id === 'kf_s2_start')!;
  assert.equal(s2.options.length, 4);
  assert.equal(path.basename(s2.options[3].path), 'kf_s2_start-v4.png');
  assert.equal(forced.keyframes!.find((k) => k.id === 'kf_s1_start')!.options.length, 2);
  // dry run prices and writes nothing
  const q = ready('Dry');
  const dry = await runStage(q.slug, 'keyframes', { dryRun: true }, (l) => lines.push(l));
  assert.deepEqual(dry.keyframes, []);
  assert.ok(lines.some((l) => /dry run — 9 keyframe prompt/.test(l)));
  assert.equal(dry.stamps?.keyframes, undefined);
});

test('store.chooseKeyframe / removeKeyframeOption: stamps keyframes, fixes chosen, deletes only own orphan files', async () => {
  const p = ready('Pick Kf');
  await runStage(p.slug, 'keyframes', { ids: ['s1'] }, emit);
  let q = store.chooseKeyframe(p.slug, 'kf_s1_start', 1);
  assert.equal(q.keyframes![0].chosen, 1);
  assert.ok(q.stamps!.keyframes);
  assert.throws(() => store.chooseKeyframe(p.slug, 'kf_s1_start', 5), /out of range/);
  assert.throws(() => store.chooseKeyframe(p.slug, 'kf_nope_start', 0), /no keyframe/);
  q = store.chooseKeyframe(p.slug, 'kf_s1_start', null);
  assert.equal(q.keyframes![0].chosen, undefined);
  store.chooseKeyframe(p.slug, 'kf_s1_start', 1);
  const files = q.keyframes![0].options.map((o) => o.path);
  q = store.removeKeyframeOption(p.slug, 'kf_s1_start', 0);
  assert.equal(q.keyframes![0].options.length, 1);
  assert.equal(q.keyframes![0].sources!.length, 1);
  assert.equal(q.keyframes![0].chosen, 0, 'chosen shifts down');
  assert.ok(!fs.existsSync(files[0]), 'own file deleted');
  assert.ok(fs.existsSync(files[1]));
  // a file outside this project's media folder is never deleted; a file still referenced by another option is kept
  const elsewhere = path.join(tmp, 'elsewhere.png');
  fs.writeFileSync(elsewhere, 'x');
  const k = q.keyframes![0];
  k.options.push({ path: elsewhere }, { path: files[1] });
  k.sources!.push({ kind: 'import', filename: 'e.png' }, { kind: 'generated' });
  store.saveProject(q);
  q = store.removeKeyframeOption(p.slug, 'kf_s1_start', 1);
  assert.ok(fs.existsSync(elsewhere));
  q = store.removeKeyframeOption(p.slug, 'kf_s1_start', 0);
  assert.ok(fs.existsSync(files[1]), 'still referenced by the other option');
  assert.equal(q.keyframes![0].chosen, undefined, 'the chosen one was removed');
  q = store.removeKeyframeOption(p.slug, 'kf_s1_start', 0);
  assert.ok(!fs.existsSync(files[1]));
  assert.throws(() => store.removeKeyframeOption(p.slug, 'kf_s1_start', 0), /out of range/);
});

test('pipeline guard: keyframes needs scene prompts and every referenced asset chosen', async () => {
  const p = ready('Guard Kf');
  store.chooseAsset(p.slug, 'loc_barn', null);
  await assert.rejects(runStage(p.slug, 'keyframes', {}, emit), /pick a picture for loc_barn in Images first/);
  const q = seedProject(store, 'Guard Kf 2');
  await assert.rejects(runStage(q.slug, 'keyframes', {}, emit), /run the scenes stage first/);
  assert.equal(store.loadProject(p.slug).jobs.length, 0, 'guard failures create no job');
});
