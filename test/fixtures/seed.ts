// Builds a project that already has script, sheets and chosen sheet images (placeholder PNGs), no LLM involved.
import fs from 'node:fs';
import path from 'node:path';
import { FAKE_SCRIPT, FAKE_SHEETS, DEMO_BRIEF } from '../../src/demo/demo.ts';
import { tinyPng } from '../../src/demo/media.ts';
import type { Project } from '../../src/types.ts';

type Store = typeof import('../../src/store.ts');

export function seedProject(store: Store, title: string, opts: { sheets?: boolean } = {}): Project {
  const p = store.createProject({ title, briefText: DEMO_BRIEF });
  p.script = structuredClone(FAKE_SCRIPT);
  p.sheets = structuredClone(FAKE_SHEETS);
  if (opts.sheets !== false) {
    const dir = store.mediaDir(p.slug, 'assets');
    for (const item of p.sheets.items) {
      const file = path.join(dir, `${item.id}-0.png`);
      fs.writeFileSync(file, tinyPng());
      p.assets.push({ ...item, model: 'test', options: [{ path: file }, { path: file }], chosen: 0 });
    }
  }
  store.saveProject(p);
  return p;
}
