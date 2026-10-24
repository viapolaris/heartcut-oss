// Higgsfield public HTTP API with the user's own key (provider `higgsfield`). Heartcut's model slugs and input shapes
// ARE Higgsfield's (src/gen/models.ts), so nothing is translated: the body is the input as is.
//
// Sources, read 2026-10-24 (docs.higgsfield.ai/docs/llms.txt and the pages it lists, openapi.json, and the official
// SDKs github.com/higgsfield-ai/higgsfield-client (Python) and higgsfield-js):
//   base       https://api.higgsfield.ai                                         (how-to/introduction, openapi servers)
//   auth       Authorization: Key <KEY_ID>:<KEY_SECRET>   (not Bearer)              (authentication.md)
//   submit     POST /<model slug>, flat JSON body -> {status, request_id, status_url, cancel_url}
//              Idempotency-Key header: same key replays the original request_id without a second charge (idempotency.md)
//   status     GET status_url (/requests/<id>/status): queued | in_progress | completed | failed | nsfw | canceled
//              outputs at top level: images[].url, video.url                     (concepts/requests.md)
//   cancel     POST /requests/<id>/cancel, only while queued, refunded             (concepts/requests.md)
//   price      POST /estimate/<model slug>, same body -> {"usd":"0.094"}; failed/nsfw/canceled are not charged
//                                                                                 (concepts/billing-and-retention.md)
//   upload     POST /files/generate-upload-url {content_type} -> {public_url, upload_url, upload_headers};
//              PUT the bytes to upload_url with every upload_header and no Higgsfield credentials (file-uploads.md)
//   check      GET /v1/text2image/soul-styles/v2 (read-only list; there is no documented whoami or balance endpoint)
//   errors     401 invalid credentials, 403 disabled key or insufficient balance, 429 account_queue_full
// UNVERIFIED: that /estimate is free of rate limits; that soul/cinema is enabled on every account (docs say it may be
// absent from model discovery); the exact error body for insufficient balance. None of this has been run with a key.
import fs from 'node:fs';
import { call, JobFailedError, mapLocalFiles, mimeOf, pollUntil, isLocalPath } from './http.ts';
import { genKey, genSecret } from './config.ts';
import type { HttpProvider, Quote } from './provider-types.ts';

export const HF_BASE = (): string => (process.env.HEARTCUT_HIGGSFIELD_BASE_URL || 'https://api.higgsfield.ai').replace(/\/+$/, '');

/** "Key id:secret". HIGGSFIELD_API_KEY may hold "id:secret" on its own, or the id with HIGGSFIELD_API_SECRET beside it. */
function auth(): string {
  const key = genKey('higgsfield');
  if (!key) throw new Error('HIGGSFIELD_API_KEY is not set');
  if (key.includes(':')) return `Key ${key}`;
  const secret = genSecret('higgsfield');
  if (!secret) throw new Error('HIGGSFIELD_API_SECRET is not set (Higgsfield needs the key id and the secret)');
  return `Key ${key}:${secret}`;
}
const headers = (extra: Record<string, string> = {}) => ({ authorization: auth(), 'content-type': 'application/json', accept: 'application/json', ...extra });

// /estimate does not need real files; a placeholder URL keeps pricing from uploading anything (same trick as the tool).
function forEstimate(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(forEstimate);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, forEstimate(x)]));
  return isLocalPath(v) ? 'https://example.com/placeholder.png' : v;
}

async function upload(file: string): Promise<string> {
  const content_type = mimeOf(file);
  const r = await call(`${HF_BASE()}/files/generate-upload-url`, { method: 'POST', headers: headers(), body: JSON.stringify({ content_type }), what: 'higgsfield upload-url' });
  const { public_url, upload_url, upload_headers } = r.body ?? {};
  if (!public_url || !upload_url) throw new Error('higgsfield upload-url: no upload_url in the answer');
  // No Higgsfield credentials on the storage PUT.
  await call(upload_url, { method: 'PUT', headers: { 'content-type': content_type, ...(upload_headers ?? {}) }, body: fs.readFileSync(file), what: 'higgsfield upload', timeoutMs: 5 * 60_000 });
  return public_url;
}

const outputsOf = (b: any): string[] => [
  ...(Array.isArray(b?.images) ? b.images.map((x: any) => x?.url) : []),
  ...(b?.video?.url ? [b.video.url] : []),
].filter((u): u is string => typeof u === 'string' && !!u);

export const higgsfieldApi: HttpProvider = {
  id: 'higgsfield',
  label: 'Higgsfield API',
  // Every Heartcut model slug is a Higgsfield slug; local models never reach a provider.
  supports: () => undefined,
  modelFor: (model) => model,

  async quote(model, input): Promise<Quote> {
    const r = await call(`${HF_BASE()}/estimate/${model}`, { method: 'POST', headers: headers(), body: JSON.stringify(forEstimate(input)), what: `higgsfield estimate ${model}`, timeoutMs: 30_000 });
    const usd = Number(r.body?.usd);
    if (!Number.isFinite(usd)) throw new Error(`higgsfield estimate ${model}: no usd in the answer`);
    return { usd, exact: true, source: 'Higgsfield /estimate' };
  },

  async run(model, input, ctx) {
    const body = await mapLocalFiles(input, upload);
    // Submit once. A timeout or dropped connection after this point throws MaybeSentError and is never resent.
    const r = await call(`${HF_BASE()}/${model}`, {
      method: 'POST', headers: headers({ 'idempotency-key': ctx.idempotencyKey }), body: JSON.stringify(body),
      what: `higgsfield submit ${model}`, submit: true, timeoutMs: 120_000,
    });
    const id: string = r.body?.request_id;
    if (!id) throw new Error('higgsfield submit: no request_id in the answer');
    ctx.onSubmitted(id);
    ctx.emit?.(`submitted ${id}`);
    const statusUrl: string = r.body?.status_url || `${HF_BASE()}/requests/${id}/status`;
    let last = '';
    const done = await pollUntil(async () => {
      const s = await call(statusUrl, { method: 'GET', headers: headers(), what: 'higgsfield status', timeoutMs: 30_000 });
      const st = String(s.body?.status ?? '');
      if (st !== last) { last = st; ctx.emit?.(`status: ${st}`); }
      if (st === 'completed') return s.body;
      // Higgsfield does not charge failed, nsfw or canceled requests (billing-and-retention.md).
      if (st === 'failed' || st === 'nsfw' || st === 'canceled') {
        throw new JobFailedError(`Higgsfield generation ${st} (not charged)${s.body?.error ? `: ${s.body.error}` : ''}`, id, false);
      }
      return undefined;
    }, { what: `higgsfield ${model}`, provider: 'Higgsfield', intervalMs: 2000 });
    const urls = outputsOf(done);
    if (!urls.length) throw new JobFailedError('Higgsfield finished but returned no file', id);
    return { urls, requestId: id };
  },

  async check() {
    const r = await call(`${HF_BASE()}/v1/text2image/soul-styles/v2`, { method: 'GET', headers: headers(), what: 'higgsfield check', timeoutMs: 20_000 });
    const n = Array.isArray(r.body) ? r.body.length : 0;
    return { ok: true, detail: `Key accepted (${n} Soul styles listed).` };
  },
};

/** Soul styles through the API (the dashboard's style picker), when the active provider is `higgsfield`. */
export async function apiSoulStyles(): Promise<{ id: string; name: string }[]> {
  const r = await call(`${HF_BASE()}/v1/text2image/soul-styles/v2`, { method: 'GET', headers: headers(), what: 'higgsfield soul styles', timeoutMs: 20_000 });
  return (Array.isArray(r.body) ? r.body : []).filter((x: any) => x?.id && x?.name).map((x: any) => ({ id: String(x.id), name: String(x.name) }));
}
