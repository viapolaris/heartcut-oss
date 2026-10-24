// Find a program on PATH, the way a shell would. On Windows it tries each PATHEXT extension (.EXE, .CMD, ...),
// so an npm-installed `claude.cmd` is found as `claude`. No spawn, no `which` or `where` command.
import fs from 'node:fs';
import path from 'node:path';

export function findOnPath(bin: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  const delim = platform === 'win32' ? ';' : ':';
  for (const dir of (env.PATH ?? env.Path ?? '').split(delim)) {
    if (!dir) continue;
    for (const ext of exts) {
      const f = path.join(dir, bin + ext);
      try { fs.accessSync(f, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* next */ }
    }
  }
  return null;
}
