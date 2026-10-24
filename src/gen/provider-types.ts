// The shape every HTTP generation provider implements (src/gen/higgsfield-api.ts, fal.ts, replicate.ts).
// Stages never see this: they call src/gen/provider.ts with Heartcut's model slugs and inputs.
import type { Emit } from '../types.ts';
import type { GenProvider } from './config.ts';

export interface Quote {
  usd: number;
  /** true = the provider's own number for this exact job; false = Heartcut's static table ("approx." in the UI). */
  exact: boolean;
  source: string;
}

export interface RunCtx {
  emit?: Emit;
  /** Sent where the API supports one, so a duplicate submit can never bill twice. */
  idempotencyKey: string;
  /** Called the moment the provider accepted the job, with its id. */
  onSubmitted(requestId: string): void;
}

export interface HttpProvider {
  id: Exclude<GenProvider, 'higgsfield-tool'>;
  label: string;
  /** undefined when the provider can run this Heartcut model; otherwise a plain reason. */
  supports(model: string, input?: Record<string, unknown>): string | undefined;
  /** The provider's model id that stands in for a Heartcut model (for notes and the settings table). */
  modelFor(model: string): string | undefined;
  /** Pictures one submit makes for this model. When below the input's batch_size, the layer submits several times
   *  (one at a time). Absent = the provider honours batch_size itself. */
  perCall?(model: string): number;
  quote(model: string, input: Record<string, unknown>): Promise<Quote>;
  /** Submit once, poll by id, return the output URLs. `usd` when the provider reports the actual cost. */
  run(model: string, input: Record<string, unknown>, ctx: RunCtx): Promise<{ urls: string[]; requestId: string; usd?: number; downloadHeaders?: Record<string, string> }>;
  /** A free, read-only call that proves the key works. Never a generation. */
  check(): Promise<{ ok: boolean; detail: string }>;
}
