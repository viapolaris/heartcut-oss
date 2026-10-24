import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HEARTCUT_FAKE = '1';
const { llmJson, loadPrompt, validate } = await import('../src/llm.ts');
const { SCRIPT_SCHEMA } = await import('../src/stages/script.ts');

test('fake mode returns the fixture for the system prompt used', async () => {
  const out = await llmJson<{ logline: string; scenes: unknown[] }>({ system: loadPrompt('system-script'), user: 'x', schema: SCRIPT_SCHEMA });
  assert.ok(out.logline.length > 10);
  assert.equal(out.scenes.length, 9);
});

test('fake loadPrompt does not need prompt files', () => {
  assert.equal(loadPrompt('blocks'), 'FAKE:blocks');
});

test('schema validation rejects a wrong shape', async () => {
  await assert.rejects(
    llmJson({ system: loadPrompt('system-script'), user: 'x', schema: { type: 'object', required: ['nope'] } }),
    /nope is required/,
  );
  await assert.rejects(
    llmJson({ system: loadPrompt('system-sheets'), user: 'x', schema: { type: 'object', properties: { items: { type: 'string' } } } }),
    /\$\.items should be string/,
  );
});

test('validate checks nested items and enums', () => {
  const schema = { type: 'object', required: ['a'], properties: { a: { type: 'array', items: { type: 'integer' } }, k: { type: 'string', enum: ['x'] } } };
  validate({ a: [1, 2] }, schema);
  assert.throws(() => validate({ a: [1, 'z'] }, schema), /a\[1\]/);
  assert.throws(() => validate({ a: [], k: 'y' }, schema), /enum/);
  assert.throws(() => validate([], schema), /should be object/);
});

test('fake mode refuses an unknown system prompt', async () => {
  await assert.rejects(llmJson({ system: 'hello', user: 'x', schema: {} }), /not one of/);
});
