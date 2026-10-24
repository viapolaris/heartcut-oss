import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-store-'));
process.env.HEARTCUT_ROOT = tmp;
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
const store = await import('../src/store.ts');

test('create, load, save, list', () => {
  const p = store.createProject({ title: 'Hello World!', briefText: 'x'.repeat(50) });
  assert.equal(p.slug, 'hello-world');
  assert.equal(p.aspect, '16:9');
  assert.throws(() => store.createProject({ title: 'Hello World!', briefText: 'again' }), /exists/);
  const before = p.updatedAt;
  p.title = 'Changed';
  store.saveProject(p);
  const again = store.loadProject('hello-world');
  assert.equal(again.title, 'Changed');
  assert.ok(again.updatedAt >= before);
  assert.equal(store.listProjects().length, 1);
  assert.throws(() => store.loadProject('nope'), /no project/);
  assert.throws(() => store.loadProject('../etc'), /bad slug/);
});

test('addRef writes the file and records it', () => {
  store.createProject({ title: 'Refs', briefText: 'x'.repeat(50) });
  const r = store.addRef('refs', { role: 'selfie', filename: 'me face.png', bytes: Buffer.from('png'), forCharacterId: 'ilse' });
  assert.ok(fs.existsSync(r.path));
  assert.match(path.basename(r.path), /^ref_[0-9a-f]+-me_face\.png$/);
  const m = store.addRef('refs', { role: 'music', filename: 'a.mp3', bytes: Buffer.from('x') });
  const p = store.loadProject('refs');
  assert.equal(p.brief.refs.length, 2);
  assert.equal(p.brief.musicPath, m.path);
});

test('addJob / updateJob and media dirs', () => {
  const p = store.createProject({ title: 'Jobs', briefText: 'x'.repeat(50) });
  const j = store.addJob(p, { kind: 'script', stage: 'script' });
  assert.equal(j.status, 'queued');
  assert.match(j.id, /^job_/);
  store.updateJob(p, j.id, { status: 'done' });
  assert.equal(p.jobs[0].status, 'done');
  assert.throws(() => store.updateJob(p, 'job_x', {}), /no job/);
  assert.ok(fs.statSync(store.mediaDir('jobs', 'clips')).isDirectory());
});

test('chooseAsset and approveClip validate ids', () => {
  const p = store.createProject({ title: 'Pick', briefText: 'x'.repeat(50) });
  p.assets.push({ id: 'a1', kind: 'location', prompt: '', model: 'm', options: [{ path: 'a' }, { path: 'b' }] });
  p.clips.push({ id: 'c1', sceneId: 's1', tier: 'draft', model: 'm', resolution: '480p', status: 'done', approved: false, createdAt: '' });
  store.saveProject(p);
  assert.equal(store.chooseAsset('pick', 'a1', 1).assets[0].chosen, 1);
  assert.throws(() => store.chooseAsset('pick', 'a1', 5), /out of range/);
  assert.equal(store.approveClip('pick', 'c1', true).clips[0].approved, true);
});

test('chooseAsset(null) unpicks; removeOption fixes chosen, sources, and only deletes this project\'s own files', () => {
  const p = store.createProject({ title: 'Rm', briefText: 'x'.repeat(50) });
  const own = (n: string) => { const f = path.join(store.mediaDir('rm', 'assets'), n); fs.writeFileSync(f, 'x'); return f; };
  const elsewhere = path.join(tmp, 'other-project-original.png');
  fs.writeFileSync(elsewhere, 'x');
  const files = [own('a.png'), own('b.png'), elsewhere, own('c.png')];
  p.assets.push({ id: 'a1', kind: 'location', prompt: '', model: 'm', options: files.map((f) => ({ path: f })), chosen: 2,
    sources: [{ kind: 'generated' }, { kind: 'generated' }, { kind: 'library' } as any, { kind: 'generated' }] });
  store.saveProject(p);
  assert.equal(store.chooseAsset('rm', 'a1', null).assets[0].chosen, undefined);
  store.chooseAsset('rm', 'a1', 2);
  // remove a lower index: chosen shifts down, source entry goes with it, file deleted
  let q = store.removeOption('rm', 'a1', 0);
  assert.equal(q.assets[0].chosen, 1);
  assert.equal(q.assets[0].options.length, 3);
  assert.equal(q.assets[0].sources!.length, 3);
  assert.equal(q.assets[0].sources![1].kind, 'library');
  assert.ok(!fs.existsSync(files[0]));
  // remove the chosen one (a file outside this project's media dir): chosen cleared, file kept
  q = store.removeOption('rm', 'a1', 1);
  assert.equal(q.assets[0].chosen, undefined);
  assert.ok(fs.existsSync(elsewhere));
  // remove a higher index: chosen unchanged
  store.chooseAsset('rm', 'a1', 0);
  q = store.removeOption('rm', 'a1', 1);
  assert.equal(q.assets[0].chosen, 0);
  assert.ok(!fs.existsSync(files[3]));
  assert.throws(() => store.removeOption('rm', 'a1', 5), /out of range/);
  assert.throws(() => store.removeOption('rm', 'nope', 0), /no asset/);
});
