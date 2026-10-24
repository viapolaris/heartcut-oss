// Language model auto-pick: saved > env > auto, where auto = the claude command on PATH, else the first API key
// (Anthropic, OpenAI, xAI, Gemini, OpenRouter), else a local Ollama / LM Studio that lists a model, else none.
// PATH lookup and fetch are injected; nothing touches the network and no paid endpoint is ever asked.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-llm-auto-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_ENV_FILE = path.join(tmp, 'no.env');
delete process.env.HEARTCUT_FAKE;
const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'];
const ENV_KEYS = ['HEARTCUT_LLM', 'HEARTCUT_LLM_PROVIDER', 'HEARTCUT_LLM_PRESET', 'HEARTCUT_LLM_BASE_URL', 'HEARTCUT_LLM_MODEL', 'HEARTCUT_LLM_MODEL_OPUS', 'HEARTCUT_LLM_MODEL_SONNET', 'HEARTCUT_LLM_MODEL_HAIKU', 'HEARTCUT_LLM_API_KEY', ...KEYS];

const cfg = await import('../src/llm/config.ts');
const { llmJson, readyLlm, claudeCommand, systemArgs } = await import('../src/llm.ts');
const { saveSettings } = await import('../src/settings.ts');
const { runDoctor } = await import('../src/doctor.ts');
const { findOnPath } = await import('../src/which.ts');

let claude: string | null = null;
let fetched: string[] = [];
let answers: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  delete process.env.HEARTCUT_FAKE;
  saveSettings({ llm: null });
  claude = null; fetched = []; answers = {};
  cfg.llmHooks.which = (bin) => (bin === 'claude' ? claude : null);
  cfg.llmHooks.fetch = async (url) => {
    fetched.push(String(url));
    const a = answers[String(url)];
    if (a === undefined) throw new TypeError('fetch failed: connection refused');
    return new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  cfg.llmHooks.now = () => Date.now();
  cfg.resetLlmProbe();
});

const OLLAMA = 'http://127.0.0.1:11434/v1/models';
const LMSTUDIO = 'http://127.0.0.1:1234/v1/models';

test('claude on PATH wins over every key, and no probe runs', async () => {
  claude = '/usr/local/bin/claude';
  process.env.OPENAI_API_KEY = 'sk-test';
  const r = await readyLlm();
  assert.equal(r.provider, 'claude-cli');
  assert.equal(r.source, 'auto');
  assert.match(r.reason!, /claude command is installed/);
  assert.deepEqual(fetched, []);
});

test('no claude: the first key in order wins (Anthropic, OpenAI, xAI, Gemini, OpenRouter)', async () => {
  const want: [string, string, string | undefined][] = [
    ['ANTHROPIC_API_KEY', 'anthropic', undefined], ['OPENAI_API_KEY', 'openai-compatible', 'openai'],
    ['XAI_API_KEY', 'openai-compatible', 'xai'], ['GEMINI_API_KEY', 'openai-compatible', 'gemini'],
    ['OPENROUTER_API_KEY', 'openai-compatible', 'openrouter'],
  ];
  for (let i = 0; i < want.length; i++) {
    for (const k of KEYS) delete process.env[k];
    for (const [k] of want.slice(i)) process.env[k] = `key-${k}`; // this one and every later one
    cfg.resetLlmProbe();
    const r = await readyLlm();
    assert.equal(r.provider, want[i][1], want[i][0]);
    assert.equal(r.preset, want[i][2]);
    assert.equal(r.source, 'auto');
    assert.equal(r.reason, `${want[i][0]} is set`);
    assert.equal(r.keyFound, true);
    assert.ok(!JSON.stringify(r).includes(`key-${want[i][0]}`), 'the key never appears in the status');
  }
  assert.deepEqual(fetched, [], 'a key means no local probe');
});

test('only OPENAI_API_KEY: OpenAI with its default models (the ChatGPT user)', async () => {
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  const r = await readyLlm();
  assert.equal(r.label, 'OpenAI');
  assert.equal(r.baseUrl, 'https://api.openai.com/v1');
  assert.ok(r.models.sonnet);
});

test('HEARTCUT_LLM_MODEL still applies to an auto pick', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.HEARTCUT_LLM_MODEL = 'my-model';
  const r = await readyLlm();
  assert.equal(r.models.sonnet, 'my-model');
});

test('no claude, no key: a local Ollama answering its model list is used with its first model', async () => {
  answers[OLLAMA] = { object: 'list', data: [{ id: 'llava:13b' }, { id: 'qwen3:8b' }] };
  const r = await readyLlm();
  assert.equal(r.provider, 'openai-compatible');
  assert.equal(r.preset, 'ollama');
  assert.equal(r.models.sonnet, 'llava:13b');
  assert.equal(r.source, 'auto');
  assert.match(r.reason!, /Ollama .* running with llava:13b/);
  assert.deepEqual(fetched.sort(), [LMSTUDIO, OLLAMA].sort(), 'only the two loopback model lists');
});

test('LM Studio is used when Ollama is not there; an empty model list does not count', async () => {
  answers[OLLAMA] = { data: [] };
  answers[LMSTUDIO] = { data: [{ id: 'google/gemma-3-12b' }] };
  const r = await readyLlm();
  assert.equal(r.preset, 'lmstudio');
  assert.equal(r.models.haiku, 'google/gemma-3-12b');
});

test('the probe is cached briefly, then asked again', async () => {
  let t = 1_000_000;
  cfg.llmHooks.now = () => t;
  await readyLlm(); await readyLlm(); await readyLlm();
  assert.equal(fetched.length, 2, 'one round for both servers');
  t += 31_000;
  await readyLlm();
  assert.equal(fetched.length, 4);
});

test('nothing at all: source none, a plain reason, llmJson refuses without spawning anything', async () => {
  const r = await readyLlm();
  assert.equal(r.source, 'none');
  assert.equal(r.label, 'Not set up');
  assert.match(r.reason!, /No language model found/);
  await assert.rejects(llmJson({ system: 's', user: 'u', schema: { type: 'object' } }), /No language model found/);
  const d = runDoctor({ llm: () => ({ provider: r.provider, label: r.label, keyEnv: null, keyRequired: false, keyFound: false, baseUrl: null, source: r.source, reason: r.reason }) });
  const c = d.checks.find((x) => x.id === 'llm')!;
  assert.equal(c.level, 'warn');
  assert.match(c.fix!, /OPENAI_API_KEY/);
  assert.match(c.fix!, /Ollama/);
  assert.equal(d.canRun, true, 'a missing language model never stops Heartcut from starting');
});

test('saved and env choices are never overridden by auto, and never probe', async () => {
  process.env.HEARTCUT_LLM_PROVIDER = 'claude-cli';
  let r = await readyLlm();
  assert.equal(r.source, 'env');
  assert.equal(r.provider, 'claude-cli');
  saveSettings({ llm: { provider: 'openai-compatible', preset: 'gemini' } });
  r = await readyLlm();
  assert.equal(r.source, 'saved');
  assert.equal(r.preset, 'gemini');
  process.env.HEARTCUT_LLM_PROVIDER = 'auto';
  saveSettings({ llm: null });
  r = await readyLlm();
  assert.equal(r.source, 'none', 'HEARTCUT_LLM_PROVIDER=auto means auto');
  assert.deepEqual(fetched.filter((u) => !u.startsWith('http://127.0.0.1')), [], 'never anything but loopback');
});

test('fake mode never probes', async () => {
  process.env.HEARTCUT_FAKE = '1';
  await readyLlm();
  assert.deepEqual(fetched, []);
  delete process.env.HEARTCUT_FAKE;
});

test('doctor names the auto pick and why', () => {
  const d = runDoctor({ llm: () => ({ provider: 'openai-compatible', label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', keyRequired: true, keyFound: true, baseUrl: 'https://api.openai.com/v1', source: 'auto', reason: 'OPENAI_API_KEY is set' }) });
  const c = d.checks.find((x) => x.id === 'llm')!;
  assert.equal(c.level, 'ok');
  assert.equal(c.detail, 'OpenAI, picked automatically (OPENAI_API_KEY is set).');
});

test('Windows: claude.cmd is found through PATHEXT and followed to the package it wraps', () => {
  const bin = path.join(tmp, 'npm-bin');
  const pkg = path.join(bin, 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off\r\n');
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ bin: { claude: 'cli.js' } }));
  fs.writeFileSync(path.join(pkg, 'cli.js'), '');
  const found = findOnPath('claude', { PATH: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32');
  assert.equal(found?.toLowerCase(), path.join(bin, 'claude.cmd').toLowerCase()); // PATHEXT case, like Windows
  assert.deepEqual(claudeCommand('win32', found), { cmd: process.execPath, pre: [path.join(pkg, 'cli.js')] });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ bin: { claude: 'bin/claude.exe' } }));
  assert.deepEqual(claudeCommand('win32', found), { cmd: path.join(pkg, 'bin/claude.exe'), pre: [] });
  assert.deepEqual(claudeCommand('win32', 'C:\\Users\\x\\.local\\bin\\claude.exe'), { cmd: 'C:\\Users\\x\\.local\\bin\\claude.exe', pre: [] });
  assert.deepEqual(claudeCommand('darwin', null), { cmd: 'claude', pre: [] });
  assert.deepEqual(claudeCommand('linux', null), { cmd: 'claude', pre: [] });
});

test('Windows: the long system prompt goes in a file; elsewhere it stays inline', () => {
  const big = 'x'.repeat(40_000);
  const w = systemArgs(big, 'win32');
  assert.equal(w.args[0], '--system-prompt-file');
  assert.equal(fs.readFileSync(w.args[1], 'utf8'), big);
  w.cleanup();
  assert.ok(!fs.existsSync(w.args[1]));
  assert.deepEqual(systemArgs('short', 'darwin').args, ['--system-prompt', 'short']);
});
