// /api/settings + /api/llm/test: the llm setting round-trips, keys are never stored or returned.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-settings-llm-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_ENV_FILE = path.join(tmp, 'no.env');
for (const k of ['HEARTCUT_LLM', 'HEARTCUT_LLM_PROVIDER', 'HEARTCUT_LLM_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete process.env[k];
const SECRET = 'sk-very-secret-test-value-123';
process.env.OPENAI_API_KEY = SECRET;
process.env.HEARTCUT_FAKE = '1';

const { startServer } = await import('../src/server.ts');
const { llmHooks, resetLlmProbe } = await import('../src/llm/config.ts');
llmHooks.which = (bin) => (bin === 'claude' ? '/usr/local/bin/claude' : null); // a machine with claude installed
resetLlmProbe();
const { PROJECTS_DIR } = await import('../src/store.ts');

let srv: Awaited<ReturnType<typeof startServer>>;
before(async () => { srv = await startServer(0); });
after(async () => { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// node:http, not fetch, so a test can stub globalThis.fetch for the server's outbound calls.
function j(method: string, url: string, body?: unknown): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: url, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let raw = '';
      res.on('data', (d) => (raw += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null, raw }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('GET /api/settings: auto picks the installed claude CLI over a key, options listed, no key anywhere', async () => {
  const r = await j('GET', '/api/settings');
  assert.equal(r.status, 200);
  assert.equal(r.body.llmStatus.provider, 'claude-cli');
  assert.equal(r.body.llmStatus.source, 'auto');
  assert.ok(r.body.llmOptions.presets.some((p: any) => p.id === 'openrouter' && p.keyEnv === 'OPENROUTER_API_KEY'));
  assert.ok(!r.raw.includes(SECRET));
});

test('PATCH llm: saved, status shows keyFound but never the key; file has no key', async () => {
  const r = await j('PATCH', '/api/settings', { llm: { provider: 'openai-compatible', preset: 'openai', models: { sonnet: 'gpt-x' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.llm, { provider: 'openai-compatible', preset: 'openai', models: { sonnet: 'gpt-x' } });
  assert.equal(r.body.llmStatus.keyEnv, 'OPENAI_API_KEY');
  assert.equal(r.body.llmStatus.keyFound, true);
  assert.equal(r.body.llmStatus.models.sonnet, 'gpt-x');
  assert.ok(!r.raw.includes(SECRET));
  const file = fs.readFileSync(path.join(PROJECTS_DIR, '_settings.json'), 'utf8');
  assert.ok(!file.includes(SECRET));
  assert.ok(!('preferLocal' in JSON.parse(file)), 'saving llm does not freeze preferLocal');
});

test('PATCH rejects keys and bad shapes; null clears', async () => {
  let r = await j('PATCH', '/api/settings', { llm: { provider: 'anthropic', apiKey: 'sk-x' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /never saved/);
  r = await j('PATCH', '/api/settings', { llm: { provider: 'gpt' } });
  assert.equal(r.status, 400);
  r = await j('PATCH', '/api/settings', { llm: { provider: 'openai-compatible', preset: 'custom', baseUrl: 'file:///etc' } });
  assert.equal(r.status, 400);
  r = await j('PATCH', '/api/settings', {});
  assert.equal(r.status, 400);
  r = await j('PATCH', '/api/settings', { llm: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.llm, undefined);
  assert.equal(r.body.llmStatus.provider, 'claude-cli');
});

test('POST /api/llm/test: fake mode sends nothing', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('no'); }) as typeof fetch;
  try {
    const r = await j('POST', '/api/llm/test', { llm: { provider: 'openai-compatible', preset: 'openai' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.fake, true);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = orig; }
});

test('POST /api/llm/test: real path with a stubbed fetch reports ok, latency and model; errors as ok:false', async () => {
  const orig = globalThis.fetch;
  delete process.env.HEARTCUT_FAKE;
  const seen: any[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init.body)), headers: init.headers });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true,"word":"hello"}' }, finish_reason: 'stop' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    let r = await j('POST', '/api/llm/test', { llm: { provider: 'openai-compatible', preset: 'openai' } });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.model, 'gpt-6-luna');
    assert.equal(typeof r.body.ms, 'number');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].body.model, 'gpt-6-luna');
    assert.ok(!r.raw.includes(SECRET));
    r = await j('POST', '/api/llm/test', { llm: { provider: 'openai-compatible', preset: 'xai' } });
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /XAI_API_KEY/);
    assert.equal(seen.length, 1, 'no request without a key');
  } finally { globalThis.fetch = orig; process.env.HEARTCUT_FAKE = '1'; }
});
