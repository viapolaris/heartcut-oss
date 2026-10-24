// Provider layer: request shape per provider, images, structured-output fallback, retry rules, precedence.
// No network: globalThis.fetch is replaced by a recorder for every test.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-llm-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_ENV_FILE = path.join(tmp, 'no.env');
delete process.env.HEARTCUT_FAKE;
const ENV_KEYS = ['HEARTCUT_LLM', 'HEARTCUT_LLM_PROVIDER', 'HEARTCUT_LLM_PRESET', 'HEARTCUT_LLM_BASE_URL', 'HEARTCUT_LLM_MODEL', 'HEARTCUT_LLM_MODEL_OPUS', 'HEARTCUT_LLM_MODEL_SONNET', 'HEARTCUT_LLM_MODEL_HAIKU', 'HEARTCUT_LLM_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'];
for (const k of ENV_KEYS) delete process.env[k];

const { llmJson, photoList, activeLlm } = await import('../src/llm.ts');
const { saveSettings } = await import('../src/settings.ts');
const { resetModeMemo, closeObjects } = await import('../src/llm/http.ts');
const { parseEnv, loadEnv } = await import('../src/env.ts');
// These tests describe a machine with the claude command installed (auto picks it). test/llm-auto.test.ts covers the rest.
const { llmHooks, resetLlmProbe } = await import('../src/llm/config.ts');
llmHooks.which = (bin) => (bin === 'claude' ? '/usr/local/bin/claude' : null);
resetLlmProbe();

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photo = path.join(tmp, 'maya.png');
fs.writeFileSync(photo, PNG);

const SCHEMA = { type: 'object', required: ['name'], properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'object', properties: { t: { type: 'string' } } } } } };

type Sent = { url: string; headers: Record<string, string>; body: any };
let sent: Sent[] = [];
let replies: (() => Response)[] = [];
const realFetch = globalThis.fetch;

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const oai = (content: string) => json(200, { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] });
const oaiTool = (args: string) => json(200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'emit', arguments: args } }] }, finish_reason: 'tool_calls' }] });
const ant = (text: string) => json(200, { content: [{ type: 'text', text }], stop_reason: 'end_turn' });

beforeEach(() => {
  sent = []; replies = []; resetModeMemo();
  for (const k of ENV_KEYS) delete process.env[k];
  saveSettings({ llm: null });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = replies.shift();
    if (!next) throw new Error('test: no reply queued');
    return next();
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const call = (extra = {}) => ({ system: 'SYS', user: 'USER', schema: SCHEMA, ...extra });

test('auto picks the claude CLI when it is installed; HEARTCUT_LLM=api still means the Anthropic API', () => {
  assert.equal(activeLlm().provider, 'claude-cli');
  assert.equal(activeLlm().source, 'auto');
  assert.equal(activeLlm().reason, 'the claude command is installed');
  process.env.HEARTCUT_LLM = 'api';
  const r = activeLlm();
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.source, 'env');
  assert.equal(r.keyEnv, 'ANTHROPIC_API_KEY');
  assert.equal(r.keyFound, false);
});

test('precedence: saved setting > env > default; HEARTCUT_LLM_PROVIDER beats HEARTCUT_LLM', () => {
  process.env.HEARTCUT_LLM = 'api';
  process.env.HEARTCUT_LLM_PROVIDER = 'gemini';
  process.env.HEARTCUT_LLM_MODEL_HAIKU = 'my-lite';
  let r = activeLlm();
  assert.equal(r.provider, 'openai-compatible');
  assert.equal(r.preset, 'gemini');
  assert.equal(r.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(r.models.haiku, 'my-lite');
  assert.equal(r.models.sonnet, 'gemini-3.8-flash');
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'xai', models: { all: 'grok-x' } } });
  r = activeLlm();
  assert.equal(r.source, 'saved');
  assert.equal(r.preset, 'xai');
  assert.deepEqual(r.models, { opus: 'grok-x', sonnet: 'grok-x', haiku: 'grok-x' });
});

test('anthropic: Messages API with structured output, images as base64 blocks in order', async () => {
  process.env.HEARTCUT_LLM = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'sk-test-ant';
  replies.push(ant('{"name":"Maya"}'));
  const out = await llmJson<{ name: string }>(call({ model: 'opus', maxTokens: 9000, images: [photo, path.join(tmp, 'gone.png')] }));
  assert.equal(out.name, 'Maya');
  const [s] = sent;
  assert.equal(s.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(s.headers['x-api-key'], 'sk-test-ant');
  assert.equal(s.headers['anthropic-version'], '2023-06-01');
  assert.equal(s.body.model, 'claude-opus-5-5');
  assert.equal(s.body.max_tokens, 9000);
  assert.equal(s.body.system, 'SYS');
  assert.equal(s.body.tool_choice, undefined, 'no forced tool use (current models reject it)');
  assert.equal(s.body.output_config.format.type, 'json_schema');
  assert.equal(s.body.output_config.format.schema.additionalProperties, false);
  assert.equal(s.body.output_config.format.schema.properties.tags.items.additionalProperties, false);
  assert.equal((SCHEMA as any).additionalProperties, undefined, 'caller schema not mutated');
  const c = s.body.messages[0].content;
  assert.deepEqual(c[0], { type: 'text', text: 'Photo 1 (maya.png)' });
  assert.equal(c[1].type, 'image');
  assert.deepEqual(c[1].source, { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') });
  assert.deepEqual(c.at(-1), { type: 'text', text: 'USER' });
  assert.equal(c.length, 3, 'a missing file is skipped');
});

test('openai-compatible presets: URL, auth, model ids, json_schema, image_url data URLs', async () => {
  const cases = [
    ['openai', 'OPENAI_API_KEY', 'https://api.openai.com/v1/chat/completions', 'gpt-6.1-sol'],
    ['xai', 'XAI_API_KEY', 'https://api.x.ai/v1/chat/completions', 'grok-4.7'],
    ['gemini', 'GEMINI_API_KEY', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-3.8-flash'],
    ['openrouter', 'OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1/chat/completions', 'anthropic/claude-sonnet-5.5'],
  ] as const;
  for (const [preset, keyEnv, url, model] of cases) {
    sent = []; resetModeMemo();
    process.env[keyEnv] = `key-${preset}`;
    saveSettings({ llm: { provider: 'openai-compatible', preset } });
    replies.push(oai('```json\n{"name":"Lily"}\n```'));
    const out = await llmJson<{ name: string }>(call({ maxTokens: 500, images: [photo] }));
    assert.equal(out.name, 'Lily');
    const [s] = sent;
    assert.equal(s.url, url);
    assert.equal(s.headers.authorization, `Bearer key-${preset}`);
    assert.equal(s.body.model, model);
    assert.deepEqual(s.body.response_format, { type: 'json_schema', json_schema: { name: 'result', schema: SCHEMA, strict: false } });
    assert.deepEqual(s.body.messages[0], { role: 'system', content: 'SYS' });
    const parts = s.body.messages[1].content;
    assert.deepEqual(parts[0], { type: 'text', text: 'Photo 1 (maya.png)' });
    assert.deepEqual(parts[1], { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } });
    assert.deepEqual(parts[2], { type: 'text', text: 'USER' });
    if (preset === 'openai') { assert.equal(s.body.max_completion_tokens, 500); assert.equal(s.body.max_tokens, undefined); }
    else assert.equal(s.body.max_tokens, 500);
  }
});

test('local servers: no key needed, no auth header; a missing model id is a clear error', async () => {
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'ollama' } });
  await assert.rejects(llmJson(call()), /no model id set for "sonnet"/);
  assert.equal(sent.length, 0);
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'ollama', models: { all: 'qwen3-vl' } } });
  replies.push(oai('{"name":"x"}'));
  await llmJson(call());
  assert.equal(sent[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(sent[0].headers.authorization, undefined);
  assert.equal(sent[0].body.model, 'qwen3-vl');
  assert.equal(activeLlm().keyRequired, false);
});

test('custom base URL uses HEARTCUT_LLM_API_KEY when set', async () => {
  process.env.HEARTCUT_LLM_API_KEY = 'custom-key';
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'custom', baseUrl: 'http://10.0.0.5:8000/v1/', models: { sonnet: 'm' } } });
  replies.push(oai('{"name":"x"}'));
  await llmJson(call());
  assert.equal(sent[0].url, 'http://10.0.0.5:8000/v1/chat/completions');
  assert.equal(sent[0].headers.authorization, 'Bearer custom-key');
});

test('a paid provider without its key fails before any request', async () => {
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'openai' } });
  await assert.rejects(llmJson(call()), /needs OPENAI_API_KEY/);
  assert.equal(sent.length, 0);
});

test('json_schema refused -> forced function call; the working mode is remembered', async () => {
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'lmstudio', models: { all: 'local' } } });
  replies.push(json(400, { error: { message: "'response_format.type' must be 'json_object' or 'text'" } }), oaiTool('{"name":"Ada"}'));
  const out = await llmJson<{ name: string }>(call());
  assert.equal(out.name, 'Ada');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.response_format, undefined);
  assert.equal(sent[1].body.tools[0].function.name, 'emit');
  assert.deepEqual(sent[1].body.tools[0].function.parameters, SCHEMA);
  assert.deepEqual(sent[1].body.tool_choice, { type: 'function', function: { name: 'emit' } });
  assert.match(sent[1].body.messages[0].content, /JSON Schema/);
  replies.push(oaiTool('{"name":"Bo"}'));
  await llmJson(call());
  assert.equal(sent.length, 3);
  assert.ok(sent[2].body.tools, 'second call goes straight to the mode that worked');
});

test('json_schema and tools both refused -> json_object with the schema in the system prompt', async () => {
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'ollama', models: { all: 'm' } } });
  replies.push(json(400, { error: { message: 'json_schema not supported' } }), json(400, { error: { message: 'tools not supported' } }), oai('{"name":"Cy"}'));
  const out = await llmJson<{ name: string }>(call());
  assert.equal(out.name, 'Cy');
  assert.deepEqual(sent[2].body.response_format, { type: 'json_object' });
  assert.ok(sent[2].body.messages[0].content.includes(JSON.stringify(SCHEMA)));
});

test('invalid reply -> exactly one retry with the validation error fed back', async () => {
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'ollama', models: { all: 'm' } } });
  replies.push(oai('{"nom":"wrong"}'), oai('{"name":"Fixed"}'));
  const out = await llmJson<{ name: string }>(call());
  assert.equal(out.name, 'Fixed');
  assert.equal(sent.length, 2);
  const msgs = sent[1].body.messages;
  assert.deepEqual(msgs[2], { role: 'assistant', content: '{"nom":"wrong"}' });
  assert.match(msgs[3].content, /name is required/);

  sent = [];
  replies.push(oai('not json at all'), oai('still not json'));
  await assert.rejects(llmJson(call()), /not valid JSON.*after one retry/s);
  assert.equal(sent.length, 2, 'never a third call');
});

test('server errors and timeouts are not retried (no double billing)', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  saveSettings({ llm: { provider: 'anthropic' } });
  replies.push(json(500, { error: { message: 'overloaded' } }));
  await assert.rejects(llmJson(call()), /500: overloaded/);
  assert.equal(sent.length, 1);
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'ollama', models: { all: 'm' } } });
  sent = [];
  replies.push(json(429, { error: { message: 'slow down' } }));
  await assert.rejects(llmJson(call()), /429/);
  assert.equal(sent.length, 1);
});

test('anthropic: output_config refused -> schema in the prompt, no output_config', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  saveSettings({ llm: { provider: 'anthropic', baseUrl: 'https://proxy.example/v1' } });
  replies.push(json(400, { error: { message: 'output_config: Extra inputs are not permitted' } }), ant('Here: {"name":"Dee"}'));
  const out = await llmJson<{ name: string }>(call());
  assert.equal(out.name, 'Dee');
  assert.equal(sent[0].url, 'https://proxy.example/v1/messages');
  assert.equal(sent[1].body.output_config, undefined);
  assert.match(sent[1].body.system, /JSON Schema/);
});

test('photoList: Read-tool wording for the CLI, numbered attachments for API providers', () => {
  const imgs = [{ path: photo, label: 'ref r1, role=selfie' }, { path: '/x/y/dad.jpg', label: 'ref r2' }];
  const cli = photoList(imgs);
  assert.match(cli, /Read tool/);
  assert.ok(cli.includes(`- ${photo} : ref r1, role=selfie`));
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'openai' } });
  const api = photoList(imgs);
  assert.doesNotMatch(api, /Read tool/);
  assert.ok(api.includes('- Photo 1 (maya.png) : ref r1, role=selfie'));
  assert.ok(api.includes('- Photo 2 (dad.jpg) : ref r2'));
  assert.equal(photoList([]), '');
});

test('fake mode short-circuits before any provider', async () => {
  process.env.HEARTCUT_FAKE = '1';
  try {
    saveSettings({ llm: { provider: 'openai-compatible', preset: 'openai' } });
    const { loadPrompt } = await import('../src/llm.ts');
    const { SCRIPT_SCHEMA } = await import('../src/stages/script.ts');
    const out = await llmJson<{ logline: string }>({ system: loadPrompt('system-script'), user: 'x', schema: SCRIPT_SCHEMA });
    assert.ok(out.logline);
    assert.equal(sent.length, 0);
  } finally { delete process.env.HEARTCUT_FAKE; }
});

test('closeObjects copies and closes nested objects only', () => {
  const s = { type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: {} } }, e: { type: 'string', enum: ['x'] } } };
  const c = closeObjects(s) as any;
  assert.equal(c.additionalProperties, false);
  assert.equal(c.properties.a.items.additionalProperties, false);
  assert.equal(c.properties.a.additionalProperties, undefined);
  assert.deepEqual(c.properties.e.enum, ['x']);
});

test('.env parser and loader: comments, quotes, export, blanks skipped, real env wins, edits refresh', () => {
  assert.deepEqual(parseEnv('# c\nexport A=1\nB="two words"\nC=\nD=x # note\n bad line\n'), { A: '1', B: 'two words', C: '', D: 'x' });
  const f = path.join(tmp, 'test.env');
  process.env.KEEP_ME = 'shell';
  fs.writeFileSync(f, 'HC_T1=a\nKEEP_ME=file\nHC_T2=\n');
  loadEnv(f);
  assert.equal(process.env.HC_T1, 'a');
  assert.equal(process.env.KEEP_ME, 'shell');
  assert.equal(process.env.HC_T2, undefined);
  fs.writeFileSync(f, 'HC_T1=b\n');
  loadEnv(f);
  assert.equal(process.env.HC_T1, 'b');
  fs.writeFileSync(f, '');
  loadEnv(f);
  assert.equal(process.env.HC_T1, undefined);
  delete process.env.KEEP_ME;
});
