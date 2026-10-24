// Dashboard server tests. Temp HEARTCUT_ROOT / HEARTCUT_MEDIA_ROOT must be set before store.ts loads.
import './fixtures/isolate.ts'; // first: cut this process off from the host machine
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-server-'));
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');
process.env.HEARTCUT_FAKE = '1';

const { startServer } = await import('../src/server.ts');
const store = await import('../src/store.ts');
const { seedProject } = await import('./fixtures/seed.ts');
const { FAKE_SCENES, FAKE_SCRIPT } = await import('../src/demo/demo.ts');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/ui-project.json', import.meta.url), 'utf8'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let srv: Awaited<ReturnType<typeof startServer>>;
let base = '';
before(async () => { srv = await startServer(0); base = `http://127.0.0.1:${srv.port}`; });
after(async () => { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function j(method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

test('create, patch (deep-merge, arrays replaced), upload ref, get back', async () => {
  const c = await j('POST', '/api/projects', { title: 'Last Apple', briefText: 'a girl and a dog', aspect: '9:16' });
  assert.equal(c.status, 201);
  assert.equal(c.body.slug, 'last-apple');
  assert.equal(c.body.aspect, '9:16');

  const script = { logline: 'L', emotionalCore: 'E', arc: 'A', characters: [], locations: [], scenes: [] };
  const p1 = await j('PATCH', '/api/projects/last-apple', { script, brief: { text: 'edited' } });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.brief.text, 'edited');
  assert.deepEqual(p1.body.brief.refs, []);                     // sibling key survived the merge
  const p2 = await j('PATCH', '/api/projects/last-apple', { script: { logline: 'L2', characters: [{ id: 'x', name: 'X' }] } }); // a hand-edited character: no baseDescription, wardrobe or states
  assert.equal(p2.body.script.logline, 'L2');
  assert.equal(p2.body.script.arc, 'A');                         // object keys merge
  assert.equal(p2.body.script.characters.length, 1);             // arrays replace

  const up = await j('POST', '/api/projects/last-apple/refs', { role: 'mood', filename: 'm.png', dataBase64: PNG.toString('base64'), note: 'sun' });
  assert.equal(up.status, 201);
  assert.equal(up.body.role, 'mood');
  const bad = await j('POST', '/api/projects/last-apple/refs', { role: 'nope', filename: 'm.png', dataBase64: 'AA==' });
  assert.equal(bad.status, 400);

  const got = await j('GET', '/api/projects/last-apple');
  assert.equal(got.body.brief.refs.length, 1);
  assert.equal(got.body.brief.refs[0].note, 'sun');
  const list = await j('GET', '/api/projects');
  assert.ok(list.body.some((p: any) => p.slug === 'last-apple'));
  assert.equal((await j('GET', '/api/projects/missing-one')).status, 404);

  const ref = await fetch(base + `/refs/last-apple/${path.basename(got.body.brief.refs[0].path)}`);
  assert.equal(ref.status, 200);
  assert.equal(ref.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await ref.arrayBuffer()), PNG);
});

test('choose, approve clip, approve stage on the fixture project', async () => {
  const mediaRoot = process.env.HEARTCUT_MEDIA_ROOT!;
  const text = JSON.stringify(fixture).replaceAll('{{MEDIA}}', JSON.stringify(mediaRoot).slice(1, -1)); // escaped: a Windows path has backslashes
  const proj = JSON.parse(text);
  const dir = path.join(process.env.HEARTCUT_ROOT!, 'projects', proj.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), text);
  for (const a of proj.assets) for (const o of a.options) { fs.mkdirSync(path.dirname(o.path), { recursive: true }); fs.writeFileSync(o.path, PNG); }
  fs.mkdirSync(path.dirname(proj.clips[0].file.path), { recursive: true });
  fs.writeFileSync(proj.clips[0].file.path, Buffer.alloc(100, 7));

  const a = proj.assets[0];
  const ch = await j('POST', `/api/projects/${proj.slug}/choose`, { assetId: a.id, index: 3 });
  assert.equal(ch.body.assets[0].chosen, 3);
  assert.equal((await j('POST', `/api/projects/${proj.slug}/choose`, { assetId: a.id, index: 9 })).status, 400);
  // unpick, then remove a picture
  const un = await j('POST', `/api/projects/${proj.slug}/choose`, { assetId: a.id, index: null });
  assert.equal(un.status, 200);
  assert.equal(un.body.assets[0].chosen, undefined);
  await j('POST', `/api/projects/${proj.slug}/choose`, { assetId: a.id, index: 3 });
  const n0 = a.options.length;
  const rm = `/api/projects/${proj.slug}/assets/${a.id}/options/remove`;
  assert.equal((await j('POST', rm, { index: 99 })).status, 400);
  assert.equal((await j('POST', `/api/projects/${proj.slug}/assets/nope/options/remove`, { index: 0 })).status, 404);
  const gone = await j('POST', rm, { index: 0 });
  assert.equal(gone.status, 200);
  assert.equal(gone.body.assets[0].options.length, n0 - 1);
  assert.equal(gone.body.assets[0].chosen, 2, 'chosen shifts down when a lower index is removed');
  assert.ok(!fs.existsSync(a.options[0].path), 'own file deleted');
  fs.writeFileSync(a.options[0].path, PNG); // later assertions in this test still fetch it
  await j('POST', `/api/projects/${proj.slug}/choose`, { assetId: a.id, index: 3 });
  const ap = await j('POST', `/api/projects/${proj.slug}/approve`, { clipId: proj.clips[0].id, approved: false });
  assert.equal(ap.body.clips[0].approved, false);
  const st = await j('POST', `/api/projects/${proj.slug}/approve-stage`, { stage: 'images' });
  assert.ok(st.body.approvals.images);
  assert.equal((await j('POST', `/api/projects/${proj.slug}/approve-stage`, { stage: 'bogus' })).status, 400);

  // media: content type + Range
  const url = `${base}/media/${proj.slug}/clips/${path.basename(proj.clips[0].file.path)}`;
  const full = await fetch(url);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  const part = await fetch(url, { headers: { range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal((await part.arrayBuffer()).byteLength, 10);
  const png = await fetch(`${base}/media/${proj.slug}/assets/${path.basename(a.options[0].path)}`);
  assert.equal(png.headers.get('content-type'), 'image/png');

  const jobs = await j('GET', `/api/projects/${proj.slug}/jobs`);
  assert.equal(jobs.body.length, proj.jobs.length);
  const sp = await j('GET', `/api/spend?slug=${proj.slug}`);
  assert.equal(sp.body.projectUsd, 2.45);
});

test('media and refs reject traversal', async () => {
  fs.mkdirSync(process.env.HEARTCUT_MEDIA_ROOT!, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'nope');
  for (const u of ['/media/last-apple/assets/..%2f..%2f..%2fsecret.txt', '/media/last-apple/%2e%2e/%2e%2e/secret.txt', '/media/..%2f..%2f/x/y.png', '/refs/last-apple/..%2f..%2fproject.json', '/media/last-apple/assets/%00.png']) {
    const s = (await fetch(base + u)).status;
    assert.ok(s === 400 || s === 404, `${u} -> ${s}`);
  }
  // raw (unnormalised) request line
  const status = await new Promise<number>((resolve) => {
    http.get({ host: '127.0.0.1', port: srv.port, path: '/media/last-apple/../../../etc/passwd' }, (r) => { r.resume(); resolve(r.statusCode ?? 0); });
  });
  assert.ok(status === 400 || status === 404);
});

test('spend returns numbers', async () => {
  const { status, body } = await j('GET', '/api/spend');
  assert.equal(status, 200);
  for (const k of ['projectUsd', 'sittingUsd', 'capUsd', 'remainingUsd']) assert.equal(typeof body[k], 'number', k);
});

test('run endpoint returns a jobId (or 503 when the pipeline is missing)', async () => {
  const r = await j('POST', '/api/projects/last-apple/run/script', { dryRun: true });
  assert.ok(r.status === 202 || r.status === 503, `status ${r.status}`);
  if (r.status === 202) assert.match(r.body.jobId, /^run_/);
  else assert.equal(r.body.error, 'pipeline not available');
  assert.equal((await j('POST', '/api/projects/last-apple/run/nonsense', {})).status, 400);
  assert.equal((await j('POST', '/api/projects/nope/run/script', {})).status, 404);
});

test('SSE delivers events', async () => {
  const got = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no SSE event')), 4000);
    const req = http.get(`${base}/api/events`, (res) => {
      assert.match(String(res.headers['content-type']), /text\/event-stream/);
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        const m = /data: (.+)\n\n/.exec(buf);
        if (m) { clearTimeout(timer); req.destroy(); resolve(JSON.parse(m[1])); }
      });
    });
  });
  assert.equal(got.type, 'project');
});

test('SSE broadcasts a project event after PATCH', async () => {
  const events: any[] = [];
  const req = http.get(`${base}/api/events`, (res) => res.on('data', (d) => {
    for (const m of String(d).matchAll(/data: (.+)\n\n/g)) events.push(JSON.parse(m[1]));
  }));
  await new Promise((r) => setTimeout(r, 100));
  await j('PATCH', '/api/projects/last-apple', { brief: { text: 'again' } });
  await new Promise((r) => setTimeout(r, 150));
  req.destroy();
  assert.ok(events.some((e) => e.type === 'project' && e.slug === 'last-apple'));
});

test('static page is served', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>Heartcut<\/title>/);
  assert.equal((await fetch(base + '/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
});

test('staleness: GET carries it, list carries staleCount, PATCH stamps, keep clears', async () => {
  const p = seedProject(store, 'Stale Me');
  p.scenePrompts = structuredClone(FAKE_SCENES);
  p.createdAt = '2025-12-01T00:00:00.000Z';
  p.stamps = { script: '2026-01-01T00:00:00.000Z', sheets: '2026-01-02T00:00:00.000Z', images: '2026-01-03T00:00:00.000Z', scenes: '2026-01-04T00:00:00.000Z' };
  store.saveProject(p);
  const g = await j('GET', '/api/projects/stale-me');
  assert.equal(g.body.staleness.scenes.stale, false);
  assert.equal(g.body.slug, 'stale-me');
  const pa = await j('PATCH', '/api/projects/stale-me', { script: { logline: 'edited' } });
  assert.ok(pa.body.stamps.script > '2026-01-04');
  assert.deepEqual(pa.body.staleness.sheets, { stale: true, because: 'script' });
  assert.deepEqual(pa.body.staleness.scenes, { stale: true, because: 'script' });
  const list = await j('GET', '/api/projects');
  assert.equal(list.body.find((x: any) => x.slug === 'stale-me').staleCount, 3); // sheets, images, scenes
  assert.equal(typeof list.body.find((x: any) => x.slug === 'last-apple').staleCount, 'number');
  const k = await j('POST', '/api/projects/stale-me/keep', { stage: 'scenes' });
  assert.deepEqual(k.body.staleness.scenes, { stale: false });
  assert.deepEqual(k.body.staleness.sheets, { stale: true, because: 'script' });
  assert.equal((await j('POST', '/api/projects/stale-me/keep', { stage: 'nope' })).status, 400);
  const ch = await j('POST', '/api/projects/stale-me/choose', { assetId: p.assets[0].id, index: 1 });
  assert.ok(ch.body.stamps.images > ch.body.stamps.script);
  assert.equal(ch.body.staleness.scenes.stale, true);
  const ap = await j('POST', '/api/projects/stale-me/approve-stage', { stage: 'images' });
  assert.ok(ap.body.staleness);
});

test('PATCH scenePrompts with blocks re-joins prompt; plain items are left alone', async () => {
  const sp = structuredClone(FAKE_SCENES[2]);
  assert.ok(sp.blocks);
  sp.blocks = sp.blocks.map((b) => (b.name === 'SHOT' ? { ...b, text: 'tight close-up' } : b));
  sp.negatives = ['no zoom'];
  sp.prompt = 'STALE';
  const plain = { ...structuredClone(FAKE_SCENES[3]), blocks: undefined, prompt: 'hand written, no zoom' };
  const r = await j('PATCH', '/api/projects/stale-me', { scenePrompts: [sp, plain] });
  assert.equal(r.status, 200);
  const out = r.body.scenePrompts;
  assert.ok(out[0].prompt.startsWith('tight close-up, '));
  assert.ok(out[0].prompt.endsWith(', no zoom'));
  assert.equal(out[0].blocks.at(-1).text, 'no zoom');
  assert.equal(out[0].blocks.find((b: any) => b.name === 'SUBJECT').locked, true);
  assert.equal(out[1].prompt, 'hand written, no zoom');
  assert.ok(r.body.stamps.scenes);
});

test('PATCH scenePrompts: next-run settings stamp nothing, endFrame stamps keyframes, a block edit stamps scenes', async () => {
  const before = (await j('GET', '/api/projects/stale-me')).body;
  const sps = structuredClone(before.scenePrompts);
  sps[0] = { ...sps[0], motion: 'she kneels in the straw, the camera drifts left', durationSec: 7, audio: !sps[0].audio };
  const r = await j('PATCH', '/api/projects/stale-me', { scenePrompts: sps });
  assert.equal(r.status, 200);
  assert.equal(r.body.scenePrompts[0].motion, 'she kneels in the straw, the camera drifts left');
  assert.equal(r.body.scenePrompts[0].durationSec, 7);
  assert.deepEqual(r.body.stamps, before.stamps, 'motion/duration/audio stamp nothing');
  const sps1 = structuredClone(r.body.scenePrompts); sps1[0].endFrame = true;
  const r1 = await j('PATCH', '/api/projects/stale-me', { scenePrompts: sps1 });
  assert.equal(r1.body.stamps.scenes, before.stamps.scenes, 'scenes stamp untouched');
  assert.ok(r1.body.stamps.keyframes > (before.stamps.keyframes ?? ''), 'endFrame stamps keyframes');
  const sps2 = structuredClone(r1.body.scenePrompts);
  sps2[0].blocks = sps2[0].blocks.map((b: any) => (b.name === 'SHOT' ? { ...b, text: 'wide shot' } : b));
  const r2 = await j('PATCH', '/api/projects/stale-me', { scenePrompts: sps2 });
  assert.ok(r2.body.stamps.scenes > before.stamps.scenes, 'scenes stamped after a block edit');
});

test('library routes: list, adopt, picture adopt, import, import-new', async () => {
  const src = seedProject(store, 'Library Source');
  const dst = store.createProject({ title: 'Library Dest', briefText: 'a brief that is long enough to be a brief, honestly' });
  const events: any[] = [];
  const req = http.get(`${base}/api/events`, (res) => res.on('data', (d) => {
    for (const m of String(d).matchAll(/data: (.+)\n\n/g)) events.push(JSON.parse(m[1]));
  }));
  await new Promise((r) => setTimeout(r, 100));

  const all = await j('GET', '/api/library?exclude=library-dest');
  assert.equal(all.status, 200);
  assert.ok(all.body.length >= 5 && all.body.every((e: any) => e.projectSlug !== 'library-dest'));
  // Regression: 'last-apple' holds a character with no baseDescription (first test). The listing must not 500 on it.
  const bare = all.body.find((e: any) => e.id === 'last-apple:x');
  assert.ok(bare, 'the bare character is listed');
  assert.equal(bare.summary, '');
  const lm = await j('GET', '/api/library?kind=location&q=stable&exclude=library-dest');
  assert.ok(lm.body.length >= 1 && lm.body.every((e: any) => e.kind === 'location' && /stable/i.test(e.summary + e.name)));
  assert.equal((await j('GET', '/api/library?kind=banana')).status, 400);
  const ilse = all.body.find((e: any) => e.id === `${src.slug}:ilse`);
  assert.equal(ilse.sheets.length, 4);
  assert.equal(typeof ilse.sheets[0].file, 'string');

  const ad = await j('POST', `/api/projects/${dst.slug}/adopt`, { entryId: `${src.slug}:ilse` });
  assert.equal(ad.status, 200);
  assert.deepEqual(ad.body.adopted, { kind: 'character', id: 'ilse' });
  assert.equal(ad.body.script.characters[0].id, 'ilse');
  assert.equal(ad.body.assets.length, 4);
  assert.ok(ad.body.staleness.images);
  assert.equal((await j('POST', `/api/projects/${dst.slug}/adopt`, { entryId: `${src.slug}:ilse` })).body.adopted.id, 'ilse-2');
  assert.equal((await j('POST', `/api/projects/${dst.slug}/adopt`, { entryId: 'x:y' })).status, 404);
  assert.equal((await j('POST', `/api/projects/${dst.slug}/adopt`, {})).status, 400);
  assert.equal((await j('POST', '/api/projects/nope/adopt', { entryId: 'a:b' })).status, 404);

  const pic = await j('POST', `/api/projects/${dst.slug}/assets/ilse_past_full/adopt`, { fromSlug: src.slug, fromAssetId: 'fenna_past_full', index: 1 });
  assert.equal(pic.status, 200);
  const pa = pic.body.assets.find((a: any) => a.id === 'ilse_past_full');
  assert.equal(pa.options.length, 2);
  assert.equal(pa.chosen, 1);
  assert.equal(pa.sources[1].kind, 'library');
  assert.equal((await j('POST', `/api/projects/${dst.slug}/assets/ilse_past_full/adopt`, { fromSlug: src.slug, fromAssetId: 'fenna_past_full', index: 7 })).status, 400);

  const imp = await j('POST', `/api/projects/${dst.slug}/assets/ilse_past_full/import`, { filename: 'me.png', dataBase64: PNG.toString('base64') });
  assert.equal(imp.status, 200);
  const ia = imp.body.assets.find((a: any) => a.id === 'ilse_past_full');
  assert.equal(ia.options.length, 3);
  assert.deepEqual(ia.sources[2], { kind: 'import', filename: 'me.png' });
  const served = await fetch(`${base}/media/${dst.slug}/assets/${path.basename(ia.options[2].path)}`);
  assert.equal(served.status, 200);
  const notImg = await j('POST', `/api/projects/${dst.slug}/assets/ilse_past_full/import`, { filename: 'a.png', dataBase64: Buffer.from('plain text').toString('base64') });
  assert.equal(notImg.status, 400);
  assert.match(notImg.body.error, /not an image/);
  assert.equal((await j('POST', `/api/projects/${dst.slug}/assets/ghost/import`, { filename: 'a.png', dataBase64: PNG.toString('base64') })).status, 404);

  const nw = await j('POST', `/api/projects/${dst.slug}/assets/import-new`, { kind: 'location', locationId: 'my-roof', filename: 'roof.png', dataBase64: PNG.toString('base64') });
  assert.equal(nw.status, 201);
  assert.equal(nw.body.assetId, 'loc_my-roof');
  assert.equal(nw.body.sheets.items.find((i: any) => i.id === 'loc_my-roof').prompt, '(imported)');
  assert.equal((await j('POST', `/api/projects/${dst.slug}/assets/import-new`, { kind: 'location', filename: 'roof.png', dataBase64: PNG.toString('base64') })).status, 400);

  await new Promise((r) => setTimeout(r, 150));
  req.destroy();
  assert.ok(events.filter((e) => e.type === 'project' && e.slug === dst.slug).length >= 5);
});

test('settings: GET shows availability, PATCH saves preferLocal, bad body is 400, models list has the local pair', async () => {
  const g = await j('GET', '/api/settings');
  assert.equal(g.status, 200);
  assert.equal(typeof g.body.preferLocal, 'boolean');
  assert.equal(typeof g.body.local.ok, 'boolean');
  assert.ok(Array.isArray(g.body.local.models));
  assert.equal((await j('PATCH', '/api/settings', { preferLocal: 'yes' })).status, 400);
  const off = await j('PATCH', '/api/settings', { preferLocal: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.preferLocal, false);
  assert.equal((await j('GET', '/api/settings')).body.preferLocal, false);
  if (g.body.local.ok) assert.equal((await j('PATCH', '/api/settings', { preferLocal: true })).body.preferLocal, true);
  else assert.equal((await j('PATCH', '/api/settings', { preferLocal: true })).status, 409);
  const m = await j('GET', '/api/image-models');
  const slugs = m.body.images.map((x: any) => x.slug);
  assert.ok(slugs.includes('local/qwen-image') && slugs.includes('local/z-image-turbo'));
  assert.equal(m.body.images.find((x: any) => x.slug === 'local/qwen-image').usd, 0);
});

test('keyframes (v5): choose, remove, import (new + existing), PATCH re-joins and stamps, run/estimate accept promptMode + sequence', async () => {
  const p = seedProject(store, 'Kf Routes');
  p.scenePrompts = structuredClone(FAKE_SCENES);
  store.saveProject(p);
  const slug = p.slug;
  // import into a keyframe that does not exist yet creates a minimal one and chooses the picture
  const nw = await j('POST', `/api/projects/${slug}/keyframes/kf_s2_start/import`, { filename: 'still.png', dataBase64: PNG.toString('base64') });
  assert.equal(nw.status, 200);
  const k = nw.body.keyframes.find((x: any) => x.id === 'kf_s2_start');
  assert.equal(k.sceneId, 's2'); assert.equal(k.role, 'start'); assert.equal(k.prompt, '(imported)'); assert.equal(k.model, 'import');
  assert.equal(k.options.length, 1); assert.equal(k.chosen, 0);
  assert.deepEqual(k.sources, [{ kind: 'import', filename: 'still.png' }]);
  assert.deepEqual(k.refAssetIds, FAKE_SCENES[1].refAssetIds);
  assert.ok(k.options[0].path.includes(`${path.sep}keyframes${path.sep}kf_s2_start-import-1.png`));
  assert.ok(nw.body.stamps.keyframes);
  assert.equal((await fetch(`${base}/media/${slug}/keyframes/${path.basename(k.options[0].path)}`)).status, 200);
  // import again appends; bad ids / non-images are refused
  const ag = await j('POST', `/api/projects/${slug}/keyframes/kf_s2_start/import`, { filename: 'b.png', dataBase64: PNG.toString('base64') });
  assert.equal(ag.body.keyframes[0].options.length, 2); assert.equal(ag.body.keyframes[0].chosen, 1);
  assert.equal((await j('POST', `/api/projects/${slug}/keyframes/kf_nope_start/import`, { filename: 'b.png', dataBase64: PNG.toString('base64') })).status, 404);
  assert.equal((await j('POST', `/api/projects/${slug}/keyframes/ilse_present_full/import`, { filename: 'b.png', dataBase64: PNG.toString('base64') })).status, 404);
  const notImg = await j('POST', `/api/projects/${slug}/keyframes/kf_s2_start/import`, { filename: 'a.png', dataBase64: Buffer.from('text').toString('base64') });
  assert.equal(notImg.status, 400); assert.match(notImg.body.error, /not an image/);
  assert.equal((await j('POST', `/api/projects/${slug}/keyframes/kf_s2_start/import`, { filename: 'a.png' })).status, 400);
  // choose / unpick / bad index / unknown
  const ch = await j('POST', `/api/projects/${slug}/keyframes/choose`, { keyframeId: 'kf_s2_start', index: 0 });
  assert.equal(ch.status, 200); assert.equal(ch.body.keyframes[0].chosen, 0);
  assert.equal((await j('POST', `/api/projects/${slug}/keyframes/choose`, { keyframeId: 'kf_s2_start', index: 9 })).status, 400);
  assert.equal((await j('POST', `/api/projects/${slug}/keyframes/choose`, { keyframeId: 'kf_zz_start', index: 0 })).status, 404);
  const un = await j('POST', `/api/projects/${slug}/keyframes/choose`, { keyframeId: 'kf_s2_start', index: null });
  assert.equal(un.body.keyframes[0].chosen, undefined);
  // remove
  const rm = `/api/projects/${slug}/keyframes/kf_s2_start/options/remove`;
  assert.equal((await j('POST', rm, { index: 5 })).status, 400);
  assert.equal((await j('POST', `/api/projects/${slug}/keyframes/kf_zz_start/options/remove`, { index: 0 })).status, 404);
  const first = ag.body.keyframes[0].options[0].path;
  const gone = await j('POST', rm, { index: 0 });
  assert.equal(gone.status, 200); assert.equal(gone.body.keyframes[0].options.length, 1); assert.ok(!fs.existsSync(first));
  // PATCH keyframes: blocks re-join into prompt, negatives once, locked flags, stamp
  const blocks = [
    { name: 'QUALITY', text: 'film still' }, { name: 'SHOT', text: 'close-up' }, { name: 'SUBJECT', text: 'a woman {{char:ilse}}' },
    { name: 'POSE', text: 'frozen mid-aim' }, { name: 'NEGATIVES', text: 'stale' },
  ];
  const before = gone.body.stamps.keyframes;
  await new Promise((r) => setTimeout(r, 5));
  const pa = await j('PATCH', `/api/projects/${slug}`, { keyframes: [{ ...gone.body.keyframes[0], blocks, negatives: ['no zoom', 'No Zoom '], prompt: 'STALE' }] });
  assert.equal(pa.status, 200);
  const pk = pa.body.keyframes[0];
  assert.equal(pk.prompt, 'close-up, a woman {{char:ilse}}, frozen mid-aim, film still, no zoom, No Zoom');
  assert.deepEqual(pk.blocks.map((b: any) => b.name), ['SHOT', 'SUBJECT', 'POSE', 'QUALITY', 'NEGATIVES']);
  assert.equal(pk.blocks[1].locked, true); assert.equal(pk.blocks[0].locked, undefined);
  assert.equal(pk.options.length, 1, 'options untouched');
  assert.ok(pa.body.stamps.keyframes > before);
  assert.equal(pa.body.staleness.keyframes.stale, false);
  assert.equal((await j('PATCH', `/api/projects/${slug}`, { keyframes: 'nope' })).status, 400);
  // scenePrompts PATCH keeps motion and endFrame
  const sp = { ...structuredClone(FAKE_SCENES[0]), endFrame: true, motion: 'she kneels in the straw' };
  const sr = await j('PATCH', `/api/projects/${slug}`, { scenePrompts: [sp] });
  assert.equal(sr.body.scenePrompts[0].endFrame, true); assert.equal(sr.body.scenePrompts[0].motion, 'she kneels in the straw');
  assert.equal(sr.body.staleness.keyframes.stale, true, 'scenes changed after keyframes');
  // run / estimate pass promptMode + sequence through (and refuse typos)
  assert.equal((await j('POST', `/api/projects/${slug}/estimate/clips`, { promptMode: 'shrt' })).status, 400);
  assert.equal((await j('POST', `/api/projects/${slug}/run/clips`, { sequence: 'yes' })).status, 400);
  await j('PATCH', `/api/projects/${slug}`, { scenePrompts: structuredClone(FAKE_SCENES) });
  await j('POST', `/api/projects/${slug}/keyframes/choose`, { keyframeId: 'kf_s2_start', index: 0 });
  const e1 = await j('POST', `/api/projects/${slug}/estimate/clips`, { ids: ['s2'] });
  assert.equal(e1.status, 200); assert.equal(e1.body.items[0].model, 'bytedance/seedance-2.5/image-to-video'); assert.match(e1.body.items[0].note, /short prompt/);
  const e2 = await j('POST', `/api/projects/${slug}/estimate/clips`, { ids: ['s2'], promptMode: 'full' });
  assert.match(e2.body.items[0].note, /full prompt/);
  const e3 = await j('POST', `/api/projects/${slug}/estimate/clips`, { ids: ['s1', 's2'], sequence: true });
  assert.equal(e3.body.items.length, 1); assert.equal(e3.body.items[0].id, 's1+s2'); assert.match(e3.body.items[0].note, /one take/);
  const bad = await j('POST', `/api/projects/${slug}/estimate/clips`, { ids: ['s1'], sequence: true });
  assert.equal(bad.status, 500); assert.match(bad.body.error, /at least 2/);
  const ek = await j('POST', `/api/projects/${slug}/estimate/keyframes`, { ids: ['s1'] });
  assert.equal(ek.status, 200); assert.equal(ek.body.usd, 0.08);
  // a run with the v5 options lands a clip with source/mode/sceneIds
  const r = await j('POST', `/api/projects/${slug}/run/clips`, { ids: ['s1', 's2'], sequence: true, promptMode: 'full' });
  assert.equal(r.status, 202);
  for (let i = 0; i < 100; i++) { await new Promise((x) => setTimeout(x, 50)); if (store.loadProject(slug).clips.some((c) => c.status !== 'pending')) break; }
  const got = await j('GET', `/api/projects/${slug}`);
  const c = got.body.clips[0];
  assert.equal(c.source, 'sequence'); assert.deepEqual(c.sceneIds, ['s1', 's2']); assert.equal(c.status, 'done');
  assert.ok(Array.isArray(got.body.keyframes) && got.body.staleness.keyframes);
});

test('rename: character name changes everywhere, ids and stamps do not', async () => {
  const p = store.createProject({ title: 'Rename Me', briefText: 'a brief that is long enough to be a brief, honestly' });
  const q = store.loadProject(p.slug);
  q.script = structuredClone(FAKE_SCRIPT);
  const c = q.script!.characters[0]; const old = c.name;
  q.sheets = { items: [{ id: `${c.id}_x_portrait`, kind: 'character-portrait', characterId: c.id, stateId: 'x', prompt: `${old} stands, ${old}s shadow, not ${old}a` }] };
  q.scenePrompts = [{ sceneId: 's1', prompt: `${old} runs`, blocks: [{ name: 'SUBJECT', text: `${old} runs` }], negatives: [], refAssetIds: [], durationSec: 5, aspect: '16:9', audio: false, motion: `${old} turns` }];
  q.stamps = { scenes: '2026-01-01T00:00:00.000Z' };
  store.saveProject(q);
  const r = await j('POST', `/api/projects/${p.slug}/rename`, { kind: 'character', id: c.id, name: '  Juniper  ' });
  assert.equal(r.status, 200);
  const out = r.body;
  assert.equal(out.script.characters[0].name, 'Juniper');
  assert.equal(out.script.characters[0].id, c.id);
  assert.equal(out.sheets.items[0].prompt, `Juniper stands, ${old}s shadow, not ${old}a`, 'whole words only');
  assert.equal(out.scenePrompts[0].prompt, 'Juniper runs');
  assert.equal(out.scenePrompts[0].blocks[0].text, 'Juniper runs');
  assert.equal(out.scenePrompts[0].motion, 'Juniper turns');
  assert.deepEqual(out.stamps, { scenes: '2026-01-01T00:00:00.000Z' }, 'nothing stamped');
  assert.equal((await j('POST', `/api/projects/${p.slug}/rename`, { kind: 'character', id: 'nope', name: 'X' })).status, 404);
  assert.equal((await j('POST', `/api/projects/${p.slug}/rename`, { kind: 'character', id: c.id, name: '   ' })).status, 400);
  assert.equal((await j('POST', `/api/projects/${p.slug}/rename`, { kind: 'thing', id: c.id, name: 'X' })).status, 400);
  const l = out.script.locations[0];
  const rl = await j('POST', `/api/projects/${p.slug}/rename`, { kind: 'location', id: l.id, name: 'High meadow' });
  assert.equal(rl.body.script.locations[0].name, 'High meadow');
});

test("director's notes: PATCH saves them and stamps brief; script and sheets messages carry them", async () => {
  const p = store.createProject({ title: 'Notes Me', briefText: 'a brief that is long enough to be a brief, honestly' });
  const r = await j('PATCH', `/api/projects/${p.slug}`, { brief: { text: p.brief.text, notes: 'Maya is 16, 165 cm, freckles.' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.brief.notes, 'Maya is 16, 165 cm, freckles.');
  assert.equal(r.body.brief.text, p.brief.text);
  assert.ok(r.body.stamps.brief, 'notes change stamps brief');
  const { notesSection } = await import('../src/stages/script.ts');
  assert.match(notesSection(store.loadProject(p.slug)), /# Director's notes[^\n]*\nMaya is 16, 165 cm, freckles\./);
  const q = store.loadProject(p.slug); q.brief.notes = '  '; assert.equal(notesSection(q), '');
  const same = await j('PATCH', `/api/projects/${p.slug}`, { brief: { text: p.brief.text, notes: 'Maya is 16, 165 cm, freckles.' } });
  assert.equal(same.body.stamps.brief, r.body.stamps.brief, 'unchanged notes do not re-stamp');
});

test('PATCH brief refs with who links the face at once (no script run)', async () => {
  const p = store.createProject({ title: 'Link Now', briefText: 'a brief that is long enough to be a brief, honestly' });
  const q = store.loadProject(p.slug);
  q.script = structuredClone(FAKE_SCRIPT);
  q.brief.refs = [{ id: 'r1', role: 'selfie', path: '/x/r1.jpg' }];
  store.saveProject(q);
  const name = q.script!.characters[0].name;
  const r = await j('PATCH', `/api/projects/${p.slug}`, { brief: { refs: [{ id: 'r1', role: 'selfie', path: '/x/r1.jpg', who: name }] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.script.characters[0].identityRefId, 'r1');
});

test('--port works the same on every OS (no PORT=... shell syntax needed)', async () => {
  const { portArg } = await import('../src/server.ts');
  assert.equal(portArg(['node', 'src/server.ts']), undefined);
  assert.equal(portArg(['node', 'src/server.ts', '--port', '5099']), 5099);
  assert.equal(portArg(['node', 'src/server.ts', '--fake', '--port=5100']), 5100);
  assert.throws(() => portArg(['node', 'src/server.ts', '--port', 'abc']), /not a port number/);
});
