// Shared by the generating stages (images/clips/export): attach to the Job the pipeline created.
import type { Emit, Job, MediaFile, Project, Stage } from '../types.ts';
import { saveProject, updateJob } from '../store.ts';

export interface JobHandle {
  /** Emit a line and append it to the job log (if a running job exists for this stage). */
  log: Emit;
  addOutputs(files: MediaFile[], usd: number): void;
  job?: Job;
}

/** The pipeline (A) creates the Job and passes nothing extra, so find the latest running one. */
export function attachJob(p: Project, stage: Stage, emit: Emit): JobHandle {
  const job = [...p.jobs].reverse().find((j) => j.stage === stage && j.status === 'running');
  return {
    job,
    // The pipeline's emit persists every line into the job log; pushing here too doubled them.
    log(line) { emit(line); },
    addOutputs(files, usd) {
      if (!job) return;
      updateJob(p, job.id, { outputs: [...job.outputs, ...files], actualUsd: Math.round(((job.actualUsd ?? 0) + usd) * 1000) / 1000 });
      saveProject(p);
    },
  };
}

export const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
