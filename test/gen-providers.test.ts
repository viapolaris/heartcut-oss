// Generation provider layer: request shapes per provider and capability, polling, no resubmit after a timeout, the
// spending cap and its reserve, provider selection precedence, keys never in /api/settings, local worker missing.
// No network: globalThis.fetch is replaced by a router for every test.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-gen-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_ENV_FILE = path.join(tmp, 'no.env');
const KEYS = ['HEARTCUT_GEN_PROVIDER', 'HEARTCUT_HIGGSFIELD_TOOL', 'HEARTCUT_SPEND_CAP', 'HEARTCUT_VIDEO_RESERVE', 'FAL_KEY', 'REPLICATE_API_TOKEN', 'HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET', 'HEARTCUT_LOCAL_WORKER', 'HEARTCUT_LOCAL_PYTHON'];
for (const k of KEYS) delete process.env[k];
delete process.env.HEARTCUT_FAKE;

const gen = await import('../src/gen/provider.ts');
const cfg = await import('../src/gen/config.ts');
const spend = await import('../src/gen/spend.ts');
const { httpHooks } = await import('../src/gen/http.ts');
const models = await import('../src/gen/models.ts');
const { saveSettings } = await import('../src/settings.ts');
const { getGenStatus } = await import('../src/gen/status.ts');
const local = await import('../src/gen/local.ts');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photo = path.join(tmp, 'face.png');
fs.writeFileSync(photo, PNG);

const FAL = 'fal-secret-test-value-123';
const REP = 'r8_secret-test-value-456';
const HFK = 'hf-key-id-789';
const HFS = 'hf-secret-value-000';

type Sent = { method: string; url: string; headers: Record<string, string>; body: any; raw: any };
let sent: Sent[] = [];
type Route = (s: Sent) => Response | Promise<Response>;
let routes: [RegExp, Route][] = [];
const realFetch = globalThis.fetch;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const png = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
const mp4 = () => new Response(Buffer.from('fake-mp4-bytes'), { status: 200, headers: { 'content-type': 'video/mp4' } });

let clock = 1_000_000;
beforeEach(() => {
  sent = []; routes = []; clock = 1_000_000;
  for (const k of KEYS) delete process.env[k];
  delete process.env.HEARTCUT_FAKE;
  saveSettings({ gen: null });
  spend.clearLedger();
  cfg.genHooks.toolExists = () => false;
  httpHooks.sleep = async () => { clock += 2000; };
  httpHooks.now = () => clock;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
    let body: any = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* raw */ } }
    const s: Sent = { method: init.method ?? 'GET', url, headers, body, raw: init.body };
    sent.push(s);
    const r = routes.find(([re]) => re.test(`${s.method} ${url}`));
    if (!r) throw new Error(`unrouted fetch ${s.method} ${url}`);
    return r[1](s);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const opts = (name: string) => ({ project: 'demo', name, sub: 'assets' as const });
const submits = (re: RegExp) => sent.filter((s) => s.method === 'POST' && re.test(s.url));

// ---------- selection precedence ----------

test('selection: saved > HEARTCUT_GEN_PROVIDER > auto (tool, then first key found) > none', () => {
  const env = { FAL_KEY: 'x', REPLICATE_API_TOKEN: 'y' } as NodeJS.ProcessEnv;
  assert.equal(cfg.resolveGen(undefined, undefined, {} as NodeJS.ProcessEnv).provider, null);
  assert.equal(cfg.resolveGen(undefined, undefined, {} as NodeJS.ProcessEnv).ready, false);
  assert.match(cfg.resolveGen(undefined, undefined, {} as NodeJS.ProcessEnv).problem!, /FAL_KEY, REPLICATE_API_TOKEN or HIGGSFIELD_API_KEY/);
  assert.equal(cfg.resolveGen(undefined, undefined, env).provider, 'fal', 'first key found');
  assert.equal(cfg.resolveGen(undefined, undefined, { REPLICATE_API_TOKEN: 'y' } as NodeJS.ProcessEnv).provider, 'replicate');
  assert.equal(cfg.resolveGen(undefined, undefined, { ...env, HEARTCUT_GEN_PROVIDER: 'replicate' }).provider, 'replicate', 'env beats auto');
  assert.equal(cfg.resolveGen(undefined, undefined, { ...env, HEARTCUT_GEN_PROVIDER: 'replicate' }).source, 'env');
  assert.equal(cfg.resolveGen({ provider: 'fal' }, undefined, { ...env, HEARTCUT_GEN_PROVIDER: 'replicate' }).provider, 'fal', 'saved beats env');
  cfg.genHooks.toolExists = (e) => !!e?.HEARTCUT_HIGGSFIELD_TOOL;
  const tool = { ...env, HEARTCUT_HIGGSFIELD_TOOL: '/x/tool.mjs' } as NodeJS.ProcessEnv;
  assert.equal(cfg.resolveGen(undefined, undefined, tool).provider, 'higgsfield-tool', 'the CLI tool wins auto when set');
  assert.equal(cfg.resolveGen(undefined, undefined, tool).ready, true);
  assert.equal(cfg.higgsfieldToolPath({} as NodeJS.ProcessEnv), '', 'no built-in tool path');
  // a saved provider with no key is not ready, and says which variable to set
  const r = cfg.resolveGen({ provider: 'replicate' }, undefined, {} as NodeJS.ProcessEnv);
  assert.equal(r.ready, false); assert.equal(r.keyEnv, 'REPLICATE_API_TOKEN'); assert.match(r.problem!, /REPLICATE_API_TOKEN is not set/);
  // Higgsfield needs the id and the secret, or id:secret
  assert.equal(cfg.resolveGen({ provider: 'higgsfield' }, undefined, { HIGGSFIELD_API_KEY: 'id' } as NodeJS.ProcessEnv).ready, false);
  assert.equal(cfg.resolveGen({ provider: 'higgsfield' }, undefined, { HIGGSFIELD_API_KEY: 'id:s' } as NodeJS.ProcessEnv).ready, true);
  assert.equal(cfg.resolveGen({ provider: 'higgsfield' }, undefined, { HIGGSFIELD_API_KEY: 'id', HIGGSFIELD_API_SECRET: 's' } as NodeJS.ProcessEnv).ready, true);
});

test('cap: saved > HEARTCUT_SPEND_CAP > $5; settings refuse keys and bad values', () => {
  assert.equal(cfg.resolveGen(undefined, undefined, {} as NodeJS.ProcessEnv).capUsd, 5);
  assert.equal(cfg.resolveGen(undefined, undefined, { HEARTCUT_SPEND_CAP: '12.5' } as NodeJS.ProcessEnv).capUsd, 12.5);
  assert.equal(cfg.resolveGen({ capUsd: 2 }, undefined, { HEARTCUT_SPEND_CAP: '12.5' } as NodeJS.ProcessEnv).capUsd, 2);
  assert.throws(() => cfg.checkGenSettings({ provider: 'fal', apiKey: 'x' }), /never saved in settings/);
  assert.throws(() => cfg.checkGenSettings({ provider: 'midjourney' }), /gen.provider must be one of/);
  assert.throws(() => cfg.checkGenSettings({ capUsd: -1 }), /between 0 and 1000/);
  assert.deepEqual(cfg.checkGenSettings({ provider: 'fal', capUsd: '7', models: { faces: 'a/b' } }), { provider: 'fal', capUsd: 7, models: { faces: 'a/b' } });
});

// ---------- fal ----------

function falRoutes(opts: { status?: () => any; result?: any } = {}) {
  routes.push(
    [/POST https:\/\/rest\.fal\.ai\/storage\/upload\/initiate/, () => json(200, { upload_url: 'https://up.fal/put/1', file_url: 'https://v3.fal.media/face.png' })],
    [/PUT https:\/\/up\.fal\/put/, () => new Response('', { status: 200 })],
    [/POST https:\/\/queue\.fal\.run\//, () => json(200, { request_id: 'req1', status_url: 'https://queue.fal.run/owner/app/requests/req1/status', response_url: 'https://queue.fal.run/owner/app/requests/req1', cancel_url: 'x' })],
    [/GET https:\/\/queue\.fal\.run\/owner\/app\/requests\/req1\/status/, () => json(200, opts.status?.() ?? { status: 'COMPLETED' })],
    [/GET https:\/\/queue\.fal\.run\/owner\/app\/requests\/req1$/, () => json(200, opts.result ?? { images: [{ url: 'https://v3.fal.media/o1.png' }, { url: 'https://v3.fal.media/o2.png' }, { url: 'https://v3.fal.media/o3.png' }, { url: 'https://v3.fal.media/o4.png' }] })],
    [/GET https:\/\/v3\.fal\.media\/o/, () => png()],
    [/GET https:\/\/v3\.fal\.media\/v/, () => mp4()],
  );
}

test('fal: faces sheet = one Seedream submit with num_images 4, Key auth, polled by id, 4 files downloaded, cost recorded', async () => {
  process.env.FAL_KEY = FAL;
  saveSettings({ gen: { provider: 'fal' } });
  let polls = 0;
  falRoutes({ status: () => (++polls < 3 ? { status: polls === 1 ? 'IN_QUEUE' : 'IN_PROGRESS' } : { status: 'COMPLETED' }) });
  const input = models.buildSheetInput('a woman, studio portrait', { aspect: '3:4', model: models.SOUL });
  const r = await gen.run(models.SOUL, input, opts('ilse'));
  const sub = submits(/queue\.fal\.run/);
  assert.equal(sub.length, 1);
  assert.equal(sub[0].url, 'https://queue.fal.run/bytedance/seedream/v5/lite/text-to-image');
  assert.equal(sub[0].headers.authorization, `Key ${FAL}`);
  assert.deepEqual(sub[0].body, { prompt: 'a woman, studio portrait', image_size: 'portrait_4_3', num_images: 4 });
  assert.equal(polls, 3, 'polled until COMPLETED');
  assert.equal(r.files.length, 4);
  assert.ok(r.files.every((f) => fs.existsSync(f) && f.endsWith('.png')));
  assert.equal(r.usd, 0.14);
  assert.equal(spend.sitting(5).sittingUsd, 0.14);
});

test('fal: identity edit uploads local pictures and sends image_urls (max 3); video maps to Seedance 2.5 with string duration', async () => {
  process.env.FAL_KEY = FAL;
  saveSettings({ gen: { provider: 'fal' } });
  falRoutes({ result: { images: [{ url: 'https://v3.fal.media/o1.png' }] } });
  const input = models.buildSheetInput('same face, full body', { aspect: '2:3', model: models.QWEN_EDIT, refPaths: [photo, photo, photo, photo] });
  await gen.run(models.QWEN_EDIT, input, opts('edit'));
  const sub = submits(/queue\.fal\.run/)[0];
  assert.equal(sub.url, 'https://queue.fal.run/alibaba/qwen-image-3/edit');
  assert.deepEqual(sub.body.image_urls, ['https://v3.fal.media/face.png', 'https://v3.fal.media/face.png', 'https://v3.fal.media/face.png']);
  assert.equal(sent.filter((s) => /upload\/initiate/.test(s.url)).length, 1, 'one file uploads once');
  assert.ok(!JSON.stringify(sub.body).includes(tmp), 'no local path is sent');

  sent = []; routes = [];
  falRoutes({ result: { video: { url: 'https://v3.fal.media/v1.mp4' } } });
  const sp = { sceneId: 's1', prompt: 'she turns', aspect: '16:9', durationSec: 6, audio: false, refAssetIds: [] } as any;
  const v = await gen.run(models.SEEDANCE_I2V, models.buildVideoInput(sp, [], 'draft', { startImage: photo, endImage: photo }), { project: 'demo', name: 's1-draft', sub: 'clips' });
  const vs = submits(/queue\.fal\.run/)[0];
  assert.equal(vs.url, 'https://queue.fal.run/bytedance/seedance-2.5/image-to-video');
  assert.equal(vs.body.duration, '6');
  assert.equal(vs.body.resolution, '480p');
  assert.equal(vs.body.image_url, 'https://v3.fal.media/face.png');
  assert.equal(vs.body.end_image_url, 'https://v3.fal.media/face.png');
  assert.ok(v.files[0].endsWith('.mp4'));
});

// ---------- replicate ----------

function repRoutes(output: unknown, status: () => string = () => 'succeeded') {
  routes.push(
    [/POST https:\/\/api\.replicate\.com\/v1\/models\//, () => json(201, { id: 'p1', status: 'starting', urls: { get: 'https://api.replicate.com/v1/predictions/p1', cancel: 'x' } })],
    [/GET https:\/\/api\.replicate\.com\/v1\/predictions\/p1/, () => json(200, { id: 'p1', status: status(), output })],
    [/GET https:\/\/replicate\.delivery\//, (s) => (/\.mp4$/.test(s.url) ? mp4() : png())],
  );
}

test('replicate: faces = 4 sequential Flux predictions (no batch field), {input} body, Bearer, Cancel-After; small photo as data URI', async () => {
  process.env.REPLICATE_API_TOKEN = REP;
  saveSettings({ gen: { provider: 'replicate' } });
  repRoutes('https://replicate.delivery/a/out.png');
  const input = models.buildSheetInput('a man', { aspect: '3:4', model: models.SOUL });
  const r = await gen.run(models.SOUL, input, opts('bo'));
  const sub = submits(/api\.replicate\.com\/v1\/models/);
  assert.equal(sub.length, 4, 'one prediction per picture');
  assert.equal(sub[0].url, 'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions');
  assert.equal(sub[0].headers.authorization, `Bearer ${REP}`);
  assert.match(sub[0].headers['cancel-after'], /^\d+m$/);
  assert.deepEqual(sub[0].body, { input: { prompt: 'a man', aspect_ratio: '3:4', output_format: 'png', safety_tolerance: 2 } });
  assert.equal(r.files.length, 4);
  assert.equal(r.usd, 0.16);

  sent = []; routes = [];
  repRoutes(['https://replicate.delivery/a/e.png']);
  await gen.run(models.QWEN_EDIT, models.buildSheetInput('same face', { aspect: '3:4', model: models.QWEN_EDIT, refPaths: [photo] }), opts('e'));
  const e = submits(/api\.replicate\.com\/v1\/models/)[0];
  assert.equal(e.url, 'https://api.replicate.com/v1/models/qwen/qwen-image-edit-plus/predictions');
  assert.match(e.body.input.image[0], /^data:image\/png;base64,/);

  sent = []; routes = [];
  repRoutes('https://replicate.delivery/a/v.mp4');
  const sp = { sceneId: 's1', prompt: 'walk', aspect: '16:9', durationSec: 5, audio: true, refAssetIds: [] } as any;
  await gen.run(models.SEEDANCE, models.buildVideoInput(sp, [photo], 'final'), { project: 'demo', name: 's1-final', sub: 'clips' });
  const v = submits(/api\.replicate\.com\/v1\/models/)[0];
  assert.equal(v.url, 'https://api.replicate.com/v1/models/bytedance/seedance-2.5/predictions');
  assert.equal(v.body.input.reference_images.length, 1);
  assert.equal(v.body.input.resolution, '720p');
  assert.equal(v.body.input.generate_audio, true);
});

// ---------- higgsfield API ----------

test('higgsfield API: exact /estimate price, flat body, Key id:secret, Idempotency-Key, upload then submit, poll status_url', async () => {
  process.env.HIGGSFIELD_API_KEY = HFK; process.env.HIGGSFIELD_API_SECRET = HFS;
  saveSettings({ gen: { provider: 'higgsfield' } });
  let polls = 0;
  routes.push(
    [/POST https:\/\/api\.higgsfield\.ai\/estimate\//, () => json(200, { usd: '0.041' })],
    [/POST https:\/\/api\.higgsfield\.ai\/files\/generate-upload-url/, () => json(200, { public_url: 'https://cdn.hf/face.png', upload_url: 'https://s3.hf/put', upload_headers: { 'Content-Type': 'image/png', 'x-amz-tagging': 'retention=temporary' } })],
    [/PUT https:\/\/s3\.hf\/put/, () => new Response('', { status: 200 })],
    [/POST https:\/\/api\.higgsfield\.ai\/alibaba/, () => json(200, { status: 'queued', request_id: 'h1', status_url: 'https://api.higgsfield.ai/requests/h1/status' })],
    [/GET https:\/\/api\.higgsfield\.ai\/requests\/h1\/status/, () => json(200, ++polls < 2 ? { status: 'in_progress' } : { status: 'completed', images: [{ url: 'https://cdn.hf/out.png' }] })],
    [/GET https:\/\/cdn\.hf\/out/, () => png()],
  );
  const input = models.buildSheetInput('same face', { aspect: '3:4', model: models.QWEN_EDIT, refPaths: [photo] });
  assert.equal(await gen.estimate(models.QWEN_EDIT, input), 0.041);
  const est = sent.find((s) => /estimate/.test(s.url))!;
  assert.deepEqual(est.body.image_urls, ['https://example.com/placeholder.png'], 'pricing never uploads');
  sent = [];
  const r = await gen.run(models.QWEN_EDIT, input, opts('hf'));
  const put = sent.find((s) => s.method === 'PUT')!;
  assert.equal(put.headers.authorization, undefined, 'no Higgsfield credentials on the storage PUT');
  assert.equal(put.headers['x-amz-tagging'], 'retention=temporary');
  const sub = submits(/api\.higgsfield\.ai\/alibaba/)[0];
  assert.equal(sub.url, 'https://api.higgsfield.ai/alibaba/qwen-image-3/edit');
  assert.equal(sub.headers.authorization, `Key ${HFK}:${HFS}`);
  assert.match(sub.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(sub.body, { prompt: 'same face', image_urls: ['https://cdn.hf/face.png'] });
  assert.equal(r.files.length, 1);
  assert.equal(r.usd, 0.041);
});

test('higgsfield API: a failed job is not charged, so its reservation is released', async () => {
  process.env.HIGGSFIELD_API_KEY = `${HFK}:${HFS}`;
  saveSettings({ gen: { provider: 'higgsfield' } });
  routes.push(
    [/POST https:\/\/api\.higgsfield\.ai\/estimate\//, () => json(200, { usd: '0.04' })],
    [/POST https:\/\/api\.higgsfield\.ai\/z-image/, () => json(200, { request_id: 'h2', status_url: 'https://api.higgsfield.ai/requests/h2/status' })],
    [/GET https:\/\/api\.higgsfield\.ai\/requests\/h2\/status/, () => json(200, { status: 'nsfw' })],
  );
  await assert.rejects(gen.run(models.Z_IMAGE, { prompt: 'x', resolution: '1k', aspect_ratio: '1:1' }, opts('z')), /nsfw \(not charged\)/);
  assert.equal(spend.sitting(5).sittingUsd, 0);
});

// ---------- never double-bill ----------

test('a submit that times out is NEVER resent, and its reservation keeps counting', async () => {
  process.env.FAL_KEY = FAL;
  saveSettings({ gen: { provider: 'fal' } });
  routes.push([/POST https:\/\/queue\.fal\.run\//, () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; }]);
  await assert.rejects(gen.run(models.QWEN_T2I, { prompt: 'x', resolution: '1k', aspect_ratio: '16:9' }, opts('t')), /may still run and be billed, so it was NOT sent again/);
  assert.equal(submits(/queue\.fal\.run/).length, 1);
  assert.equal(spend.sitting(5).sittingUsd, 0.04, 'the reservation is kept');
});

test('a 5xx on submit is never resent either; a 4xx refusal is not billed and releases the reservation', async () => {
  process.env.REPLICATE_API_TOKEN = REP;
  saveSettings({ gen: { provider: 'replicate' } });
  routes.push([/POST https:\/\/api\.replicate\.com\/v1\/models\//, () => json(502, { detail: 'bad gateway' })]);
  await assert.rejects(gen.run(models.QWEN_T2I, { prompt: 'x' }, opts('a')), /NOT sent again/);
  assert.equal(submits(/predictions/).length, 1);
  assert.equal(spend.sitting(5).sittingUsd, 0.025);
  spend.clearLedger(); sent = []; routes = [];
  routes.push([/POST https:\/\/api\.replicate\.com\/v1\/models\//, () => json(422, { detail: 'invalid input' })]);
  await assert.rejects(gen.run(models.QWEN_T2I, { prompt: 'x' }, opts('b')), /422 invalid input/);
  assert.equal(spend.sitting(5).sittingUsd, 0, 'refused jobs are released');
});

test('polling that outlives the deadline gives up without resubmitting', async () => {
  process.env.FAL_KEY = FAL;
  process.env.HEARTCUT_GEN_TIMEOUT_SEC = '30';
  saveSettings({ gen: { provider: 'fal' } });
  try {
    falRoutes({ status: () => ({ status: 'IN_QUEUE' }) });
    await assert.rejects(gen.run(models.QWEN_T2I, { prompt: 'x', resolution: '1k', aspect_ratio: '16:9' }, opts('slow')), /gave up after 30s/);
    assert.equal(submits(/queue\.fal\.run/).length, 1);
    assert.ok(sent.filter((s) => /status/.test(s.url)).length > 3, 'polled by id');
    assert.equal(spend.sitting(5).sittingUsd, 0.04);
  } finally { delete process.env.HEARTCUT_GEN_TIMEOUT_SEC; }
});

// ---------- spending cap ----------

test('cap: a job that would cross it is refused before anything is sent, with a plain message on how to raise it', async () => {
  process.env.FAL_KEY = FAL;
  saveSettings({ gen: { provider: 'fal', capUsd: 0.1 } });
  falRoutes();
  const sp = { sceneId: 's1', prompt: 'walk', aspect: '16:9', durationSec: 4, audio: false, refAssetIds: [] } as any;
  const input = models.buildVideoInput(sp, [photo], 'draft');
  await assert.rejects(gen.run(models.SEEDANCE, input, { project: 'demo', name: 'c', sub: 'clips' }), (e: Error) => {
    assert.ok(e instanceof gen.SpendCapError);
    assert.match(e.message, /would cross the spending cap.*Nothing was sent.*Raise the cap in the Brief step.*HEARTCUT_SPEND_CAP/s);
    return true;
  });
  assert.equal(sent.length, 0, 'not even an upload');
});

test('cap: an unpriced video reserves at least $2.50 while it runs, then counts the quote; jobs run one at a time', async () => {
  process.env.FAL_KEY = FAL;
  saveSettings({ gen: { provider: 'fal', capUsd: 5 } });
  const seen: number[] = [];
  routes.push(
    [/POST https:\/\/queue\.fal\.run\//, () => { seen.push(spend.sitting(5).sittingUsd); return json(200, { request_id: 'req1', status_url: 'https://queue.fal.run/owner/app/requests/req1/status', response_url: 'https://queue.fal.run/owner/app/requests/req1' }); }],
    [/GET .*req1\/status/, () => json(200, { status: 'COMPLETED' })],
    [/GET .*req1$/, () => json(200, { video: { url: 'https://v3.fal.media/v1.mp4' } })],
    [/GET https:\/\/v3\.fal\.media\/v/, () => mp4()],
    [/upload\/initiate/, () => json(200, { upload_url: 'https://up.fal/put/1', file_url: 'https://v3.fal.media/face.png' })],
    [/PUT https:\/\/up\.fal/, () => new Response('', { status: 200 })],
  );
  const sp = { sceneId: 's1', prompt: 'walk', aspect: '16:9', durationSec: 4, audio: false, refAssetIds: [] } as any;
  const input = models.buildVideoInput(sp, [photo], 'draft'); // 480p x 4 s on fal = $0.882 approx
  const [a, b] = await Promise.all([gen.run(models.SEEDANCE, input, { project: 'demo', name: 'a', sub: 'clips' }), gen.run(models.SEEDANCE, input, { project: 'demo', name: 'b', sub: 'clips' })]);
  assert.deepEqual(seen, [2.5, 0.882 + 2.5].map((n) => Math.round(n * 1000) / 1000), 'reserve held during the submit; the second waits for the first to settle');
  assert.equal(a.usd, 0.882); assert.equal(b.usd, 0.882);
  assert.equal(spend.sitting(5).sittingUsd, 1.764);
  // a third would hold 2.50 more: 1.764 + 2.5 > 3 -> refused
  saveSettings({ gen: { provider: 'fal', capUsd: 3 } });
  await assert.rejects(gen.run(models.SEEDANCE, input, { project: 'demo', name: 'c', sub: 'clips' }), gen.SpendCapError);
  assert.equal((await gen.spend()).remainingUsd, 1.236, '/api/spend reads the ledger for HTTP providers');
});

test('estimates use the active provider prices; unsupported or unset services say so instead of failing late', async () => {
  const input = models.buildSheetInput('a man', { aspect: '3:4', model: models.SOUL });
  process.env.REPLICATE_API_TOKEN = REP;
  saveSettings({ gen: { provider: 'replicate' } });
  assert.equal(await gen.estimate(models.SOUL, input), 0.16);
  assert.match((await gen.priceNote(models.SOUL, input))!, /^approx\. \(replicate\.com\/black-forest-labs\/flux-1\.1-pro/);
  assert.equal(await gen.priceNote(models.LOCAL_QWEN, {}), undefined, 'local is free and exact');
  saveSettings({ gen: { provider: 'fal' } });
  assert.match((await gen.priceNote('some/unknown-model', { prompt: 'x' }))!, /cannot run here: fal\.ai has no model/);
  saveSettings({ gen: null });
  delete process.env.REPLICATE_API_TOKEN;
  const q = await gen.quote(models.SOUL, input);
  assert.equal(q.provider, null); assert.equal(q.exact, false); assert.equal(q.usd, models.fakePrice(models.SOUL, input));
  await assert.rejects(gen.run(models.SOUL, input, opts('none')), /No picture service is set up/);
  assert.equal(sent.length, 0);
});

test('fake mode short-circuits before any provider', async () => {
  process.env.HEARTCUT_FAKE = '1';
  process.env.FAL_KEY = FAL;
  saveSettings({ gen: { provider: 'fal' } });
  const r = await gen.run(models.SOUL, { batch_size: 4 }, opts('fake'));
  assert.equal(r.files.length, 4);
  assert.equal(r.requestId, 'fake_request');
  assert.equal(sent.length, 0);
  assert.equal((await gen.check()).fake, true);
});

// ---------- status, check, local ----------

test('getGenStatus: keyFound only, never the key; Check uses a free read-only endpoint', async () => {
  process.env.FAL_KEY = FAL;
  const st = getGenStatus();
  assert.equal(st.provider, 'fal'); assert.equal(st.keyEnv, 'FAL_KEY'); assert.equal(st.keyFound, true); assert.equal(st.ready, true);
  assert.equal(st.approxPrices, true);
  assert.ok(!JSON.stringify(st).includes(FAL));
  routes.push([/GET https:\/\/api\.fal\.ai\/v1\/models\/pricing/, () => json(200, { prices: [] })]);
  const c = await gen.check();
  assert.equal(c.ok, true);
  assert.equal(sent.length, 1); assert.equal(sent[0].method, 'GET');
  assert.ok(!JSON.stringify(c).includes(FAL));
  sent = []; routes = [];
  routes.push([/GET https:\/\/api\.fal\.ai/, () => json(401, { detail: 'Invalid key' })]);
  const bad = await gen.check();
  assert.equal(bad.ok, false); assert.match(bad.error!, /fal\.ai refused the login/);
});

test('local worker missing -> isLocalAvailable ok:false with a plain reason; default worker is the repo copy', () => {
  assert.equal(local.workerPath(), local.REPO_WORKER);
  assert.ok(local.REPO_WORKER.endsWith(path.join('tools', 'local-image.py')) && fs.existsSync(local.REPO_WORKER));
  process.env.HEARTCUT_LOCAL_WORKER = path.join(tmp, 'nope.py');
  const a = local.isLocalAvailable();
  assert.equal(a.ok, false);
  assert.match(a.reason!, /worker missing/);
  assert.deepEqual(a.models, []);
  delete process.env.HEARTCUT_LOCAL_WORKER;
  process.env.HEARTCUT_LOCAL_PYTHON = path.join(tmp, 'no-python');
  assert.match(local.isLocalAvailable().reason!, /HEARTCUT_LOCAL_PYTHON not found/);
});

// ---------- /api/settings never returns a key ----------

test('/api/settings + /api/gen/check: gen round-trips, keys never stored or returned', async () => {
  process.env.HEARTCUT_FAKE = '1';
  process.env.FAL_KEY = FAL; process.env.REPLICATE_API_TOKEN = REP; process.env.HIGGSFIELD_API_KEY = HFK; process.env.HIGGSFIELD_API_SECRET = HFS;
  globalThis.fetch = realFetch;
  const { startServer } = await import('../src/server.ts');
  const { PROJECTS_DIR } = await import('../src/store.ts');
  const srv = await startServer(0);
  const j = (method: string, url: string, body?: unknown): Promise<{ status: number; body: any; raw: string }> => new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: url, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let raw = ''; res.on('data', (d) => (raw += d)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null, raw }));
    });
    req.on('error', reject); req.end(data);
  });
  const secrets = [FAL, REP, HFK, HFS];
  try {
    const g = await j('GET', '/api/settings');
    assert.equal(g.status, 200);
    assert.equal(g.body.genStatus.provider, 'higgsfield', 'auto: first key found');
    assert.ok(g.body.genOptions.providers.some((p: any) => p.id === 'fal' && p.keyEnv === 'FAL_KEY'));
    assert.ok(Array.isArray(g.body.genCoverage));
    for (const s of secrets) assert.ok(!g.raw.includes(s));
    const p = await j('PATCH', '/api/settings', { gen: { provider: 'replicate', capUsd: 9 } });
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.gen, { provider: 'replicate', capUsd: 9 });
    assert.equal(p.body.genStatus.keyEnv, 'REPLICATE_API_TOKEN'); assert.equal(p.body.genStatus.keyFound, true); assert.equal(p.body.genStatus.capUsd, 9);
    for (const s of secrets) assert.ok(!p.raw.includes(s));
    const file = fs.readFileSync(path.join(PROJECTS_DIR, '_settings.json'), 'utf8');
    for (const s of secrets) assert.ok(!file.includes(s));
    assert.equal((await j('PATCH', '/api/settings', { gen: { provider: 'fal', key: FAL } })).status, 400);
    const c = await j('POST', '/api/gen/check', {});
    assert.equal(c.body.ok, true); assert.equal(c.body.fake, true);
    const sp = await j('GET', '/api/spend');
    assert.equal(sp.status, 200); assert.equal(typeof sp.body.capUsd, 'number');
    assert.equal((await j('PATCH', '/api/settings', { gen: null })).body.gen, undefined);
  } finally { await srv.close(); }
});
