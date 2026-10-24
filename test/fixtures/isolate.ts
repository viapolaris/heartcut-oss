// Imported first by every test file (test/isolation.test.ts checks it). It cuts the test process off from the
// machine it runs on, so a test passes or fails the same on any OS and any computer:
// - drops every HEARTCUT_*, Hugging Face and Claude Code variable and every API key from the inherited environment,
// - points HEARTCUT_ENV_FILE at a file that does not exist (never the developer's own .env),
// - points projects, media and the Hugging Face cache at a fresh temp folder (never ~/.cache or the repo),
// - turns fake mode on and local pictures off, as `npm test` does.
// It sets environment variables only and imports nothing from src/, so a test file can still set its own
// HEARTCUT_ROOT and friends before it imports the modules that read them.
// Kept: PATH (the tests run ffmpeg and node) and HEARTCUT_FFMPEG / HEARTCUT_FFPROBE (where this machine's ffmpeg is).
// Anything that looks for `claude`, `uv` or Apple Silicon is injected per test through the hooks in src/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEEP = new Set(['HEARTCUT_FFMPEG', 'HEARTCUT_FFPROBE']);
const DROP = /^(HEARTCUT_|HF_|HUGGING_?FACE|CLAUDE|ANTHROPIC_|OPENAI_|XAI_|GEMINI_|GOOGLE_API|OPENROUTER_|FAL_|REPLICATE_|HIGGSFIELD_|OLLAMA_|LMSTUDIO_)|(_API_KEY|_API_SECRET|_API_TOKEN)$/i;
for (const k of Object.keys(process.env)) if (DROP.test(k) && !KEEP.has(k.toUpperCase())) delete process.env[k];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-test-'));
Object.assign(process.env, {
  HEARTCUT_FAKE: '1',
  HEARTCUT_PREFER_LOCAL: '0',
  HEARTCUT_ENV_FILE: path.join(tmp, 'no.env'),
  HEARTCUT_ROOT: path.join(tmp, 'root'),
  HEARTCUT_MEDIA_ROOT: path.join(tmp, 'media'),
  HF_HOME: path.join(tmp, 'hf'),
});
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a file still open on Windows */ } });

export const isolatedTmp = tmp;
