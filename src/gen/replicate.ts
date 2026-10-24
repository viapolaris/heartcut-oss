// Replicate (provider `replicate`, REPLICATE_API_TOKEN). Heartcut's models (Higgsfield slugs, src/gen/models.ts) are
// mapped to the closest official Replicate model per capability below.
//
// API, read 2026-10-24 from replicate.com/docs/reference/http, docs/topics/predictions/create-a-prediction and the
// public spec https://api.replicate.com/openapi.json:
//   create   POST https://api.replicate.com/v1/models/{owner}/{name}/predictions, body {input:{...}},
//            Authorization: Bearer <token>; 201/202 -> {id, status, urls:{get,cancel}, output, error}
//            Cancel-After header (e.g. "20m") makes Replicate stop a prediction that runs too long.
//   status   GET /v1/predictions/{id}: starting | processing | succeeded | failed | canceled | aborted
//   output   a string URL or an array of URLs, depending on the model; deleted after 1 hour, so we download at once
//   files    inputs take data: URLs (spec: use them up to 256 KB) or HTTP URLs; POST /v1/files (multipart, field
//            `content`) returns {urls:{get}} for bigger files
//   check    GET /v1/account -> {type, username}: free, runs nothing
//   NO idempotency key anywhere in the spec, so a submit is never repeated, ever.
//   NO price in the API. Prices below come from each model's public page (its billingConfig), read 2026-10-24.
// UNVERIFIED: passing a Files API `urls.get` URL as a model input (the official clients do this; the spec does not say
// it); whether a failed prediction on an official model is billed (we keep the reservation to be safe);
// qwen-image-edit-plus taking more than 3 pictures (we send at most 3, like Higgsfield's Qwen edit).
import fs from 'node:fs';
import path from 'node:path';
import { call, dataUri, JobFailedError, mapLocalFiles, mimeOf, pollUntil } from './http.ts';
import { genKey } from './config.ts';
import { CINEMA, QWEN_EDIT, QWEN_T2I, RECRAFT, SEEDANCE, SEEDANCE_I2V, SOUL, Z_IMAGE } from './models.ts';
import type { HttpProvider, Quote } from './provider-types.ts';

export const REPLICATE_BASE = (): string => (process.env.HEARTCUT_REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/, '');
const DATA_URI_MAX = 256 * 1024;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
type In = Record<string, unknown>;
const pick = (a: unknown, ok: string[], fallback: string): string => (typeof a === 'string' && ok.includes(a) ? a : fallback);

interface Route {
  id: string;                     // owner/name of the official model
  label: string;
  build(input: In): In;           // Heartcut input -> Replicate input (one prediction)
  usd(input: In): number;         // price of one prediction, from the model page
  /** Pictures one prediction makes. A Heartcut batch_size above this runs several predictions. */
  perCall: number;
  video?: boolean;
}

const FLUX_ASPECTS = ['1:1', '16:9', '3:2', '2:3', '4:5', '5:4', '9:16', '3:4', '4:3'];
const QWEN_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
const RECRAFT_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '2:1', '1:2'];
const SEEDANCE_ASPECTS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', '9:21'];
// replicate.com/bytedance/seedance-2.5, non_video_in tier, $/second of output (2026-10-24).
const SEEDANCE_PER_SEC: Record<string, number> = { '480p': 0.1028, '720p': 0.2312 };
const seedanceUsd = (i: In) => r3((SEEDANCE_PER_SEC[String(i.resolution)] ?? SEEDANCE_PER_SEC['720p']) * Number(i.duration ?? 5));

// Flux 1.1 Pro: $0.04/image (replicate.com/black-forest-labs/flux-1.1-pro). One image per prediction.
const flux = (label: string): Route => ({
  id: 'black-forest-labs/flux-1.1-pro', label, perCall: 1, usd: () => 0.04,
  build: (i) => ({ prompt: i.prompt, aspect_ratio: pick(i.aspect_ratio, FLUX_ASPECTS, '16:9'), output_format: 'png', safety_tolerance: 2 }),
});

/** Heartcut model -> Replicate route. Capabilities: faces=SOUL, places=CINEMA, drawn=QWEN_T2I/Z_IMAGE/RECRAFT, edit=QWEN_EDIT, refVideo=SEEDANCE, i2v=SEEDANCE_I2V. */
export const REPLICATE_ROUTES: Record<string, Route> = {
  [SOUL]: flux('Flux 1.1 Pro (faces)'),
  [CINEMA]: flux('Flux 1.1 Pro (places)'),
  // qwen/qwen-image: $0.025/image.
  [QWEN_T2I]: { id: 'qwen/qwen-image', label: 'Qwen-Image', perCall: 1, usd: () => 0.025,
    build: (i) => ({ prompt: i.prompt, aspect_ratio: pick(i.aspect_ratio, QWEN_ASPECTS, '16:9'), output_format: 'png' }) },
  // black-forest-labs/flux-schnell: $3 per 1000 images; num_outputs 1-4.
  [Z_IMAGE]: { id: 'black-forest-labs/flux-schnell', label: 'Flux Schnell', perCall: 1, usd: () => 0.003,
    build: (i) => ({ prompt: i.prompt, aspect_ratio: pick(i.aspect_ratio, FLUX_ASPECTS, '16:9'), num_outputs: 1, output_format: 'png' }) },
  // recraft-ai/recraft-v3: $0.04/image; `style` left at its default ("any") so the prompt's look decides.
  [RECRAFT]: { id: 'recraft-ai/recraft-v3', label: 'Recraft V3', perCall: 1, usd: () => 0.04,
    build: (i) => ({ prompt: i.prompt, aspect_ratio: pick(i.aspect_ratio, RECRAFT_ASPECTS, '16:9') }) },
  // qwen/qwen-image-edit-plus: $0.03/image; `image` is an ARRAY of pictures.
  [QWEN_EDIT]: { id: 'qwen/qwen-image-edit-plus', label: 'Qwen-Image-Edit Plus', perCall: 1, usd: () => 0.03,
    build: (i) => ({ prompt: i.prompt, image: (Array.isArray(i.image_urls) ? i.image_urls : []).slice(0, 3), output_format: 'png' }) },
  // bytedance/seedance-2.5: reference_images up to 30; first/last frame mode needs aspect_ratio "adaptive" and
  // cannot be combined with reference fields.
  [SEEDANCE]: { id: 'bytedance/seedance-2.5', label: 'Seedance 2.5 (from sheets)', perCall: 1, video: true, usd: seedanceUsd,
    build: (i) => ({ prompt: i.prompt, reference_images: (Array.isArray(i.image_urls) ? i.image_urls : []).slice(0, 30), duration: i.duration,
      resolution: pick(i.resolution, ['480p', '720p'], '720p'), aspect_ratio: pick(i.aspect_ratio, SEEDANCE_ASPECTS, '16:9'), generate_audio: !!i.generate_audio, output_format: 'mp4' }) },
  [SEEDANCE_I2V]: { id: 'bytedance/seedance-2.5', label: 'Seedance 2.5 (from a frame)', perCall: 1, video: true, usd: seedanceUsd,
    build: (i) => ({ prompt: i.prompt, image: i.image_url, ...(i.end_image_url ? { last_frame_image: i.end_image_url } : {}), duration: i.duration,
      resolution: pick(i.resolution, ['480p', '720p'], '720p'), aspect_ratio: 'adaptive', generate_audio: !!i.generate_audio, output_format: 'mp4' }) },
};

function token(): string {
  const t = genKey('replicate');
  if (!t) throw new Error('REPLICATE_API_TOKEN is not set');
  return t;
}
const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token()}`, 'content-type': 'application/json', accept: 'application/json', ...extra });

async function fileUrl(file: string): Promise<string> {
  if (fs.statSync(file).size <= DATA_URI_MAX) return dataUri(file);
  const form = new FormData();
  form.append('content', new Blob([fs.readFileSync(file)], { type: mimeOf(file) }), path.basename(file));
  form.append('filename', path.basename(file));
  form.append('type', mimeOf(file));
  const r = await call(`${REPLICATE_BASE()}/files`, { method: 'POST', headers: { authorization: `Bearer ${token()}` }, body: form, what: 'replicate file upload', timeoutMs: 5 * 60_000 });
  const url = r.body?.urls?.get;
  if (!url) throw new Error('replicate file upload: no urls.get in the answer');
  return url;
}

const outputsOf = (o: unknown): string[] => (Array.isArray(o) ? o : [o]).filter((u): u is string => typeof u === 'string' && /^https?:/.test(u));

export const replicate: HttpProvider & { routes: typeof REPLICATE_ROUTES; perCall(model: string): number } = {
  id: 'replicate',
  label: 'Replicate',
  routes: REPLICATE_ROUTES,
  supports: (model) => (REPLICATE_ROUTES[model] ? undefined : `Replicate has no model set up for ${model} in Heartcut`),
  modelFor: (model) => REPLICATE_ROUTES[model]?.id,
  perCall: (model) => REPLICATE_ROUTES[model]?.perCall ?? 1,

  async quote(model, input): Promise<Quote> {
    const r = REPLICATE_ROUTES[model];
    if (!r) throw new Error(`Replicate has no model for ${model}`);
    return { usd: r3(r.usd(input) * Math.max(1, Number(input.batch_size ?? 1))), exact: false, source: `replicate.com/${r.id} price, 2026-10-24` };
  },

  async run(model, input, ctx) {
    const route = REPLICATE_ROUTES[model];
    if (!route) throw new Error(`Replicate has no model for ${model}`);
    const mapped = (await mapLocalFiles(route.build(input), fileUrl)) as In;
    const limitSec = Number(process.env.HEARTCUT_GEN_TIMEOUT_SEC || 1200);
    // Submit once (no idempotency key on Replicate). Cancel-After stops a stuck prediction on Replicate's side.
    const r = await call(`${REPLICATE_BASE()}/models/${route.id}/predictions`, {
      method: 'POST', headers: headers({ 'cancel-after': `${Math.max(1, Math.ceil(limitSec / 60))}m` }), body: JSON.stringify({ input: mapped }),
      what: `replicate submit ${route.id}`, submit: true, timeoutMs: 120_000,
    });
    const id: string = r.body?.id;
    if (!id) throw new Error('replicate submit: no prediction id in the answer');
    ctx.onSubmitted(id);
    ctx.emit?.(`submitted ${id}`);
    const getUrl: string = r.body?.urls?.get || `${REPLICATE_BASE()}/predictions/${id}`;
    let last = '';
    const done = await pollUntil(async () => {
      const s = await call(getUrl, { method: 'GET', headers: headers(), what: 'replicate status', timeoutMs: 30_000 });
      const st = String(s.body?.status ?? '');
      if (st !== last) { last = st; ctx.emit?.(`status: ${st}`); }
      if (st === 'succeeded') return s.body;
      if (st === 'failed' || st === 'canceled' || st === 'aborted') {
        throw new JobFailedError(`Replicate prediction ${st}${s.body?.error ? `: ${String(s.body.error).slice(0, 400)}` : ''}`, id, st === 'aborted' ? false : undefined);
      }
      return undefined;
    }, { what: `replicate ${route.id}`, provider: 'Replicate', intervalMs: 2000 });
    const urls = outputsOf(done.output);
    if (!urls.length) throw new JobFailedError('Replicate finished but returned no file', id);
    return { urls, requestId: id };
  },

  async check() {
    const r = await call(`${REPLICATE_BASE()}/account`, { method: 'GET', headers: headers(), what: 'replicate check', timeoutMs: 20_000 });
    return { ok: true, detail: `Token accepted${r.body?.username ? ` (${r.body.username})` : ''}.` };
  },
};
