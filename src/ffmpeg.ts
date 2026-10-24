// ffmpeg/ffprobe helpers: probe, normalize+concat (+music), 4K upscale.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const bin = (name: 'ffmpeg' | 'ffprobe') => {
  const env = process.env[`HEARTCUT_${name.toUpperCase()}`];
  if (env) return env;
  const brew = `/opt/homebrew/bin/${name}`;
  return fs.existsSync(brew) ? brew : name;
};

function exec(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(file)} failed: ${String(stderr).trim().split('\n').slice(-5).join('\n')}`));
      else resolve(stdout);
    });
  });
}

export interface Probe { width: number; height: number; durationSec: number; hasAudio: boolean }

export async function probe(file: string): Promise<Probe> {
  const out = JSON.parse(await exec(bin('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
  const v = (out.streams ?? []).find((s: any) => s.codec_type === 'video');
  if (!v) throw new Error(`no video stream in ${file}`);
  const dur = Number(out.format?.duration ?? v.duration ?? 0);
  return {
    width: v.width,
    height: v.height,
    durationSec: Number.isFinite(dur) ? dur : 0,
    hasAudio: (out.streams ?? []).some((s: any) => s.codec_type === 'audio'),
  };
}

export interface ConcatOpts {
  music?: string;
  fadeSec?: number;
  /** Target frame size; default = the first input's size. */
  size?: { width: number; height: number };
  fps?: number;
}

// Every input is re-encoded to one size/fps/pix_fmt/audio layout so the concat demuxer can join
// them safely. Clips without audio get silence so every segment has the same streams.
async function normalize(input: string, out: string, size: { width: number; height: number }, fps: number): Promise<void> {
  const { width: w, height: h } = size;
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`;
  const info = await probe(input);
  const args = ['-v', 'error', '-y', '-i', input];
  if (!info.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  args.push('-map', '0:v:0', '-map', info.hasAudio ? '0:a:0' : '1:a:0', '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out);
  await exec(bin('ffmpeg'), args);
}

export async function concat(files: string[], out: string, opts: ConcatOpts = {}): Promise<string> {
  if (!files.length) throw new Error('concat: no input files');
  const size = opts.size ?? await probe(files[0]);
  const fps = opts.fps ?? 24;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heartcut-concat-'));
  try {
    const parts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const part = path.join(tmp, `part${i}.mp4`);
      await normalize(files[i], part, size, fps);
      parts.push(part);
    }
    const list = path.join(tmp, 'list.txt');
    // Names relative to the list file (all parts sit next to it), so no drive letter or backslash needs escaping on Windows.
    fs.writeFileSync(list, parts.map((f) => `file '${path.basename(f)}'`).join('\n'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (!opts.music) {
      await exec(bin('ffmpeg'), ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
      return out;
    }
    const joined = path.join(tmp, 'joined.mp4');
    await exec(bin('ffmpeg'), ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
    const total = (await probe(joined)).durationSec;
    const fade = opts.fadeSec ?? 1;
    // Music sits under the clip audio; the whole mix fades out over the last `fade` seconds.
    const fc = `[1:a]volume=0.5[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0,afade=t=out:st=${Math.max(0, total - fade).toFixed(3)}:d=${fade}[a]`;
    await exec(bin('ffmpeg'), ['-v', 'error', '-y', '-i', joined, '-i', opts.music, '-filter_complex', fc,
      '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Lanczos to 3840 on the long edge (portrait scales height instead of an absurd 3840-wide frame). */
export async function upscale4k(input: string, out: string, opts: { grain?: boolean } = {}): Promise<string> {
  const { width, height } = await probe(input);
  const scale = height > width ? 'scale=-2:3840:flags=lanczos' : 'scale=3840:-2:flags=lanczos';
  const vf = opts.grain ? `${scale},noise=alls=6:allf=t` : scale;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await exec(bin('ffmpeg'), ['-v', 'error', '-y', '-i', input, '-vf', vf, '-c:v', 'libx264', '-crf', '17', '-preset', process.env.HEARTCUT_X264_PRESET || 'slow',
    '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
  return out;
}
