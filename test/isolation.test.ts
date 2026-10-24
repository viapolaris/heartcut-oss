// Every test file imports test/fixtures/isolate.ts before anything else, so no test reads the developer's .env,
// API keys, Hugging Face cache or HEARTCUT_* settings, and the suite gives the same answer on any computer.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

test('every test file imports the isolation module first', () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts'));
  assert.ok(files.length > 10);
  for (const f of files) {
    const first = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).find((l) => /^import\s/.test(l));
    assert.match(first ?? '', /^import '\.\/fixtures\/isolate\.ts';/, `${f}: the first import must be './fixtures/isolate.ts'`);
  }
});

test('the isolated environment: fake, no .env, temp folders, no keys', () => {
  const e = process.env;
  assert.equal(e.HEARTCUT_FAKE, '1');
  assert.equal(e.HEARTCUT_PREFER_LOCAL, '0');
  assert.ok(!fs.existsSync(e.HEARTCUT_ENV_FILE!));
  for (const k of ['HEARTCUT_ENV_FILE', 'HEARTCUT_ROOT', 'HEARTCUT_MEDIA_ROOT', 'HF_HOME']) assert.ok(e[k]!.startsWith(os.tmpdir()), k);
  assert.deepEqual(Object.keys(e).filter((k) => /(_API_KEY|_API_SECRET|_API_TOKEN|^FAL_KEY)$/i.test(k)), []);
  assert.equal(e.HF_HUB_CACHE, undefined);
});
