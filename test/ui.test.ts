// Dashboard static assets: served, parse, and nothing external but the font link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-ui-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';

const { startServer } = await import('../src/server.ts');
let srv: Awaited<ReturnType<typeof startServer>>;
let base = '';
before(async () => { srv = await startServer(0); base = `http://127.0.0.1:${srv.port}`; });
after(async () => { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function get(p: string) {
  const r = await fetch(base + p);
  return { status: r.status, type: r.headers.get('content-type') ?? '', text: await r.text() };
}

test('GET / serves the dashboard shell', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.text, /<script type="module" src="\/app\.js">/);
  assert.match(r.text, /href="\/app\.css"/);
  const hosts = [...r.text.matchAll(/(?:href|src)="(https?:\/\/[^/"]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(hosts)].sort(), ['https://fonts.googleapis.com']);
  assert.match(r.text, /Instrument\+Sans/);
  assert.match(r.text, /JetBrains\+Mono/);
});

test('GET /app.css is served and carries the Foundations tokens', async () => {
  const r = await get('/app.css');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/css/);
  for (const tok of ['#101214', '#181B20', '#F0785A', '#58C492', '#E8B04B', '#E05A5A', '#6FA8FF', '#A7ADB4']) assert.ok(r.text.includes(tok), `missing token ${tok}`);
});

test('GET /app.js is served and parses', async () => {
  const r = await get('/app.js');
  assert.equal(r.status, 200);
  assert.match(r.type, /javascript/);
  const file = path.join(tmp, 'app-check.mjs');
  fs.writeFileSync(file, r.text);
  const out = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  // the six status words, and the v2 endpoints the dashboard depends on
  for (const w of ['empty', 'needs you', 'generating…', 'done', 'approved', 'stale']) assert.ok(r.text.includes(`'${w}'`), `missing status word ${w}`);
  for (const ep of ['/library', '/adopt', '/import', '/import-new', '/keep', '/estimate/', '/run/']) assert.ok(r.text.includes(ep), `missing endpoint ${ep}`);
});

test('Images step: anchor phases and the generate / regenerate buttons are in the dashboard', async () => {
  const r = await get('/app.js');
  for (const t of ['1 · Lock the face', '2 · Build from this face', 'from this face', 'from face ✓', 'face changed', 'Rebuild', 'Generate missing', 'Regenerate all', 'missing ${ids.length === 1', 'no prompt — Add your picture… or regenerate Sheets', 'Use as final', 'Use as context', 'Make a clean sheet from it', 'Use as the shot', 'Clean this up…', '/context', 'Qwen Image Edit · from face', 'anchorStale', 'liveAssets']) assert.ok(r.text.includes(t), `missing UI text: ${t}`);
});

test('unknown static paths 404 instead of falling through', async () => {
  assert.equal((await get('/nope.js')).status, 404);
});

test('STEPS ids are stage ids in STAGES order (8 once the Keyframes step lands)', async () => {
  const { STAGES } = await import('../src/types.ts');
  const r = await get('/app.js');
  const block = r.text.slice(r.text.indexOf('const STEPS = ['), r.text.indexOf('];', r.text.indexOf('const STEPS = [')));
  const ids = [...block.matchAll(/\{\s*id:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length === 7 || ids.length === 8, `${ids.length} steps`);
  assert.deepEqual(ids, STAGES.filter((s) => ids.includes(s)), 'every step is a stage, in stage order');
  if (ids.length === 8) assert.deepEqual(ids, STAGES);
  else assert.deepEqual(ids, STAGES.filter((s) => s !== 'keyframes'), 'only the v5 Keyframes step may be missing while web/ is mid-edit');
});
