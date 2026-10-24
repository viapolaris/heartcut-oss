// Clips stage (v5): source selection, prompt mode default + override, short fallback, one-take sequences, final rule,
// export coverage of sequence clips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-clips-'));
process.env.HEARTCUT_ROOT = tmp;
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';
const store = await import('../src/store.ts');
const clips = await import('../src/stages/clips.ts');
const exp = await import('../src/stages/export.ts');
const models = await import('../src/gen/models.ts');
const { runStage } = await import('../src/pipeline.ts');
const { seedProject } = await import('./fixtures/seed.ts');
const { FAKE_SCENES } = await import('../src/demo/demo.ts');
const { tinyPng } = await import('../src/demo/media.ts');
import type { Clip, KeyframeRole, Project, ScenePrompt } from '../src/types.ts';

const emit = () => {};

function ready(title: string, opts: { keyframes?: string[]; endFor?: string[] } = {}): Project {
  const p = seedProject(store, title);
  p.scenePrompts = structuredClone(FAKE_SCENES);
  p.keyframes = [];
  const dir = store.mediaDir(p.slug, 'keyframes');
  for (const sceneId of opts.keyframes ?? []) {
    for (const role of ['start', ...(opts.endFor?.includes(sceneId) ? ['end'] : [])] as KeyframeRole[]) {
      const file = path.join(dir, `kf_${sceneId}_${role}-v1.png`);
      fs.writeFileSync(file, tinyPng());
      const sp = p.scenePrompts.find((x) => x.sceneId === sceneId)!;
      p.keyframes.push({ id: `kf_${sceneId}_${role}`, sceneId, role, prompt: 'still', negatives: [], refAssetIds: sp.refAssetIds, model: 'm', options: [{ path: file }, { path: file }], chosen: 0 });
    }
  }
  store.saveProject(p);
  return p;
}

test('models: videoModel(source), I2V input shape, fakePrice formula shared', () => {
  assert.equal(models.SEEDANCE_I2V, 'bytedance/seedance-2.5/image-to-video');
  assert.equal(models.videoModel(), models.SEEDANCE);
  assert.equal(models.videoModel('reference'), models.SEEDANCE);
  assert.equal(models.videoModel('sequence'), models.SEEDANCE);
  assert.equal(models.videoModel('keyframe'), models.SEEDANCE_I2V);
  const sp: ScenePrompt = { sceneId: 's', prompt: 'full text', negatives: [], refAssetIds: [], durationSec: 5.4, aspect: '9:16', audio: true };
  const i2v = models.buildVideoInput(sp, ['/ignored.png'], 'draft', { prompt: 'motion only', startImage: '/kf.png' });
  assert.deepEqual(i2v, { prompt: 'motion only', resolution: '480p', duration: 5, generate_audio: false, image_url: '/kf.png', output_format: 'mp4' });
  assert.ok(!('aspect_ratio' in i2v) && !('image_urls' in i2v));
  const withEnd = models.buildVideoInput(sp, [], 'final', { startImage: '/a.png', endImage: '/b.png' });
  assert.equal(withEnd.end_image_url, '/b.png');
  assert.equal(withEnd.prompt, 'full text');
  assert.equal(withEnd.generate_audio, true);
  // reference-to-video unchanged
  assert.deepEqual(models.buildVideoInput(sp, ['/a.png'], 'draft'), { prompt: 'full text', resolution: '480p', duration: 5, aspect_ratio: '9:16', generate_audio: false, image_urls: ['/a.png'], output_format: 'mp4' });
  assert.equal(models.buildVideoInput(sp, [], 'draft', { durationSec: 99 }).duration, 30);
  assert.equal(models.fakePrice(models.SEEDANCE_I2V, { resolution: '720p', duration: 5 }), models.fakePrice(models.SEEDANCE, { resolution: '720p', duration: 5 }));
  assert.equal(models.fakePrice(models.SEEDANCE_I2V, { resolution: '480p', duration: 8 }), 1.645);
  assert.ok(models.isFormulaPriced(models.SEEDANCE_I2V));
});

test('source selection: chosen start keyframe -> image-to-video (+end), otherwise reference-to-video as before', async () => {
  const p = ready('Source', { keyframes: ['s1', 's2'], endFor: ['s2'] });
  const est = await clips.estimate(p, { ids: ['s1', 's2', 's3'] });
  assert.deepEqual(est.items.map((i) => i.model), [models.SEEDANCE_I2V, models.SEEDANCE_I2V, models.SEEDANCE]);
  assert.match(est.items[0].note!, /from keyframe, short prompt/);
  assert.match(est.items[2].note!, /from sheets, full prompt/);
  // an unchosen keyframe does not count
  p.keyframes![0].chosen = undefined;
  assert.equal((await clips.estimate(p, { ids: ['s1'] })).items[0].model, models.SEEDANCE);
  p.keyframes![0].chosen = 0;
  const sent: { model: string; input: any }[] = [];
  const orig = clips.hooks.run;
  clips.hooks.run = (async (m: string, input: any, ro: any) => { sent.push({ model: m, input }); return orig(m, input, ro); }) as typeof orig;
  try { await runStage(p.slug, 'clips', { ids: ['s1', 's2', 's3'] }, emit); } finally { clips.hooks.run = orig; }
  assert.equal(sent.length, 3);
  assert.equal(sent[0].input.image_url, p.keyframes![0].options[0].path);
  assert.equal(sent[0].input.end_image_url, undefined);
  assert.ok(!('aspect_ratio' in sent[0].input) && !('image_urls' in sent[0].input));
  assert.equal(sent[1].input.end_image_url, p.keyframes!.find((k) => k.id === 'kf_s2_end')!.options[0].path);
  assert.ok(Array.isArray(sent[2].input.image_urls) && sent[2].input.image_urls.length === 2 && sent[2].input.aspect_ratio === '16:9');
  const q = store.loadProject(p.slug);
  assert.deepEqual(q.clips.map((c) => [c.sceneId, c.source, c.mode, c.model]), [
    ['s1', 'keyframe', 'short', models.SEEDANCE_I2V], ['s2', 'keyframe', 'short', models.SEEDANCE_I2V], ['s3', 'reference', 'full', models.SEEDANCE],
  ]);
  assert.equal(q.clips[0].prompt, FAKE_SCENES[0].motion);
  assert.equal(q.clips[2].prompt, FAKE_SCENES[2].prompt);
  assert.ok(q.clips.every((c) => c.status === 'done' && fs.existsSync(c.file!.path)));
});

test('prompt mode: default short with a keyframe, full otherwise; opts.promptMode overrides both ways', async () => {
  const p = ready('Mode', { keyframes: ['s1'] });
  const run = async (opts: any) => { const q = await runStage(p.slug, 'clips', opts, emit); return q.clips.at(-1)!; };
  const a = await run({ ids: ['s1'] });
  assert.equal(a.mode, 'short'); assert.equal(a.prompt, FAKE_SCENES[0].motion);
  const b = await run({ ids: ['s1'], promptMode: 'full' });
  assert.equal(b.mode, 'full'); assert.equal(b.prompt, FAKE_SCENES[0].prompt); assert.equal(b.source, 'keyframe'); assert.equal(b.model, models.SEEDANCE_I2V);
  const c = await run({ ids: ['s3'] });
  assert.equal(c.mode, 'full'); assert.equal(c.source, 'reference');
  const d = await run({ ids: ['s3'], promptMode: 'short' });
  assert.equal(d.mode, 'short'); assert.equal(d.prompt, FAKE_SCENES[2].motion); assert.equal(d.model, models.SEEDANCE);
});

test('shortPrompt: motion text wins; fallback = SHOT + PERFORM + PHYSICS + motion negatives, 150-450 chars', () => {
  for (const sp of FAKE_SCENES) {
    assert.equal(clips.shortPrompt(sp), sp.motion);
    const noMotion = { ...sp, motion: undefined };
    const s = clips.shortPrompt(noMotion);
    assert.ok(s.length >= clips.SHORT_MIN && s.length <= clips.SHORT_MAX, `${sp.sceneId}: ${s.length} chars`);
    const shot = sp.blocks!.find((b) => b.name === 'SHOT')!.text;
    assert.ok(s.startsWith(shot), `${sp.sceneId} starts with SHOT`);
    for (const b of sp.blocks!) if (['SUBJECT', 'IDENTITY', 'LOCATION', 'GRADE', 'QUALITY'].includes(b.name)) assert.ok(!s.includes(b.text), `${sp.sceneId}: ${b.name} must not leak into the short prompt`);
    for (const n of sp.negatives) assert.equal(s.includes(n), clips.isMotionNegative(n), `${sp.sceneId}: ${n}`);
  }
  assert.ok(clips.isMotionNegative('no camera movement') && clips.isMotionNegative('no zoom') && clips.isMotionNegative('no slow push-in') && clips.isMotionNegative('no morphing'));
  assert.ok(!clips.isMotionNegative('no gore') && !clips.isMotionNegative('no glowing eyes') && !clips.isMotionNegative('no dirt on her face'));
  // a plain prompt (no blocks) is clipped at a clause boundary
  const plain: ScenePrompt = { sceneId: 'x', prompt: Array.from({ length: 60 }, (_, i) => `clause ${i} of the shot`).join(', '), negatives: ['no zoom', 'no gore'], refAssetIds: [], durationSec: 5, aspect: '16:9', audio: false };
  const s = clips.shortPrompt(plain);
  assert.ok(s.length <= clips.SHORT_MAX && s.endsWith(', no zoom') && !s.includes('no gore'), s);
});

test('sequence: prompt, refs, duration, clip record; needs >= 2 ids; final needs an approved sequence draft', async () => {
  const p = ready('Seq', { keyframes: ['s1', 's3'] });
  const ids = ['s3', 's1', 's2']; // out of order on purpose
  const prompt = clips.buildSequencePrompt(p, ids);
  assert.ok(prompt.startsWith('3 hard cuts, one continuous sequence, same location, same light: cut 1 (8s): '), prompt.slice(0, 90));
  assert.ok(prompt.includes('; cut 2 (5s): ') && prompt.includes('; cut 3 (5s): '));
  const cut1 = prompt.slice(prompt.indexOf('cut 1'), prompt.indexOf('; cut 2'));
  const s1 = FAKE_SCENES[0];
  for (const n of ['SHOT', 'PERFORM', 'PHYSICS', 'CAMERA']) assert.ok(cut1.includes(s1.blocks!.find((b) => b.name === n)!.text), `cut 1 carries ${n}`);
  for (const n of ['SUBJECT', 'IDENTITY', 'LOCATION']) assert.ok(!cut1.includes(s1.blocks!.find((b) => b.name === n)!.text), `cut 1 has no ${n}`);
  const afterCuts = prompt.slice(prompt.indexOf('; cut 3'));
  assert.ok(afterCuts.includes(s1.blocks!.find((b) => b.name === 'IDENTITY')!.text), 'IDENTITY once at the end');
  assert.equal(prompt.match(new RegExp(s1.blocks!.find((b) => b.name === 'GRADE')!.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))!.length, 1, 'GRADE deduped');
  assert.ok(prompt.includes('hard cuts not dissolves, no morphing between cuts'));
  for (const sp of [FAKE_SCENES[0], FAKE_SCENES[1], FAKE_SCENES[2]]) for (const n of sp.negatives) assert.ok(prompt.includes(n), n);
  assert.equal(prompt, clips.buildSequencePrompt(p, ids), 'deterministic');
  assert.throws(() => clips.buildSequencePrompt(p, ['s1']), /at least 2/);
  assert.throws(() => clips.buildSequencePrompt(p, ['s1', 'nope']), /no scene prompt for: nope/);

  const refs = clips.sequenceRefs(p, ids);
  const kf1 = p.keyframes!.find((k) => k.id === 'kf_s1_start')!.options[0].path;
  const kf3 = p.keyframes!.find((k) => k.id === 'kf_s3_start')!.options[0].path;
  assert.deepEqual(refs.slice(0, 2), [kf1, kf3], 'start keyframes first, in beat order');
  const file = (id: string) => { const a = p.assets.find((x) => x.id === id)!; return a.options[a.chosen!].path; };
  assert.deepEqual(refs.slice(2), [file('ilse_present_full'), file('fenna_present_full'), file('loc_barn')], 'then full-body sheets, then the location, deduped');
  assert.ok(refs.length <= 30);
  assert.equal(clips.sequenceDuration(p, ids), 18);
  assert.equal(clips.sequenceDuration(p, FAKE_SCENES.map((s) => s.sceneId)), 30, 'clamped to 30');

  await assert.rejects(clips.estimate(p, { sequence: true, ids: ['s1'] }), /at least 2 scene ids/);
  await assert.rejects(clips.estimate(p, { sequence: true }), /at least 2 scene ids/);
  const est = await clips.estimate(p, { sequence: true, ids });
  assert.equal(est.items.length, 1);
  assert.equal(est.items[0].id, 's1+s2+s3');
  assert.equal(est.items[0].model, models.SEEDANCE);
  assert.equal(est.items[0].usd, models.fakePrice(models.SEEDANCE, { resolution: '480p', duration: 18 }));
  assert.match(est.items[0].note!, /one take draft · 18s, 3 cuts/);

  const sent: any[] = [];
  const orig = clips.hooks.run;
  clips.hooks.run = (async (m: string, input: any, ro: any) => { sent.push(input); return orig(m, input, ro); }) as typeof orig;
  try { await runStage(p.slug, 'clips', { sequence: true, ids }, emit); } finally { clips.hooks.run = orig; }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].duration, 18);
  assert.equal(sent[0].prompt, prompt);
  assert.deepEqual(sent[0].image_urls, refs);
  assert.equal(sent[0].aspect_ratio, '16:9');
  let q = store.loadProject(p.slug);
  const seq = q.clips[0];
  assert.equal(seq.source, 'sequence');
  assert.equal(seq.sceneId, 's1');
  assert.deepEqual(seq.sceneIds, ['s1', 's2', 's3']);
  assert.equal(seq.mode, 'full');
  assert.equal(seq.model, models.SEEDANCE);
  assert.equal(seq.prompt, prompt);
  assert.equal(seq.status, 'done');

  // final tier: a per-scene approved draft is not enough; an approved sequence draft over the same ids is
  await assert.rejects(runStage(p.slug, 'clips', { sequence: true, ids, tier: 'final' }, emit), /final needs an approved draft of the same sequence/);
  await runStage(p.slug, 'clips', { ids: ['s1'] }, emit);
  store.approveClip(p.slug, store.loadProject(p.slug).clips.at(-1)!.id, true);
  await assert.rejects(runStage(p.slug, 'clips', { sequence: true, ids, tier: 'final' }, emit), /approved draft of the same sequence/);
  await assert.rejects(runStage(p.slug, 'clips', { ids: ['s2'], tier: 'final' }, emit), /Scene 2: final needs an approved draft/, 'a sequence draft does not stand in for a per-scene final');
  store.approveClip(p.slug, seq.id, true);
  await assert.rejects(runStage(p.slug, 'clips', { sequence: true, ids: ['s1', 's2'], tier: 'final' }, emit), /approved draft of the same sequence/, 'different ids');
  q = await runStage(p.slug, 'clips', { sequence: true, ids, tier: 'final' }, emit);
  const fin = q.clips.at(-1)!;
  assert.equal(fin.tier, 'final'); assert.equal(fin.resolution, '720p'); assert.deepEqual(fin.sceneIds, ['s1', 's2', 's3']);
  q = await runStage(p.slug, 'clips', { sequence: true, ids: ['s4', 's5'], tier: 'final', force: true }, emit);
  assert.deepEqual(q.clips.at(-1)!.sceneIds, ['s4', 's5']);
});

test('export: an approved sequence clip covers its beats; final sequence > final > draft sequence > draft', () => {
  const p = ready('Cover');
  const dir = store.mediaDir(p.slug, 'clips');
  let n = 0;
  const mk = (sceneId: string, tier: Clip['tier'], extra: Partial<Clip> = {}): Clip => {
    const file = path.join(dir, `c${++n}.mp4`);
    fs.writeFileSync(file, 'x');
    return { id: `c${n}`, sceneId, tier, model: 'm', resolution: '480p', status: 'done', approved: true, createdAt: `2026-01-0${n}`, file: { path: file }, ...extra };
  };
  p.clips = [
    mk('s1', 'draft'),
    mk('s2', 'draft'),
    mk('s1', 'draft', { source: 'sequence', sceneIds: ['s1', 's2', 's3'] }),
    mk('s4', 'final'),
    mk('s5', 'draft'),
    mk('s5', 'draft', { source: 'sequence', sceneIds: ['s5', 's6'], approved: false }), // not approved: ignored
    mk('s7', 'draft'),
    mk('s7', 'draft', { source: 'sequence', sceneIds: ['s7', 's8'] }),
    mk('s7', 'final'),                                                            // final per-scene beats a draft sequence
    mk('s9', 'final', { source: 'sequence', sceneIds: ['s9'] }),
  ];
  const picked = exp.pickClips(p, {});
  // s2/s3 are covered by the s1 sequence; the s7+s8 draft sequence loses to the s7 final and is only ever placed at s7, so s8 has nothing
  assert.deepEqual(picked.map((x) => [x.sceneId, x.clip.id]), [['s1', 'c3'], ['s4', 'c4'], ['s5', 'c5'], ['s7', 'c9'], ['s9', 'c10']]);
  assert.equal(picked[0].clip.source, 'sequence');
  // a final sequence beats a final per-scene at the same position and covers the next beat
  p.clips.push(mk('s4', 'final', { source: 'sequence', sceneIds: ['s4', 's5'] }));
  const again = exp.pickClips(p, {});
  assert.deepEqual(again.map((x) => x.sceneId), ['s1', 's4', 's7', 's9']);
  assert.deepEqual(again[1].clip.sceneIds, ['s4', 's5']);
  // ids filter: a sequence placed at a filtered-in beat still covers its others
  assert.deepEqual(exp.pickClips(p, { ids: ['s1', 's2'] }).map((x) => x.sceneId), ['s1']);
  assert.throws(() => exp.pickClips({ ...p, clips: [] }, {}), /nothing to export/);
});

test('scenes stage keeps endFrame across a rewrite and stores motion from the model', async () => {
  const p = ready('Keep End');
  p.scenePrompts![2].endFrame = true;
  store.saveProject(p);
  const q = await runStage(p.slug, 'scenes', {}, emit);
  assert.equal(q.scenePrompts![2].endFrame, true);
  assert.equal(q.scenePrompts![0].endFrame, undefined);
  assert.ok(q.scenePrompts!.every((sp) => typeof sp.motion === 'string' && sp.motion.length > 50));
});
