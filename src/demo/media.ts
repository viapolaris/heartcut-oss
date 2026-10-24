// Placeholder media for HEARTCUT_FAKE=1, the demo and tests. No network, no provider.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const FFMPEG = process.env.HEARTCUT_FFMPEG || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');

export function tinyPng(): Buffer {
  return Buffer.from(PNG_B64, 'base64');
}

let cachedMp4: string | undefined;

/** A 1-second 64x36 12fps MP4, generated once per process into a cached temp file. */
export function tinyMp4Path(): string {
  if (cachedMp4 && fs.existsSync(cachedMp4)) return cachedMp4;
  const f = path.join(os.tmpdir(), `heartcut-tiny-${process.getuid?.() ?? 0}.mp4`);
  if (!fs.existsSync(f) || fs.statSync(f).size === 0) {
    const tmp = `${f}.${process.pid}.tmp.mp4`;
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x36:rate=12', '-pix_fmt', 'yuv420p', tmp]);
    fs.renameSync(tmp, f);
  }
  cachedMp4 = f;
  return f;
}

export function tinyMp4(): Buffer {
  return fs.readFileSync(tinyMp4Path());
}
