import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Project, RefImage, Script } from '../src/types.ts';

process.env.HEARTCUT_FAKE = '1';
const { attachIdentityRefs, faceRefs } = await import('../src/stages/script.ts');

const ref = (id: string, extra: Partial<RefImage> = {}): RefImage => ({ id, role: 'selfie', path: `/x/${id}.jpg`, ...extra });
const proj = (refs: RefImage[]): Project => ({ brief: { text: '', refs } } as unknown as Project);
const script = (): Script => ({
  logline: '', emotionalCore: '', arc: '', locations: [], scenes: [],
  characters: [
    { id: 'cate', name: 'Cate', species: 'human', baseDescription: '', wardrobe: '', states: [] },
    { id: 'tori', name: 'Tori', species: 'human', baseDescription: '', wardrobe: '', states: [] },
  ],
});

test('who tags link each photo to the right character, case-insensitive', () => {
  const s = script();
  attachIdentityRefs(proj([ref('a', { who: 'tori' }), ref('b', { who: 'Cate' })]), s);
  assert.equal(s.characters[0].identityRefId, 'b');
  assert.equal(s.characters[1].identityRefId, 'a');
});

test('a group photo never locks a face, even when the LLM picked it', () => {
  const s = script(); s.characters[0].identityRefId = 'g';
  const p = proj([ref('g', { who: 'several people' })]);
  attachIdentityRefs(p, s);
  assert.equal(s.characters[0].identityRefId, undefined);
  assert.deepEqual(faceRefs(p).map((r) => r.id), []);
});

test("the LLM's pick is kept when valid and unclaimed, dropped when it is a mood picture or tagged for someone else", () => {
  const s = script(); s.characters[0].identityRefId = 'm'; s.characters[1].identityRefId = 'c';
  attachIdentityRefs(proj([ref('m', { role: 'mood' }), ref('c', { who: 'Cate' })]), s);
  assert.equal(s.characters[0].identityRefId, 'c', 'Cate gets her tagged photo');
  assert.equal(s.characters[1].identityRefId, undefined, 'Tori may not take a photo tagged Cate');
  const s2 = script(); s2.characters[1].identityRefId = 'u';
  attachIdentityRefs(proj([ref('u')]), s2);
  assert.equal(s2.characters[1].identityRefId, 'u');
});

test('one untagged selfie goes to the one unlocked human only; with two humans unlocked it is not guessed', () => {
  const s = script();
  attachIdentityRefs(proj([ref('u')]), s);
  assert.equal(s.characters.filter((c) => c.identityRefId).length, 0, 'two unlocked humans: no guess');
  const s2 = script();
  attachIdentityRefs(proj([ref('t', { who: 'Tori' }), ref('u')]), s2);
  assert.equal(s2.characters[1].identityRefId, 't');
  assert.equal(s2.characters[0].identityRefId, 'u', 'the only unlocked human gets the only loose selfie');
});

test('group photos are recognised from the who text', async () => {
  const { isGroupWho } = await import('../src/stages/script.ts');
  const cast = ['Cate', 'Tori'];
  for (const w of ['several people', 'both girls', 'Cate on left Tori on right', 'Cate and Tori', 'cate & tori', 'Tori, Cate']) assert.equal(isGroupWho(w, cast), true, w);
  for (const w of ['Cate', 'tori', '', 'Caterina']) assert.equal(isGroupWho(w, cast), false, w);
});

test('a group-tagged photo plus one-person photos: each girl gets her own', () => {
  const s = script();
  attachIdentityRefs(proj([ref('hug', { who: 'Cate on left Tori on right' }), ref('t', { who: 'Tori' }), ref('c', { who: 'Cate' })]), s);
  assert.equal(s.characters[0].identityRefId, 'c');
  assert.equal(s.characters[1].identityRefId, 't');
});
