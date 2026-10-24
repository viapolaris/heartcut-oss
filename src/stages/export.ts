// Approved clips -> one film. Per scene: the newest approved final, else the newest approved draft. An approved
// one-take (sequence) clip stands in for every beat it covers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Aspect, Clip, Emit, Estimate, ExportResult, Project, RunOptions } from '../types.ts';
import { mediaDir, saveProject } from '../store.ts';
import { concat, probe, upscale4k } from '../ffmpeg.ts';
import { attachJob } from './_job.ts';

const SIZES: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '21:9': { width: 2560, height: 1080 },
};

function sceneOrder(p: Project): string[] {
  if (p.script?.scenes.length) return [...p.script.scenes].sort((a, b) => a.order - b.order).map((s) => s.id);
  return (p.scenePrompts ?? []).map((s) => s.sceneId);
}

const newest = (cs: Clip[]) => [...cs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

/** Which clip plays for each beat. An approved sequence clip is placed at its first beat's position and the beats it
 *  covers are skipped. Preference per position: final sequence > final per-scene > draft sequence > draft. Exported for tests. */
export function pickClips(p: Project, opts: RunOptions): { sceneId: string; clip: Clip }[] {
  const out: { sceneId: string; clip: Clip }[] = [];
  const covered = new Set<string>();
  const usable = (c: Clip) => c.approved && c.status === 'done' && !!c.file && fs.existsSync(c.file.path);
  for (const sceneId of sceneOrder(p)) {
    if (covered.has(sceneId)) continue;
    if (opts.ids && !opts.ids.includes(sceneId)) continue;
    const single = (tier: Clip['tier']) => p.clips.filter((c) => c.sceneId === sceneId && c.tier === tier && (c.source ?? 'reference') !== 'sequence' && usable(c));
    const seq = (tier: Clip['tier']) => p.clips.filter((c) => c.source === 'sequence' && c.tier === tier && c.sceneIds?.[0] === sceneId && usable(c));
    const clip = newest(seq('final')) ?? newest(single('final')) ?? newest(seq('draft')) ?? newest(single('draft'));
    if (!clip) continue;
    out.push({ sceneId, clip });
    for (const id of clip.sceneIds ?? []) covered.add(id);
  }
  if (!out.length) throw new Error('nothing to export: approve at least one finished clip first');
  return out;
}

export async function estimate(_p: Project, _opts: RunOptions): Promise<Estimate> {
  return { usd: 0, items: [] };
}

export async function run(p: Project, opts: RunOptions, emit: Emit): Promise<Project> {
  const h = attachJob(p, 'export', emit);
  const chosen = pickClips(p, opts);
  const res = opts.resolution ?? '1080p';
  const covered = chosen.flatMap((c) => c.clip.sceneIds ?? [c.sceneId]);
  h.log(`exporting ${covered.length} scene(s) in ${chosen.length} clip(s) at ${res}: ${chosen.map((c) => `${(c.clip.sceneIds ?? [c.sceneId]).join('+')}(${c.clip.tier}${c.clip.source === 'sequence' ? ', one take' : ''})`).join(', ')}`);
  if (opts.dryRun) { h.log('dry run — nothing written'); return p; }

  const dir = mediaDir(p.slug, 'export');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const final = path.join(dir, `${p.slug}-${stamp}-${res}.mp4`);
  const music = p.brief.musicPath && fs.existsSync(p.brief.musicPath) ? p.brief.musicPath : undefined;
  const files = chosen.map((c) => c.clip.file!.path);
  const size = SIZES[p.aspect];

  if (res === '4k') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-export-'));
    try {
      const hd = await concat(files, path.join(tmp, 'hd.mp4'), { music, size });
      h.log('upscaling to 4K (lanczos + light grain)…');
      await upscale4k(hd, final, { grain: true });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  } else {
    await concat(files, final, { music, size });
  }

  const meta = await probe(final);
  const result: ExportResult = {
    file: { path: final, width: meta.width, height: meta.height, durationSec: meta.durationSec },
    resolution: res, sceneOrder: covered, musicPath: music, createdAt: new Date().toISOString(),
  };
  p.exports.push(result);
  h.addOutputs([result.file], 0);
  saveProject(p);
  h.log(`exported ${path.basename(final)} (${meta.width}x${meta.height}, ${meta.durationSec.toFixed(1)}s)`);
  return p;
}
