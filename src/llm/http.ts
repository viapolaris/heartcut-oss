// HTTP adapters: Anthropic Messages API and OpenAI-compatible chat completions. Plain fetch, no deps.
// Both return the parsed (not yet validated) object; llm.ts validates and owns the one repair retry.
import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedLlm, LlmTier } from './config.ts';
import { apiKeyFor } from './config.ts';

export interface HttpCall {
  system: string;
  user: string;
  schema: object;
  tier: LlmTier;
  maxTokens?: number;
  images?: string[];
  /** A previous reply and why it failed, for the single repair retry. */
  repair?: { reply: string; error: string };
}

const TIMEOUT_MS = Number(process.env.HEARTCUT_LLM_TIMEOUT_MS) || 300_000;
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif' };

export class LlmHttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Photos in call order, numbered from 1 so the labels in photoList() line up. Missing files are skipped but keep their number. */
export function readImages(images: string[] | undefined): { n: number; name: string; mime: string; b64: string }[] {
  return (images ?? []).flatMap((f, i) => {
    if (!fs.existsSync(f)) return [];
    const mime = MIME[path.extname(f).toLowerCase()] ?? 'image/jpeg';
    return [{ n: i + 1, name: path.basename(f), mime, b64: fs.readFileSync(f).toString('base64') }];
  });
}

export const photoTag = (n: number, name: string): string => `Photo ${n} (${name})`;

export function parseLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch (e) {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw e;
  }
}

/** Anthropic structured outputs need additionalProperties:false on every object. Copy, never mutate the caller's schema. */
export function closeObjects(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(closeObjects);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = k === 'enum' || k === 'required' ? v : closeObjects(v);
  if (out.type === 'object' || out.properties) out.additionalProperties = false;
  return out;
}

const schemaInPrompt = (system: string, schema: object): string =>
  `${system}\n\n# Output format\nReply with one JSON object and nothing else. It must match this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``;

const repairText = (r: NonNullable<HttpCall['repair']>): string =>
  `Your last reply could not be used: ${r.error.slice(0, 1500)}\nReply again with the complete, corrected JSON object only.`;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError') throw new LlmHttpError(0, `no reply after ${TIMEOUT_MS / 1000}s from ${new URL(url).host}`);
    throw new LlmHttpError(0, `could not reach ${new URL(url).host}: ${err.message}. Is the server running and the base URL right?`);
  }
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message ?? (typeof json?.error === 'string' ? json.error : '') ?? '';
    throw new LlmHttpError(res.status, `${new URL(url).host} ${res.status}: ${String(msg || json?.raw || text).slice(0, 800)}`);
  }
  return json;
}

const needModel = (cfg: ResolvedLlm, tier: LlmTier): string => {
  const m = cfg.models[tier];
  if (!m) throw new Error(`${cfg.label}: no model id set for "${tier}". Set one in Settings, Language model (or HEARTCUT_LLM_MODEL).`);
  return m;
};
const needKey = (cfg: ResolvedLlm): string | undefined => {
  const key = apiKeyFor(cfg);
  if (!key && cfg.keyRequired) throw new Error(`${cfg.label} needs ${cfg.keyEnv}. Add it to the .env file in the Heartcut folder, or export it.`);
  return key;
};

// Which structured-output mode worked last, per server and model, so a fallback is found once per run.
const modeMemo = new Map<string, string>();
export const resetModeMemo = (): void => modeMemo.clear();

// A 400/404/422 means the request was refused before any work, so trying the next mode cannot double bill.
const refusedShape = (e: unknown): boolean => e instanceof LlmHttpError && [400, 404, 415, 422].includes(e.status);

/** Parsed reply. `parseError` is set when the text was not JSON (the caller may retry once). */
export interface Reply { value?: unknown; text: string; parseError?: string }

function reply(text: string): Reply {
  try { return { value: parseLoose(text), text }; } catch (e) { return { text, parseError: `not valid JSON (${(e as Error).message})` }; }
}

// ---------------- Anthropic ----------------

export function anthropicBody(cfg: ResolvedLlm, call: HttpCall, mode: 'format' | 'prompt'): Record<string, unknown> {
  const imgs = readImages(call.images);
  const content: unknown[] = imgs.length
    ? [...imgs.flatMap((i) => [{ type: 'text', text: photoTag(i.n, i.name) }, { type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } }]), { type: 'text', text: call.user }]
    : [{ type: 'text', text: call.user }];
  const messages: unknown[] = [{ role: 'user', content }];
  if (call.repair) messages.push({ role: 'assistant', content: call.repair.reply || '(empty)' }, { role: 'user', content: repairText(call.repair) });
  return {
    model: needModel(cfg, call.tier),
    max_tokens: call.maxTokens ?? 16000,
    system: mode === 'prompt' ? schemaInPrompt(call.system, call.schema) : call.system,
    messages,
    ...(mode === 'format' ? { output_config: { format: { type: 'json_schema', schema: closeObjects(call.schema) } } } : {}),
  };
}

export async function anthropicJson(cfg: ResolvedLlm, call: HttpCall): Promise<Reply> {
  const key = needKey(cfg)!;
  const url = `${cfg.baseUrl ?? 'https://api.anthropic.com/v1'}/messages`;
  const memoKey = `${url}|${cfg.models[call.tier]}`;
  const modes = (modeMemo.get(memoKey) === 'prompt' ? ['prompt'] : ['format', 'prompt']) as ('format' | 'prompt')[];
  let lastErr: unknown;
  for (const mode of modes) {
    let body: any;
    try { body = await post(url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, anthropicBody(cfg, call, mode)); }
    catch (e) { lastErr = e; if (refusedShape(e) && mode !== 'prompt') continue; throw e; }
    modeMemo.set(memoKey, mode);
    if (body.stop_reason === 'refusal') throw new Error(`anthropic api: the model declined (${body.stop_details?.category ?? 'no category'})`);
    const text = (body.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    if (body.stop_reason === 'max_tokens') throw new Error(`anthropic api: the reply hit max_tokens (${call.maxTokens ?? 16000}) before it finished`);
    return reply(text);
  }
  throw lastErr;
}

// ---------------- OpenAI-compatible ----------------

export type OaiMode = 'json_schema' | 'tool' | 'json_object';
export const OAI_MODES: OaiMode[] = ['json_schema', 'tool', 'json_object'];

export function openaiBody(cfg: ResolvedLlm, call: HttpCall, mode: OaiMode): Record<string, unknown> {
  const imgs = readImages(call.images);
  const userContent = imgs.length
    ? [...imgs.flatMap((i) => [{ type: 'text', text: photoTag(i.n, i.name) }, { type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }]), { type: 'text', text: call.user }]
    : call.user;
  const system = mode === 'json_schema' ? call.system : schemaInPrompt(call.system, call.schema);
  const messages: unknown[] = [{ role: 'system', content: system }, { role: 'user', content: userContent }];
  if (call.repair) messages.push({ role: 'assistant', content: call.repair.reply || '(empty)' }, { role: 'user', content: repairText(call.repair) });
  const body: Record<string, unknown> = { model: needModel(cfg, call.tier), messages };
  // OpenAI's newer models take max_completion_tokens; most other servers still read max_tokens.
  if (call.maxTokens) body[cfg.preset === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = call.maxTokens;
  if (mode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'result', schema: call.schema, strict: false } };
  else if (mode === 'tool') {
    body.tools = [{ type: 'function', function: { name: 'emit', description: 'Return the structured result', parameters: call.schema } }];
    body.tool_choice = { type: 'function', function: { name: 'emit' } };
  } else body.response_format = { type: 'json_object' };
  return body;
}


export async function openaiJson(cfg: ResolvedLlm, call: HttpCall): Promise<Reply & { mode: OaiMode }> {
  if (!cfg.baseUrl) throw new Error(`${cfg.label}: set a base URL in Settings, Language model (or HEARTCUT_LLM_BASE_URL).`);
  const key = needKey(cfg);
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  if (cfg.preset === 'openrouter') headers['x-title'] = 'Heartcut';
  const memoKey = `${url}|${cfg.models[call.tier]}`;
  const known = modeMemo.get(memoKey) as OaiMode | undefined;
  const modes = known ? OAI_MODES.slice(OAI_MODES.indexOf(known)) : OAI_MODES;
  const refusals: string[] = [];
  for (const [i, mode] of modes.entries()) {
    let body: any;
    try { body = await post(url, headers, openaiBody(cfg, call, mode)); }
    catch (e) {
      if (refusedShape(e) && i < modes.length - 1) { refusals.push(`${mode}: ${(e as Error).message}`); continue; }
      if (refusals.length) (e as Error).message += `\n(also refused: ${refusals.join(' | ')})`;
      throw e;
    }
    modeMemo.set(memoKey, mode);
    const choice = body.choices?.[0];
    const msg = choice?.message ?? {};
    if (choice?.finish_reason === 'length') throw new Error(`${cfg.label}: the reply hit the token limit before it finished`);
    const args = msg.tool_calls?.[0]?.function?.arguments;
    const text = typeof args === 'string' && args ? args : typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? msg.content.map((p: any) => p.text ?? '').join('') : '';
    if (msg.refusal) throw new Error(`${cfg.label}: the model declined: ${String(msg.refusal).slice(0, 300)}`);
    return { ...reply(text), mode };
  }
  throw new Error('unreachable');
}
