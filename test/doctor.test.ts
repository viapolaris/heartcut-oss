// heartcut doctor, the media default, GET /api/doctor and POST /api/demo. Probes are injected; nothing real is called.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-doctor-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_ENV_FILE = path.join(tmp, 'no.env');
for (const k of ['HEARTCUT_LLM', 'HEARTCUT_LLM_PROVIDER', 'HEARTCUT_LLM_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
const SECRET = 'sk-ant-doctor-secret-value-987';
process.env.HEARTCUT_FAKE = '1';

const { runDoctor, formatDoctor, problemLines, ffmpegHint, canWrite, findOnPath } = await import('../src/doctor.ts');
const { defaultMediaRoot } = await import('../src/store.ts');
const { startServer } = await import('../src/server.ts');
type Probes = import('../src/doctor.ts').Probes;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const good: Probes = {
  node: '22.18.0', platform: 'darwin', fake: false,
  which: (b) => `/usr/bin/${b}`,
  llm: () => ({ provider: 'claude-cli', label: 'Claude CLI (subscription)', keyEnv: null, keyRequired: false, keyFound: false, baseUrl: null }),
  gen: () => ({ provider: 'higgsfield', label: 'Higgsfield', keyEnv: 'HF_KEY', keyFound: true, ready: true }),
  local: () => ({ ok: false, reason: 'no uv', models: [] }),
  writable: () => true,
  envExists: () => true,
  dirs: { projects: '/x/projects', media: '/x/media' },
};
const level = (r: ReturnType<typeof runDoctor>, id: string) => r.checks.find((c) => c.id === id)?.level;

test('doctor: all good is ready, exit-worthy, and says so', () => {
  const r = runDoctor(good);
  assert.equal(r.canRun, true);
  assert.equal(r.ready, true);
  assert.equal(level(r, 'local'), 'info'); // optional, never blocks
  const out = formatDoctor(r);
  assert.match(out, /All good/);
  assert.doesNotMatch(out, /FAIL|todo/);
  assert.deepEqual(problemLines(r), []);
});

test('doctor: missing ffmpeg fails with an install hint for this OS', () => {
  for (const [platform, hint] of [['darwin', /brew install ffmpeg/], ['linux', /apt install ffmpeg/], ['win32', /winget install/]] as const) {
    const r = runDoctor({ ...good, platform, which: (b) => (b === 'ffprobe' ? null : `/usr/bin/${b}`) });
    assert.equal(r.canRun, false);
    assert.equal(level(r, 'ffmpeg'), 'fail');
    const out = formatDoctor(r);
    assert.match(out, /FAIL  ffmpeg: ffprobe not found/);
    assert.match(out, hint);
    assert.match(out, /cannot run yet/);
    assert.match(ffmpegHint(platform), hint);
  }
});

test('doctor: missing keys are todo lines that name the variable; fake mode turns them into notes', () => {
  const noKeys: Partial<Probes> = {
    llm: () => ({ provider: 'anthropic', label: 'Anthropic API', keyEnv: 'ANTHROPIC_API_KEY', keyRequired: true, keyFound: false, baseUrl: 'https://api.anthropic.com/v1' }),
    gen: () => ({ provider: 'higgsfield', label: 'Higgsfield', keyEnv: 'HIGGSFIELD_API_KEY', keyFound: false, ready: false, problem: 'No key yet.' }),
    envExists: () => false,
  };
  const r = runDoctor({ ...good, ...noKeys });
  assert.equal(r.canRun, true, 'fake mode can always run, so missing keys never block');
  assert.equal(r.ready, false);
  assert.equal(level(r, 'llm'), 'warn');
  assert.equal(level(r, 'gen'), 'warn');
  assert.equal(level(r, 'env'), 'info');
  const out = formatDoctor(r);
  assert.match(out, /ANTHROPIC_API_KEY=your-key/);
  assert.match(out, /HIGGSFIELD_API_KEY=your-key/);
  assert.match(out, /cp \.env\.example \.env/);
  assert.match(out, /Heartcut can run/);
  assert.equal(problemLines(r).length, 2);
  const fake = runDoctor({ ...good, ...noKeys, fake: true });
  assert.equal(level(fake, 'llm'), 'info');
  assert.equal(level(fake, 'gen'), 'info');
  assert.equal(fake.ready, true);
});

test('doctor: no claude command, old Node and a read-only folder', () => {
  const r = runDoctor({ ...good, node: '20.11.1', which: (b) => (b === 'claude' ? null : `/usr/bin/${b}`), writable: (d) => d !== '/x/media' });
  assert.equal(level(r, 'node'), 'fail');
  assert.equal(level(r, 'llm'), 'warn');
  assert.equal(level(r, 'media'), 'fail');
  assert.equal(level(r, 'projects'), 'ok');
  assert.match(formatDoctor(r), /Install Node 22\.18\.0 or newer/);
  assert.match(formatDoctor(r), /HEARTCUT_MEDIA_ROOT/);
  assert.equal(runDoctor({ ...good, node: '22.17.9' }).canRun, false);
  assert.equal(runDoctor({ ...good, node: '24.0.0' }).canRun, true);
});

test('doctor helpers: canWrite walks up to the nearest folder; findOnPath honours PATHEXT on Windows', () => {
  assert.equal(canWrite(path.join(tmp, 'not', 'made', 'yet')), true);
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tool.CMD'), '');
  assert.equal(findOnPath('tool', { PATH: bin, PATHEXT: '.EXE;.CMD' }, 'win32'), path.join(bin, 'tool.CMD'));
  assert.equal(findOnPath('tool', { PATH: bin }, 'linux'), null);
});

test('media: defaults to media/ beside projects/, HEARTCUT_MEDIA_ROOT and .env override it', () => {
  assert.equal(defaultMediaRoot({}, '/r'), path.join('/r', 'media'));
  assert.equal(defaultMediaRoot({ HEARTCUT_MEDIA_ROOT: '/m' }, '/r'), path.resolve('/m'));
  const print = (env: NodeJS.ProcessEnv) => execFileSync(process.execPath, ['-e', "import('./src/store.ts').then((m) => console.log(m.MEDIA_ROOT))"], { cwd: REPO, env, encoding: 'utf8' }).trim();
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^HEARTCUT_/.test(k)));
  // No override and no .env: the repo's own media/ folder, never a path in someone's home.
  assert.equal(print({ ...clean, HEARTCUT_ENV_FILE: path.join(tmp, 'none.env') }), path.join(REPO, 'media'));
  const envFile = path.join(tmp, 'media.env');
  fs.writeFileSync(envFile, `HEARTCUT_MEDIA_ROOT=${path.join(tmp, 'from-env')}\n`);
  assert.equal(print({ ...clean, HEARTCUT_ENV_FILE: envFile }), path.join(tmp, 'from-env'));
  assert.ok(fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8').split(/\r?\n/).includes('media/'));
});

test('cli: doctor exits 0 in fake mode, new --example names what exists when the name is wrong', () => {
  const env = { ...process.env, HEARTCUT_ROOT: path.join(tmp, 'cli'), HEARTCUT_MEDIA_ROOT: path.join(tmp, 'cli-media') };
  const d = spawnSync(process.execPath, ['src/cli.ts', 'doctor', '--json'], { cwd: REPO, env, encoding: 'utf8' });
  const r = JSON.parse(d.stdout);
  assert.equal(d.status, r.canRun ? 0 : 1);
  assert.ok(Array.isArray(r.checks) && r.checks.some((c: { id: string }) => c.id === 'ffmpeg'));
  const n = spawnSync(process.execPath, ['src/cli.ts', 'new', 'x', '--example', 'no-such-example'], { cwd: REPO, env, encoding: 'utf8' });
  assert.equal(n.status, 1);
  assert.match(n.stderr, /no example "no-such-example"/);
});

test('cli: every example brief makes a project, titled from its heading', () => {
  const dir = path.join(REPO, 'examples');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.') && !/^readme/i.test(f)).map((f) => f.slice(0, -3)) : [];
  const env = { ...process.env, HEARTCUT_ROOT: path.join(tmp, 'ex'), HEARTCUT_MEDIA_ROOT: path.join(tmp, 'ex-media') };
  for (const name of names) {
    const r = spawnSync(process.execPath, ['src/cli.ts', 'new', `ex-${name}`, '--example', name], { cwd: REPO, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const p = JSON.parse(fs.readFileSync(path.join(tmp, 'ex', 'projects', `ex-${name}`, 'project.json'), 'utf8'));
    assert.ok(p.brief.text.length >= 40, `${name} brief is too short`);
    assert.notEqual(p.title, `ex-${name}`);
  }
});

let srv: Awaited<ReturnType<typeof startServer>>;
before(async () => { srv = await startServer(0); });
after(async () => { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('GET /api/doctor: the checklist as JSON, with key names but never a key', async () => {
  process.env.HEARTCUT_LLM_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = SECRET;
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/doctor`);
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes(SECRET), 'the key must never leave the server');
    const r = JSON.parse(raw);
    assert.equal(typeof r.canRun, 'boolean');
    assert.equal(r.fake, true);
    assert.deepEqual(r.checks.map((c: { id: string }) => c.id), ['node', 'ffmpeg', 'llm', 'gen', 'local', 'projects', 'media', 'env']);
    assert.match(r.checks.find((c: { id: string }) => c.id === 'llm').detail, /Anthropic API/);
  } finally { delete process.env.HEARTCUT_LLM_PROVIDER; delete process.env.ANTHROPIC_API_KEY; }
});

test('POST /api/demo: makes demo, then demo-2, with the demo brief', async () => {
  const post = async () => (await fetch(`http://127.0.0.1:${srv.port}/api/demo`, { method: 'POST' })).json() as Promise<{ slug: string; fake: boolean; brief: { text: string } }>;
  const a = await post();
  const b = await post();
  assert.equal(a.slug, 'demo');
  assert.equal(b.slug, 'demo-2');
  assert.equal(a.fake, true);
  assert.ok(a.brief.text.length > 100);
});
