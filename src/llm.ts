// LLM adapter: every LLM call in Heartcut goes through llmJson() here.
// Default: the `claude` CLI on the subscription (no API key). Optional, opt-in providers (src/llm/config.ts):
// the Anthropic API, or any OpenAI-compatible server (OpenAI, xAI, Gemini, OpenRouter, Ollama, LM Studio, custom).
// HTTP adapters live in src/llm/http.ts. Fake mode (HEARTCUT_FAKE=1) short-circuits before any provider.
//
// claude CLI notes:
// Probe results (claude CLI, 2026-10-10):
//  - system prompt flag: --system-prompt <text> (replaces the default); user text goes on stdin.
//  - `--output-format json` prints ONE envelope object: { type:'result', subtype:'success',
//    is_error, result:'<text>', structured_output:<object when --json-schema is used>,
//    num_turns, total_cost_usd, ... }. The parsed object is in `structured_output`;
//    `result` holds the same JSON as a string. Structured output costs one extra turn
//    (num_turns 2), so --max-turns must be >= 2; we use 3.
//  - A bare spawn loaded ~370k tokens of user settings/plugins/MCP. Passing
//    `--setting-sources "" --strict-mcp-config --disable-slash-commands --tools ""`
//    cuts that to ~1k tokens and ~$0.005 notional, so we always pass them.
//  - Spawning from inside a Claude Code session worked with the env as-is; if a "nested
//    session" error ever appears we retry once with CLAUDECODE removed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLlm, primeLlmAuto, llmHooks, type LlmSettings, type ResolvedLlm } from './llm/config.ts';
import { anthropicJson, openaiJson, photoTag, parseLoose, type HttpCall, type Reply } from './llm/http.ts';
import { storedLlm } from './settings.ts';

export interface LlmCall {
  system: string;
  user: string;
  schema: object;
  model?: 'sonnet' | 'opus' | 'haiku';
  maxTokens?: number;
  images?: string[];   // absolute image paths the model must look at (CLI: the Read tool, limited to their folders; API: sent inline)
  llm?: LlmSettings;   // use this config instead of the saved/env one (the connection test)
}

/** The provider llmJson would use right now: saved setting > env > auto. Sync; uses the cached local probe. */
export const activeLlm = (override?: LlmSettings): ResolvedLlm => resolveLlm(storedLlm(), override);

/** activeLlm after the auto probe has run (a free, loopback-only model list, cached briefly). */
export async function readyLlm(override?: LlmSettings): Promise<ResolvedLlm> {
  if (!override) await primeLlmAuto(storedLlm());
  return activeLlm(override);
}

type PromptName = 'blocks' | 'system-script' | 'system-sheets' | 'system-scenes' | 'system-keyframes';

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const TIMEOUT_MS = 180_000;

export const isFake = (): boolean => process.env.HEARTCUT_FAKE === '1';

export function loadPrompt(name: PromptName): string {
  // Fake mode must not depend on builder D's files: return a sentinel llmJson recognises.
  if (isFake()) return `FAKE:${name}`;
  const f = path.join(PROMPTS_DIR, `${name}.md`);
  if (!fs.existsSync(f)) throw new Error(`prompt file missing: ${f}`);
  return fs.readFileSync(f, 'utf8');
}

// --- schema validation (type / required / properties / items / enum; no deps) ---

type Schema = { type?: string; required?: string[]; properties?: Record<string, Schema>; items?: Schema; enum?: unknown[] };

function typeOk(v: unknown, t: string): boolean {
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return typeof v === 'object' && v !== null && !Array.isArray(v);
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeof v === t;
}

export function validate(value: unknown, schema: Schema, at = '$'): void {
  if (schema.type && !typeOk(value, schema.type)) throw new Error(`schema: ${at} should be ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`schema: ${at} not in enum`);
  if (schema.type === 'object' || schema.properties || schema.required) {
    const o = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (o[k] === undefined) throw new Error(`schema: ${at}.${k} is required`);
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (o[k] !== undefined) validate(o[k], s, `${at}.${k}`);
  }
  if (schema.items && Array.isArray(value)) value.forEach((v, i) => validate(v, schema.items!, `${at}[${i}]`));
}

// --- backends ---

async function fakeJson(call: LlmCall): Promise<unknown> {
  const fx = await import('./demo/demo.ts');
  if (call.system.startsWith('FAKE:system-script')) return fx.FAKE_SCRIPT;
  if (call.system.startsWith('FAKE:system-sheets')) return fx.FAKE_SHEETS;
  if (call.system.startsWith('FAKE:system-scenes')) return { scenes: fx.FAKE_SCENES };
  // One start per beat plus a derived end for every beat, so an `endFrame` switch works offline too; the stage keeps what it asked for.
  if (call.system.startsWith('FAKE:system-keyframes')) return { keyframes: [...fx.FAKE_KEYFRAMES, ...fx.FAKE_KEYFRAMES.map(fx.fakeEndKeyframe)] };
  throw new Error('HEARTCUT_FAKE: system prompt is not one of script/sheets/scenes/keyframes');
}

/**
 * How to start `claude` without a shell. On macOS and Linux: the `claude` program. On Windows npm installs a
 * claude.cmd shim, and Node will not spawn a .cmd without a shell, while cmd.exe cannot carry our multi-line,
 * 40 KB arguments. So on win32 we follow the shim to the package it wraps and run that directly: its JS entry
 * through this Node, or its .exe. A native install (claude.exe) is spawned as is.
 */
export function claudeCommand(platform: NodeJS.Platform = process.platform, found: string | null = platform === 'win32' ? llmHooks.which('claude') : null): { cmd: string; pre: string[] } {
  if (platform !== 'win32' || !found) return { cmd: 'claude', pre: [] };
  if (!/\.(cmd|bat)$/i.test(found)) return { cmd: found, pre: [] };
  const pkg = path.join(path.dirname(found), 'node_modules', '@anthropic-ai', 'claude-code');
  try {
    const j = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
    const rel = typeof j.bin === 'string' ? j.bin : j.bin?.claude;
    if (rel) {
      const entry = path.join(pkg, rel);
      if (/\.(c|m)?js$/i.test(entry)) return { cmd: process.execPath, pre: [entry] };
      if (/\.exe$/i.test(entry)) return { cmd: entry, pre: [] };
    }
  } catch { /* fall through */ }
  const cli = path.join(pkg, 'cli.js');
  if (fs.existsSync(cli)) return { cmd: process.execPath, pre: [cli] };
  throw new Error(`Cannot start ${found} without a shell. Install Claude Code with its native installer (claude.exe), or pick another language model in the dashboard.`);
}

function runClaude(args: string[], stdin: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    let c: ReturnType<typeof claudeCommand>;
    try { c = claudeCommand(); } catch (e) { reject(e); return; }
    const child = spawn(c.cmd, [...c.pre, ...args], { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude timed out after ${TIMEOUT_MS / 1000}s`)); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      const code = (e as NodeJS.ErrnoException).code;
      reject(code === 'ENOENT' ? new Error('The claude command is not installed. Install Claude Code and sign in once, or pick another language model in the dashboard.') : e);
    });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(stdin);
  });
}


// Photos: the CLI sees images only through its Read tool, so allow Read alone, only in the photos' folders, and
// give it one extra turn per photo (probed 2026-10-11: one photo + structured output = 3 turns).
function visionArgs(images: string[] | undefined): string[] {
  const imgs = (images ?? []).filter((f) => fs.existsSync(f));
  if (!imgs.length) return ['--tools', '', '--max-turns', '3'];
  const dirs = [...new Set(imgs.map((f) => path.dirname(f)))];
  return ['--tools', 'Read', '--allowedTools', 'Read', ...dirs.flatMap((d) => ['--add-dir', d]), '--max-turns', String(3 + imgs.length)];
}

/**
 * The user-message lines that tell the model which photos to look at. Pass them in the same order as
 * LlmCall.images. CLI: the model opens each path with the Read tool. API providers: the pictures are attached
 * inline, each preceded by "Photo N (file name)", and this list maps those numbers to labels.
 */
export function photoList(images: { path: string; label: string }[]): string {
  if (!images.length) return '';
  let cli = true;
  try { cli = activeLlm().provider === 'claude-cli'; } catch { /* a bad env value surfaces in llmJson */ }
  if (cli) return `# Photos (open every one with the Read tool before you answer)\n${images.map((i) => `- ${i.path} : ${i.label}`).join('\n')}\n\n`;
  return `# Photos (attached to this message in this order; look at every one before you answer)\n${images.map((i, n) => `- ${photoTag(n + 1, path.basename(i.path))} : ${i.label}`).join('\n')}\n\n`;
}

/**
 * The system prompt flag. Windows caps a command line at 32,767 characters and our prompts run to about 40 KB,
 * so on win32 the prompt goes in a temp file (--system-prompt-file). Elsewhere it stays inline, as before.
 */
export function systemArgs(system: string, platform: NodeJS.Platform = process.platform): { args: string[]; cleanup: () => void } {
  if (platform !== 'win32') return { args: ['--system-prompt', system], cleanup: () => {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-sys-'));
  const f = path.join(dir, 'system.md');
  fs.writeFileSync(f, system);
  return { args: ['--system-prompt-file', f], cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function cliJson(call: LlmCall): Promise<unknown> {
  const sys = systemArgs(call.system);
  try { return await cliJsonWith(call, sys.args); } finally { sys.cleanup(); }
}

async function cliJsonWith(call: LlmCall, sysArgs: string[]): Promise<unknown> {
  const args = [
    '-p', '--model', call.model ?? 'sonnet', '--output-format', 'json',
    '--json-schema', JSON.stringify(call.schema), ...sysArgs,
    ...visionArgs(call.images),
    '--no-session-persistence',
    '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands',
  ];
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (call.maxTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(call.maxTokens);
  let r = await runClaude(args, call.user, env);
  if (r.code !== 0 && /nested|another session|CLAUDECODE/i.test(r.err + r.out)) {
    delete env.CLAUDECODE;
    r = await runClaude(args, call.user, env);
  }
  let env2: { is_error?: boolean; result?: string; structured_output?: unknown };
  try { env2 = JSON.parse(r.out); } catch { throw new Error(`claude returned non-JSON (exit ${r.code}): ${(r.out || r.err).slice(0, 2000)}`); }
  if (env2.is_error || r.code !== 0) throw new Error(`claude failed (exit ${r.code}): ${String(env2.result ?? r.err).slice(0, 2000)}`);
  if (env2.structured_output !== undefined && env2.structured_output !== null) return env2.structured_output;
  try { return parseLoose(env2.result ?? ''); } catch { throw new Error(`claude result is not JSON: ${String(env2.result).slice(0, 2000)}`); }
}

const fail = (raw: unknown, e: unknown): Error => new Error(`${(e as Error).message}\nraw: ${JSON.stringify(raw).slice(0, 2000)}`);

function check(raw: unknown, schema: object): string | undefined {
  try { validate(raw, schema as Schema); return undefined; } catch (e) { return (e as Error).message; }
}

// API providers: one repair retry when the reply is not JSON or fails the schema, with the error fed back.
// HTTP errors are never retried here (a retry after a timeout could bill twice).
async function httpJson(cfg: ResolvedLlm, call: LlmCall): Promise<unknown> {
  const run = (c: HttpCall): Promise<Reply> => (cfg.provider === 'anthropic' ? anthropicJson(cfg, c) : openaiJson(cfg, c));
  const base: HttpCall = { system: call.system, user: call.user, schema: call.schema, tier: call.model ?? 'sonnet', maxTokens: call.maxTokens, images: call.images };
  let r = await run(base);
  let problem = r.parseError ?? check(r.value, call.schema);
  if (!problem) return r.value;
  r = await run({ ...base, repair: { reply: r.text.slice(0, 20000), error: problem } });
  problem = r.parseError ?? check(r.value, call.schema);
  if (!problem) return r.value;
  throw fail(r.value ?? r.text, new Error(`${cfg.label}: ${problem} (after one retry)`));
}

export async function llmJson<T>(call: LlmCall): Promise<T> {
  let raw: unknown;
  if (isFake()) raw = structuredClone(await fakeJson(call));
  else {
    const cfg = await readyLlm(call.llm);
    if (cfg.source === 'none') throw new Error(cfg.reason ?? 'No language model is set up.');
    if (cfg.provider !== 'claude-cli') return (await httpJson(cfg, call)) as T;
    raw = await cliJson({ ...call, model: (cfg.models[call.model ?? 'sonnet'] || call.model) as LlmCall['model'] });
  }
  const problem = check(raw, call.schema);
  if (problem) throw fail(raw, new Error(problem));
  return raw as T;
}
