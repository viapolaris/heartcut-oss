import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-gen-'));
process.env.HEARTCUT_FAKE = '1';
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');

const models = await import('../src/gen/models.ts');
const hf = await import('../src/gen/higgsfield.ts');
const images = await import('../src/stages/images.ts');
const clips = await import('../src/stages/clips.ts');
const { addJob, updateJob } = await import('../src/store.ts');
import type { Project, ScenePrompt } from '../src/types.ts';

function fixture(): Project {
  const selfie = path.join(tmp, 'selfie.png');
  fs.writeFileSync(selfie, Buffer.from('x'));
  const sp: ScenePrompt = { sceneId: 's1', prompt: 'Shot. Action. no zoom', negatives: ['no zoom'], refAssetIds: ['loc1', 'ch1_full'], durationSec: 5, aspect: '16:9', audio: true };
  return {
    id: 'prj_t', slug: 'demo', title: 'Demo', owner: 'viaPolaris', aspect: '16:9', createdAt: '', updatedAt: '',
    brief: { text: 'b', refs: [{ id: 'ref_1', role: 'selfie', path: selfie }] },
    script: {
      logline: '', emotionalCore: '', arc: '',
      characters: [{ id: 'ch1', name: 'A', species: 'human', baseDescription: '', wardrobe: '', states: [], identityRefId: 'ref_1' }],
      locations: [{ id: 'loc1', name: 'L', description: '', lighting: '', cameraPackage: '', palette: '' }],
      scenes: [{ id: 's1', order: 1, title: 't', era: 'present', characters: [], locationId: 'loc1', cameraSimple: '', actionSimple: '', mood: '', durationSec: 5 }],
    },
    sheets: { items: [
      { id: 'ch1_full', kind: 'character-full', characterId: 'ch1', prompt: '[identity: ref] full body, white cyc' },
      { id: 'loc1', kind: 'location', locationId: 'loc1', prompt: 'ruined hall' },
    ] },
    assets: [], scenePrompts: [sp], clips: [], exports: [], jobs: [], approvals: {},
  };
}

test('models build exact inputs', () => {
  assert.equal(models.sheetModel('character-portrait', false), 'higgsfield-ai/soul/v2/standard');
  assert.equal(models.sheetModel('character-full', true), 'alibaba/qwen-image-3/edit');
  assert.equal(models.sheetModel('location', true), 'higgsfield-ai/soul/cinema');
  assert.deepEqual(models.buildSheetInput('p', { aspect: '21:9' }),
    { prompt: 'p', resolution: '1080p', aspect_ratio: '16:9', batch_size: 4, enhance_prompt: false });
  assert.deepEqual(models.buildSheetInput('p', { aspect: '3:4', identityRefPath: '/x.png' }), { prompt: 'p', image_urls: ['/x.png'] });
  const sp: ScenePrompt = { sceneId: 's', prompt: 'go', negatives: [], refAssetIds: [], durationSec: 5.4, aspect: '9:16', audio: true };
  assert.deepEqual(models.buildVideoInput(sp, ['/a.png', '/b.png'], 'draft'),
    { prompt: 'go', resolution: '480p', duration: 5, aspect_ratio: '9:16', generate_audio: false, image_urls: ['/a.png', '/b.png'], output_format: 'mp4' });
  assert.equal(models.buildVideoInput(sp, [], 'final').generate_audio, true);
  assert.equal(models.buildVideoInput(sp, [], 'final').resolution, '720p');
  assert.equal(models.fakePrice(models.SEEDANCE, { resolution: '720p', duration: 5 }), 2.311);
});

test('fake higgsfield run writes 4 files under mediaDir', async () => {
  const r = await hf.run(models.SOUL, { batch_size: 4 }, { project: 'demo', name: 'x' });
  assert.equal(r.files.length, 4);
  for (const f of r.files) { assert.ok(fs.existsSync(f)); assert.ok(f.startsWith(path.join(tmp, 'media', 'demo', 'assets'))); }
  assert.deepEqual(await hf.spend(), { sittingUsd: 0, capUsd: 5, remainingUsd: 5 });
  const dry = await hf.run(models.SOUL, { batch_size: 4 }, { project: 'demo', name: 'y', dryRun: true });
  assert.deepEqual(dry.files, []);
});

test('images stage: routing, options, skip, dry run, job log', async () => {
  const p = fixture();
  const est = await images.estimate(p, {});
  assert.equal(est.items.length, 2);
  assert.equal(est.items[0].model, 'alibaba/qwen-image-3/edit');
  assert.equal(est.items[1].model, 'higgsfield-ai/soul/cinema');

  await images.run(p, { dryRun: true }, () => {});
  assert.equal(p.assets.length, 0);

  const job = addJob(p, { projectSlug: p.slug, kind: 'image', stage: 'images' });
  updateJob(p, job.id, { status: 'running' });
  const lines: string[] = [];
  await images.run(p, {}, (l) => lines.push(l));
  const ch = p.assets.find((a) => a.id === 'ch1_full')!;
  assert.equal(ch.options.length, 1);
  assert.equal(ch.model, 'alibaba/qwen-image-3/edit');
  assert.equal(p.assets.find((a) => a.id === 'loc1')!.options.length, 4);
  assert.ok(lines.length > 0 && job.outputs.length === 5 && job.actualUsd! > 0);
  assert.ok(lines.some((l) => l.includes('estimate')));

  const before = p.assets.length;
  const again: string[] = [];
  await images.run(p, {}, (l) => again.push(l));
  assert.ok(again.every((l) => l.startsWith('skip')));
  assert.equal(p.assets.length, before);
});

test('clips stage: unchosen refuses, draft ok, final needs approved draft', async () => {
  const p = fixture();
  await images.run(p, {}, () => {});
  await assert.rejects(clips.run(p, {}, () => {}), /no chosen option/);
  assert.equal(p.clips.length, 0);
  for (const a of p.assets) a.chosen = 0;

  const lines: string[] = [];
  await clips.run(p, {}, (l) => lines.push(l));
  assert.equal(p.clips.length, 1);
  assert.equal(p.clips[0].status, 'done');
  assert.equal(p.clips[0].resolution, '480p');
  assert.ok(fs.existsSync(p.clips[0].file!.path));
  assert.ok(lines.some((l) => /^Scene 1 draft — \$\d/.test(l)));

  await assert.rejects(clips.run(p, { tier: 'final' }, () => {}), /approved draft/);
  p.clips[0].approved = true;
  await clips.run(p, { tier: 'final' }, () => {});
  assert.equal(p.clips.length, 2);
  assert.equal(p.clips[1].resolution, '720p');
  const est = await clips.estimate(p, { tier: 'final' });
  assert.equal(est.items[0].usd, 2.311);
});

// --- parallel variants (drawn styles route to qwen t2i: no batch field, 4 calls per sheet) ---
const { getStyle } = await import('../src/styles.ts');
function drawn(): Project {
  const p = fixture();
  p.style = getStyle('anime-2d')!;
  p.sheets = { items: [{ id: 'loc1', kind: 'location', locationId: 'loc1', prompt: 'ruined hall' }] };
  return p;
}
async function withRunner(fn: (name: string, o: any, model: string) => Promise<void>, body: () => Promise<void>) {
  const orig = images.hooks.run;
  images.resetConcurrencyFallback();
  images.hooks.run = (async (m: string, i: object, o: any) => { await fn(o.name, o, m); return orig(m, i, o); }) as typeof hf.run;
  try { await body(); } finally { images.hooks.run = orig; images.resetConcurrencyFallback(); }
}

test('images: 4-call sheet submits variants concurrently into 4 options', async () => {
  const p = drawn();
  assert.equal(models.callsPerSheet(models.QWEN_T2I), 4);
  const names: string[] = [];
  let live = 0, peak = 0;
  const lines: string[] = [];
  await withRunner(async (n) => { names.push(n); live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live--; },
    async () => { await images.run(p, {}, (l) => lines.push(l)); });
  assert.deepEqual([...names].sort(), ['loc1-v1', 'loc1-v2', 'loc1-v3', 'loc1-v4']);
  assert.equal(peak, 4);
  assert.equal(p.assets[0].options.length, 4);
  assert.ok(lines.some((l) => /sheet 1\/1 · loc1 · variant 4\/4 done/.test(l)), lines.join('\n'));
});

test('images: HEARTCUT_GEN_CONCURRENCY caps in-flight submits', async () => {
  process.env.HEARTCUT_GEN_CONCURRENCY = '2';
  try {
    let live = 0, peak = 0;
    const p = drawn();
    await withRunner(async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 10)); live--; },
      async () => { await images.run(p, {}, () => {}); });
    assert.equal(peak, 2);
    assert.equal(p.assets[0].options.length, 4);
  } finally { delete process.env.HEARTCUT_GEN_CONCURRENCY; }
});

test('images: a failed variant keeps the others on the asset and rethrows', async () => {
  const p = drawn();
  const lines: string[] = [];
  await withRunner(async (n) => { if (n === 'loc1-v3') throw new Error('higgsfield run failed (exit 1): boom'); }, async () => {
    await assert.rejects(images.run(p, {}, (l) => lines.push(l)), /boom/);
  });
  const a = p.assets.find((x) => x.id === 'loc1')!;
  assert.deepEqual(a.options.map((o) => path.basename(o.path)), ['loc1-v1-1.png', 'loc1-v2-1.png', 'loc1-v4-1.png']);
  assert.ok((a.costUsd ?? 0) > 0);
  assert.ok(lines.some((l) => l === '3 of 4 variants done for loc1'), lines.join('\n'));
});

test('images: a concurrency refusal flips to sequential, for this sheet and the next', async () => {
  const p = drawn();
  p.sheets = { items: [
    { id: 'loc1', kind: 'location', locationId: 'loc1', prompt: 'ruined hall' },
    { id: 'loc2', kind: 'location', locationId: 'loc1', prompt: 'ruined yard' },
  ] };
  let live = 0, peak2 = 0, refused = false;
  const lines: string[] = [];
  await withRunner(async (n) => {
    if (n === 'loc1-v2' && !refused) { refused = true; throw new Error('higgsfield run failed (exit 1): HTTP 400 too many concurrent requests'); }
    live++; if (n.startsWith('loc2')) peak2 = Math.max(peak2, live);
    await new Promise((r) => setTimeout(r, 10)); live--;
  }, async () => { await images.run(p, {}, (l) => lines.push(l)); });
  assert.equal(p.assets.length, 2);
  for (const a of p.assets) assert.equal(a.options.length, 4);
  assert.equal(peak2, 1, 'second sheet ran one at a time');
  assert.equal(lines.filter((l) => /refused parallel submits/.test(l)).length, 1);
  assert.ok(images.isRateLimit(new Error('429 Too Many Requests')) && !images.isRateLimit(new Error('boom')));
});

const UNAVAILABLE = 'higgsfield run failed (exit 1): status: failed after 3s higgsfield: generation failed: "This model is temporarily unavailable. Please try again later or contact support." (not charged for failed/nsfw)';

test('images: an unavailable model falls back for that variant only, and the source records it', async () => {
  const p = drawn();
  const lines: string[] = [];
  await withRunner(async (n, _o, m) => { if (n === 'loc1-v2' && m === models.QWEN_T2I) throw new Error(UNAVAILABLE); },
    async () => { await images.run(p, {}, (l) => lines.push(l)); });
  const a = p.assets[0];
  assert.equal(a.options.length, 4);
  assert.equal(a.model, models.QWEN_T2I);
  assert.equal(a.sources![1].kind === 'generated' && a.sources![1].model, models.Z_IMAGE);
  assert.equal(a.sources![0].kind === 'generated' && a.sources![0].model, models.QWEN_T2I);
  assert.ok(lines.some((l) => l === `qwen unavailable — variant 2 on ${models.Z_IMAGE} instead`), lines.join('\n'));
  assert.deepEqual(models.FALLBACK[models.RECRAFT], models.QWEN_T2I);
});

test('images: a timeout does not fall back', async () => {
  const p = drawn();
  const seen: string[] = [];
  await withRunner(async (n, _o, m) => { seen.push(m); if (n === 'loc1-v2') throw new Error('heartcut: gave up after 1200s - the request may still finish'); }, async () => {
    await assert.rejects(images.run(p, {}, () => {}), /gave up after/);
  });
  assert.ok(!seen.includes(models.Z_IMAGE));
  assert.equal(models.isModelUnavailable(new Error('gave up after 1200s')), false);
});

test('images: Soul has no fallback, an unavailable error rethrows', async () => {
  const p = fixture();
  p.sheets = { items: [{ id: 'loc1', kind: 'location', locationId: 'loc1', prompt: 'ruined hall' }] };
  assert.equal(models.FALLBACK[models.SOUL], undefined);
  await withRunner(async () => { throw new Error(UNAVAILABLE); }, async () => {
    await assert.rejects(images.run(p, {}, () => {}), /temporarily unavailable/);
  });
  assert.equal(p.assets.length, 0);
});

test('failHeadline names the actionable Higgsfield failures', async () => {
  const { failHeadline } = await import('../src/gen/higgsfield.ts');
  assert.match(failHeadline('uploaded x.jpeg\nhiggsfield: POST /alibaba/qwen-image-3/edit -> 403 insufficient credits - top up at open.higgsfield.ai\n{"detail":"not_enough_credits"}')!, /out of credits/);
  assert.match(failHeadline('higgsfield: POST /x -> 500 internal error')!, /^Higgsfield said 500 internal error/);
  assert.equal(failHeadline('uploaded x.jpeg'), undefined);
});
