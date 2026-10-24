// The one entry point for server and CLI: dispatch a stage, record it as a Job.
import type { Emit, Estimate, JobKind, Project, RunOptions, Stage } from './types.ts';
import { addJob, loadProject, saveProject, stamp, updateJob } from './store.ts';
import * as script from './stages/script.ts';
import * as sheets from './stages/sheets.ts';
import * as scenes from './stages/scenes.ts';
import * as keyframes from './stages/keyframes.ts';

interface StageModule {
  run(p: Project, opts: RunOptions, emit: Emit): Promise<Project>;
  estimate(p: Project, opts: RunOptions): Promise<Estimate>;
}

/** Stages that run on the Claude plan: free, never priced, and they write real content even in a dry run. */
export const LLM_STAGES = new Set<Stage>(['script', 'sheets', 'scenes']);

const JOB_KIND: Record<Exclude<Stage, 'brief'>, JobKind> = {
  script: 'script', sheets: 'sheets', scenes: 'scenes', keyframes: 'keyframe', images: 'image', clips: 'clip', export: 'export',
};

async function moduleFor(stage: Exclude<Stage, 'brief'>): Promise<StageModule> {
  if (stage === 'script') return script;
  if (stage === 'sheets') return sheets;
  if (stage === 'scenes') return scenes;
  if (stage === 'keyframes') return keyframes;
  // Generation stages belong to another builder; load lazily so LLM stages work without them.
  try {
    return (await import(`./stages/${stage}.ts`)) as StageModule;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') throw new Error(`stage ${stage} not available yet`);
    throw e;
  }
}

// What a stage needs to already exist on the project.
export function guard(p: Project, stage: Stage): void {
  const need = (ok: unknown, msg: string) => { if (!ok) throw new Error(`cannot run ${stage}: ${msg}`); };
  switch (stage) {
    case 'brief': need(p.brief.text.trim().length >= 40, 'brief text must be at least 40 characters'); break;
    case 'script': need(p.brief.text.trim().length >= 40, 'brief text must be at least 40 characters'); break;
    case 'sheets': need(p.script, 'run the script stage first'); break;
    case 'images': need(p.sheets, 'run the sheets stage first'); break;
    case 'scenes': need(p.sheets, 'run the sheets stage first'); break;
    case 'keyframes': {
      need(p.scenePrompts, 'run the scenes stage first');
      const unpicked = [...new Set((p.scenePrompts ?? []).flatMap((sp) => sp.refAssetIds))]
        .filter((id) => { const a = p.assets.find((x) => x.id === id); return !a || a.chosen === undefined || !a.options[a.chosen]; });
      need(!unpicked.length, `pick a picture for ${unpicked.join(', ')} in Images first`);
      break;
    }
    case 'clips': need(p.scenePrompts, 'run the scenes stage first'); break;
    case 'export': need(p.clips.length, 'run the clips stage first'); break;
  }
}

export async function runStage(slug: string, stage: Stage, opts: RunOptions, emit: Emit): Promise<Project> {
  const p = loadProject(slug);
  guard(p, stage);
  if (stage === 'brief') {
    emit('brief ok');
    return p;
  }
  const mod = await moduleFor(stage);
  const job = addJob(p, { kind: JOB_KIND[stage], stage, input: opts });
  updateJob(p, job.id, { status: 'running' });
  saveProject(p);
  const lines: string[] = [];
  // Persist progress as it happens: a reload mid-run must show what the job is doing, and an
  // interrupted job must leave a trail. Stages that pass `p` through keep the same job object.
  // No stage reloads from disk mid-run, so `p` (and `job` inside it) is the single live copy.
  const tee: Emit = (line) => {
    lines.push(line);
    emit(line);
    job.log = [...lines];
    try { saveProject(p); } catch { /* progress is best-effort; the stage result is what matters */ }
  };
  try {
    const out = await mod.run(p, opts, tee);
    updateJob(out, job.id, { status: 'done', finishedAt: new Date().toISOString(), log: [...lines] });
    // A dry run prices and changes nothing, so it must not make downstream stages stale. The LLM stages are the
    // exception: they cost nothing, ignore dryRun and always write real content, so they always stamp.
    if (!opts.dryRun || LLM_STAGES.has(stage)) stamp(out, stage);
    saveProject(out);
    return out;
  } catch (e) {
    // Reload: the stage may have saved partial progress before failing.
    const fresh = loadProject(slug);
    updateJob(fresh, job.id, { status: 'failed', finishedAt: new Date().toISOString(), error: (e as Error).message, log: lines });
    saveProject(fresh);
    throw e;
  }
}

export async function estimateStage(slug: string, stage: Stage, opts: RunOptions): Promise<Estimate> {
  const p = loadProject(slug);
  if (stage === 'brief') return { usd: 0, items: [] };
  guard(p, stage);
  return (await moduleFor(stage)).estimate(p, opts);
}
