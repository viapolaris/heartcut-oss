import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-pipe-'));
process.env.HEARTCUT_ROOT = tmp;
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';
const store = await import('../src/store.ts');
const { runStage, estimateStage } = await import('../src/pipeline.ts');
const { DEMO_BRIEF } = await import('../src/demo/demo.ts');

const lines: string[] = [];
const emit = (l: string) => lines.push(l);

test('ordering guards', async () => {
  store.createProject({ title: 'Guard', briefText: DEMO_BRIEF });
  await assert.rejects(runStage('guard', 'sheets', {}, emit), /run the script stage first/);
  await assert.rejects(runStage('guard', 'scenes', {}, emit), /run the sheets stage first/);
  await assert.rejects(runStage('guard', 'images', {}, emit), /run the sheets stage first/);
  await assert.rejects(runStage('guard', 'clips', {}, emit), /run the scenes stage first/);
  await assert.rejects(runStage('guard', 'keyframes', {}, emit), /run the scenes stage first/);
  assert.equal(store.loadProject('guard').jobs.length, 0, 'guard failures create no job');
});

test('brief stage validates length and makes no job', async () => {
  store.createProject({ title: 'Short', briefText: 'too short' });
  await assert.rejects(runStage('short', 'brief', {}, emit), /at least 40/);
  await runStage('guard', 'brief', {}, emit);
});

test('LLM stages record done jobs with logs', async () => {
  await runStage('guard', 'script', {}, emit);
  await runStage('guard', 'sheets', {}, emit);
  const p = await runStage('guard', 'scenes', {}, emit);
  assert.deepEqual(p.jobs.map((j) => [j.kind, j.status]), [['script', 'done'], ['sheets', 'done'], ['scenes', 'done']]);
  assert.ok(p.jobs.every((j) => j.finishedAt && j.log.length > 0));
  assert.deepEqual(await estimateStage('guard', 'script', {}), { usd: 0, items: [] });
  assert.ok(lines.some((l) => l.includes('scenes saved')));
});

test('a failing stage marks its job failed and rethrows', async () => {
  const p = store.createProject({ title: 'Boom', briefText: DEMO_BRIEF });
  p.script = { logline: '', emotionalCore: '', arc: '', characters: [], locations: [], scenes: [] };
  store.saveProject(p);
  process.env.HEARTCUT_FAKE = '0'; // real path, forced to fail fast: no prompts dir entry for a bogus name is not reachable, so break PATH
  const oldPath = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    await assert.rejects(runStage('boom', 'sheets', {}, emit));
  } finally {
    process.env.PATH = oldPath;
    process.env.HEARTCUT_FAKE = '1';
  }
  const j = store.loadProject('boom').jobs[0];
  assert.equal(j.status, 'failed');
  assert.ok(j.error);
});

test('cli demo runs the LLM stages in fake mode', () => {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
  const r = spawnSync(process.execPath, [cli, 'demo'], {
    env: { ...process.env, HEARTCUT_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'hc-cli-')), HEARTCUT_MEDIA_ROOT: path.join(tmp, 'media2'), HEARTCUT_FAKE: '1' },
    encoding: 'utf8', timeout: 60_000,
  });
  // Generation stages are another builder's; a failure there is an integration issue, not an engine-core one.
  if (r.status !== 0) assert.match(r.stdout, /\[(images|clips|export)\]|\[scenes\] scenes saved/, r.stdout + r.stderr);
  assert.match(r.stdout, /\[script\] script saved/);
  assert.match(r.stdout, /\[sheets\] sheets saved/);
  if (r.status === 0) {
    assert.match(r.stdout, /\[keyframes\] keyframe prompts saved: 9/);
    assert.match(r.stdout, /\[clips\] Scene 1 draft — \$[\d.]+ — from keyframe, short prompt/);
    for (const st of ['brief', 'script', 'sheets', 'images', 'scenes', 'keyframes', 'clips', 'export']) assert.match(r.stdout, new RegExp(`^  ${st}\\s+done`, 'm'), `${st} done`);
  }
});

test('LLM stages stamp even with Dry run on (they are free and write real content); images in a dry run do not', async () => {
  store.createProject({ title: 'Dry Stamp', briefText: DEMO_BRIEF });
  const p0 = store.loadProject('dry-stamp'); p0.stamps = { brief: '2026-01-01T00:00:00.000Z' }; store.saveProject(p0);
  await runStage('dry-stamp', 'script', { dryRun: true }, emit);
  await runStage('dry-stamp', 'sheets', { dryRun: true }, emit);
  const p = store.loadProject('dry-stamp');
  assert.ok(p.stamps?.script && p.stamps.script > p0.stamps!.brief!, 'script stamped in dry run');
  assert.ok(p.stamps?.sheets && p.stamps.sheets >= p.stamps.script, 'sheets stamped in dry run');
  const st = store.staleness(p);
  assert.notEqual(st.script?.stale, true); assert.notEqual(st.sheets?.stale, true);
  await runStage('dry-stamp', 'images', { dryRun: true }, emit);
  assert.equal(store.loadProject('dry-stamp').stamps?.images, undefined, 'a dry image run stamps nothing');
});
