// {{char:id}} / {{loc:id}} are Heartcut's own sheet links. They stay in the stored text and never reach a picture or
// video model as text: every input builder strips them, and the provider layer strips them again as a safety net.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-reftags-'));
process.env.HEARTCUT_ROOT = tmp;
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';
const store = await import('../src/store.ts');
const clips = await import('../src/stages/clips.ts');
const keyframes = await import('../src/stages/keyframes.ts');
const models = await import('../src/gen/models.ts');
const { runStage } = await import('../src/pipeline.ts');
const { seedProject } = await import('./fixtures/seed.ts');
const { FAKE_SCENES } = await import('../src/demo/demo.ts');

const emit = () => {};
const TAG = /\{\{(char|loc):/;

test('stripRefTags removes the tags and tidies the gaps they leave', () => {
  assert.equal(models.stripRefTags('an old woman {{char:ilse}} standing in the door {{loc:barn}}, a rope'), 'an old woman standing in the door, a rope');
  assert.equal(models.stripRefTags('a red apple {{loc:barn}}, toward a hoof {{char:fenna}}'), 'a red apple, toward a hoof');
  assert.equal(models.stripRefTags('no tags here, at all'), 'no tags here, at all');
  assert.deepEqual(models.withoutRefTags({ prompt: 'a {{char:x}} b', n: 1 }), { prompt: 'a b', n: 1 });
});

test('demo scene prompts carry tags (so this test means something)', () => {
  assert.ok(FAKE_SCENES.some((sp) => TAG.test(sp.prompt)));
});

test('builders: sheet, video and keyframe inputs never carry a tag', () => {
  const sp = FAKE_SCENES[0];
  assert.ok(!TAG.test(String(models.buildVideoInput(sp, [], 'draft').prompt)));
  assert.ok(!TAG.test(String(models.buildVideoInput(sp, [], 'draft', { prompt: sp.prompt, startImage: '/x.png' }).prompt)));
  assert.ok(!TAG.test(String(models.buildSheetInput('{{char:odran}} full body shot', { aspect: '16:9' }).prompt)));
  const p = seedProject(store, 'Tags builders');
  assert.ok(!TAG.test(String(keyframes.buildKeyframeInput(p, sp.prompt, []).prompt)));
});

test('clips stage: what is sent has no tag, the stored scene prompt keeps its tags', async () => {
  const p = seedProject(store, 'Tags clips');
  p.scenePrompts = structuredClone(FAKE_SCENES);
  store.saveProject(p);
  const sent: any[] = [];
  const orig = clips.hooks.run;
  clips.hooks.run = (async (m: string, input: any, ro: any) => { sent.push(input); return orig(m, input, ro); }) as typeof orig;
  try {
    await runStage(p.slug, 'clips', { ids: ['s1', 's2'], promptMode: 'full' }, emit);
    await runStage(p.slug, 'clips', { sequence: true, ids: ['s1', 's2'] }, emit);
  } finally { clips.hooks.run = orig; }
  assert.ok(sent.length >= 3, `sent ${sent.length}`);
  for (const i of sent) assert.ok(!TAG.test(String(i.prompt)), String(i.prompt).slice(0, 200));
  const q = store.loadProject(p.slug);
  assert.ok(TAG.test(q.scenePrompts!.find((x) => x.sceneId === 's1')!.prompt), 'stored text unchanged');
});
