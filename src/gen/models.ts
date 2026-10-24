// Routing table (docs/CONTRACT.md) as code: which Higgsfield model, which exact input fields.
//
// Verified 2026-10-10 with real `higgsfield.mjs run ... --dry-run` (free, nothing submitted):
//   soul/v2/standard   {prompt,resolution:1080p,aspect_ratio,batch_size:4,enhance_prompt:false} -> $0.023 for 4
//   soul/cinema        same fields, batch_size:4 is accepted                                    -> $0.022 for 4
//   qwen-image-3/edit  needs `image_urls` (ARRAY) — NOT `image_url`: /estimate 400s with
//                      "'image_urls' is a required property". `resolution` is '1k'|'2k' (not 1080p);
//                      aspect_ratio/batch_size are silently ignored. Returns ONE image.      -> $0.040
//   seedance-2.5/reference-to-video  /estimate returns {type:"description"} (formula, no flat
//                      number), so the tool treats it as UNPRICED: `run` needs --allow-unpriced and
//                      the spend cap counts it at $2.50 worst case. We price it ourselves below.
//
// Style models (v3), probed 2026-10-11 with `estimate` (it validates enums and required fields; unknown
// keys are silently ignored, so a field that is not listed below is NOT part of the schema) and confirmed
// with `run ... --dry-run` (free):
//   alibaba/qwen-image-3/text-to-image  {prompt, resolution:'1k'|'2k', aspect_ratio:1:1 2:3 3:2 3:4 4:3 7:9 9:7 9:16 16:9 21:9}
//                      no batch field -> 4 sequential calls.  1k $0.040, 2k $0.075 per image
//   z-image/turbo      {prompt, resolution:'1k'|'2k', aspect_ratio: same list as qwen}  no batch field -> 4 calls. $0.015 per image
//   recraft/v4.1/text-to-image  {prompt, resolution:'1k' (2k is rejected), aspect_ratio:1:1 2:1 1:2 3:2 2:3 4:3 3:4 5:4 4:5
//                      6:10 14:10 10:14 16:9 9:16 (no 21:9), output_format:'png'|'jpg'|'webp', colors?, background_color?}
//                      no batch field, no style field -> 4 calls. $0.035 per image
//   soul/v2/standard   also takes style_id (a Soul style UUID from `higgsfield.mjs styles`)
// Local file paths inside --input (image_url, image_urls[]) are uploaded by the tool automatically
// (uploadLocalPaths in higgsfield.mjs), so we never call upload() for generation inputs.
import type { Aspect, AssetKind, ClipSource, ClipTier, ScenePrompt, StyleSpec } from '../types.ts';

export const SOUL = 'higgsfield-ai/soul/v2/standard';
export const QWEN_EDIT = 'alibaba/qwen-image-3/edit';
export const CINEMA = 'higgsfield-ai/soul/cinema';
export const QWEN_T2I = 'alibaba/qwen-image-3/text-to-image';
export const Z_IMAGE = 'z-image/turbo';
export const RECRAFT = 'recraft/v4.1/text-to-image';
// Local MLX models (src/gen/local.ts): free, run on this Mac. Slugs are ours, not Higgsfield's.
export const LOCAL_QWEN = 'local/qwen-image';
export const LOCAL_Z = 'local/z-image-turbo';
/** Local photo edit (selfie -> sheet, face -> other sheets). Apache-2.0 Qwen-Image-Edit-2511 on MLX. */
export const LOCAL_EDIT = 'local/qwen-image-edit';
export const SEEDANCE = 'bytedance/seedance-2.5/reference-to-video';
// Image-to-video (v5 keyframes): required `image_url`, optional `end_image_url`; NO aspect_ratio (the still sets the
// framing) and NO image_urls (the keyframe carries identity). Same resolution/duration/generate_audio/output_format fields.
export const SEEDANCE_I2V = 'bytedance/seedance-2.5/image-to-video';

// Soul/Cinema accept 9:16 16:9 4:3 3:4 1:1 2:3 3:2 — no 21:9.
const SOUL_ASPECTS = new Set(['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2']);
export function soulAspect(a: Aspect | string): string {
  return SOUL_ASPECTS.has(a) ? a : '16:9';
}

/** Image models a style may route faces/places to. `usd` is the price of one 4-option sheet. `kind: 'photo'`
 *  models only draw photographs, so they cannot serve anime/cartoon/illustration/3d styles. `calls` is how many
 *  submits one sheet takes: Soul takes batch_size:4 in one call; the others have no batch field, so we loop. */
export interface ImageModelInfo { label: string; usd: number; kind: 'photo' | 'any'; calls: number; local?: boolean }
export const IMAGE_MODELS: Record<string, ImageModelInfo> = {
  [SOUL]: { label: 'Soul 2', usd: 0.023, kind: 'photo', calls: 1 },
  [CINEMA]: { label: 'Soul Cinema', usd: 0.022, kind: 'photo', calls: 1 },
  [QWEN_T2I]: { label: 'Qwen Image 3', usd: 0.16, kind: 'any', calls: 4 },
  [Z_IMAGE]: { label: 'Z-Image Turbo', usd: 0.06, kind: 'any', calls: 4 },
  [RECRAFT]: { label: 'Recraft V4.1', usd: 0.14, kind: 'any', calls: 4 },
  [LOCAL_QWEN]: { label: 'Qwen-Image · local GPU · free', usd: 0, kind: 'any', calls: 4, local: true },
  [LOCAL_Z]: { label: 'Z-Image Turbo · local GPU · free', usd: 0, kind: 'any', calls: 4, local: true },
  [LOCAL_EDIT]: { label: 'Qwen-Image-Edit · local GPU · free · from your photo', usd: 0, kind: 'any', calls: 2, local: true },
};
export const isLocalModel = (model: string): boolean => !!IMAGE_MODELS[model]?.local;
/** Higgsfield model -> the local model that stands in for it when "render on this Mac" is on. */
export const TO_LOCAL: Record<string, string> = { [QWEN_T2I]: LOCAL_QWEN, [Z_IMAGE]: LOCAL_Z };
/** Local model -> its paid Higgsfield twin (used only when the worker cannot run at all; this COSTS MONEY). */
export const LOCAL_TWIN: Record<string, string> = { [LOCAL_QWEN]: QWEN_T2I, [LOCAL_Z]: Z_IMAGE, [LOCAL_EDIT]: QWEN_EDIT };
/** Identity-lock models (selfie in, redraw in the style out). One image per call. */
export const IDENTITY_MODELS: Record<string, { label: string; usd: number }> = {
  [QWEN_EDIT]: { label: 'Qwen Image 3 edit', usd: 0.04 },
};

const DEFAULT_MODELS = { faces: SOUL, places: CINEMA, identity: QWEN_EDIT };

export function sheetModel(kind: AssetKind, hasIdentityRef: boolean, style?: Pick<StyleSpec, 'models'>): string {
  const m = { ...DEFAULT_MODELS, ...style?.models };
  if (kind === 'location') return m.places;
  return hasIdentityRef ? (m.identity || QWEN_EDIT) : m.faces;
}

/** Drawn-medium text-to-image models that can stand in for each other when one is down. Photo models and the identity edit have none. */
export const FALLBACK: Record<string, string> = {
  [QWEN_T2I]: Z_IMAGE,
  [Z_IMAGE]: QWEN_T2I,
  [RECRAFT]: QWEN_T2I,
  [LOCAL_QWEN]: LOCAL_Z,
};

/** A generation Higgsfield refused or failed outright (not billed). A timeout ("gave up after") is NOT this: it may still be running. */
export function isModelUnavailable(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /temporarily unavailable|model .*unavailable|service unavailable|503/i.test(m) && /not charged|generation failed/i.test(m);
}

/** Submits needed for one sheet on this model (4 options either way, except identity edit: 1 image). */
export function callsPerSheet(model: string): number {
  return IMAGE_MODELS[model]?.calls ?? 1;
}

// Recraft has no 21:9; 2:1 is the closest.
const RECRAFT_ASPECTS = new Set(['1:1', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16']);
const QWEN_ASPECTS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '7:9', '9:7', '9:16', '16:9', '21:9']);
export function aspectFor(model: string, a: Aspect | string): string {
  if (model === SOUL || model === CINEMA) return soulAspect(a);
  if (model === RECRAFT) return RECRAFT_ASPECTS.has(a) ? a : a === '21:9' ? '2:1' : '16:9';
  return QWEN_ASPECTS.has(a) ? a : '16:9';
}

// Local renders: ~1 megapixel, multiples of 16.
const LOCAL_SIZES: Record<string, [number, number]> = {
  '3:4': [896, 1152], '2:3': [832, 1248], '16:9': [1280, 720], '1:1': [1024, 1024], '9:16': [720, 1280],
  '4:3': [1152, 896], '3:2': [1248, 832], '21:9': [1344, 576],
};
export function localSize(a: Aspect | string): { width: number; height: number } {
  const [width, height] = LOCAL_SIZES[a] ?? LOCAL_SIZES['16:9'];
  return { width, height };
}

/**
 * `{{char:id}}` / `{{loc:id}}` are Heartcut's own references (prompts/blocks.md): the scenes and keyframes stages
 * turn them into reference pictures. They never go to a picture or video model as text. This removes them and
 * tidies the spaces and commas they leave. Stored prompts keep them; only what is sent is cleaned.
 */
export const REF_TAG = /\{\{(char|loc):([^}]+)\}\}/g;
export function stripRefTags(text: string): string {
  if (!text.includes('{{')) return text;
  return text.replace(REF_TAG, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:])/g, '$1').replace(/,\s*,/g, ',').replace(/^ +| +$/gm, '');
}
/** The same for a whole generation input: its `prompt` field, when it is text. */
export function withoutRefTags<T extends object>(input: T): T {
  const p = (input as { prompt?: unknown }).prompt;
  return typeof p === 'string' && p.includes('{{') ? { ...input, prompt: stripRefTags(p) } : input;
}

export function buildSheetInput(
  prompt: string,
  opts: { aspect: Aspect | string; identityRefPath?: string; refPaths?: string[]; style?: Pick<StyleSpec, 'models' | 'soulStyleId'>; model?: string },
): Record<string, unknown> {
  prompt = stripRefTags(prompt);
  const model = opts.model ?? (opts.identityRefPath ? QWEN_EDIT : opts.style?.models.faces ?? SOUL);
  if (model === LOCAL_EDIT) return { prompt, ...localSize(opts.aspect), images: opts.refPaths ?? (opts.identityRefPath ? [opts.identityRefPath] : []) };
  if (isLocalModel(model)) return { prompt, ...localSize(opts.aspect) };
  switch (model) {
    case QWEN_EDIT: return { prompt, image_urls: opts.refPaths ?? (opts.identityRefPath ? [opts.identityRefPath] : []) };
    case SOUL: {
      const body: Record<string, unknown> = { prompt, resolution: '1080p', aspect_ratio: soulAspect(opts.aspect), batch_size: 4, enhance_prompt: false };
      if (opts.style?.soulStyleId) body.style_id = opts.style.soulStyleId;
      return body;
    }
    case CINEMA: return { prompt, resolution: '1080p', aspect_ratio: soulAspect(opts.aspect), batch_size: 4, enhance_prompt: false };
    case QWEN_T2I:
    case Z_IMAGE: return { prompt, resolution: '1k', aspect_ratio: aspectFor(model, opts.aspect) };
    case RECRAFT: return { prompt, resolution: '1k', aspect_ratio: aspectFor(model, opts.aspect), output_format: 'png' };
    default: return { prompt, aspect_ratio: aspectFor(model, opts.aspect) };
  }
}

/** Video endpoint for a clip source: a chosen start keyframe animates with image-to-video; sheets and one-take sequences use reference-to-video. */
export function videoModel(source: ClipSource = 'reference'): string {
  return source === 'keyframe' ? SEEDANCE_I2V : SEEDANCE;
}

export const clampDuration = (sec: number): number => Math.min(30, Math.max(4, Math.round(sec)));

export interface VideoInputOpts {
  /** The text to send; default sp.prompt (full mode). */
  prompt?: string;
  /** Chosen start keyframe file: switches to image-to-video. */
  startImage?: string;
  /** Chosen end keyframe file (image-to-video only). */
  endImage?: string;
  /** Override sp.durationSec (sequences: the sum of their beats). */
  durationSec?: number;
}

/** Exact input for either Seedance endpoint. With `startImage` the shape is image-to-video (image_url, optional
 *  end_image_url, no aspect_ratio, no image_urls); otherwise reference-to-video exactly as before. */
export function buildVideoInput(sp: ScenePrompt, refImagePaths: string[], tier: ClipTier, opts: VideoInputOpts = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    prompt: stripRefTags(opts.prompt ?? sp.prompt),
    resolution: tier === 'draft' ? '480p' : '720p',
    duration: clampDuration(opts.durationSec ?? sp.durationSec),
  };
  if (opts.startImage) {
    return {
      ...base,
      generate_audio: tier === 'final' && sp.audio,
      image_url: opts.startImage,
      ...(opts.endImage ? { end_image_url: opts.endImage } : {}),
      output_format: 'mp4',
    };
  }
  return {
    ...base,
    aspect_ratio: sp.aspect,
    generate_audio: tier === 'final' && sp.audio,
    image_urls: refImagePaths.slice(0, 30),
    output_format: 'mp4',
  };
}

// Seedance 2.5 formula (from the /estimate description, 16:9, no video input), $/second of output:
const SEEDANCE_PER_SEC: Record<string, number> = { '480p': 0.2056, '720p': 0.4622, '1080p': 1.1372 };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Deterministic price for a model + input: measured flat prices for images, the published formula
 *  for Seedance. Used as the HEARTCUT_FAKE price and as the fallback when /estimate is formula-only. */
export function fakePrice(model: string, input: Record<string, unknown>): number {
  if (isLocalModel(model)) return 0;
  const batch = Number(input.batch_size ?? 1);
  switch (model) {
    case SOUL: return r3((0.023 / 4) * batch);
    case CINEMA: return r3((0.022 / 4) * batch);
    case QWEN_EDIT: return 0.04;
    case QWEN_T2I: return input.resolution === '2k' ? 0.075 : 0.04;
    case Z_IMAGE: return 0.015;
    case RECRAFT: return 0.035;
    case SEEDANCE:
    case SEEDANCE_I2V: {
      const res = String(input.resolution ?? '720p');
      return r3((SEEDANCE_PER_SEC[res] ?? SEEDANCE_PER_SEC['720p']) * Number(input.duration ?? 5));
    }
    default: return 0.05;
  }
}

/** True when /estimate has no flat number, so `run` needs --allow-unpriced. */
export function isFormulaPriced(model: string): boolean {
  return model === SEEDANCE || model === SEEDANCE_I2V;
}
