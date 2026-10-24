// fal.ai (provider `fal`, FAL_KEY). Heartcut's models (Higgsfield slugs, src/gen/models.ts) are mapped to the closest
// fal model per capability below. Several are the very same models Higgsfield hosts (Qwen Image 3, Recraft V4.1, Seedance 2.5).
//
// API, read 2026-10-24 (fal.ai/docs/llms.txt; fal.ai/docs/inference-api/queue/{submit,status,result,cancel}.md;
// fal.ai/docs/platform-apis/v1/models/pricing.md; github.com/fal-ai/fal-js libs/client/src/storage.ts):
//   submit   POST https://queue.fal.run/<model id>, flat JSON input, Authorization: Key <FAL_KEY>
//            -> {request_id, status_url, response_url, cancel_url}. Use the returned URLs: for ids with subpaths the
//            status/result URLs use only owner/app, so never build them by hand.
//   status   GET status_url: IN_QUEUE | IN_PROGRESS | COMPLETED. A failed job is also COMPLETED, with `error` set.
//   result   GET response_url: the model's output (images[].url, video.url). Kept 1 hour (6 min when >= 10 KB).
//   cancel   PUT cancel_url
//   check    GET https://api.fal.ai/v1/models/pricing?endpoint_id=<id> (auth required, no permissions, runs nothing)
//   NO idempotency header exists, so a submit is never repeated.
// Prices: static table from each model page (fal.ai/models/<id>/llms.txt), read 2026-10-24. Shown as "approx.".
// UNVERIFIED (no keyed call was made): the upload flow (POST https://rest.fal.ai/storage/upload/initiate?storage_type=
// fal-cdn-v3 {content_type, file_name} -> {upload_url, file_url}, then PUT the bytes) is from the fal-js source, not a
// REST doc page; Seedance 2.5's `duration` is sent as a string (the 2.0 schema is a string enum "4".."15"); Seedream v5
// lite's num_images cap (we ask for at most 4); whether a failed job is billed (we keep the reservation to be safe).
import fs from 'node:fs';
import path from 'node:path';
import { call, JobFailedError, mapLocalFiles, mimeOf, pollUntil } from './http.ts';
import { genKey } from './config.ts';
import { CINEMA, QWEN_EDIT, QWEN_T2I, RECRAFT, SEEDANCE, SEEDANCE_I2V, SOUL, Z_IMAGE } from './models.ts';
import type { HttpProvider, Quote } from './provider-types.ts';

export const FAL_QUEUE = (): string => (process.env.HEARTCUT_FAL_QUEUE_URL || 'https://queue.fal.run').replace(/\/+$/, '');
export const FAL_API = (): string => (process.env.HEARTCUT_FAL_API_URL || 'https://api.fal.ai').replace(/\/+$/, '');
export const FAL_REST = (): string => (process.env.HEARTCUT_FAL_REST_URL || 'https://rest.fal.ai').replace(/\/+$/, '');

const r3 = (n: number) => Math.round(n * 1000) / 1000;
type In = Record<string, unknown>;
const pick = (a: unknown, ok: string[], fallback: string): string => (typeof a === 'string' && ok.includes(a) ? a : fallback);

// fal's standard image_size presets (from the model OpenAPI files).
const SIZE: Record<string, string> = {
  '1:1': 'square_hd', '3:4': 'portrait_4_3', '2:3': 'portrait_4_3', '9:16': 'portrait_16_9', '4:5': 'portrait_4_3',
  '4:3': 'landscape_4_3', '3:2': 'landscape_4_3', '16:9': 'landscape_16_9', '21:9': 'landscape_16_9', '7:9': 'portrait_4_3', '9:7': 'landscape_4_3',
};
const sizeFor = (a: unknown): string => SIZE[String(a)] ?? 'landscape_16_9';
const batchOf = (i: In): number => Math.min(4, Math.max(1, Number(i.batch_size ?? 1)));

interface Route { id: string; label: string; build(input: In): In; usd(input: In): number; perCall: number; video?: boolean }

// bytedance/seedream/v5/lite/text-to-image: $0.035 per image; num_images in one call.
const seedream = (label: string): Route => ({
  id: 'bytedance/seedream/v5/lite/text-to-image', label, perCall: 4, usd: (i) => 0.035 * batchOf(i),
  build: (i) => ({ prompt: i.prompt, image_size: sizeFor(i.aspect_ratio), num_images: batchOf(i) }),
});
// bytedance/seedance-2.5/*: $/second of output, no video input (fal.ai/models/bytedance/seedance-2.5/reference-to-video).
const SEEDANCE_PER_SEC: Record<string, number> = { '480p': 0.2205, '720p': 0.473, '1080p': 1.164 };
const seedanceUsd = (i: In) => r3((SEEDANCE_PER_SEC[String(i.resolution)] ?? SEEDANCE_PER_SEC['720p']) * Number(i.duration ?? 5));
const SEEDANCE_ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

/** Heartcut model -> fal route. faces=SOUL, places=CINEMA, drawn=QWEN_T2I/Z_IMAGE/RECRAFT, edit=QWEN_EDIT, refVideo=SEEDANCE, i2v=SEEDANCE_I2V. */
export const FAL_ROUTES: Record<string, Route> = {
  [SOUL]: seedream('Seedream 5 Lite (faces)'),
  [CINEMA]: seedream('Seedream 5 Lite (places)'),
  [Z_IMAGE]: seedream('Seedream 5 Lite'),
  // alibaba/qwen-image-3/text-to-image: $0.04 at 1K, $0.075 at 2K per image.
  [QWEN_T2I]: { id: 'alibaba/qwen-image-3/text-to-image', label: 'Qwen Image 3', perCall: 1, usd: (i) => (i.resolution === '2k' ? 0.075 : 0.04),
    build: (i) => ({ prompt: i.prompt, image_size: sizeFor(i.aspect_ratio), num_images: 1 }) },
  // fal-ai/recraft/v4.1/text-to-image: $0.035 per image, no style parameter (the prompt carries the look).
  [RECRAFT]: { id: 'fal-ai/recraft/v4.1/text-to-image', label: 'Recraft V4.1', perCall: 1, usd: () => 0.035,
    build: (i) => ({ prompt: i.prompt, image_size: sizeFor(i.aspect_ratio) }) },
  // alibaba/qwen-image-3/edit: image_urls 1-3, $0.04 at 1K.
  [QWEN_EDIT]: { id: 'alibaba/qwen-image-3/edit', label: 'Qwen Image 3 edit', perCall: 1, usd: (i) => (i.resolution === '2k' ? 0.075 : 0.04),
    build: (i) => ({ prompt: i.prompt, image_urls: (Array.isArray(i.image_urls) ? i.image_urls : []).slice(0, 3) }) },
  // bytedance/seedance-2.5/reference-to-video: image_urls up to 30, 4-30 s, 480p/720p/1080p.
  [SEEDANCE]: { id: 'bytedance/seedance-2.5/reference-to-video', label: 'Seedance 2.5 (from sheets)', perCall: 1, video: true, usd: seedanceUsd,
    build: (i) => ({ prompt: i.prompt, image_urls: (Array.isArray(i.image_urls) ? i.image_urls : []).slice(0, 30), duration: String(i.duration ?? 5),
      resolution: pick(i.resolution, ['480p', '720p', '1080p'], '720p'), aspect_ratio: pick(i.aspect_ratio, SEEDANCE_ASPECTS, '16:9'), generate_audio: !!i.generate_audio }) },
  // bytedance/seedance-2.5/image-to-video: image_url + optional end_image_url.
  [SEEDANCE_I2V]: { id: 'bytedance/seedance-2.5/image-to-video', label: 'Seedance 2.5 (from a frame)', perCall: 1, video: true, usd: seedanceUsd,
    build: (i) => ({ prompt: i.prompt, image_url: i.image_url, ...(i.end_image_url ? { end_image_url: i.end_image_url } : {}), duration: String(i.duration ?? 5),
      resolution: pick(i.resolution, ['480p', '720p', '1080p'], '720p'), generate_audio: !!i.generate_audio }) },
};

function key(): string {
  const k = genKey('fal');
  if (!k) throw new Error('FAL_KEY is not set');
  return k;
}
const headers = () => ({ authorization: `Key ${key()}`, 'content-type': 'application/json', accept: 'application/json' });

async function upload(file: string): Promise<string> {
  const content_type = mimeOf(file);
  const r = await call(`${FAL_REST()}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ content_type, file_name: path.basename(file) }), what: 'fal upload initiate',
  });
  const { upload_url, file_url } = r.body ?? {};
  if (!upload_url || !file_url) throw new Error('fal upload: no upload_url in the answer');
  await call(upload_url, { method: 'PUT', headers: { 'content-type': content_type }, body: fs.readFileSync(file), what: 'fal upload', timeoutMs: 5 * 60_000 });
  return file_url;
}

const outputsOf = (b: any): string[] => [
  ...(Array.isArray(b?.images) ? b.images.map((x: any) => x?.url) : []),
  ...(b?.image?.url ? [b.image.url] : []),
  ...(b?.video?.url ? [b.video.url] : []),
].filter((u): u is string => typeof u === 'string' && !!u);

export const fal: HttpProvider & { routes: typeof FAL_ROUTES } = {
  id: 'fal',
  label: 'fal.ai',
  routes: FAL_ROUTES,
  supports: (model) => (FAL_ROUTES[model] ? undefined : `fal.ai has no model set up for ${model} in Heartcut`),
  modelFor: (model) => FAL_ROUTES[model]?.id,
  perCall: (model) => FAL_ROUTES[model]?.perCall ?? 1,

  async quote(model, input): Promise<Quote> {
    const r = FAL_ROUTES[model];
    if (!r) throw new Error(`fal.ai has no model for ${model}`);
    // Pictures the whole job makes: perCall-sized submits until batch_size is reached.
    const n = Math.max(1, Number(input.batch_size ?? 1));
    const per = r.perCall >= n ? r.usd(input) : r.usd({ ...input, batch_size: r.perCall }) * Math.ceil(n / r.perCall);
    return { usd: r3(r.video ? r.usd(input) : per), exact: false, source: `fal.ai/models/${r.id} price, 2026-10-24` };
  },

  async run(model, input, ctx) {
    const route = FAL_ROUTES[model];
    if (!route) throw new Error(`fal.ai has no model for ${model}`);
    const body = await mapLocalFiles(route.build(input), upload);
    // Submit once (fal has no idempotency key).
    const r = await call(`${FAL_QUEUE()}/${route.id}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), what: `fal submit ${route.id}`, submit: true, timeoutMs: 120_000 });
    const id: string = r.body?.request_id;
    if (!id) throw new Error('fal submit: no request_id in the answer');
    ctx.onSubmitted(id);
    ctx.emit?.(`submitted ${id}`);
    const statusUrl: string = r.body?.status_url;
    const responseUrl: string = r.body?.response_url;
    if (!statusUrl || !responseUrl) throw new JobFailedError('fal submit: no status_url in the answer', id);
    let last = '';
    await pollUntil(async () => {
      const s = await call(statusUrl, { method: 'GET', headers: headers(), what: 'fal status', timeoutMs: 30_000 });
      const st = String(s.body?.status ?? '');
      if (st !== last) { last = st; ctx.emit?.(`status: ${st.toLowerCase()}`); }
      if (st !== 'COMPLETED') return undefined;
      if (s.body?.error) throw new JobFailedError(`fal.ai generation failed: ${String(s.body.error).slice(0, 400)}`, id);
      return true;
    }, { what: `fal ${route.id}`, provider: 'fal.ai', intervalMs: 2000 });
    let out;
    try { out = await call(responseUrl, { method: 'GET', headers: headers(), what: 'fal result', timeoutMs: 60_000 }); } catch (e) {
      throw new JobFailedError(`fal.ai generation failed: ${(e as Error).message.slice(0, 400)}`, id);
    }
    const urls = outputsOf(out.body);
    if (!urls.length) throw new JobFailedError('fal.ai finished but returned no file', id);
    return { urls, requestId: id };
  },

  async check() {
    await call(`${FAL_API()}/v1/models/pricing?endpoint_id=${encodeURIComponent(FAL_ROUTES[SOUL].id)}`, { method: 'GET', headers: headers(), what: 'fal check', timeoutMs: 20_000 });
    return { ok: true, detail: 'Key accepted (price list read; nothing was generated).' };
  },
};
