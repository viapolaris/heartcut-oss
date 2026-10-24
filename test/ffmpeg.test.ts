import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-ff-'));
process.env.HEARTCUT_FAKE = '1';
process.env.HEARTCUT_X264_PRESET = 'ultrafast';
process.env.HEARTCUT_ROOT = path.join(tmp, 'root');
process.env.HEARTCUT_MEDIA_ROOT = path.join(tmp, 'media');

const ff = await import('../src/ffmpeg.ts');
const exp = await import('../src/stages/export.ts');
const { FFMPEG } = await import('../src/demo/media.ts');
import type { Clip, Project } from '../src/types.ts';

function lavfi(name: string, size: string, audio: boolean): string {
  const out = path.join(tmp, name);
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=duration=1:size=${size}:rate=12`];
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac');
  args.push('-pix_fmt', 'yuv420p', '-shortest', out);
  execFileSync(FFMPEG, args);
  return out;
}

test('concat normalizes mixed inputs; music mixes; 4k upscale', async () => {
  const a = lavfi('a.mp4', '64x36', false);
  const b = lavfi('b.mp4', '48x48', true);
  const out = await ff.concat([a, b], path.join(tmp, 'cat.mp4'), { size: { width: 64, height: 36 } });
  const p = await ff.probe(out);
  assert.equal(p.width, 64); assert.equal(p.height, 36);
  assert.ok(p.durationSec > 1.8 && p.durationSec < 2.4, `duration ${p.durationSec}`);
  assert.ok(p.hasAudio);

  const music = path.join(tmp, 'm.wav');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=5', music]);
  const withMusic = await ff.concat([a, b], path.join(tmp, 'catm.mp4'), { music, size: { width: 64, height: 36 } });
  assert.ok((await ff.probe(withMusic)).durationSec < 2.6);

  const big = await ff.upscale4k(out, path.join(tmp, '4k.mp4'), { grain: true });
  assert.ok((await ff.probe(big)).height >= 2160);
});

test('export stage: prefers approved finals, falls back to drafts, errors on none, 4k', async () => {
  const mk = (id: string, sceneId: string, tier: Clip['tier'], file: string, approved: boolean): Clip => ({
    id, sceneId, tier, model: 'm', resolution: tier === 'draft' ? '480p' : '720p', file: { path: file },
    status: 'done', approved, createdAt: new Date().toISOString(),
  });
  const a = lavfi('s1.mp4', '64x36', false);
  const b = lavfi('s2.mp4', '64x36', false);
  const p = {
    id: 'x', slug: 'ffdemo', title: 't', owner: 'viaPolaris', aspect: '16:9', createdAt: '', updatedAt: '',
    brief: { text: '', refs: [] }, assets: [], clips: [], exports: [], jobs: [], approvals: {},
    scenePrompts: [{ sceneId: 's1' }, { sceneId: 's2' }],
  } as unknown as Project;
  await assert.rejects(exp.run(p, {}, () => {}), /nothing to export/);
  p.clips.push(mk('c1', 's1', 'draft', a, true), mk('c2', 's2', 'final', b, true), mk('c3', 's2', 'draft', a, true));
  await exp.run(p, { resolution: '4k' }, () => {});
  assert.deepEqual(p.exports[0].sceneOrder, ['s1', 's2']);
  assert.equal(p.exports[0].resolution, '4k');
  assert.ok(p.exports[0].file.height! >= 2160);
  assert.match(path.basename(p.exports[0].file.path), /^ffdemo-\d{8}T\d{6}-4k\.mp4$/);
});
