import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-stale-'));
process.env.HEARTCUT_ROOT = tmp;
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';
const store = await import('../src/store.ts');
const { runStage } = await import('../src/pipeline.ts');
const { seedProject } = await import('./fixtures/seed.ts');

const t = (n: number) => new Date(Date.UTC(2026, 9, 11, 12, 0, n)).toISOString();

test('staleness: only stages with content are reported, downstream of a newer stage is stale', () => {
  const p = seedProject(store, 'Order');
  p.createdAt = t(0);
  p.stamps = { script: t(10), sheets: t(20), images: t(30) };
  assert.deepEqual(store.staleness(p), { brief: { stale: false }, script: { stale: false }, sheets: { stale: false }, images: { stale: false } });
  assert.equal(store.staleCount(p), 0);

  p.stamps.script = t(35); // script edited after sheets and images were made
  const s = store.staleness(p);
  assert.deepEqual(s.sheets, { stale: true, because: 'script' });
  assert.deepEqual(s.images, { stale: true, because: 'script' });
  assert.deepEqual(s.script, { stale: false });
  assert.equal(s.scenes, undefined, 'no scenePrompts, so no entry');
  assert.equal(store.staleCount(p), 2);

  p.stamps.sheets = t(40); // sheets regenerated; images now only stale because of sheets
  assert.deepEqual(store.staleness(p).images, { stale: true, because: 'sheets' });
  p.stamps.images = t(50);
  assert.equal(store.staleCount(p), 0);
});

test('staleness: scenes -> clips -> export chain, and a missing stamp means createdAt', () => {
  const p = seedProject(store, 'Chain');
  p.createdAt = t(0);
  p.scenePrompts = [];
  p.clips = [{ id: 'c1', sceneId: 's1', tier: 'draft', model: 'm', resolution: '480p', status: 'done', approved: false, createdAt: t(0) }];
  p.exports = [{ file: { path: '/x.mp4' }, resolution: '1080p', sceneOrder: [], createdAt: t(0) }];
  // Legacy project: no stamps at all -> nothing is stale.
  assert.equal(store.staleCount(p), 0);
  p.stamps = { images: t(5) }; // pick changed; scenes/clips/export have no stamp (= createdAt)
  const s = store.staleness(p);
  assert.deepEqual(s.scenes, { stale: true, because: 'images' });
  assert.deepEqual(s.clips, { stale: true, because: 'images' });
  assert.deepEqual(s.export, { stale: true, because: 'images' });
  p.stamps.scenes = t(6);
  assert.deepEqual(store.staleness(p).clips, { stale: true, because: 'scenes' });
  assert.deepEqual(store.staleness(p).scenes, { stale: false });
});

test('keepStage acknowledges upstream change; chooseAsset / approveClip / runStage stamp', async () => {
  const p = seedProject(store, 'Stamps');
  assert.equal(p.stamps, undefined);
  await new Promise((r) => setTimeout(r, 5));
  store.chooseAsset(p.slug, p.assets[0].id, 1);
  assert.ok(store.loadProject(p.slug).stamps!.images);

  // runStage success stamps that stage
  const q = store.createProject({ title: 'Run', briefText: (await import('../src/demo/demo.ts')).DEMO_BRIEF });
  await runStage(q.slug, 'script', {}, () => {});
  await new Promise((r) => setTimeout(r, 5));
  await runStage(q.slug, 'sheets', {}, () => {});
  let l = store.loadProject(q.slug);
  assert.ok(l.stamps!.script && l.stamps!.sheets && l.stamps!.sheets > l.stamps!.script);
  assert.equal(store.staleCount(l), 0);
  await new Promise((r) => setTimeout(r, 5));
  await runStage(q.slug, 'script', {}, () => {}); // re-running script makes sheets stale
  l = store.loadProject(q.slug);
  assert.deepEqual(store.staleness(l).sheets, { stale: true, because: 'script' });
  await new Promise((r) => setTimeout(r, 5));
  store.keepStage(q.slug, 'sheets');
  assert.deepEqual(store.staleness(store.loadProject(q.slug)).sheets, { stale: false });
});

test('staleness: keyframes sit between scenes and clips', () => {
  const p = seedProject(store, 'Kf Order');
  p.createdAt = t(0);
  p.scenePrompts = [];
  p.keyframes = [{ id: 'kf_s1_start', sceneId: 's1', role: 'start', prompt: 'x', negatives: [], refAssetIds: [], model: 'm', options: [] }];
  p.clips = [{ id: 'c1', sceneId: 's1', tier: 'draft', model: 'm', resolution: '480p', status: 'done', approved: false, createdAt: t(0) }];
  p.stamps = { scenes: t(1), keyframes: t(2), clips: t(3) };
  assert.equal(store.staleCount(p), 0);
  p.stamps.scenes = t(5);
  let s = store.staleness(p);
  assert.deepEqual(s.keyframes, { stale: true, because: 'scenes' });
  assert.deepEqual(s.clips, { stale: true, because: 'scenes' });
  p.stamps.keyframes = t(6); // keyframes re-picked: clips now stale because of keyframes
  s = store.staleness(p);
  assert.deepEqual(s.keyframes, { stale: false });
  assert.deepEqual(s.clips, { stale: true, because: 'keyframes' });
  p.keyframes = [];
  assert.equal(store.staleness(p).keyframes, undefined, 'no keyframes, no entry');
});
