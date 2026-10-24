// Heartcut dashboard v2 (Direction A, Guided Studio). Vanilla ES module; the server is the source of truth.
// The server serves only /app.js and /app.css from web/, so everything lives in this one file.

// ---------- constants ----------
const STEPS = [
  { id: 'brief', label: 'Brief', hint: 'tell the story', title: 'Write the brief', intro: 'Tell the story the way you would tell a friend. Add faces, places and moods you want it to feel like.' },
  { id: 'script', label: 'Script', hint: 'shape it', title: 'Shape the story', intro: 'The language model turns the brief into a logline, a cast, places and short scene beats. Edit anything before you move on.' },
  { id: 'sheets', label: 'Sheets', hint: 'check prompts', title: 'Check the sheet prompts', intro: 'One prompt for every character state and every place. They make the pictures you pick from next.' },
  { id: 'images', label: 'Images', hint: 'lock the cast', title: 'Lock the cast', intro: 'Lock one face per character first, then build every other picture of them from that face. Locations are picked on their own. These exact pictures ride along with every clip, so consistency starts here.' },
  { id: 'scenes', label: 'Scenes', hint: 'write the shots', title: 'Write the shots', intro: 'Every beat becomes a video prompt in named blocks. Dashed blocks come from your cast and places. Edit the rest.' },
  { id: 'keyframes', label: 'Keyframes', hint: 'freeze the frames', title: 'Freeze one frame per shot', intro: 'A still picture of each shot, lit by the scene. Pick the one that looks filmed. Video then only has to move it. Skip this and clips are made from the sheets instead.' },
  { id: 'clips', label: 'Clips', hint: 'shoot drafts', title: 'Shoot the drafts', intro: 'Draft at 480p first. A draft made from a keyframe keeps the face because the still already fixed it; the video prompt only has to move it. Approve the ones you like, then render finals at 720p. A final is still a fresh render, not an upscale: Seedance has no seed.' },
  { id: 'export', label: 'Export', hint: 'cut it', title: 'Cut and export', intro: 'Approved finals join in scene order. Pick 1080p or 4K and add music.' },
];
const STEP_IDX = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));
const CONFIRM_USD = 0.5;
const DRAFT_USD = 1.03;
const MODEL_NAMES = { 'higgsfield-ai/soul/v2/standard': 'Soul 2 · faces', 'higgsfield-ai/soul/cinema': 'Soul Cinema · places', 'alibaba/qwen-image-3/edit': 'Qwen Image Edit · from your selfie', 'bytedance/seedance-2.5/reference-to-video': 'Seedance 2.5', 'bytedance/seedance-2.5/image-to-video': 'Seedance 2.5 · from keyframe', 'local/qwen-image': 'Qwen-Image · local', 'local/z-image-turbo': 'Z-Image Turbo · local', 'local/qwen-image-edit': 'Qwen-Image-Edit · local · from your photo' };
const BLOCK_ORDER = ['SHOT', 'SUBJECT', 'IDENTITY', 'PERFORM', 'PHYSICS', 'MATCHCUT', 'LOCATION', 'LIGHT', 'GRADE', 'CAMERA', 'QUALITY', 'NEGATIVES'];
// v5 keyframes: one still per beat before any video. Block order for the still prompt (no PERFORM/PHYSICS/MATCHCUT; POSE is the frozen instant).
const KEYFRAME_BLOCKS = ['SHOT', 'SUBJECT', 'IDENTITY', 'POSE', 'LOCATION', 'LIGHT', 'GRADE', 'CAMERA', 'LOOK', 'QUALITY', 'NEGATIVES'];
const OPTIONAL_STEPS = new Set(['keyframes']); // skippable: a beat with no chosen keyframe is shot from the sheets, as before
const KF_USD = 0.08; // 2 × $0.04 Qwen Image 3 edit calls per keyframe; the server estimate wins whenever it answers
const SEEDANCE_I2V = 'bytedance/seedance-2.5/image-to-video';

// Image models a style can pick. Price is dollars per 4 images. Server /api/styles models not listed here show as raw slugs.
const SOUL2 = 'higgsfield-ai/soul/v2/standard';
const IMAGE_MODELS = [
  { id: SOUL2, short: 'Soul 2', label: 'Soul 2 · photoreal faces · $0.023/4', price: 0.023, desc: 'photoreal faces, real skin texture' },
  { id: 'higgsfield-ai/soul/cinema', short: 'Soul Cinema', label: 'Soul Cinema · cinematic places · $0.022/4', price: 0.022, desc: 'cinematic, film-grade places' },
  { id: 'alibaba/qwen-image-3/text-to-image', short: 'Qwen Image 3', label: 'Qwen Image 3 · any medium · $0.16/4', price: 0.16, desc: 'any medium; strong at anime and illustration' },
  { id: 'z-image/turbo', short: 'Z-Image Turbo', label: 'Z-Image Turbo · fast, any medium · $0.06/4', price: 0.06, desc: 'fast, any medium' },
  { id: 'local/qwen-image', short: 'Qwen-Image · local GPU · free', label: 'Qwen-Image · local GPU · free', price: 0, local: true, desc: 'runs on this Mac; any medium, slower' },
  { id: 'local/z-image-turbo', short: 'Z-Image Turbo · local GPU · free', label: 'Z-Image Turbo · local GPU · free', price: 0, local: true, desc: 'runs on this Mac; fastest local' },
  { id: 'recraft/v4.1/text-to-image', short: 'Recraft 4.1', label: 'Recraft 4.1 · flat/vector illustration · $0.14/4', price: 0.14, desc: 'flat and vector illustration' },
  { id: 'ideogram/v4.0', short: 'Ideogram 4', label: 'Ideogram 4 · $0.24/4', price: 0.24, desc: 'graphic design, clean lettering' },
  { id: 'xai/grok-imagine-image-2.0', short: 'Grok Image 2', label: 'Grok Image 2 · $0.24/4', price: 0.24, desc: 'general purpose' },
];
const FAMILY_HINTS = { photoreal: 'camera-real people and places', film: 'film stock, grain and grade', anime: '2D cel animation', cartoon: 'flat, friendly kids cartoon', illustration: 'drawn, painted or inked', '3d': 'animated 3D feature look', custom: 'your own words' };
const RECOMMENDED = { faces: SOUL2, places: 'higgsfield-ai/soul/cinema' };
/** Rows for a faces/places model chip: name, one line, $ per 4 (or free · local GPU), tags. Server models we do not know are added from /api/image-models. */
function modelOptions(slot, extra = []) {
  const list = IMAGE_MODELS.map((m) => ({ ...m }));
  for (const m of state.models?.images || []) if (!list.some((x) => x.id === m.slug)) list.push({ id: m.slug, short: m.label, price: m.usd, local: !!m.local, desc: m.kind === 'photo' ? 'photographic' : 'any medium' });
  for (const v of extra) if (v && !list.some((x) => x.id === v)) list.push({ id: v, short: v, desc: 'not in the model list' });
  const paid = list.filter((m) => m.price > 0).map((m) => m.price);
  const cheapest = paid.length ? Math.min(...paid) : null;
  const L = state.settings.local || {};
  return list.map((m) => ({
    value: m.id, label: m.short.replace(' · local GPU · free', ''), short: m.short.replace(' · local GPU · free', ' · local'),
    hint: m.local && state.settings.loaded && !L.ok ? `${m.desc} · not available here: ${L.reason || 'no local GPU worker'}` : m.desc,
    price: m.price == null ? null : m.price === 0 ? 'free · local GPU' : `${unit(m.price)} / 4`,
    tag: [m.id === RECOMMENDED[slot] ? 'Recommended' : null, m.local ? 'Local' : null, m.price === cheapest ? 'Cheapest' : null].filter(Boolean),
    glyph: () => svg(m.local ? 'cpu' : 'spark', 18, 'currentColor', 1.7),
  }));
}
async function loadModels() {
  if (state.models || state.modelsLoading) return;
  state.modelsLoading = true;
  try { state.models = await api('/image-models'); } catch { state.models = { images: [] }; }
  state.modelsLoading = false;
}
// With "render on this Mac" on, these Higgsfield drawn-medium models are swapped for their free local twins (server: settings.ts).
const TO_LOCAL = { 'alibaba/qwen-image-3/text-to-image': 'local/qwen-image', 'z-image/turbo': 'local/z-image-turbo' };
const FAMILIES = ['photoreal', 'film', 'anime', 'cartoon', 'illustration', '3d', 'custom'];
const DEFAULT_STYLE_ID = 'cinematic-realism';
const modelInfo = (id) => IMAGE_MODELS.find((m) => m.id === id);
const modelShort = (id) => modelInfo(id)?.short || (id || 'none').split('/').slice(-2, -1)[0] || id || 'none';

const state = {
  settings: { loaded: false, loading: false, preferLocal: false, local: { ok: false, reason: '', models: [] }, err: '' },
  styles: { list: [], loaded: false, loading: false, err: '', tab: 'presets' }, soul: { list: null, err: '' },
  projects: [], slug: null, step: 'brief', p: null,
  spend: { projectUsd: 0, sittingUsd: 0, capUsd: 5, remainingUsd: 5 },
  est: {}, pend: {},        // estimate cache + in-flight keys
  runs: {},                 // run id -> {slug, stage, status}
  errs: {},                 // stage -> message shown as a banner inside that step
  dirty: false,             // unsaved edits in the centre column
  ui: { open: {}, plain: {}, sheetOpen: {}, sel: {}, cmp: [], compare: false, confirm: null, filter: false, dismissed: {}, exportRes: '1080p', drawer: null, scene: null, promptMode: null, motionDraft: null },
  lib: { entries: [], loading: false, err: '' },
  models: null, modelsLoading: false,
  sig: {},
};

// ---------- tiny helpers ----------
// replaceChildren() would print "null" for an empty slot; drop empty slots the way h() does.
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function replaceChildren(...kids) { return nativeReplace.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false)); };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const usd = (n) => { const v = Number(n) || 0; const two = v.toFixed(2); return `$${v > 0 && v < 1 && Math.abs(Number(two) - v) > 0.0005 ? v.toFixed(3) : two}`; };
const unit = (n) => `$${(Number(n) || 0).toFixed(3).replace(/0$/, '')}`;
const plural = (n, a, b = a + 's') => `${n} ${n === 1 ? a : b}`;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') el[k] = !!v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  if (value !== undefined) el.value = value;
  return el;
}
const ICONS = {
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  warn: '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  upload: '<path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  prev: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  caret: '<path d="m6 9 6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  diamond: '<path d="M12 3 21 12 12 21 3 12z"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6m0-6-5 6"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 8"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  text: '<path d="M4 6h16M4 12h10M4 18h13"/>',
  face: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8.5 15a4.5 4.5 0 0 0 7 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  drop: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  checklist: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  refs: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>',
};
function svg(name, size = 16, stroke = 'currentColor', sw = 2.2) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', stroke); s.setAttribute('stroke-width', sw);
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}

// ---------- intuitive-decision pieces: aspect glyphs, chip selects, "made with" lines, step cards ----------
/** An outline rectangle in the true proportion of `ratio` ("16:9"), max side = size, centred in a size×size box so rows align. */
function aspectGlyph(ratio, size = 18) {
  const [w, hgt] = String(ratio || '16:9').split(':').map(Number);
  const r = w > 0 && hgt > 0 ? w / hgt : 16 / 9;
  const max = size - 2; // room for the 1.5 px stroke
  const rw = r >= 1 ? max : max * r; const rh = r >= 1 ? max / r : max;
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', `0 0 ${size} ${size}`); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'aglyph');
  s.innerHTML = `<rect x="${((size - rw) / 2).toFixed(2)}" y="${((size - rh) / 2).toFixed(2)}" width="${rw.toFixed(2)}" height="${rh.toFixed(2)}" rx="1.5" stroke="currentColor" stroke-width="1.5"/>`;
  return s;
}
/** "▭ 16:9" as one inline piece: the glyph and the ratio. */
const aspectBit = (a, size = 12) => h('span', { class: 'asp' }, aspectGlyph(a, size), a);
const ASPECTS = [
  { value: '16:9', hint: 'YouTube, TV, laptop' },
  { value: '9:16', hint: 'Reels, TikTok, Shorts' },
  { value: '1:1', hint: 'Instagram feed' },
  { value: '4:3', hint: 'Classic TV, iPad' },
  { value: '21:9', hint: 'Cinema widescreen' },
].map((a) => ({ ...a, label: a.value, glyph: () => aspectGlyph(a.value, 20) }));
const ROLES = {
  selfie: { label: 'Selfie', hint: 'locks a real face', icon: 'face' },
  character: { label: 'Character', hint: 'look for a person or animal', icon: 'user' },
  location: { label: 'Location', hint: 'look for a place', icon: 'pin' },
  mood: { label: 'Mood', hint: 'colour and feeling', icon: 'drop' },
  music: { label: 'Music', hint: 'soundtrack for export', icon: 'music' },
};
const roleOptions = (list) => list.map((v) => ({ value: v, label: ROLES[v].label, hint: ROLES[v].hint, glyph: () => svg(ROLES[v].icon, 18, 'currentColor', 1.8) }));

let csOpen = null; // the one open chip popover: { key, anchor, pop, scrim, sheet }
let csSeq = 0;
const nodeOf = (g) => (g == null ? null : typeof g === 'function' ? g() : g.nodeType ? g.cloneNode(true) : document.createTextNode(String(g)));
const csOptions = (s) => (typeof s.options === 'function' ? s.options() : s.options || []).map((o) => ({ ...o, value: String(o.value) }));
const TAG_CLS = { Recommended: 'rec', Local: 'loc', Cheapest: 'cheap', Free: 'loc', New: 'rec' };
/**
 * A compact chip that shows icon + the current label; click (or Enter/Space/ArrowDown) opens a listbox popover anchored to it
 * (a bottom sheet on phones). Rows: glyph, label, tag pills, price, check on the chosen one, muted hint (or the disabled reason).
 * spec: { title, value, options:[{value,label,short?,hint?,glyph?,price?,tag?,disabled?,reason?}] | () => options,
 *         onChange(value, option), icon?, key? (stable across re-renders), name?, path? (data-p for collectStep), cls?, sub?, display? }
 * The element is a <button> whose .value is the chosen value, so forms and collectStep read it like a select.
 * It fires bubbling `input` and `change` events on a pick.
 */
function chipSelect(spec) {
  const key = spec.key || `cs${++csSeq}`;
  const b = h('button', { type: 'button', class: `cs ${spec.cls || ''}`, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'data-cs': key, name: spec.name, id: spec.id, 'data-p': spec.path, disabled: spec.disabled, title: spec.tip });
  b._cs = { ...spec, key };
  b.value = String(spec.value ?? '');
  csPaint(b);
  b.addEventListener('click', (e) => { e.stopPropagation(); if (csOpen?.key === key) csClose(true); else csOpenFor(b); });
  b.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (csOpen?.key !== key) csOpenFor(b); } });
  // A re-render rebuilt the chip while its popover is open: re-anchor and refresh the rows (prices may have arrived).
  if (csOpen?.key === key) queueMicrotask(() => { if (b.isConnected && csOpen?.key === key) { csOpen.anchor = b; b.setAttribute('aria-expanded', 'true'); csFill(false); } });
  return b;
}
function csPaint(b) {
  const s = b._cs; const o = csOptions(s).find((x) => x.value === b.value);
  const label = s.display ? s.display(o, b.value) : (o?.short || o?.label || b.value || s.placeholder || '—');
  const icon = s.icon != null ? nodeOf(s.icon) : o?.glyph ? nodeOf(o.glyph) : null;
  b.setAttribute('aria-label', `${s.title}: ${o?.label || b.value || s.placeholder || 'none'}`);
  const sub = typeof s.sub === 'function' ? s.sub(o) : s.sub;
  b.replaceChildren(icon ? h('span', { class: 'ic' }, icon) : null, h('span', { class: 'lbl' }, label), sub ? h('span', { class: `csub ${s.subCls || ''}` }, sub) : null, h('span', { class: 'caret' }, svg('caret', 14)));
}
/** Change a chip's options and/or value from outside (dependent selects). */
function csSet(b, patch) { Object.assign(b._cs, patch); if ('value' in patch) b.value = String(patch.value ?? ''); csPaint(b); }
function csOpenFor(b) {
  csClose(false);
  const s = b._cs;
  const sheet = matchMedia('(max-width: 760px)').matches;
  const pop = h('div', { class: `cspop ${sheet ? 'sheet' : ''}` });
  const scrim = sheet ? h('div', { class: 'csscrim', onclick: () => csClose(true) }) : null;
  pop.addEventListener('keydown', (e) => {
    const rows = $$('.cso', pop); const i = rows.indexOf(document.activeElement);
    const mv = (n) => { e.preventDefault(); rows[(n + rows.length) % rows.length]?.focus(); };
    if (e.key === 'ArrowDown') mv(i + 1);
    else if (e.key === 'ArrowUp') mv(i < 0 ? rows.length - 1 : i - 1);
    else if (e.key === 'Home') mv(0);
    else if (e.key === 'End') mv(rows.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rows[i]?.click(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); csClose(true); }
  });
  csOpen = { key: s.key, anchor: b, pop, scrim, sheet };
  (b.closest('dialog') || document.body).append(...[scrim, pop].filter(Boolean)); // inside an open <dialog>, everything outside it is inert
  b.setAttribute('aria-expanded', 'true');
  csFill(true);
}
function csFill(first) {
  const { anchor: b, pop } = csOpen; const s = b._cs;
  const had = pop.contains(document.activeElement) ? document.activeElement.dataset.v : null;
  const list = h('div', { class: 'csl', role: 'listbox', 'aria-label': s.title });
  for (const [i, o] of csOptions(s).entries()) {
    const on = o.value === b.value;
    const note = o.disabled && o.reason ? o.reason : o.hint;
    list.append(h('div', { class: `cso ${note ? '' : 'one'}`, role: 'option', tabindex: -1, id: `${s.key}-o${i}`, 'data-v': o.value, 'aria-selected': on ? 'true' : 'false', 'aria-disabled': o.disabled ? 'true' : null, onclick: () => csPick(o) },
      h('span', { class: 'g' }, nodeOf(o.glyph)),
      h('span', { class: 'l' }, h('span', {}, o.label), ...[].concat(o.tag || []).map((t) => h('span', { class: `tag ${TAG_CLS[t] || ''}` }, t))),
      o.price != null ? h('span', { class: 'pr' }, o.price) : null,
      h('span', { class: 'ck' }, on ? svg('check', 16) : null),
      note ? h('span', { class: `hn ${o.disabled ? 'why' : ''}` }, note) : null));
  }
  pop.replaceChildren(h('div', { class: 'cst', 'aria-hidden': 'true' }, s.title), list);
  csPlace();
  if (first || had != null) {
    const rows = $$('.cso', pop);
    (rows.find((r) => r.dataset.v === (had ?? b.value)) || rows[0])?.focus({ preventScroll: true });
    rows.find((r) => r === document.activeElement)?.scrollIntoView({ block: 'nearest' });
  }
}
function csPlace() {
  if (!csOpen || csOpen.sheet) return;
  const { anchor, pop } = csOpen;
  if (!anchor.isConnected) return;
  const r = anchor.getBoundingClientRect();
  pop.style.minWidth = `${Math.max(240, Math.round(r.width))}px`;
  const below = innerHeight - r.bottom - 12; const above = r.top - 12;
  const down = below >= Math.min(pop.scrollHeight, 320) || below >= above;
  pop.style.maxHeight = `${Math.min(440, Math.max(160, down ? below : above))}px`;
  const ph = pop.offsetHeight; const pw = pop.offsetWidth;
  pop.style.top = `${down ? r.bottom + 6 : Math.max(8, r.top - 6 - ph)}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pw - 8))}px`;
}
function csPick(o) {
  if (!csOpen) return;
  if (o.disabled) { toast(o.reason || 'Not available'); return; }
  const b = csOpen.anchor; const s = b._cs;
  const changed = b.value !== o.value;
  b.value = o.value; csPaint(b); csClose(true);
  if (!changed) return;
  b.dispatchEvent(new Event('input', { bubbles: true })); b.dispatchEvent(new Event('change', { bubbles: true }));
  s.onChange?.(o.value, o);
}
function csClose(refocus) {
  if (!csOpen) return;
  const { key, anchor, pop, scrim } = csOpen; csOpen = null;
  pop.remove(); scrim?.remove();
  const b = anchor.isConnected ? anchor : document.querySelector(`[data-cs="${key}"]`);
  b?.setAttribute('aria-expanded', 'false');
  if (refocus) b?.focus();
}
document.addEventListener('pointerdown', (e) => { if (csOpen && !csOpen.pop.contains(e.target) && !csOpen.anchor.contains(e.target) && e.target !== csOpen.scrim) csClose(false); }, true);
window.addEventListener('resize', () => csPlace());
document.addEventListener('scroll', (e) => { if (csOpen && !csOpen.pop.contains(e.target)) csPlace(); }, true);

/** A − N s + stepper that looks like a chip. */
function chipStepper({ label, value, min, max, unit: u = '', icon, onChange }) {
  const val = h('span', { class: 'lbl mono', 'aria-live': 'polite' }, `${value}${u}`);
  const set = (v) => { const n = Math.max(min, Math.min(max, v)); if (n === value) return; value = n; val.textContent = `${n}${u}`; dec.disabled = n <= min; inc.disabled = n >= max; onChange(n); };
  const dec = h('button', { type: 'button', class: 'stp', 'aria-label': `Shorter ${label}`, disabled: value <= min, onclick: () => set(value - 1) }, svg('minus', 14));
  const inc = h('button', { type: 'button', class: 'stp', 'aria-label': `Longer ${label}`, disabled: value >= max, onclick: () => set(value + 1) }, svg('plus', 14));
  return h('span', { class: 'cs stepper', role: 'group', 'aria-label': `${label} ${min} to ${max}${u}` }, icon ? h('span', { class: 'ic' }, nodeOf(icon)) : null, dec, val, inc);
}
/** A display-only chip (a value fixed after creation). */
const chipRO = (icon, label, tip) => h('span', { class: 'cs ro', title: tip || null }, icon ? h('span', { class: 'ic' }, nodeOf(icon)) : null, h('span', { class: 'lbl' }, label));
/** A small muted line of what made a picture or a clip: "480p · 5 s · ▭ 16:9 · from keyframe · short · $1.03". */
const madeLine = (parts) => { const ps = parts.filter((x) => x != null && x !== '' && x !== false); return ps.length ? h('div', { class: 'made', 'aria-label': 'Made with' }, ps.map((x) => h('span', {}, x))) : null; };
/** "Refs N/30" — how many pictures will ride along, against Seedance's limit. */
const REF_LIMIT = 30;
const refCount = (n) => h('span', { class: `pill tiny refcount ${n > REF_LIMIT ? 'over' : ''}`, title: `${n} reference ${n === 1 ? 'picture' : 'pictures'} attached; Seedance takes up to ${REF_LIMIT}` }, svg('refs', 12, 'currentColor', 2), `Refs ${n}/${REF_LIMIT}`);
/** Empty state as numbered step cards with line icons: [[icon, title, text], …]. */
function stepCards(steps, foot) {
  return h('div', { class: 'stepcards' },
    h('ol', {}, steps.map(([icon, title, text], i) => h('li', { class: 'stepcard' },
      h('span', { class: 'si' }, svg(icon, 28, 'currentColor', 1.6)),
      h('span', { class: 'sn mono' }, `${i + 1}`), h('b', {}, title), h('span', { class: 'note' }, text)))),
    foot || null);
}

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `${r.status} ${r.statusText}`); e.status = r.status; throw e; }
  return j;
}

let toastTimer;
/**
 * Keep a visible toast above the sticky footer. The footer can appear after the toast (the demo toast fires just
 * before the project page draws) and grows to several rows of full-width buttons on a phone, so this runs again
 * after every render and on resize, not only when the toast opens.
 */
function placeToast() {
  const t = $('#toast');
  if (!t || t.hidden) return;
  const f = $('#foot');
  const fh = f && !f.hidden ? f.getBoundingClientRect().height : 0;
  t.style.bottom = `${Math.round(fh) + 12}px`;
}
window.addEventListener('resize', placeToast);
function toast(msg, isErr = false) {
  const t = $('#toast');
  msg = String(msg); const cut = msg.search(/:\s*(uploaded |estimate: |sitting |higgsfield: |\{)/);
  if (cut > 20) msg = msg.slice(0, cut); else if (msg.length > 200) msg = `${msg.slice(0, 200)}…`;
  t.textContent = msg; t.className = `toast${isErr ? ' err' : ''}`; t.hidden = false;
  placeToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 3000);
}
/** Run an action; any failure becomes a banner inside `stage` plus a toast. Never a blank screen. */
async function attempt(stage, fn) {
  try { delete state.errs[stage]; return await fn(); }
  catch (e) {
    const msg = e.status === 404 ? `${e.message} (the server may not have this feature yet)` : e.message;
    state.errs[stage] = msg; toast(msg, true); render(); return undefined;
  }
}

function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch { /* private mode */ }
  return null;
}
// Stored paths are absolute and use the server's separator: / on macOS and Linux, \ on Windows.
const fileName = (path) => String(path || '').split(/[\\/]/).pop();
function mediaUrl(path, slug = state.slug) {
  const m = /([^\\/]+)[\\/](assets|clips|export|keyframes)[\\/]([^\\/]+)$/.exec(path || '');
  return m ? `/media/${slug === state.slug ? slug : m[1]}/${m[2]}/${encodeURIComponent(m[3])}` : '';
}
const libUrl = (slug, path) => { const m = /(assets)[\\/]([^\\/]+)$/.exec(path || ''); return m ? `/media/${slug}/assets/${encodeURIComponent(m[2])}` : ''; };
const refFileName = (path) => fileName(path).replace(/^ref_[a-z0-9]+-/i, '');
const refUrl = (path) => `/refs/${state.slug}/${encodeURIComponent(fileName(path))}`;
const setPath = (obj, path, val) => { const k = path.split('.'); let o = obj; for (let i = 0; i < k.length - 1; i++) o = o[k[i]]; o[k[k.length - 1]] = val; };
const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function pickFile(accept) {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept, style: 'display:none' });
    i.addEventListener('change', () => { res(i.files[0] || null); i.remove(); });
    document.body.append(i); i.click();
  });
}
// Drag-and-drop for files. `el` lights up while files hover over it; dropped files that pass `accept` go to onFiles.
// A drop anywhere else in the page is swallowed (below) so a missed drop never navigates away from the app.
const isImg = (f) => /^image\/(png|jpeg|webp|gif|heic|heif)$/.test(f.type) || /\.(png|jpe?g|webp|gif|heic)$/i.test(f.name);
const isAudio = (f) => f.type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg)$/i.test(f.name);
function dropTarget(el, { accept = isImg, onFiles, multiple = true, what = 'pictures' }) {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  el.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; el.classList.add('dropover'); });
  el.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('dropover'); });
  el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation(); depth = 0; el.classList.remove('dropover');
    const all = [...e.dataTransfer.files]; const ok = all.filter(accept);
    if (!ok.length) { toast(`Only ${what} can go here`, true); return; }
    if (ok.length < all.length) toast(`${all.length - ok.length} file(s) skipped: not ${what}`, true);
    onFiles(multiple ? ok : ok.slice(0, 1));
  });
  return el;
}
document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
const tooBig = (f) => f.size > 15 * 1024 * 1024;
function pickFiles(accept) {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept, multiple: true, style: 'display:none' });
    i.addEventListener('change', () => { res([...i.files]); i.remove(); });
    document.body.append(i); i.click();
  });
}
/** A dashed box you drop files on, click to choose files, or focus and press Enter. */
function dropzone({ title, sub, accept, acceptAttr, onFiles, what, compact }) {
  const choose = async () => { const fs = (await pickFiles(acceptAttr)).filter(accept); if (fs.length) onFiles(fs); };
  return dropTarget(h('div', { class: `dropzone ${compact ? 'compact' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${title}. ${sub}`,
    onclick: choose, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } } },
    svg('upload', compact ? 20 : 28, 'currentColor', 1.8), h('b', {}, title), h('span', { class: 'note' }, sub)), { accept, onFiles, what });
}
const REF_ACCEPT = (f) => isImg(f) || isAudio(f);
/** Upload dropped/pasted/chosen files as brief references. Audio always goes in as music; pictures use the chosen role. */
async function addRefFiles(files) {
  const big = files.filter(tooBig); const ok = files.filter((f) => !tooBig(f));
  if (big.length) toast(`${big.map((f) => f.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over 15 MB`, true);
  if (!ok.length) return;
  const role = state.ui.refRole || 'mood'; const note = '';
  await attempt('brief', async () => {
    toast(`Adding ${ok.length === 1 ? ok[0].name : `${ok.length} files`}…`);
    for (const f of ok) await uploadRef(state.slug, f, isAudio(f) ? 'music' : role, note);
    await loadProject(); toast(ok.length === 1 ? 'Reference added' : `${ok.length} references added`); render(true);
  });
}
// "Who is this?" on a person photo: a name (suggested from the cast) or "several people". It decides which character's
// face the photo locks; a group photo locks none. Saved on blur/Enter; the script must run again to use it.
const SEVERAL = 'several people';
/** Same rule as the server: several/both/group/"X and Y"/"left … right", or two or more cast names. */
function isGroupWho(who, names = []) {
  const w = String(who || '').trim().toLowerCase();
  if (!w) return false;
  if (w === SEVERAL || /\b(several|group|both|together|everyone|all of them)\b|\s(and|&|\+)\s|\bleft\b[\s\S]*\bright\b|\bright\b[\s\S]*\bleft\b/.test(w)) return true;
  return names.filter((n) => n && new RegExp(`(?<![\\p{L}])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(w)).length >= 2;
}
function whoField(r, refs) {
  const listId = 'who-names';
  if (!$(`#${listId}`)) document.body.append(h('datalist', { id: listId }));
  $(`#${listId}`).replaceChildren(...[...chars().filter((c) => c.species === 'human').map((c) => c.name), SEVERAL].map((n) => h('option', { value: n })));
  const locks = chars().filter((c) => c.identityRefId === r.id).map((c) => c.name);
  const several = isGroupWho(r.who, chars().map((c) => c.name));
  const status = several ? h('span', { class: 'pill s-stale tiny', title: 'More than one person: it helps the script describe them, but it never locks a face. Add one photo per person for that.' }, 'group photo · locks no face')
    : locks.length ? h('span', { class: 'pill depbadge tiny', title: 'Every sheet of this character is built from this photo' }, `locks ${locks.join(', ')}`)
    : r.who && chars().length ? h('span', { class: 'pill s-stale tiny', title: `Type a name exactly as in the cast: ${chars().map((c) => c.name).join(', ')}` }, `no one named ${r.who} in the cast`)
    : r.who ? h('span', { class: 'pill tiny', title: 'Links when the script makes the cast' }, 'links when the script is made')
    : h('span', { class: 'pill s-stale tiny', title: 'Type who this is so the right face is used' }, 'who is this?');
  return h('div', { class: 'who' },
    h('input', { class: 'refnote whoin', type: 'text', list: listId, value: r.who || '', placeholder: 'Who is this?', 'aria-label': `Who is in ${refFileName(r.path)}`,
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      onchange: (e) => { const v = e.target.value.trim(); if (v !== (r.who || '')) setRefs(refs.map((x) => (x.id === r.id ? { ...x, who: v || undefined } : x)), v ? `Saved: ${v}` : 'Cleared'); } }),
    status);
}
async function setRefs(refs, msg) {
  await attempt('brief', async () => { await api(`/projects/${state.slug}`, 'PATCH', { brief: { refs } }); await loadProject(); if (msg) toast(msg); render(true); });
}
// Paste a copied picture anywhere on the Brief step (not while typing in a text box) to add it as a reference.
document.addEventListener('paste', (e) => {
  if (state.step !== 'brief' || !state.slug || $('dialog[open]')) return;
  const files = [...(e.clipboardData?.files || [])].filter(REF_ACCEPT);
  if (!files.length) return;
  e.preventDefault(); addRefFiles(files);
});

const toBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('could not read file')); r.readAsDataURL(file); });

// ---------- derived data ----------
const P = () => state.p;
const chars = () => P()?.script?.characters || [];
const locs = () => P()?.script?.locations || [];
const beats = () => (P()?.script?.scenes || []).slice().sort((a, b) => a.order - b.order);
const charName = (id) => chars().find((c) => c.id === id)?.name || id;
const stateLabel = (cid, sid) => chars().find((c) => c.id === cid)?.states.find((s) => s.id === sid)?.label || sid;
const locName = (id) => locs().find((l) => l.id === id)?.name || id;
const beat = (id) => beats().find((b) => b.id === id);
// `{{char:id}}` / `{{loc:id}}` are Heartcut's links to a sheet (prompts/blocks.md). The stored text keeps them; the
// dashboard shows the name as a chip, and the server removes them before anything goes to a picture or video model.
const REF_TAG = /\{\{(char|loc):([^}]+)\}\}/g;
const refName = (kind, id) => ((kind === 'char' ? chars() : locs()).find((x) => x.id === id)?.name || id);
function withRefChips(text) {
  const s = String(text ?? ''); const out = []; let last = 0;
  for (const m of s.matchAll(REF_TAG)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const name = refName(m[1], m[2]);
    out.push(h('span', { class: `refchip ${m[1]}`, title: `${m[1] === 'char' ? 'Character' : 'Place'}: ${name}. Its sheet goes with the shot as a reference picture.` }, name));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
/** The language model row of a price box: who writes the text and what it costs (no API price list, so "cents"). */
function llmCost() {
  if (!state.settings.loaded) { loadSettings(); return ['Language model', '…']; }
  const st = state.settings.llmStatus;
  if (state.spend?.fake || state.settings.fake) return ['Language model · fake mode', 'free'];
  if (!st || st.source === 'none') return ['Language model · not set up', '$?'];
  if (st.provider === 'claude-cli') return ['Claude · your plan', 'free'];
  if (st.preset === 'ollama' || st.preset === 'lmstudio') return [`${st.label} · this computer`, 'free'];
  return [`${st.label} · billed by them`, 'cents'];
}
/** Same clean-up as stripRefTags in src/gen/models.ts: the text a model actually receives. */
const stripRefTags = (t) => (String(t ?? '').includes('{{') ? String(t).replace(REF_TAG, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:])/g, '$1').replace(/,\s*,/g, ',').replace(/^ +| +$/gm, '') : String(t ?? ''));
const refPlain = (t) => String(t ?? '').replace(REF_TAG, (_, k, id) => refName(k, id));
const beatTitle = (id) => beat(id)?.title || id;
const beatNo = (id) => (beat(id)?.order ?? beats().findIndex((b) => b.id === id) + 1);
const asset = (id) => P()?.assets.find((a) => a.id === id);
const chosenOpt = (a) => (a && a.chosen != null ? a.options[a.chosen] : undefined);
const kindWord = (k) => (k === 'character-portrait' ? 'portrait' : k === 'character-full' ? 'full body' : 'location');
function assetModelName(a) { return MODEL_NAMES[a.model] || (a.model === 'library' ? 'library' : a.model === 'import' ? 'import' : (a.model || '').split('/').slice(-2, -1)[0] || ''); }
function shortLabel(a) {
  if (a.characterId) return `${charName(a.characterId)} · ${stateLabel(a.characterId, a.stateId)}`;
  return locName(a.locationId);
}

function hasContent(stage, p = P()) {
  switch (stage) {
    case 'brief': return !!p.brief.text.trim();
    case 'script': return !!p.script;
    case 'sheets': return !!p.sheets?.items.length;
    case 'images': return p.assets.some((a) => a.options.length);
    case 'scenes': return !!p.scenePrompts?.length;
    case 'keyframes': return !!p.keyframes?.length;
    case 'clips': return p.clips.length > 0;
    case 'export': return p.exports.length > 0;
  }
}
const isRunning = (stage) => Object.values(state.runs).some((r) => r.slug === state.slug && r.stage === stage && r.status === 'running')
  || !!P()?.jobs.some((j) => j.stage === stage && (j.status === 'running' || j.status === 'queued'));
const staleInfo = (stage) => P()?.staleness?.[stage]?.stale ? P().staleness[stage] : null;
const sheetItems = () => P()?.sheets?.items || [];
/** Sheets with no generated options yet. */
function missingSheets() {
  const have = new Set(P().assets.filter((a) => a.options.length).map((a) => a.id));
  return sheetItems().filter((s) => !have.has(s.id));
}
/** Mirror of the engine's anchorFor (src/stages/sheets.ts): humans anchor on the first state's portrait, animals on its full body. */
function anchorOf(sheet) {
  if (sheet.dependsOn) return sheet.dependsOn;
  if (!sheet.characterId) return undefined;
  const c = chars().find((x) => x.id === sheet.characterId);
  const first = c?.states[0];
  if (!c || !first) return undefined;
  const anchor = `${c.id}_${first.id}_${c.species === 'human' ? 'portrait' : 'full'}`;
  return sheet.id === anchor || !c.states.some((s) => sheet.id === `${c.id}_${s.id}_portrait` || sheet.id === `${c.id}_${s.id}_full`) ? undefined : anchor;
}
const hasPromptText = (r) => !!(r.prompt || '').trim() && r.prompt.trim() !== '(imported)';
const hasPics = (r) => !!r.asset?.options.length;
/** A dependent whose anchor has no pick yet. */
const isWaiting = (r) => { const a = anchorOf(r); return !!a && !hasPics(r) && chosenOpt(asset(a)) === undefined; };
const isStaleFace = (id) => (P().anchorStale || []).includes(id);
/** Rows with a prompt, no pictures yet, and nothing they are waiting for: what "Generate missing" makes. */
const readyMissing = (rows) => rows.filter((r) => hasPromptText(r) && !hasPics(r) && !isWaiting(r)).map((r) => r.id);
/** Rows that can be regenerated right now (a dependent with no pictures and no face is not one). */
const noFace = (r) => { const a = anchorOf(r); return !!a && chosenOpt(asset(a)) === undefined; };
const regenIds = (rows) => rows.filter((r) => hasPromptText(r) && !noFace(r)).map((r) => r.id);
/** Assets that back a current sheet. Pictures left over from an older script (renamed characters, removed places) are not on the page and must not gate it. */
const liveAssets = () => { const ids = new Set(sheetItems().map((s) => s.id)); return P().assets.filter((a) => ids.has(a.id)); };
const unpicked = () => liveAssets().filter((a) => a.options.length && a.chosen == null);
function clipsOf(sceneId, tier) { return P().clips.filter((c) => c.sceneId === sceneId && !isSeq(c) && (!tier || c.tier === tier) && c.status !== 'failed').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); }
const bestClip = (sceneId) => clipsOf(sceneId, 'final').find((c) => c.status === 'done') || clipsOf(sceneId, 'draft').find((c) => c.status === 'done');

// ---------- v5 derived: keyframes (optional stills) and one-take sequence clips ----------
// Old projects have no keyframes array and no motion text; every helper here tolerates both.
const keyframes = () => P()?.keyframes || [];
const kfId = (sceneId, role) => `kf_${sceneId}_${role}`;
const kfOf = (sceneId, role = 'start') => keyframes().find((k) => k.id === kfId(sceneId, role) || (k.sceneId === sceneId && k.role === role));
const kfChosen = (sceneId, role = 'start') => chosenOpt(kfOf(sceneId, role));
const spOf = (sceneId) => P()?.scenePrompts?.find((s) => s.sceneId === sceneId);
/** Beats that have a scene prompt, in order: the rows of the Keyframes step. */
const kfBeats = () => beats().filter((b) => spOf(b.id));
const kfWanted = (b) => [['start', true], ['end', !!spOf(b.id)?.endFrame]].filter(([, on]) => on).map(([role]) => role);
/** Frames (start, and end where switched on) that have no pictures yet. */
const kfMissingFrames = () => kfBeats().flatMap((b) => kfWanted(b).filter((role) => !kfOf(b.id, role)?.options?.length).map((role) => ({ sceneId: b.id, role })));
const kfMissing = () => [...new Set(kfMissingFrames().map((f) => f.sceneId))];
const kfAllChosen = () => kfBeats().length > 0 && kfBeats().every((b) => kfChosen(b.id));
/** A one-take clip covers several beats (sceneId == sceneIds[0]). It is kept apart from the per-scene clips. */
const isSeq = (c) => c.source === 'sequence' || (c.sceneIds?.length || 0) > 1;
const seqClips = () => P().clips.filter((c) => isSeq(c) && c.status !== 'failed').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
const seqCovering = (sceneId) => seqClips().filter((c) => (c.sceneIds || [c.sceneId]).includes(sceneId));
const sceneApproved = (sceneId) => clipsOf(sceneId).some((c) => c.approved) || seqCovering(sceneId).some((c) => c.approved);
const clipSource = (c) => (isSeq(c) ? 'one take' : c.source === 'keyframe' ? 'from keyframe' : 'from sheets');
const clipMode = (c) => c.mode || 'full';
/** Which prompt the server will send for a scene: the user's choice, else short with a chosen keyframe, full without. */
const effectiveMode = (sceneId) => state.ui.promptMode || (kfChosen(sceneId) ? 'short' : 'full');
/** What the server falls back to in short mode when the scenes stage wrote no motion text. */
function shortFallback(sp) {
  const pick = (n) => sp.blocks?.find((b) => b.name === n)?.text?.trim();
  const motionNeg = (sp.negatives || []).filter((n) => /camera|zoom|push|pull|pan|tilt|dolly|morph|shake|drift|slow/i.test(n));
  return [pick('SHOT'), pick('PERFORM'), pick('PHYSICS'), ...motionNeg].filter(Boolean).join(', ');
}

/** The six status words. Nothing else. */
function stageStatus(stage) {
  if (isRunning(stage)) return 'generating…';
  if (!hasContent(stage)) return 'empty';
  if (staleInfo(stage)) return 'stale';
  if (stage === 'images' && (unpicked().length || missingSheets().length)) return 'needs you';
  if (stage === 'keyframes' && !kfAllChosen()) return 'needs you';
  if (stage === 'clips' && !P().clips.some((c) => c.approved)) return 'needs you';
  if (P().approvals[stage]) return 'approved';
  return 'done';
}
const STATUS_CLS = { 'empty': 's-empty', 'needs you': 's-needs', 'generating…': 's-run', 'done': 's-done', 'approved': 's-approved', 'stale': 's-stale' };
const statusPill = (w, extra = '') => h('span', { class: `pill ${STATUS_CLS[w]} ${extra}` }, w);

/** First step that still needs attention. */
function currentStep() {
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    if (hasContent(s.id)) continue;
    // A skippable step is only "current" while the step after it is empty too.
    if (!OPTIONAL_STEPS.has(s.id) || !STEPS[i + 1] || !hasContent(STEPS[i + 1].id)) return s.id;
  }
  for (const s of STEPS) if (!P().approvals[s.id]) return s.id;
  return 'export';
}
/** A step is reachable when every step before it has content (skippable steps may be empty). */
function reachable(stage) {
  for (const s of STEPS) { if (s.id === stage) return true; if (!hasContent(s.id) && !OPTIONAL_STEPS.has(s.id)) return false; }
  return true;
}

// ---------- estimates (price first) ----------
const ek = (stage, o) => `${stage}:${JSON.stringify(o)}`;
/** Read an estimate; fetch it if missing or out of date. `delay` debounces input-driven requests (600 ms). */
/** Clips carry the chosen prompt mode (one-take sequences have their own deterministic prompt, so not those). */
const clipExtra = (stage, o) => (stage === 'clips' && state.ui.promptMode && !o.sequence ? { promptMode: state.ui.promptMode } : {});
function want(stage, opts = {}, delay = 0) {
  const o = { ...opts, ...clipExtra(stage, opts) };
  const k = ek(stage, o);
  const cur = state.est[k];
  const stamp = P()?.updatedAt;
  if ((!cur || cur.at !== stamp) && !state.pend[k]) {
    state.pend[k] = setTimeout(async () => {
      try { state.est[k] = { ...(await api(`/projects/${state.slug}/estimate/${stage}`, 'POST', o)), at: stamp }; }
      catch (e) { state.est[k] = { error: e.status === 503 ? 'engine not ready' : e.message, at: stamp }; }
      delete state.pend[k]; render();
    }, delay);
  }
  return cur;
}
const capLeft = () => state.spend.remainingUsd;
const overBy = (usdv) => Math.max(0, usdv - capLeft());

/**
 * A button whose label carries its price. Over $0.50 (live runs) the click opens a one-line confirm.
 * spec: {key, label, stage, opts, run, cls, disabled, why, est (precomputed {usd}), debounce}
 */
function priced(spec) {
  const e = 'est' in spec ? spec.est : want(spec.stage, spec.opts || {}, spec.debounce || 0);
  const busy = isRunning(spec.stage);
  const price = e && !e.error ? e.usd : null;
  const over = price != null && !spec.disabled ? overBy(price) : 0;
  if (state.ui.confirm === spec.key && price != null) {
    return h('span', { class: 'confirm' }, `Spend `, h('b', {}, usd(price)), `?`,
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => { state.ui.confirm = null; spec.run(); } }, `Yes, generate ${usd(price)}`),
      h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { state.ui.confirm = null; render(); } }, 'Cancel'));
  }
  const dis = spec.disabled || busy || price == null || over > 0;
  const why = spec.disabled ? spec.why : over > 0 ? `over cap by ${usd(over)}` : e?.error ? 'price unavailable' : '';
  return h('button', {
    class: `btn ${spec.cls || ''} ${over > 0 ? 'over' : ''}`, type: 'button', disabled: dis, title: e?.error || (dis && why ? why : ''),
    onclick: () => { if (price >= CONFIRM_USD) { state.ui.confirm = spec.key; render(); } else spec.run(); },
  }, spec.label, ' · ', h('span', { class: 'price', title: price > 0 && state.settings.genStatus?.approxPrices ? 'approx.: from the service\'s published price list' : null }, price == null ? (e?.error ? '$?' : '$…') : `${price > 0 && state.settings.genStatus?.approxPrices ? 'approx. ' : ''}${usd(price)}`), why ? h('span', { class: 'why' }, why) : null);
}

const pendingWhat = {}; // stage -> words of the last run started from here, for the finish toast when the SSE beats the POST reply
/** "Draft · Scene 1", "One take · Scenes 2–4", "Keyframes · 3 scenes" — the words the run toasts use. */
function runWhat(stage, opts = {}) {
  const ids = opts.ids || [];
  const scenes = ['clips', 'keyframes'].includes(stage) && ids.length ? (ids.length === 1 ? `Scene ${beatNo(ids[0])}` : opts.sequence ? `Scenes ${beatNo(ids[0])}–${beatNo(ids.at(-1))}` : plural(ids.length, 'scene')) : '';
  const word = stage === 'clips' ? (opts.sequence ? 'One take' : opts.tier === 'final' ? 'Final' : 'Draft') : STEPS[STEP_IDX[stage]]?.label || stage;
  return [word, scenes].filter(Boolean).join(' · ');
}
async function runStage(stage, opts) {
  await saveIfDirty();
  await attempt(stage, async () => {
    const o = { ...opts, ...clipExtra(stage, opts) };
    const what = runWhat(stage, opts);
    const e = stage === 'clips' && opts.ids && !opts.sequence ? actionEst({ stage, opts }) : state.est[ek(stage, o)];
    pendingWhat[stage] = what;
    toast(`${what} started${e && !e.error ? ` · ${usd(e.usd)}` : ''}`);
    const { jobId } = await api(`/projects/${state.slug}/run/${stage}`, 'POST', o);
    // The SSE "done" can beat this response on a fast (fake or dry) run: never put a finished run back to running.
    const seen = state.runs[jobId];
    state.runs[jobId] = { ...seen, slug: state.slug, stage, status: seen?.status && seen.status !== 'running' ? seen.status : 'running', what };
    render();
  });
}

// ---------- loading, routing, saving ----------
async function refreshProjects() { state.projects = await api('/projects'); }
async function refreshSpend() {
  try { state.spend = await api(`/spend${state.slug ? `?slug=${state.slug}` : ''}`); render(); } catch { /* keep last numbers */ }
}
async function loadProject(slug = state.slug) {
  const p = await api(`/projects/${slug}`);
  if (slug !== state.slug) return;
  state.p = p;
}

const nav = (slug, step) => { location.hash = slug ? `#/p/${slug}${step ? '/' + step : ''}` : '#/projects'; };
function parseHash() {
  const m = /^#\/?p\/([a-z0-9-]+)(?:\/(\w+))?/.exec(location.hash);
  return m ? { slug: m[1], step: STEP_IDX[m[2]] != null ? m[2] : null } : { slug: null };
}
async function onRoute() {
  closeDrawer(true);
  const r = parseHash();
  if (!r.slug) {
    state.slug = null; state.p = null; state.dirty = false;
    try { await refreshProjects(); delete state.errs.projects; } catch (e) { state.errs.projects = e.message; toast(e.message, true); }
    render(true); return;
  }
  if (r.slug !== state.slug || !state.p) {
    Object.assign(state, { slug: r.slug, p: null, est: {}, pend: {}, errs: {}, dirty: false });
    Object.assign(state.ui, { sel: {}, open: {}, confirm: null, scene: null });
    render(true);
    try { await loadProject(r.slug); } catch (e) { toast(e.message, true); location.hash = '#/projects'; return; }
    store('heartcut.slug', r.slug);
    refreshSpend();
  }
  state.dirty = false;
  state.step = r.step || currentStep();
  if (!r.step) history.replaceState(null, '', `#/p/${state.slug}/${state.step}`);
  state.ui.confirm = null;
  window.scrollTo(0, 0);
  render(true);
}

/** Pull the editable values out of the centre column into a clone of the project. */
function collectStep(stage) {
  const root = $('#centre');
  const out = structuredClone(P());
  for (const el of $$('[data-p]', root)) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = Number(v);
    setPath(out, el.dataset.p, v);
  }
  if (stage === 'keyframes' && out.keyframes) {
    for (const card of $$('.kfed[data-k]', root)) {
      const kf = out.keyframes[Number(card.dataset.k)];
      if (!kf) continue;
      kf.negatives = $$('.chip[data-v]', card).map((c) => c.dataset.v);
      if (kf.blocks?.length) {
        for (const ta of $$('textarea[data-b]', card)) kf.blocks[Number(ta.dataset.b)].text = ta.value.trim();
        const nb = kf.blocks.find((b) => b.name === 'NEGATIVES');
        if (nb) nb.text = kf.negatives.join(', ');
        kf.prompt = joinBlocks(kf.blocks, kf.negatives);
      } else {
        const ta = $('textarea[data-plain]', card);
        if (ta) kf.prompt = ta.value;
      }
    }
  }
  if (stage === 'scenes') {
    for (const card of $$('.scene[data-i]', root)) {
      const sp = out.scenePrompts[Number(card.dataset.i)];
      sp.negatives = $$('.chip[data-v]', card).map((c) => c.dataset.v);
      if (sp.blocks) {
        for (const ta of $$('textarea[data-b]', card)) sp.blocks[Number(ta.dataset.b)].text = ta.value.trim();
        const nb = sp.blocks.find((b) => b.name === 'NEGATIVES');
        if (nb) nb.text = sp.negatives.join(', ');
        sp.prompt = joinBlocks(sp.blocks, sp.negatives);
      } else {
        const ta = $('textarea[data-plain]', card);
        if (ta) sp.prompt = ta.value;
      }
    }
  }
  return out;
}
/** Same rule as the engine: every block but NEGATIVES, then the negatives once. */
function joinBlocks(blocks, negatives) {
  const body = blocks.filter((b) => b.name !== 'NEGATIVES').map((b) => b.text.trim().replace(/[,.\s]+$/, '')).filter(Boolean);
  const lower = body.join(', ').toLowerCase();
  const tail = negatives.map((n) => n.trim()).filter((n) => n && !lower.includes(n.toLowerCase()));
  return [...body, ...tail].join(', ');
}
// Apply the Script form's name changes through /rename, then report whether anything else in the form changed.
// Returns true when the names were the only edit (no PATCH needed). Mutates `form` so a following PATCH carries the
// swapped text instead of reverting it.
const ID_KEYS = new Set(['id', 'characterId', 'locationId', 'stateId', 'identityRefId', 'refId', 'matchCutFrom', 'era']);
function swapWords(v, re, to, key) {
  if (typeof v === 'string') return ID_KEYS.has(key) ? v : v.replace(re, to);
  if (Array.isArray(v)) return v.map((x) => swapWords(x, re, to));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapWords(x, re, to, k)]));
  return v;
}
function sameJson(a, b) {
  const norm = (v) => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined && v[k] !== '').map((k) => [k, norm(v[k])])) : typeof v === 'number' ? String(v) : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
async function renameFromScript(form) {
  const cur = P().script; if (!cur || !form) return false;
  const pairs = [];
  for (const [kind, key] of [['character', 'characters'], ['location', 'locations']]) {
    for (const f of form[key] || []) {
      const was = (cur[key] || []).find((x) => x.id === f.id);
      const name = String(f.name ?? '').replace(/\s+/g, ' ').trim();
      if (was && name && name !== was.name) pairs.push({ kind, id: f.id, from: was.name, to: name });
    }
  }
  if (!pairs.length) return false;
  for (const r of pairs) {
    state.p = await api(`/projects/${state.slug}/rename`, 'POST', { kind: r.kind, id: r.id, name: r.to });
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
    Object.assign(form, swapWords(form, re, r.to));
    const ent = (form[r.kind === 'character' ? 'characters' : 'locations'] || []).find((x) => x.id === r.id);
    if (ent) ent.name = r.to; // the name field itself already holds the new name; the swap must not double it
  }
  toast(pairs.length === 1 ? `Renamed ${pairs[0].from} to ${pairs[0].to} everywhere` : `Renamed ${pairs.length} names everywhere`);
  const same = sameJson(form, P().script);
  if (!same) console.debug('script form differs after rename', diffPaths(form, P().script));
  return same;
}
function diffPaths(a, b, at = '') {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return String(a ?? '') === String(b ?? '') ? [] : [at];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffPaths(a[k], b[k], `${at}.${k}`));
}
async function saveStep() {
  const stage = state.step;
  const out = collectStep(stage);
  const body = {};
  if (stage === 'brief') body.brief = { text: out.brief.text, notes: out.brief.notes ?? '' };
  else if (stage === 'script') {
    // Name edits go through the rename route (name swapped in every prompt, nothing goes stale). Only a real
    // change to anything else is PATCHed, so renaming in this form costs nothing downstream.
    try { if (await renameFromScript(out.script)) { state.dirty = false; await loadProject(); toast('Saved'); render(true); return true; } }
    catch (e) { state.errs[stage] = `Could not save: ${e.message}`; toast(e.message, true); render(); return false; }
    body.script = out.script;
  }
  else if (stage === 'sheets') body.sheets = out.sheets;
  else if (stage === 'scenes') body.scenePrompts = out.scenePrompts;
  else if (stage === 'keyframes') body.keyframes = out.keyframes || [];
  else return true;
  try {
    await api(`/projects/${state.slug}`, 'PATCH', body);
    state.dirty = false;
    await loadProject(); toast('Saved'); render(true); return true;
  } catch (e) { state.errs[stage] = `Could not save: ${e.message}`; toast(e.message, true); render(); return false; }
}
async function saveIfDirty() { return state.dirty ? saveStep() : true; }
function markDirty() {
  if (state.dirty) return;
  state.dirty = true;
  const bar = $('#savebar'); if (bar) bar.hidden = false;
  const note = $('#footnote'); if (note) note.textContent = 'You have edits that are not saved yet.';
}

async function go(stage) {
  if (!(await saveIfDirty())) return;
  nav(state.slug, stage);
}
async function continueFrom() {
  if (!(await saveIfDirty())) return;
  const i = STEP_IDX[state.step];
  if (!P().approvals[state.step] && hasContent(state.step)) {
    try { await api(`/projects/${state.slug}/approve-stage`, 'POST', { stage: state.step }); await loadProject(); } catch (e) { toast(e.message, true); }
  }
  nav(state.slug, STEPS[Math.min(i + 1, STEPS.length - 1)].id);
}

// ---------- modal / drawer shells ----------
function modal(title, build, wide) {
  const d = h('dialog', { class: wide ? 'wide' : '', 'aria-label': title });
  d.append(build(d));
  $('#overlay').append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}
// ---------- shell: top bar, stepper, footer ----------
function paint(key, sig, build) {
  if (state.sig[key] === sig) return false;
  state.sig[key] = sig; build(); return true;
}
function render(force = false) {
  const y = window.scrollY;
  renderNow(force);
  placeToast();
  // Rebuilding a column briefly shortens the page, which would throw the scroll position to the top.
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
}
function renderNow(force) {
  const base = JSON.stringify([state.styles, state.settings, state.p, state.step, state.slug, state.est, state.errs, state.spend, state.runs, state.ui, state.lib, state.projects, state.dirty]);
  if (force) state.sig = {};
  paintTop();
  if (!state.slug) { $('#steps').hidden = true; $('#foot').hidden = true; paintProjects(base); return; }
  if (!state.p) {
    $('#steps').hidden = true; $('#foot').hidden = true;
    paint('app', 'loading', () => $('#app').replaceChildren(h('main', { class: 'projects' }, h('p', { class: 'note' }, 'Loading…'))));
    return;
  }
  paintSteps(base); paintBody(base, force); paintFoot(base); paintDrawer(base);
}

function spendBlock() {
  const s = state.spend;
  const pct = s.capUsd ? s.sittingUsd / s.capUsd : 0;
  const drafts = Math.max(0, Math.floor(s.remainingUsd / DRAFT_USD));
  const cls = pct >= 0.9 ? 'bad' : pct >= 0.7 ? 'warn' : '';
  const right = drafts === 0 && pct >= 0.9 ? 'cap reached · raise it' : `≈ ${plural(drafts, 'draft')} left`;
  // The server decides fake mode; the UI must shout about it or placeholder output looks like a dead button.
  return h('div', { class: `spend ${cls}`, id: 'spend' },
    s.fake ? h('div', { class: 'fakebadge', title: 'HEARTCUT_FAKE=1: placeholders only, nothing is sent anywhere. Stop Heartcut and start it with npm start for real output.' }, 'FAKE MODE · placeholders, no real pictures') : null,
    h('div', { class: 'row' }, h('span', { class: 'l' }, 'Sitting spend'),
      h('span', { class: 'mono' }, h('span', { class: 'amt' }, usd(s.sittingUsd)), h('span', { class: 'left' }, ` of ${usd(s.capUsd)} · ${right}`))),
    h('div', { class: `meter ${cls}`, role: 'progressbar', 'aria-label': 'Sitting spend', 'aria-valuemin': 0, 'aria-valuemax': s.capUsd, 'aria-valuenow': s.sittingUsd },
      h('i', { style: `width:${Math.min(100, Math.max(pct > 0 ? 2 : 0, Math.round(pct * 100)))}%` })));
}
function paintTop() {
  const sig = JSON.stringify([state.p?.title, state.p?.aspect, state.slug, state.spend]);
  paint('top', sig, () => {
    $('#top').replaceChildren(
      h('a', { class: 'brand', href: '#/projects', 'aria-label': 'Heartcut, all projects' }, svg('heart', 18, 'var(--ember)'), 'Heartcut'),
      state.p ? h('div', { class: 'crumb' }, h('strong', {}, state.p.title), '·', h('span', { title: 'Aspect is fixed when the project is made' }, aspectBit(state.p.aspect, 14)), '·', h('a', { href: '#/projects' }, 'All projects')) : null,
      h('div', { class: 'grow' }),
      spendBlock(),
      null);
  });
}

function paintSteps(base) {
  paint('steps', base, () => {
    const bar = $('#steps'); bar.hidden = false;
    const cur = state.step;
    const firstStale = STEPS.find((s) => staleInfo(s.id));
    const items = STEPS.map((s, i) => {
      // A check mark means the step is really finished (every sheet picked, a clip approved…),
      // not merely "has something in it" — the same rule the status pill uses.
      const st = stageStatus(s.id);
      const done = (st === 'done' || st === 'approved') && s.id !== cur;
      const needs = st === 'needs you' && s.id !== cur;
      const stale = !!staleInfo(s.id);
      return h('li', {}, h('button', {
        type: 'button', class: `stepbtn ${s.id === cur ? 'now' : done ? 'done' : needs ? 'needs' : ''} ${stale ? 'stale' : ''}`, disabled: !reachable(s.id),
        'aria-current': s.id === cur ? 'step' : null, title: needs ? 'Needs you: finish this step' : null, onclick: () => go(s.id),
      }, h('span', { class: 'n' }, done && !stale ? '✓' : i + 1), s.id === cur ? `${s.label} — ${s.hint}` : s.label,
        stale ? h('span', { class: 'pill s-stale' }, 'stale') : needs ? h('span', { class: 'pill s-needs' }, 'needs you') : null));
    });
    const staleCount = STEPS.filter((s) => staleInfo(s.id)).length;
    bar.replaceChildren(h('ol', {}, items),
      firstStale ? h('button', { type: 'button', class: 'stalebanner', onclick: () => go(firstStale.id) },
        h('span', { class: 'pill s-stale' }, svg('warn', 12, 'currentColor', 2.5),
          `${STEPS.find((s) => s.id === staleInfo(firstStale.id).because)?.label || 'An earlier step'} changed · ${plural(staleCount, 'step')} may be stale`)) : null);
  });
}

// ---------- first-run setup card (server: src/doctor.ts, GET /api/doctor, POST /api/demo) ----------
// Shown on the projects page when there are no projects yet or the doctor has something to fix. Never shows a key.
const setupState = { loaded: false, loading: false, data: null, err: '', open: null };
async function loadDoctor(force) {
  if (setupState.loading || (setupState.loaded && !force)) return;
  setupState.loading = true;
  try { setupState.data = await api('/doctor'); setupState.err = ''; } catch (e) { setupState.err = e.message; }
  setupState.loading = false; setupState.loaded = true;
  render();
}
const setupProblems = () => (setupState.data?.checks || []).filter((c) => c.level === 'warn' || c.level === 'fail');
const setupSig = () => setupProblems().map((c) => `${c.id}:${c.level}`).join(',');
/** Open a settings group where it lives (a project's Brief step). With no project yet, show it inside the card. */
function openSetting(which) {
  const title = which === 'gen' ? 'Pictures and video' : 'Language model';
  const first = state.projects[0];
  if (!first) { setupState.open = setupState.open === which ? null : which; render(true); return; }
  nav(first.slug, 'brief');
  let tries = 0;
  const seek = () => {
    const el = which === 'llm' ? document.getElementById('llm') : null;
    const found = el || [...document.querySelectorAll('.group')].find((g) => g.querySelector('h2')?.textContent.trim() === title);
    if (found) { found.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (++tries < 30) setTimeout(seek, 100);
  };
  setTimeout(seek, 50);
}
/** The "Pictures and video" group, when the dashboard has one. */
function genGroup() {
  if (typeof genSection === 'function') return genSection(); // eslint-disable-line no-undef
  return h('div', { class: 'group' }, h('h2', { class: 'h2' }, 'Pictures and video'), h('p', { class: 'note' }, 'This group is not in the dashboard yet. Use .env for now: see .env.example.'));
}
async function startDemo(anyway) {
  const fake = !!(setupState.data?.fake ?? state.spend.fake);
  if (!fake && !anyway) {
    modal('Try the demo', (d) => h('form', { method: 'dialog' },
      h('h2', { class: 'h2' }, 'Fake mode is off'),
      h('p', {}, 'The demo is free in fake mode. Every step makes placeholder pictures and clips, and nothing is sent anywhere.'),
      h('p', {}, 'To turn it on, stop Heartcut (Ctrl+C in its terminal) and start it again with:'),
      h('p', { class: 'mono setup-cmd' }, 'npm run fake'),
      h('p', { class: 'note' }, 'You can also make the demo project now. Each step shows its price before it spends anything.'),
      h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => d.close() }, 'Close'),
        h('button', { class: 'btn', type: 'button', onclick: () => { d.close(); startDemo(true); } }, 'Make the demo project anyway'))));
    return;
  }
  try {
    const p = await api('/demo', 'POST', {});
    await refreshProjects();
    toast(fake ? 'Demo project made. Press Generate script to start (free in fake mode).' : 'Demo project made. Each step shows its price first.');
    nav(p.slug);
  } catch (e) { toast(e.message, true); }
}
function setupCard() {
  if (!setupState.loaded) { loadDoctor(); return null; }
  const d = setupState.data;
  const problems = setupProblems();
  const none = !state.projects.length;
  if (!none && (!problems.length || store('heartcut.setupHidden') === setupSig())) return null;
  const dot = (lvl) => h('span', { class: `setup-dot ${lvl === 'ok' ? 'ok' : lvl === 'fail' ? 'bad' : lvl === 'warn' ? 'warn' : ''}`, 'aria-hidden': 'true' }, '●');
  const word = { ok: 'Ready', info: 'Note', warn: 'To do', fail: 'Problem' };
  const list = d ? h('ul', { class: 'setup-list' }, d.checks.map((c) => h('li', { class: `setup-item lvl-${c.level}` },
    dot(c.level),
    h('div', {},
      h('div', {}, h('b', {}, c.label), h('span', { class: 'sr' }, ` ${word[c.level]}.`), ' ', h('span', { class: 'setup-detail' }, c.detail)),
      c.fix && c.level !== 'ok' ? h('div', { class: 'note' }, c.level === 'info' ? 'Tip: ' : 'Fix: ', /^(cp|copy|brew|sudo|winget) /.test(c.fix) || /^Install it: /.test(c.fix) ? h('span', { class: 'mono' }, c.fix) : c.fix) : null)))) : null;
  const head = !d ? 'The setup check did not answer.' : d.canRun === false ? 'Heartcut needs one thing fixed before it can make anything.'
    : problems.length ? 'Heartcut can run now in fake mode (free). Fix the To do lines to make real films.' : d.fake ? 'All set. Fake mode is on, so the demo is free.' : 'All set.';
  const inline = setupState.open ? (setupState.open === 'gen' ? genGroup() : llmSection()) : null;
  return h('section', { class: 'empty-card setup', 'aria-labelledby': 'setup-h' },
    h('div', { class: 'sechead setup-head' }, h('div', { class: 'intro' }, h('div', { class: 'eyebrow' }, 'FIRST RUN'), h('h2', { id: 'setup-h' }, 'Get set up')),
      !none ? h('button', { class: 'btn sm quiet', type: 'button', title: 'Hide until something changes', onclick: () => { store('heartcut.setupHidden', setupSig()); render(true); } }, 'Hide') : null),
    h('p', {}, head),
    setupState.err ? h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, setupState.err)) : null,
    list,
    h('div', { class: 'acts-row setup-acts' },
      h('button', { class: 'btn sm', type: 'button', 'aria-expanded': none ? String(setupState.open === 'llm') : null, onclick: () => openSetting('llm') }, 'Language model'),
      h('button', { class: 'btn sm', type: 'button', 'aria-expanded': none ? String(setupState.open === 'gen') : null, onclick: () => openSetting('gen') }, 'Pictures and video'),
      h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { setupState.loaded = false; loadDoctor(true); } }, 'Check again'),
      h('button', { class: `btn sm ${none ? 'primary' : ''}`, type: 'button', onclick: () => startDemo(false) }, 'Try the demo (free)')),
    h('p', { class: 'note' }, 'The same checklist runs in a terminal: ', h('span', { class: 'mono' }, 'npm run doctor')),
    inline ? h('div', { class: 'setup-inline' }, inline) : null);
}

// ---------- projects view ----------
function paintProjects(base) {
  paint('app', base + JSON.stringify([setupState.data, setupState.err, setupState.open, setupState.loaded]), () => {
    const list = state.projects;
    const cards = list.map((p) => {
      const dots = STEPS.map((s) => h('i', { class: hasContent(s.id, p) ? 'on' : '', title: s.label }));
      const spent = p.jobs.reduce((a, j) => a + (j.actualUsd || 0), 0);
      const cur = STEPS.find((s) => !hasContent(s.id, p));
      return h('a', { class: 'pcard', href: `#/p/${p.slug}/${cur ? cur.id : 'export'}` },
        h('div', { class: 'sechead' }, h('h3', {}, p.title), h('span', { class: 'pill', title: `Aspect ${p.aspect}` }, aspectGlyph(p.aspect, 12), p.aspect)),
        h('div', { class: 'dots', 'aria-label': `${STEPS.filter((s) => hasContent(s.id, p)).length} of ${STEPS.length} steps have content` }, dots),
        h('div', { class: 'meta' }, h('span', {}, cur ? `Next: ${cur.label}` : 'All steps done'), h('span', { class: 'mono' }, `${usd(spent)} · ${p.updatedAt.slice(0, 10)}`)));
    });
    const newBtn = (cls) => h('button', { class: `btn ${cls}`, type: 'button', onclick: newProjectModal }, 'New project');
    $('#app').replaceChildren(h('main', { class: 'projects' },
      h('div', { class: 'sechead' }, h('div', { class: 'intro' }, h('div', { class: 'eyebrow' }, 'PROJECTS'), h('h1', { class: 'h1' }, 'Your films')), list.length ? newBtn('primary') : null),
      state.errs.projects ? h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, state.errs.projects)) : null,
      setupCard(),
      list.length ? h('div', { class: 'pgrid' }, cards) : h('div', { class: 'empty-card' },
        h('h2', {}, "Write the brief like you'd tell a friend."),
        h('p', {}, 'No technical words. Say who is in it, where it happens and how it should feel. Heartcut does the rest, and shows the price before it spends anything.'),
        stepCards([
          ['pen', 'Write the brief', 'Who is in it, where, and how it should feel.'],
          ['lock', 'Lock the cast', 'Pick one face per character and one picture per place.'],
          ['film', 'Shoot the drafts', 'Cheap 480p drafts first, finals only for the ones you approve.'],
        ]), newBtn('primary'))));
  });
}

function newProjectModal() {
  const err = h('div', { class: 'banner err', role: 'alert', hidden: true });
  modal('New project', (d) => {
    const queued = []; const qlist = h('div', { class: 'reflist queued' });
    const showQueue = () => qlist.replaceChildren(...queued.map((file, i) => h('div', { class: 'ref' },
      h('div', { class: 'refpic' }, h('img', { class: 'im', src: URL.createObjectURL(file), alt: file.name }),
        h('button', { type: 'button', class: 'refx', 'aria-label': `Remove ${file.name}`, onclick: () => { queued.splice(i, 1); showQueue(); } }, svg('close', 12))),
      h('span', { class: 'refname', title: file.name }, file.name))));
    const addQueued = (files) => { for (const file of files) { if (tooBig(file)) toast(`${file.name} is over 15 MB`, true); else queued.push(file); } showQueue(); };
    const f = h('form', { method: 'dialog' },
      h('h2', { class: 'h2' }, 'New project'), err,
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, 'Title'), h('input', { type: 'text', name: 'title', required: true, autocomplete: 'off' })),
        h('div', { class: 'field' }, h('span', { id: 'np-aspect' }, 'Aspect'), chipSelect({ title: 'Aspect ratio', name: 'aspect', value: '16:9', options: ASPECTS, cls: 'block', sub: (o) => o?.hint }))),
      h('p', { class: 'note' }, 'The aspect is fixed once the project is made: every sheet, keyframe and clip is framed for it.'),
      h('label', { class: 'field' }, h('span', {}, 'Brief'), h('textarea', { name: 'briefText', rows: 6, placeholder: "Write it the way you'd tell a friend." })),
      h('div', { class: 'upload' },
        h('div', { class: 'field', style: 'grid-column:1/-1' }, h('span', {}, 'Reference images (optional)'),
          dropzone({ compact: true, title: 'Drop pictures here', sub: 'or click to choose · png, jpg, webp · up to 15 MB each', accept: isImg, acceptAttr: 'image/*', onFiles: addQueued, what: 'pictures' }), qlist),
        h('div', { class: 'field' }, h('span', {}, 'Role'), chipSelect({ title: 'What is this picture for?', name: 'role', value: 'mood', options: roleOptions(['selfie', 'character', 'location', 'mood']), cls: 'block' })),
        h('label', { class: 'field' }, h('span', {}, 'Note'), h('input', { type: 'text', name: 'note' })), h('span')),
      h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Create project')));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', f); btn.disabled = true;
      try {
        const p = await api('/projects', 'POST', { title: f.title.value, aspect: f.aspect.value, briefText: f.briefText.value });
        for (const file of queued) await uploadRef(p.slug, file, f.role.value, f.note.value);
        d.close(); await refreshProjects(); nav(p.slug);
      } catch (x) { err.hidden = false; err.replaceChildren(h('span', { class: 'msg' }, x.message)); btn.disabled = false; }
    });
    setTimeout(() => f.title.focus(), 0);
    return f;
  });
}
async function uploadRef(slug, file, role, note) {
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} is over 15 MB`);
  return api(`/projects/${slug}/refs`, 'POST', { role, filename: file.name, dataBase64: await toBase64(file), note: note || undefined });
}

// ---------- step actions (what the priced buttons do) ----------
const lastDraftless = () => beats().filter((b) => P().scenePrompts?.some((s) => s.sceneId === b.id) && !clipsOf(b.id, 'draft').some((c) => c.status === 'done')).map((b) => b.id);
/** The one priced action for a step, or null. */
function mainAction(step) {
  const has = hasContent(step);
  switch (step) {
    case 'script': return { label: has ? 'Regenerate script' : 'Generate script', stage: 'script', opts: {} };
    case 'sheets': return { label: has ? 'Regenerate sheets' : 'Generate sheets', stage: 'sheets', opts: {} };
    case 'images': {
      const ids = readyMissing(imageRows());
      if (ids.length) return { label: `Generate ${ids.length} missing ${ids.length === 1 ? 'sheet' : 'sheets'}`, stage: 'images', opts: { ids } };
      return missingSheets().length ? null : { label: 'Regenerate all', stage: 'images', opts: { force: true } }; // what is left is waiting for a face pick
    }
    case 'scenes': return { label: has ? 'Regenerate scenes' : 'Write scenes', stage: 'scenes', opts: {} };
    case 'keyframes': { const ids = kfMissing(); const n = kfMissingFrames().length; return ids.length ? { label: `Generate ${plural(n, 'keyframe')}`, stage: 'keyframes', opts: { ids } } : null; }
    case 'clips': { const ids = lastDraftless(); return ids.length ? { label: `Draft ${plural(ids.length, 'scene')}`, stage: 'clips', opts: { tier: 'draft', ids } } : null; }
    case 'export': return { label: `Export ${state.ui.exportRes}`, stage: 'export', opts: { resolution: state.ui.exportRes }, debounce: 600 };
    default: return null;
  }
}
/** What "Regenerate" means in a stale banner. */
function regenAction(step) {
  if (step === 'images') return { label: 'Regenerate', stage: 'images', opts: { force: true } };
  if (step === 'keyframes') return { label: 'Regenerate', stage: 'keyframes', opts: { force: true } };
  if (step === 'clips') return { label: 'Regenerate drafts', stage: 'clips', opts: { tier: 'draft', ids: [...new Set(P().clips.map((c) => c.sceneId))] } };
  const m = mainAction(step);
  return m ? { ...m, label: 'Regenerate' } : null;
}
const pricedFor = (a, key, extra = {}) => priced({ key, label: a.label, stage: a.stage, opts: a.opts, est: actionEst(a), run: () => runStage(a.stage, a.opts), ...extra });

// ---------- body skeleton ----------
function paintBody(base, force) {
  const app = $('#app');
  if (!$('.body', app)) {
    app.replaceChildren(h('div', { class: 'body' }, h('aside', { class: 'col-l', id: 'left' }), h('main', { class: 'col-c', id: 'centre', 'aria-label': 'Step' }), h('aside', { class: 'col-r', id: 'right' })));
    state.sig.left = state.sig.centre = state.sig.right = null;
  }
  $('.body', app).dataset.step = state.step;
  paint('left', base, buildLeft);
  const c = $('#centre'); const ae = document.activeElement;
  const typing = ae && c.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== 'checkbox';
  if (force || !(state.dirty || typing)) paint('centre', base, () => { buildCentre(); growAll(c); });
  paint('right', base, buildRight);
}
function growAll(root) { for (const t of $$('textarea.grow', root)) grow(t); }
function grow(t) { if (!t.offsetParent) return; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }

// ---------- left column ----------
function buildLeft() {
  const i = STEP_IDX[state.step]; const S = STEPS[i];
  $('#left').replaceChildren(
    h('div', { class: 'intro' },
      h('div', { class: 'eyebrow' }, `STEP ${i + 1} OF ${STEPS.length}`),
      h('h1', { class: 'h1' }, S.title),
      h('button', { class: 'lookline', type: 'button', title: 'Change the look', onclick: gotoLook }, h('span', {}, 'Look: '), h('b', {}, curStyle().name)),
      h('div', {}, statusPill(stageStatus(state.step))),
      h('p', {}, S.intro)),
    costCard(), progressBlock());
}
/** Clips cost card: which prompt text the drafts and finals are made with. null = the server default per scene. */
function promptModeRadio() {
  const cur = state.ui.promptMode;
  const opt = (v, label, note) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name: 'pm', value: v, checked: cur === v, onchange: () => { state.ui.promptMode = v; state.ui.confirm = null; render(); } }),
    h('span', {}, h('b', {}, label), h('span', { class: 'note' }, note)));
  return h('div', { class: 'radios', role: 'radiogroup', 'aria-label': 'Video prompt' },
    h('div', { class: 'eyebrow' }, 'VIDEO PROMPT'),
    opt('short', 'Short — motion only', 'default with a keyframe · 150–450 chars'),
    opt('full', 'Full — every block', 'default from the sheets'),
    cur ? h('button', { class: 'linkbtn', type: 'button', onclick: () => { state.ui.promptMode = null; state.ui.confirm = null; render(); } }, 'Back to the default per scene')
      : h('span', { class: 'note' }, 'Default: short when the scene has a chosen keyframe, full otherwise. Open a row to read the text.'));
}
function costCard() {
  const a = mainAction(state.step);
  const extra = state.step === 'clips' ? promptModeRadio() : null;
  if (!a) {
    if (state.step === 'clips') return h('div', { class: 'card' }, h('div', { class: 'kv' }, h('span', {}, 'Drafts'), h('span', { class: 'mono' }, 'every scene has one')), h('div', { class: 'note' }, 'Pick scenes in the table to redo a draft. Finals are priced per row.'), extra);
    if (state.step === 'keyframes' && kfBeats().length) return h('div', { class: 'card' }, h('div', { class: 'kv' }, h('span', {}, 'Keyframes'), h('span', { class: 'mono' }, 'every beat has one')), h('div', { class: 'note' }, `Regenerate a row for two new stills (≈ ${usd(KF_USD)}). Switch End frame on to add a closing still.`));
    return null;
  }
  const e = actionEst(a);
  const rows = [];
  if (!e) rows.push(h('div', { class: 'kv' }, h('span', {}, 'Estimating…'), h('span', { class: 'mono' }, '$…')));
  else if (e.error) {
    rows.push(h('div', { class: 'kv' }, h('span', {}, 'Price unavailable'), h('span', { class: 'mono bad' }, '$?')), h('div', { class: 'note warn' }, e.error));
    if (a.stage === 'keyframes') { const n = kfMissingFrames().length; rows.push(h('div', { class: 'note' }, `List price: ${n} × ${usd(KF_USD)} = ${usd(n * KF_USD)} (two Qwen Image 3 edits per frame). The button unlocks when the server can price it.`)); }
  } else {
    const live = e.items.filter((x) => !(x.usd === 0 && x.note && /skip|already|waiting/i.test(x.note)));
    const groups = new Map();
    const sheetOf = (id) => sheetItems().find((x) => x.id === id) || { id, characterId: asset(id)?.characterId };
    for (const it of live) { const key = a.stage === 'images' && anchorOf(sheetOf(it.id)) ? `${it.model}|face` : it.model; const g = groups.get(key) || { n: 0, sum: 0 }; g.n++; g.sum += it.usd; groups.set(key, g); }
    if (a.stage === 'images') rows.push(h('div', { class: 'kv' }, h('span', {}, 'Sheets to make'), h('span', { class: 'mono' }, String(live.length))));
    if (a.stage === 'clips') rows.push(h('div', { class: 'kv' }, h('span', {}, 'Scenes'), h('span', { class: 'mono' }, String(live.length))));
    if (a.stage === 'keyframes') rows.push(h('div', { class: 'kv' }, h('span', {}, 'Frames to make'), h('span', { class: 'mono' }, String(live.length))), h('div', { class: 'kv' }, h('span', {}, `${llmCost()[0].split(' · ')[0]} · the still prompts`), h('span', { class: 'mono' }, llmCost()[1])));
    if (!groups.size && ['script', 'sheets', 'scenes'].includes(a.stage)) { const [k, v] = llmCost(); rows.push(h('div', { class: 'kv' }, h('span', {}, k), h('span', { class: 'mono' }, v))); }
    for (const [key, g] of groups) { const face = key.endsWith('|face'); const m = key.replace('|face', ''); rows.push(h('div', { class: 'kv' }, h('span', {}, face ? 'Qwen Image Edit · from face' : a.stage === 'keyframes' && m === 'alibaba/qwen-image-3/edit' ? 'Qwen Image 3 edit · 2 stills each' : MODEL_NAMES[m] || m.split('/').slice(-2, -1)[0]), h('span', { class: 'mono' }, m.startsWith('local/') ? `${g.n} × $0.00 · local GPU` : `${g.n} × ${unit(g.sum / g.n)}`))); }
    rows.push(h('div', { class: 'kv total' }, h('span', {}, 'Total for this step'), h('span', { class: 'mono' }, usd(e.usd))));
  }
  // The local/Higgsfield choice matters most where the money is decided, so repeat the switch here.
  if (a.stage === 'images' && !state.settings.loaded) loadSettings();
  const sw = a.stage === 'images' && state.settings.loaded && state.settings.local?.ok ? h('div', { class: 'note' }, localSwitch()) : null;
  return h('div', { class: 'card' }, rows, sw, extra);
}
function progressBlock() {
  const p = P(); const s = state.step;
  const bar = (pct, cls = 'ember') => h('div', { class: `meter ${cls}` }, h('i', { style: `width:${Math.round(pct * 100)}%` }));
  let main = null; let sub = null; let pct = null;
  if (s === 'script' && p.script) main = `${plural(chars().length, 'character')} · ${plural(locs().length, 'place')} · ${plural(beats().length, 'scene')}`;
  if (s === 'sheets' && p.sheets) main = `${plural(sheetItems().length, 'prompt')}`;
  if (s === 'images') {
    const total = liveAssets().filter((a) => a.options.length).length + missingSheets().length;
    const picked = liveAssets().filter((a) => a.chosen != null).length;
    main = `${picked} of ${total} chosen`; pct = total ? picked / total : 0;
    const left = [...unpicked().map(shortLabel), ...missingSheets().map((m) => `${m.characterId ? charName(m.characterId) : locName(m.locationId)} (not generated)`)];
    if (left.length) sub = `Still to pick: ${left.slice(0, 3).join(', ')}${left.length > 3 ? ` and ${left.length - 3} more` : ''}`;
  }
  if (s === 'scenes') { const n = beats().length; const w = p.scenePrompts?.length || 0; main = `${w} of ${n} scenes written`; pct = n ? w / n : 0; }
  if (s === 'keyframes' && kfBeats().length) {
    const n = kfBeats().length; const ok = kfBeats().filter((b) => kfChosen(b.id)).length;
    main = `${ok} of ${n} beats have a chosen start frame`; pct = n ? ok / n : 0;
    const ends = kfBeats().filter((b) => spOf(b.id)?.endFrame).length;
    sub = `${keyframes().filter((k) => k.options?.length).length} frames made${ends ? ` · ${plural(ends, 'end frame')} wanted` : ''}${ok < n ? ' · Skip is allowed: beats without a pick are shot from the sheets' : ''}`;
  }
  if (s === 'clips') {
    const ids = (p.scenePrompts || []).map((x) => x.sceneId);
    const ok = ids.filter(sceneApproved).length;
    main = `${ok} of ${ids.length} scenes approved`; pct = ids.length ? ok / ids.length : 0;
    const seqN = seqClips().filter((c) => c.status === 'done').length;
    sub = `${p.clips.filter((c) => c.tier === 'draft' && c.status === 'done' && !isSeq(c)).length} drafts · ${p.clips.filter((c) => c.tier === 'final' && c.status === 'done' && !isSeq(c)).length} finals${seqN ? ` · ${plural(seqN, 'one take')}` : ''}`;
  }
  if (s === 'export') main = `${plural(p.exports.length, 'export')}`;
  if (!main) return null;
  return h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'eyebrow' }, 'PROGRESS'), h('div', {}, main), pct != null ? bar(pct) : null, sub ? h('div', { class: 'note', style: 'font-size:13px' }, sub) : null);
}

// ---------- right column ----------
const KIND_WORD = { script: 'script', sheets: 'sheets', scenes: 'scenes', image: 'images', keyframe: 'keyframes', clip: 'clips', export: 'export' };
function buildRight() {
  const s = state.step; const p = P();
  const blocks = [];
  if (s === 'images') {
    blocks.push(h('div', { class: 'eyebrow' }, 'CAST SO FAR'));
    const list = h('div', { class: 'stack', style: 'gap:10px' });
    for (const c of chars()) for (const st of c.states) {
      const por = asset(`${c.id}_${st.id}_portrait`); const full = asset(`${c.id}_${st.id}_full`);
      const pi = chosenOpt(por); const fi = chosenOpt(full);
      const face = chosenOpt(asset(`${c.id}_${c.states[0].id}_${c.species === 'human' ? 'portrait' : 'full'}`)); // the locked face is the avatar
      const img = face || fi || pi;
      const ok = (a, o) => (o ? '✓' : a && a.options.length ? 'pick' : '—');
      const done = !!(fi && (!por || pi)); // animals have no portrait sheet
      list.append(h('div', { class: 'cast' }, img ? h('img', { class: 'av', src: mediaUrl(img.path), alt: '' }) : h('div', { class: 'av none' }),
        h('div', {}, h('b', {}, `${c.name} · ${st.id}`), h('span', { class: done ? 'ok' : 'warn' }, `${face ? 'face ✓ · ' : 'face: pick one · '}${por ? `portrait ${ok(por, pi)} · ` : ''}full ${ok(full, fi)}`))));
    }
    for (const l of locs()) {
      const a = asset(`loc_${l.id}`); const o = chosenOpt(a);
      list.append(h('div', { class: 'cast' }, o ? h('img', { class: 'av', src: mediaUrl(o.path), alt: '' }) : h('div', { class: 'av none' }),
        h('div', {}, h('b', {}, l.name), h('span', { class: o ? 'ok' : 'warn' }, o ? 'chosen ✓' : 'pick one'))));
    }
    blocks.push(list);
  } else if (s === 'scenes' && p.scenePrompts?.length) {
    const sp = p.scenePrompts.find((x) => x.sceneId === state.ui.scene) || p.scenePrompts[0];
    blocks.push(h('div', { class: 'eyebrow' }, 'REFERENCES IT WILL ATTACH'), h('div', { class: 'note' }, `Scene ${beatNo(sp.sceneId)} · ${beatTitle(sp.sceneId)}`), refStrip(sp));
    const clip = bestClip(sp.sceneId);
    if (clip?.file) blocks.push(h('div', { class: 'eyebrow' }, `${clip.tier.toUpperCase()} · ${clip.resolution}`), h('video', { class: 'player', controls: true, preload: 'metadata', muted: true, src: mediaUrl(clip.file.path) }), clipMade(clip));
  } else if (s === 'keyframes' && kfBeats().length) {
    const bs = kfBeats();
    const id = bs.some((b) => b.id === state.ui.scene) ? state.ui.scene : bs[0].id;
    const kf = kfOf(id); const sp = spOf(id);
    const refs = kf?.refAssetIds?.length ? kf.refAssetIds : sp?.refAssetIds || [];
    blocks.push(h('div', { class: 'eyebrow' }, 'REFERENCES IT WILL ATTACH'), h('div', { class: 'note' }, `Scene ${beatNo(id)} · ${beatTitle(id)} · the chosen sheets, characters first, place last`), refStrip({ refAssetIds: refs }),
      h('div', { class: 'eyebrow', style: 'margin-top:6px' }, 'WHY KEYFRAMES'),
      h('div', { class: 'why3' },
        h('p', { class: 'note' }, 'Stills cost cents, video costs dollars.'),
        h('p', { class: 'note' }, 'The still fixes the face, the light and the framing.'),
        h('p', { class: 'note' }, 'The video prompt then only has to move it.')));
  } else if (s === 'clips') {
    const approved = (p.scenePrompts || []).filter((x) => sceneApproved(x.sceneId));
    const secs = approved.reduce((a, x) => a + (x.durationSec || 0), 0);
    blocks.push(h('div', { class: 'eyebrow' }, 'APPROVED CUT'), h('div', {}, `${approved.length} of ${(p.scenePrompts || []).length} scenes · ${secs} s`),
      h('p', { class: 'note' }, 'Click a row to see the prompt by block and play the draft or final.'));
  } else if (s === 'brief') {
    blocks.push(h('div', { class: 'eyebrow' }, 'TIP'), h('p', { class: 'note' }, 'Say who is in it, where it happens, what changes and how it should feel. Numbers help: age, height, weight.'));
  } else if (s === 'script') {
    blocks.push(h('div', { class: 'eyebrow' }, 'TIP'), h('p', { class: 'note' }, 'Edits here change the locked blocks in every scene prompt and make the later steps stale until you regenerate them.'));
  } else if (s === 'sheets') {
    blocks.push(h('div', { class: 'eyebrow' }, 'TIP'), h('p', { class: 'note' }, 'Sheets are shot on a white seamless background with even light so the face reads the same in every frame.'));
  } else if (s === 'export') {
    blocks.push(h('div', { class: 'eyebrow' }, 'HOW IT JOINS'), h('p', { class: 'note' }, 'Approved finals first, approved drafts if a scene has no final. Seedance 2.5 caps at 720p; 4K is an ffmpeg upscale with light grain.'));
  }
  const jobs = p.jobs.filter((j) => KIND_WORD[j.kind] === s || j.stage === s).slice().reverse().slice(0, 12);
  blocks.push(h('div', { class: 'eyebrow', style: 'margin-top:6px' }, "THIS STEP'S JOBS"));
  blocks.push(jobs.length ? h('div', { class: 'stack', style: 'gap:8px' }, jobs.map(jobRow)) : h('p', { class: 'note' }, 'Nothing has run for this step yet.'));
  $('#right').replaceChildren(...blocks);
}
function jobRow(j) {
  const word = j.status === 'running' || j.status === 'queued' ? 'generating…' : j.status === 'failed' ? 'needs you' : 'done';
  const col = j.status === 'failed' ? 'bad' : word === 'generating…' ? 'blue' : '';
  const label = `${j.kind}${j.targetId ? ` · ${j.targetId}` : ''}`;
  return h('details', { class: 'job' },
    h('summary', {}, h('span', {}, label), h('span', { class: `mono ${col}`, style: col === 'blue' ? 'color:var(--blue)' : '' }, `${word}${j.actualUsd != null ? ` · ${usd(j.actualUsd)}` : j.estimateUsd != null ? ` · ${usd(j.estimateUsd)}` : ''}`)),
    h('pre', {}, (j.log || []).join('\n') || '(no log lines)', j.error ? h('div', { class: 'err' }, `\n${j.error}`) : null));
}
function refStrip(sp) {
  return h('div', { class: 'stack', style: 'gap:8px' }, refCount(sp.refAssetIds.length), h('div', { class: 'refstrip' }, sp.refAssetIds.map((id) => {
    const a = asset(id); const o = chosenOpt(a);
    const loc = a?.kind === 'location' || id.startsWith('loc_');
    return h('div', { class: `r ${loc ? 'wide' : ''}` }, o ? h('img', { class: 'im', src: mediaUrl(o.path), alt: '', loading: 'lazy' }) : h('div', { class: 'im', style: 'border:1px dashed rgba(255,255,255,.25);background:transparent' }),
      a ? shortLabel(a) : id);
  })));
}

// ---------- footer ----------
function paintFoot(base) {
  paint('foot', base, () => {
    const foot = $('#foot'); foot.hidden = false;
    const i = STEP_IDX[state.step]; const next = STEPS[i + 1]; const prev = STEPS[i - 1];
    const has = hasContent(state.step);
    const a = mainAction(state.step);
    const run = isRunning(state.step);
    const blockedImages = state.step === 'images' && (unpicked().length || missingSheets().length);
    const blockedKf = state.step === 'keyframes' && !kfAllChosen();
    const canContinue = has && !run && !blockedImages && !blockedKf;
    const emptyPrimary = !!a && !has;
    // Keyframes are optional: the secondary action goes straight to Clips, nothing generated or approved.
    const skip = blockedKf && next ? h('button', { class: 'btn', type: 'button', onclick: () => go(next.id) }, 'Skip keyframes →') : null;
    const noteText = state.dirty ? 'You have edits that are not saved yet.'
      : state.step === 'images' ? 'Continue is enabled once every sheet has a pick. Nothing is charged until you press a priced button.'
      : state.step === 'keyframes' ? 'Continue is enabled once every beat has a chosen start frame. Skip, and beats without one are shot from the sheets.'
      : state.step === 'clips' ? 'Final is a fresh 720p render with the same prompt and references. Seedance 2.5 has no seed.'
      : 'Nothing is charged on this screen until you press a priced button.';
    foot.replaceChildren(
      prev ? h('button', { class: 'btn quiet', type: 'button', onclick: () => go(prev.id) }, `← Back to ${prev.label}`) : h('a', { class: 'btn quiet', href: '#/projects' }, '← All projects'),
      h('div', { class: 'note', id: 'footnote' }, noteText),
      h('div', { class: 'acts' },
        a ? pricedFor(a, `foot-${state.step}`, { cls: emptyPrimary ? 'primary' : '' }) : null,
        skip,
        next ? h('button', { class: `btn ${emptyPrimary ? '' : 'primary'}`, type: 'button', disabled: !canContinue, onclick: continueFrom }, `Continue to ${next.label} →`) : null));
  });
}

// ---------- centre: shared banners ----------
function failedJob(step) {
  const js = P().jobs.filter((j) => j.stage === step).slice().reverse();
  const last = js.find((j) => j.status === 'done' || j.status === 'failed');
  return last && last.status === 'failed' && !state.ui.dismissed[last.id] ? last : null;
}
function errBanner(step) {
  const fj = failedJob(step);
  const msg = state.errs[step] || (fj ? `${fj.kind} failed: ${fj.error || 'see the job log'}` : '');
  if (!msg) return null;
  // Lead with the readable part; raw tool output (uploads, estimates, HTTP lines) goes behind Details.
  const cut = msg.search(/:\s*(uploaded |estimate: |sitting |higgsfield: |\{)/);
  const head = (cut > 20 ? msg.slice(0, cut) : msg.length > 240 ? `${msg.slice(0, 240)}…` : msg).trim();
  const more = head.length < msg.length ? h('details', { class: 'errmore' }, h('summary', {}, 'Details'), h('pre', {}, msg)) : null;
  return h('div', { class: 'banner err', role: 'alert' }, h('div', { class: 'msg' }, h('span', {}, head), more),
    h('div', { class: 'acts' }, h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { delete state.errs[step]; if (fj) state.ui.dismissed[fj.id] = 1; render(); } }, 'Dismiss')));
}
function staleBanner(step) {
  const info = staleInfo(step);
  if (!info) return null;
  const because = STEPS.find((s) => s.id === info.because)?.label || 'An earlier step';
  const a = regenAction(step);
  return h('div', { class: 'banner stale', role: 'status' }, svg('warn', 16, 'currentColor', 2.2),
    h('span', { class: 'msg' }, `${because} changed after this step was made. What you see may no longer match.`),
    h('div', { class: 'acts' },
      a ? pricedFor(a, `stale-${step}`, { cls: 'sm' }) : null,
      h('button', { class: 'btn sm', type: 'button', onclick: () => attempt(step, async () => { await api(`/projects/${state.slug}/keep`, 'POST', { stage: step }); await loadProject(); toast('Kept as it is'); render(); }) }, 'Keep anyway')));
}
function saveBar() {
  return h('div', { class: 'savebar', id: 'savebar', hidden: !state.dirty },
    h('span', { class: 'msg' }, 'You have edits that are not saved yet.'),
    h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { state.dirty = false; render(true); } }, 'Discard'),
    h('button', { class: 'btn sm', type: 'button', onclick: saveStep }, 'Save changes'));
}
// A name with a pencil: click to rename a character or location in place. The id never changes, so every
// picture stays linked; the server swaps the old name in every prompt and marks nothing stale.
function renameable(kind, id, name, tag = 'b', cls = '') {
  const wrap = h('span', { class: `rn ${cls}` });
  const show = () => {
    wrap.replaceChildren(h(tag, { class: cls.includes('h2') ? 'h2' : null }, name),
      h('button', { type: 'button', class: 'rnbtn', title: `Rename ${name}`, 'aria-label': `Rename ${name}`, onclick: (e) => { e.stopPropagation(); edit(); } }, svg('pencil', 14)));
  };
  const edit = () => {
    const inp = h('input', { class: 'rninput', value: name, maxlength: 60, 'aria-label': `New name for ${name}` });
    const save = async () => {
      const v = inp.value.replace(/\s+/g, ' ').trim();
      if (!v || v === name) return show();
      inp.disabled = true;
      await attempt(state.step, async () => {
        state.p = await api(`/projects/${state.slug}/rename`, 'POST', { kind, id, name: v });
        toast(`Renamed ${name} to ${v}`);
        render(true);
      });
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); show(); } });
    wrap.replaceChildren(inp,
      h('button', { type: 'button', class: 'btn sm primary', onclick: save }, 'Save'),
      h('button', { type: 'button', class: 'btn sm quiet', onclick: show }, 'Cancel'));
    inp.focus(); inp.select();
  };
  show();
  return wrap;
}
function emptyCard(title, text) { return h('div', { class: 'empty-card' }, statusPill('empty'), h('h2', {}, title), h('p', {}, text)); }

// ---------- centre dispatcher ----------
function buildCentre() {
  const s = state.step;
  const body = { brief: briefBody, script: scriptBody, sheets: sheetsBody, images: imagesBody, scenes: scenesBody, keyframes: keyframesBody, clips: clipsBody, export: exportBody }[s]();
  const editable = ['brief', 'script', 'sheets', 'scenes', 'keyframes'].includes(s);
  $('#centre').replaceChildren(errBanner(s), staleBanner(s), editable ? saveBar() : null, body);
}

// ---------- field helpers ----------
function fld(label, path, val, o = {}) {
  let el;
  if (o.select) el = chipSelect({ key: `fld-${path}`, path, title: label, value: val ?? '', cls: 'block', options: o.select.map((x) => (Array.isArray(x) ? { value: x[0], label: x[1], ...(x[2] || {}) } : { value: x, label: x })) });
  else if (o.rows) el = h('textarea', { 'data-p': path, rows: o.rows, class: 'grow', value: val ?? '' });
  else el = h('input', { 'data-p': path, type: o.type || 'text', value: val ?? '', min: o.min, max: o.max, step: o.step });
  return h(o.select ? 'div' : 'label', { class: 'field', style: o.span ? 'grid-column:1/-1' : null }, h('span', {}, label), el);
}

// ---------- 1 brief ----------
function briefBody() {
  const p = P();
  const refs = p.brief.refs;
  const role = chipSelect({ key: 'brief-role', id: 'refRole', title: 'What is this reference for?', value: state.ui.refRole || 'mood', options: roleOptions(['selfie', 'character', 'location', 'mood', 'music']), cls: 'block', onChange: (v) => { state.ui.refRole = v; } });
  return h('div', { class: 'stack' },
    h('div', { class: 'group' },
      h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, 'Your brief'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openLibrary({ mode: 'adopt', kind: 'character' }) }, 'Start from a past character')),
      h('label', { class: 'field' }, h('span', { class: 'sr' }, 'Brief'), h('textarea', { 'data-p': 'brief.text', rows: 8, class: 'grow', placeholder: "Write it the way you'd tell a friend. No technical words.", value: p.brief.text }))),
    h('div', { class: 'group' },
      h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, "Director's notes"), h('span', { class: 'note' }, 'Script and Sheets follow these over anything they would guess')),
      h('label', { class: 'field' }, h('span', { class: 'sr' }, "Director's notes"), h('textarea', { 'data-p': 'brief.notes', rows: 4, class: 'grow', placeholder: 'Facts that must be true. e.g. Maya is 16, 165 cm, freckles, red string bracelet. Lily is 9, gap in her front teeth, always in the white sun hat.', value: p.brief.notes || '' })),
      h('p', { class: 'note' }, 'Changed a note after the script exists? Save, then press Regenerate script and Regenerate sheets so every picture and shot agrees.')),
    h('div', { class: 'group' },
      h('h2', { class: 'h2' }, 'References'),
      refs.length ? h('div', { class: 'reflist' }, refs.map((r) => {
        const used = chars().filter((c) => c.identityRefId === r.id).map((c) => c.name);
        return h('div', { class: 'ref' },
          h('div', { class: 'refpic' },
            r.role === 'music' ? h('div', { class: 'im mono', style: 'background:var(--media);font-size:11px' }, 'audio') : h('img', { class: 'im', src: refUrl(r.path), alt: r.note || r.role, loading: 'lazy' }),
            h('button', { type: 'button', class: 'refx', 'aria-label': `Remove ${r.note || refFileName(r.path)}`, title: 'Remove', onclick: () => {
              if (!confirm(used.length ? `Remove this reference? ${used.join(' and ')} use${used.length === 1 ? 's' : ''} it to lock a face.` : 'Remove this reference?')) return;
              setRefs(refs.filter((x) => x.id !== r.id), 'Reference removed');
            } }, svg('close', 12))),
          r.role === 'music' ? h('span', { class: 'badge' }, svg(ROLES.music?.icon || 'heart', 12, 'currentColor', 2), 'music')
            : chipSelect({ key: `ref-role-${r.id}`, title: 'What is this reference for?', value: r.role, cls: 'tiny', options: roleOptions(['selfie', 'character', 'location', 'mood']),
              onChange: (v) => { if (v !== r.role) setRefs(refs.map((x) => (x.id === r.id ? { ...x, role: v } : x)), `Now a ${v} reference`); } }),
          (r.role === 'selfie' || r.role === 'character') ? whoField(r, refs) : null,
          h('input', { class: 'refnote', type: 'text', value: r.note || '', placeholder: refFileName(r.path) || 'add a note', 'aria-label': `Note for ${refFileName(r.path)}`, title: 'What should the script take from this picture? Saved when you leave the box.',
            onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
            onchange: (e) => { const v = e.target.value.trim(); if (v !== (r.note || '')) setRefs(refs.map((x) => (x.id === r.id ? { ...x, note: v || undefined } : x)), 'Note saved'); } }));
      })) : null,
      dropzone({ title: 'Drop pictures here', sub: 'or click to choose · or paste a copied picture · png, jpg, webp or audio · up to 15 MB each', accept: REF_ACCEPT, acceptAttr: 'image/*,audio/*', onFiles: addRefFiles, what: 'pictures or audio' }),
      h('div', { class: 'refopts' },
        h('div', { class: 'field' }, h('span', {}, 'Add as'), role)),
      h('p', { class: 'note' }, refs.length ? 'Each picture: pick what it is for with its chip and type a note under it (saved when you leave the box). A selfie locks a face; mood pictures set the feeling.' : 'No references yet. A selfie locks a face; mood pictures set the feeling.')),
    lookSection(), llmSection(), genSection());
}

// ---------- styles: the Look section, the editor, the chips ----------
const curStyle = () => P()?.style || state.styles.list.find((s) => s.id === DEFAULT_STYLE_ID) || { id: DEFAULT_STYLE_ID, name: 'Cinematic realism', family: 'film', models: { faces: SOUL2, places: 'higgsfield-ai/soul/cinema' }, builtin: true };
const styleChip = () => h('span', { class: 'pill stylechip', title: 'This style is injected into the prompt' }, `Style: ${curStyle().name}`);
const blockLabel = (n) => (n === 'QUALITY' ? [h('span', { title: 'QUALITY · from style' }, 'QUALITY'), h('span', { class: 'fromstyle' }, 'from style')] : n);
function gotoLook() {
  const go_ = () => setTimeout(() => $('#look')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  if (state.step === 'brief') { go_(); return; }
  saveIfDirty().then((ok) => { if (ok) { nav(state.slug, 'brief'); go_(); } });
}
async function loadStyles(force) {
  const S = state.styles;
  if (S.loading || (S.loaded && !force)) return;
  S.loading = true;
  try { S.list = await api('/styles'); S.err = ''; }
  catch (e) { S.err = e.status === 404 ? `${e.message} (the server may not have styles yet)` : e.message; }
  S.loading = false; S.loaded = true; render();
}
async function loadSoul() {
  if (state.soul.list || state.soul.loading) return;
  state.soul.loading = true;
  try { state.soul.list = await api('/soul-styles'); state.soul.err = ''; }
  catch (e) { state.soul.err = e.message; state.soul.list = []; }
  state.soul.loading = false;
}
const localOn = () => !!(state.settings.preferLocal && state.settings.local.ok);
const mapped = (id) => (localOn() ? TO_LOCAL[id] || id : id);
async function loadSettings(force) {
  const S = state.settings;
  if (S.loading || (S.loaded && !force)) return;
  S.loading = true;
  try { Object.assign(S, await api('/settings'), { err: '' }); } catch (e) { S.err = e.message; }
  S.loading = false; S.loaded = true; render();
}
async function setPreferLocal(on) {
  try { Object.assign(state.settings, await api('/settings', 'PATCH', { preferLocal: on }), { err: '' }); state.est = {}; toast(on ? 'Drawn looks now render on this Mac (free)' : 'Drawn looks now render on your picture service'); }
  catch (e) { toast(e.message, true); await loadSettings(true); }
  render(true);
}
const stylePrice = (s) => {
  const f = modelInfo(mapped(s.models?.faces))?.price, p = modelInfo(mapped(s.models?.places))?.price;
  const v = Math.max(f ?? 0, p ?? 0);
  return f == null && p == null ? '?' : v === 0 ? '$0.00 · local GPU' : unit(v);
};
function styleFail(e) {
  const msg = e.status === 404 ? `${e.message} (the server may not have this feature yet)` : e.message;
  state.styles.err = msg; toast(msg, true); render();
}
async function chooseStyle(id) {
  if (!(await saveIfDirty())) return;
  try { state.styles.err = ''; await api(`/projects/${state.slug}/style`, 'POST', { styleId: id }); await loadProject(); toast('Look changed. Later steps need a refresh.'); render(true); }
  catch (e) { styleFail(e); }
}
async function deleteStyle(s) {
  if (!confirm(`Delete "${s.name}" from your styles?`)) return;
  try { await api(`/styles/${encodeURIComponent(s.id)}`, 'DELETE'); await loadStyles(true); toast('Style deleted'); }
  catch (e) { styleFail(e); }
}
function styleCard(s, chosen) {
  const main = h('button', { class: 'sc-main', type: 'button', 'aria-pressed': chosen, onclick: () => chooseStyle(s.id) },
    h('b', { class: 'sc-name' }, s.name),
    h('span', { class: 'sc-top' }, h('span', { class: 'pill tiny' }, s.family), chosen ? h('span', { class: 'pill tiny chosen' }, 'chosen') : null),
    h('span', { class: 'sc-desc' }, s.description || ''),
    h('span', { class: 'mono sc-models' }, ...[`faces: ${modelShort(mapped(s.models?.faces))}`, `places: ${modelShort(mapped(s.models?.places))}`, `≈ ${stylePrice(s)} per 4`].map((t) => h('span', { class: 'nb' }, t))));
  return h('div', { class: `stylecard ${chosen ? 'chosen' : ''}` }, main,
    !s.builtin ? h('button', { class: 'btn sm quiet sc-del', type: 'button', onclick: () => deleteStyle(s) }, 'Delete') : null);
}
function localSwitch() {
  const S = state.settings;
  if (!S.loaded) return null;
  const ok = !!S.local?.ok;
  const box = h('input', { type: 'checkbox', role: 'switch', checked: ok && S.preferLocal, disabled: !ok, onchange: (e) => setPreferLocal(e.target.checked) });
  const edits = (S.local?.models || []).includes('local/qwen-image-edit');
  return h('label', { class: `localswitch ${ok ? '' : 'off'}`, title: ok ? (edits ? 'Drawn looks and faces built from your photos run on this Mac instead of Higgsfield.' : 'Drawn looks run on this Mac. Faces built from your photos still use Higgsfield until the local photo-edit model is downloaded.') : S.local?.reason || '' },
    box, h('span', {}, edits ? 'Render on this Mac (free): drawn looks and photo faces' : 'Render drawn looks on this Mac (free). Photo faces use Higgsfield'),
    ok ? null : h('span', { class: 'why' }, S.local?.reason || (S.err ? `settings unavailable: ${S.err}` : 'unavailable')));
}
function lookSection() {
  const S = state.styles;
  if (!S.loaded) loadStyles();
  loadSettings();
  const cur = curStyle();
  const mine = S.tab === 'mine';
  const list = S.list.filter((s) => (mine ? !s.builtin : s.builtin));
  const tab = (id, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === id, onclick: () => { S.tab = id; render(); } }, label);
  let grid;
  if (S.loading && !S.loaded) grid = h('p', { class: 'note' }, 'Loading styles…');
  else if (!list.length) grid = h('p', { class: 'note' }, S.err ? 'Styles are not available right now.' : mine ? 'No saved styles yet. Use "New style…" or "Customise this…" to make one.' : 'No presets found.');
  else grid = h('div', { class: 'stylegrid' }, list.map((s) => styleCard(s, s.id === cur.id)));
  return h('div', { class: 'group', id: 'look' },
    h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, 'Look'), h('div', { class: 'tabs', role: 'tablist' }, tab('presets', 'Presets'), tab('mine', 'My styles'))),
    localSwitch(),
    h('p', { class: 'note' }, 'The look is injected into every sheet and scene prompt and picks the image model.'),
    S.err ? h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, S.err), h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { S.err = ''; loadStyles(true); render(); } }, 'Try again'))) : null,
    grid,
    h('div', { class: 'acts-row' },
      h('button', { class: 'btn', type: 'button', onclick: () => styleModal(cur) }, 'Customise this…'),
      h('button', { class: 'btn', type: 'button', onclick: () => styleModal(null) }, 'New style…')));
}

// ---------- language model (server: src/llm/config.ts, GET/PATCH /api/settings, POST /api/llm/test) ----------
// Keys never reach the browser: the server sends only the variable name and whether it is set.
const LLM_TIERS = [['opus', 'Careful (opus tier)'], ['sonnet', 'Default (sonnet tier)'], ['haiku', 'Quick (haiku tier, used by the test)']];
function llmCur() {
  const S = state.settings, st = S.llmStatus || {};
  return structuredClone(S.llm || { provider: st.provider || 'claude-cli', ...(st.preset ? { preset: st.preset } : {}), ...(st.preset === 'custom' && st.baseUrl ? { baseUrl: st.baseUrl } : {}) });
}
async function saveLlm(patch, msg) {
  const next = { ...llmCur(), ...patch };
  if (next.provider === 'openai-compatible') next.preset ||= 'openai'; else delete next.preset;
  if (next.preset !== 'custom') delete next.baseUrl;
  state.ui.llmTest = null;
  try { const r = await api('/settings', 'PATCH', { llm: next }); Object.assign(state.settings, r, { llm: r.llm || null, err: '' }); if (msg) toast(msg); }
  catch (e) { toast(e.message, true); await loadSettings(true); }
  render(true);
}
async function resetLlm() {
  state.ui.llmTest = null;
  try { const r = await api('/settings', 'PATCH', { llm: null }); Object.assign(state.settings, r, { llm: null, err: '' }); toast('Language model back to automatic'); }
  catch (e) { toast(e.message, true); }
  render(true);
}
async function testLlm() {
  state.ui.llmTest = { running: true };
  render();
  try { state.ui.llmTest = await api('/llm/test', 'POST', {}); }
  catch (e) { state.ui.llmTest = { ok: false, error: e.message }; }
  render();
}
function llmKeyLine(st) {
  if (st.source === 'none') return null;
  if (st.provider === 'claude-cli') return h('p', { class: 'note' }, 'Uses the claude command and your Claude plan. No key needed. Install Claude Code and sign in once.');
  if (!st.keyRequired) return h('p', { class: 'note' }, st.keyEnv ? `No key needed. If your server wants one, set ${st.keyEnv} in .env.` : 'No key needed.');
  return st.keyFound
    ? h('p', { class: 'note' }, h('span', { class: 'ok' }, '● Key found'), ` in ${st.keyEnv}.`)
    : h('p', { class: 'note' }, h('span', { class: 'bad' }, '● No key yet.'), ' Add ', h('span', { class: 'mono' }, `${st.keyEnv}=…`), ' to the .env file in the Heartcut folder (copy .env.example), or export it. Keys are never saved in settings.');
}
function llmSection() {
  const S = state.settings;
  if (!S.loaded) { loadSettings(); return null; }
  const st = S.llmStatus || { provider: 'claude-cli' };
  const opts = S.llmOptions || { providers: [], presets: [], defaults: {} };
  const cur = llmCur();
  const preset = opts.presets.find((p) => p.id === cur.preset);
  const defaults = cur.provider === 'openai-compatible' ? preset?.models || {} : opts.defaults?.[cur.provider] || {};
  const provider = chipSelect({ key: 'llm-provider', title: 'Provider', value: cur.provider, cls: 'block',
    options: opts.providers.map((p) => ({ value: p.id, label: p.label })),
    onChange: (v) => { if (v !== cur.provider) saveLlm({ provider: v, preset: undefined, models: undefined, baseUrl: undefined }, 'Language model changed'); } });
  const presetSel = cur.provider === 'openai-compatible' ? chipSelect({ key: 'llm-preset', title: 'Service', value: cur.preset || 'openai', cls: 'block',
    options: opts.presets.map((p) => ({ value: p.id, label: p.label, hint: p.note || p.baseUrl })),
    onChange: (v) => { if (v !== cur.preset) saveLlm({ preset: v, models: undefined, baseUrl: undefined }, 'Language model changed'); } }) : null;
  const text = (name, value, placeholder, onSave) => h('input', { type: 'text', name, value: value || '', placeholder, autocomplete: 'off', spellcheck: 'false',
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    onchange: (e) => onSave(e.target.value.trim()) });
  const setModel = (tier, v) => { const m = { ...(cur.models || {}) }; if (v) m[tier] = v; else delete m[tier]; saveLlm({ models: Object.keys(m).length ? m : undefined }, 'Model saved'); };
  const needsModel = cur.provider === 'openai-compatible' && !defaults.sonnet;
  const all = h('label', { class: 'field' }, h('span', {}, needsModel ? 'Model (required)' : 'Model for every step (optional)'),
    text('llm-all', cur.models?.all, needsModel ? 'e.g. the model you pulled or loaded' : `default: ${defaults.sonnet || ''}`, (v) => setModel('all', v)));
  const tiers = h('details', {}, h('summary', { class: 'note' }, 'One model per tier'),
    h('div', { class: 'grid2' }, LLM_TIERS.map(([t, label]) => h('label', { class: 'field' }, h('span', {}, label),
      text(`llm-${t}`, cur.models?.[t], cur.models?.all || defaults[t] || 'not set', (v) => setModel(t, v))))));
  const base = cur.preset === 'custom' ? h('label', { class: 'field' }, h('span', {}, 'Base URL'),
    text('llm-base', cur.baseUrl, 'http://127.0.0.1:8080/v1', (v) => saveLlm({ baseUrl: v || undefined }, 'Base URL saved'))) : null;
  const t = state.ui.llmTest;
  const result = !t ? null : t.running ? h('p', { class: 'note' }, 'Testing…')
    : t.ok ? h('p', { class: 'note' }, h('span', { class: 'ok' }, t.fake ? '● Fake mode' : '● Connected'), t.fake ? ` · ${t.note}` : ` · ${(t.ms / 1000).toFixed(1)} s · ${t.model || ''}`)
    : h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, t.error || 'The test failed.'));
  const where = st.source === 'env' ? 'Set by HEARTCUT_LLM_PROVIDER in .env or your shell. A choice here overrides it.' : st.source === 'saved' ? 'Saved for this computer.'
    : st.source === 'auto' ? `Picked automatically${st.reason ? `: ${st.reason}` : ''}. A choice here overrides it.` : '';
  return h('div', { class: 'group', id: 'llm' },
    h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, 'Language model'), h('span', { class: 'pill tiny' }, st.label || cur.provider)),
    h('p', { class: 'note' }, `Writes the script, the sheets and the shot prompts. ${where}`),
    st.error ? h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, st.error)) : null,
    st.source === 'none' && !S.llm ? h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, `${st.reason || 'No language model found.'} Install Claude Code and sign in, add one API key to the .env file in the Heartcut folder, or start Ollama or LM Studio.`)) : null,
    h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('span', {}, 'Provider'), provider), presetSel ? h('div', { class: 'field' }, h('span', {}, 'Service'), presetSel) : null),
    base, all, tiers,
    llmKeyLine(st),
    h('div', { class: 'acts-row' },
      h('button', { class: 'btn sm', type: 'button', disabled: !!t?.running, title: 'Sends one tiny request. On a paid API it costs a fraction of a cent.', onclick: testLlm }, 'Test connection'),
      S.llm ? h('button', { class: 'btn sm quiet', type: 'button', onclick: resetLlm }, 'Reset to automatic') : null),
    result);
}
// ---------- pictures and video (server: src/gen/config.ts + src/gen/status.ts, GET/PATCH /api/settings, POST /api/gen/check) ----------
// Keys never reach the browser: the server sends only the variable name and whether it is set.
async function saveGen(patch, msg) {
  const S = state.settings;
  const next = { ...(S.gen || {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
  state.ui.genCheck = null;
  try { const r = await api('/settings', 'PATCH', { gen: Object.keys(next).length ? next : null }); Object.assign(S, r, { gen: r.gen || null, err: '' }); state.est = {}; if (msg) toast(msg); }
  catch (e) { toast(e.message, true); await loadSettings(true); }
  refreshSpend(); render(true);
}
async function checkGen() {
  state.ui.genCheck = { running: true };
  render();
  try { state.ui.genCheck = await api('/gen/check', 'POST', {}); }
  catch (e) { state.ui.genCheck = { ok: false, error: e.message }; }
  render();
}
function genKeyLine(st, opt) {
  if (!st.provider) return h('p', { class: 'note' }, h('span', { class: 'bad' }, '● No service yet.'), ' Add one key to the .env file in the Heartcut folder (copy .env.example): ', h('span', { class: 'mono' }, 'FAL_KEY'), ', ', h('span', { class: 'mono' }, 'REPLICATE_API_TOKEN'), ' or ', h('span', { class: 'mono' }, 'HIGGSFIELD_API_KEY'), '. Then reload this page. No restart is needed.');
  if (st.provider === 'higgsfield-tool') return h('p', { class: 'note' }, st.keyFound ? [h('span', { class: 'ok' }, '● Tool found'), ' (HEARTCUT_HIGGSFIELD_TOOL). It keeps its own key and its own spending cap.'] : [h('span', { class: 'bad' }, '● Tool not found.'), ` ${st.problem || ''}`]);
  const extra = (opt?.extraEnv || []).length ? ` (plus ${opt.extraEnv.join(', ')})` : '';
  return st.keyFound
    ? h('p', { class: 'note' }, h('span', { class: 'ok' }, '● Key found'), ` in ${st.keyEnv}${extra}.`)
    : h('p', { class: 'note' }, h('span', { class: 'bad' }, '● No key yet.'), ' Add ', h('span', { class: 'mono' }, `${st.keyEnv}=…`), `${extra} to the .env file in the Heartcut folder, or export it. Keys are never saved in settings.`);
}
function genSection() {
  const S = state.settings;
  if (!S.loaded) { loadSettings(); return null; }
  const st = S.genStatus || { provider: null, label: 'Not set up' };
  const opts = S.genOptions || { providers: [], defaultCapUsd: 5 };
  const cur = S.gen?.provider || '';
  const provider = chipSelect({ key: 'gen-provider', title: 'Service', value: cur, cls: 'block',
    options: [{ value: '', label: 'Automatic', hint: 'the first service with a key in .env' }, ...opts.providers.map((p) => ({ value: p.id, label: p.label, hint: p.keyEnv ? `needs ${p.keyEnv}` : 'set HEARTCUT_HIGGSFIELD_TOOL' }))],
    onChange: (v) => { if (v !== cur) saveGen({ provider: v || undefined }, 'Picture service changed'); } });
  const opt = opts.providers.find((p) => p.id === st.provider);
  const toolOwnCap = st.provider === 'higgsfield-tool';
  const cap = h('input', { type: 'number', name: 'gen-cap', min: '0', max: '1000', step: '0.5', value: S.gen?.capUsd ?? '', placeholder: `${st.capUsd ?? opts.defaultCapUsd}`, disabled: toolOwnCap,
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    onchange: (e) => { const v = e.target.value.trim(); saveGen({ capUsd: v === '' ? undefined : Number(v) }, v === '' ? 'Cap back to the default' : `Cap set to ${usd(Number(v))}`); } });
  const capNote = toolOwnCap ? 'The Higgsfield CLI tool keeps its own cap.' : st.capSource === 'env' ? 'From HEARTCUT_SPEND_CAP. A value here overrides it.' : 'Per sitting (the last 6 hours). A clip with no exact price reserves $2.50 until it is done.';
  const rows = (S.genCoverage || []).map((c) => h('tr', {}, h('td', {}, (opts.capabilities || []).find((x) => x.id === c.capability)?.label || c.capability),
    h('td', { class: c.model ? 'mono' : 'why' }, c.model || `not available${c.note ? `: ${c.note}` : ''}`)));
  const t = state.ui.genCheck;
  const result = !t ? null : t.running ? h('p', { class: 'note' }, 'Checking…')
    : t.ok ? h('p', { class: 'note' }, h('span', { class: 'ok' }, t.fake ? '● Fake mode' : '● Connected'), ` · ${t.detail || ''}${t.ms ? ` · ${(t.ms / 1000).toFixed(1)} s` : ''}`)
    : h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, t.error || 'The check failed.'));
  const where = st.source === 'saved' ? 'Saved for this computer.' : st.source === 'env' ? 'Set by HEARTCUT_GEN_PROVIDER. A choice here overrides it.' : st.source === 'auto' ? 'Picked automatically.' : '';
  const local = st.local?.ok ? 'Drawn looks can also render free on this Mac (switch in the Images step).' : `Free local pictures are off: ${st.local?.reason || 'not available on this computer'}.`;
  return h('div', { class: 'group', id: 'gen' },
    h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, 'Pictures and video'), h('span', { class: `pill tiny ${st.ready ? '' : 'warn'}` }, st.label || 'Not set up')),
    h('p', { class: 'note' }, `Makes the sheets, keyframes and clips. Every price shows before anything is spent. ${where}`),
    st.problem && !st.ready ? h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, st.problem)) : null,
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('span', {}, 'Service'), provider),
      h('label', { class: 'field' }, h('span', {}, `Spending cap per sitting ($)`), cap)),
    h('p', { class: 'note' }, capNote),
    genKeyLine(st, opt),
    st.approxPrices ? h('p', { class: 'note' }, `Prices on ${st.label} are approx.: they come from its published price list (dated in the code), not from the service.`) : null,
    rows.length ? h('details', {}, h('summary', { class: 'note' }, 'What this service makes'), h('table', { class: 'tiny' }, h('tbody', {}, rows))) : null,
    h('p', { class: 'note' }, local),
    h('div', { class: 'acts-row' },
      h('button', { class: 'btn sm', type: 'button', disabled: !!t?.running, title: 'A free, read-only call (account, price list or style list). Never makes a picture.', onclick: checkGen }, 'Check'),
      S.gen ? h('button', { class: 'btn sm quiet', type: 'button', onclick: () => saveGen({ provider: undefined, capUsd: undefined, models: undefined }, 'Picture service reset to automatic') }, 'Reset to automatic') : null),
    result);
}
const BLANK_STYLE ={ name: '', family: 'custom', description: '', look: '', sheetLook: '', negatives: [], videoHints: '', models: { faces: 'alibaba/qwen-image-3/text-to-image', places: 'alibaba/qwen-image-3/text-to-image' } };
function styleModal(from) {
  let init;
  if (!from) init = structuredClone(BLANK_STYLE);
  else {
    init = structuredClone(from);
    if (from.builtin) { delete init.id; delete init.builtin; delete init.updatedAt; init.name = `${from.name} copy`; }
  }
  init.negatives ||= []; init.models ||= { faces: '', places: '' };
  const err = h('div', { class: 'banner err', role: 'alert', hidden: true });
  const known = new Set(IMAGE_MODELS.map((m) => m.id));
  const extra = new Set();
  for (const s of state.styles.list) for (const v of [s.models?.faces, s.models?.places]) if (v && !known.has(v)) extra.add(v);
  for (const v of [init.models.faces, init.models.places]) if (v && !known.has(v)) extra.add(v);
  loadModels().then(() => { for (const el of [f.faces, f.places]) csSet(el, {}); });
  if (!state.settings.loaded) loadSettings();
  const mkModel = (slot, val) => chipSelect({ name: slot, title: slot === 'faces' ? 'Faces model' : 'Places model', value: val ?? '', cls: 'block', options: () => modelOptions(slot, [...extra]), sub: (o) => o?.price, subCls: 'price' });
  const ta = (name, val, rows = 2) => { const t = h('textarea', { name, class: 'grow', rows, value: val || '' }); t.addEventListener('input', () => grow(t)); return t; };
  const f = {
    name: h('input', { type: 'text', name: 'name', value: init.name || '', required: true, autocomplete: 'off' }),
    family: chipSelect({ name: 'family', title: 'Family', value: init.family || 'custom', cls: 'block', options: FAMILIES.map((x) => ({ value: x, label: x, hint: FAMILY_HINTS[x] })) }),
    description: h('input', { type: 'text', name: 'description', value: init.description || '', autocomplete: 'off' }),
    look: ta('look', init.look, 3), sheetLook: ta('sheetLook', init.sheetLook, 2), videoHints: ta('videoHints', init.videoHints, 2),
    faces: mkModel('faces', init.models.faces), places: mkModel('places', init.models.places),
    soul: chipSelect({ name: 'soul', title: 'Soul style', value: init.soulStyleId || '', cls: 'block', icon: () => svg('spark', 16, 'currentColor', 1.7), placeholder: 'No Soul style', options: [] }),
  };
  const dirtyFlag = { v: !init.id || !!from?.builtin };
  const touch = () => { dirtyFlag.v = true; };
  const negs = chipsEditor(init.negatives, touch);
  const soulField = h('div', { class: 'field' }, h('span', {}, 'Soul style'), f.soul);
  const fillSoul = () => {
    const list = state.soul.list || [];
    const options = [{ value: '', label: list.length ? 'No Soul style' : state.soul.list ? 'Soul styles unavailable' : 'Loading…', hint: 'plain Soul 2 look' },
      ...list.map((x) => ({ value: x.id, label: x.name, hint: x.description || null, tag: 'Free' }))];
    if (init.soulStyleId && !options.some((o) => o.value === init.soulStyleId)) options.push({ value: init.soulStyleId, label: init.soulStyleId });
    csSet(f.soul, { options, value: f.soul.value || init.soulStyleId || '' });
  };
  const syncSoul = () => {
    const on = f.faces.value === SOUL2;
    soulField.hidden = !on;
    if (on && !state.soul.list) { loadSoul().then(() => { fillSoul(); if (state.soul.err) { err.hidden = false; err.replaceChildren(h('span', { class: 'msg' }, `Soul styles: ${state.soul.err}`)); } }); }
  };
  fillSoul();
  const collect = () => ({
    ...(init.id ? { id: init.id } : {}),
    name: f.name.value.trim(), family: f.family.value, description: f.description.value.trim(),
    look: f.look.value.trim(), sheetLook: f.sheetLook.value.trim() || undefined,
    negatives: $$('.chip[data-v]', negs).map((c) => c.dataset.v),
    videoHints: f.videoHints.value.trim(),
    models: { faces: f.faces.value, places: f.places.value, ...(init.models.identity ? { identity: init.models.identity } : {}) },
    ...(f.faces.value === SOUL2 && f.soul.value ? { soulStyleId: f.soul.value } : {}),
  });
  const L = (label, el, span) => h('label', { class: 'field', style: span ? 'grid-column:1/-1' : null }, h('span', {}, label), el);
  const D = (label, el) => h('div', { class: 'field' }, h('span', {}, label), el); // a chip select is a button; a <label> around it would swallow clicks
  modal(from ? 'Customise style' : 'New style', (d) => {
    const saveBtn = h('button', { class: 'btn', type: 'button' }, 'Save to my styles');
    const useBtn = h('button', { class: 'btn primary', type: 'button' }, 'Use for this project');
    const form = h('form', { method: 'dialog', class: 'styleform' },
      h('h2', { class: 'h2' }, from ? 'Customise style' : 'New style'), err,
      h('div', { class: 'grid2' }, L('Name', f.name), D('Family', f.family)),
      L('Description (one line for the card)', f.description),
      L('Look', f.look), L('Sheet look (character and location sheets)', f.sheetLook),
      h('div', { class: 'field' }, h('span', {}, 'Negatives'), negs),
      L('Video hints (added to every scene prompt)', f.videoHints),
      h('div', { class: 'grid2' }, D('Faces model', f.faces), D('Places model', f.places)),
      soulField,
      h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => d.close() }, 'Cancel'), saveBtn, useBtn));
    const fail = (x) => { err.hidden = false; err.replaceChildren(h('span', { class: 'msg' }, x.status === 404 ? `${x.message} (the server may not have this feature yet)` : x.message)); toast(x.message, true); };
    const persist = async () => {
      const spec = collect();
      if (!spec.name) { f.name.focus(); throw new Error('Give the style a name'); }
      const saved = await api('/styles', 'POST', spec);
      init = { ...init, id: saved.id }; dirtyFlag.v = false;
      await loadStyles(true);
      return saved;
    };
    const run = async (btn, fn) => { err.hidden = true; saveBtn.disabled = useBtn.disabled = true; try { await fn(); } catch (x) { fail(x); } finally { saveBtn.disabled = useBtn.disabled = false; } };
    saveBtn.addEventListener('click', () => run(saveBtn, async () => { await persist(); state.styles.tab = 'mine'; toast('Saved to my styles'); d.close(); render(); }));
    useBtn.addEventListener('click', () => run(useBtn, async () => {
      const id = dirtyFlag.v || !init.id ? (await persist()).id : init.id;
      if (!(await saveIfDirty())) return;
      await api(`/projects/${state.slug}/style`, 'POST', { styleId: id });
      await loadProject(); d.close(); toast('Look changed. Later steps need a refresh.'); render(true);
    }));
    form.addEventListener('input', touch); form.addEventListener('change', (e) => { touch(); if (e.target === f.faces) syncSoul(); });
    form.addEventListener('submit', (e) => e.preventDefault());
    setTimeout(() => { syncSoul(); growAll(form); f.name.focus(); }, 0);
    return form;
  }, true);
}

// ---------- 2 script ----------
function scriptBody() {
  const p = P();
  if (!p.script) return emptyCard('No script yet', 'Write the brief, then press Generate script below. The price row shows what the language model costs.');
  const sc = p.script;
  const out = h('div', { class: 'stack' });
  out.append(h('div', { class: 'group' }, h('h2', { class: 'h2' }, 'Story'),
    fld('Logline', 'script.logline', sc.logline, { rows: 1 }),
    fld('The one moment the film exists for', 'script.emotionalCore', sc.emotionalCore, { rows: 2 }),
    fld('Arc', 'script.arc', sc.arc, { rows: 3 }),
    fld('Inspiration (notes only, never used in prompts)', 'script.inspiration', sc.inspiration || '', { rows: 1 })));
  out.append(h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, 'Characters'), h('button', { class: 'btn sm', type: 'button', onclick: () => openLibrary({ mode: 'adopt', kind: 'character' }) }, 'Add from library')));
  sc.characters.forEach((c, i) => {
    const b = `script.characters.${i}`;
    out.append(h('div', { class: 'group' },
      h('header', {}, h('h3', { class: 'h2' }, c.name), h('div', { class: 'sechead' }, h('span', { class: 'pill' }, c.species), h('button', { class: 'btn sm', type: 'button', onclick: () => openLibrary({ mode: 'replace', kind: 'character', charId: c.id }) }, 'Replace from library'))),
      h('div', { class: 'grid2' }, fld('Name', `${b}.name`, c.name), fld('Species', `${b}.species`, c.species, { select: [['human', 'Human', { hint: 'portrait + full-body sheets', glyph: () => svg('user', 18, 'currentColor', 1.8) }], ['animal', 'Animal', { hint: 'full-body sheets only' }], ['other', 'Other']] })),
      fld('Description (age, height, weight, marks)', `${b}.baseDescription`, c.baseDescription, { rows: 2 }),
      fld('Wardrobe and props that never change', `${b}.wardrobe`, c.wardrobe, { rows: 2 }),
      h('div', { class: 'sub' }, h('div', { class: 'eyebrow' }, 'STATES'), c.states.map((s, j) => h('div', { class: 'grid2' }, fld(`State ${s.id}`, `${b}.states.${j}.label`, s.label), fld('What differs', `${b}.states.${j}.description`, s.description, { rows: 1 }))))));
  });
  out.append(h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, 'Locations'), h('button', { class: 'btn sm', type: 'button', onclick: () => openLibrary({ mode: 'adopt', kind: 'location' }) }, 'Add from library')));
  sc.locations.forEach((l, i) => {
    const b = `script.locations.${i}`;
    out.append(h('div', { class: 'group' }, h('h3', { class: 'h2' }, l.name),
      h('div', { class: 'grid2' }, fld('Name', `${b}.name`, l.name), fld('Palette', `${b}.palette`, l.palette)),
      fld('Description', `${b}.description`, l.description, { rows: 2 }),
      h('div', { class: 'grid2' }, fld('Lighting', `${b}.lighting`, l.lighting, { rows: 2 }), fld('Camera package', `${b}.cameraPackage`, l.cameraPackage, { rows: 2 }))));
  });
  out.append(h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, 'Scene beats'), h('span', { class: 'note' }, `${beats().length} beats · ${beats().reduce((a, b) => a + b.durationSec, 0)} s`)));
  sc.scenes.forEach((s, i) => {
    const b = `script.scenes.${i}`;
    const cast = s.characters.map((c) => `${charName(c.characterId)} · ${c.stateId}`).join(', ');
    out.append(h('div', { class: 'group' },
      h('header', {}, h('h3', { class: 'h2' }, `${s.order} · ${s.title}`), s.matchCutFrom ? h('span', { class: 'pill' }, `match cut from ${beatNo(s.matchCutFrom)}`) : h('span', { class: 'note' }, cast)),
      h('div', { class: 'grid2' }, fld('Title', `${b}.title`, s.title), fld('Seconds', `${b}.durationSec`, s.durationSec, { type: 'number', min: 4, max: 10 })),
      h('div', { class: 'grid2' }, fld('Era', `${b}.era`, s.era), fld('Location', `${b}.locationId`, s.locationId, { select: sc.locations.map((l) => [l.id, l.name, { hint: l.description?.slice(0, 70), glyph: () => svg('pin', 18, 'currentColor', 1.8) }]) })),
      fld('Camera', `${b}.cameraSimple`, s.cameraSimple, { rows: 1 }), fld('Action', `${b}.actionSimple`, s.actionSimple, { rows: 2 }), fld('Mood', `${b}.mood`, s.mood, { rows: 1 })));
  });
  return out;
}

// ---------- 3 sheets ----------
function sheetsBody() {
  const items = sheetItems();
  if (!items.length) return emptyCard('No sheet prompts yet', 'Press Generate sheets below. You get a portrait and a full-body prompt for every person state, one full-body prompt for every animal state, and one per place.');
  const out = h('div', { class: 'stack' });
  const groupFor = (title, list) => h('div', { class: 'group' }, typeof title === 'string' ? h('h2', { class: 'h2' }, title) : title,
    list.map(({ it, idx }) => h('div', { class: 'sheetrow' },
      h('div', { class: 'sheetlabel' }, it.characterId ? h('b', {}, stateLabel(it.characterId, it.stateId)) : renameable('location', it.locationId, locName(it.locationId)), h('span', { class: 'note' }, kindWord(it.kind)), h('span', { class: 'mono note' }, it.id), styleChip()),
      h('textarea', { 'data-p': `sheets.items.${idx}.prompt`, 'aria-label': `Prompt for ${it.id}`, rows: 3, value: it.prompt }))));
  for (const c of chars()) {
    const list = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.characterId === c.id);
    if (list.length) out.append(groupFor(renameable('character', c.id, c.name, 'h2', 'h2'), list));
  }
  const ll = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.locationId && !x.it.characterId);
  if (ll.length) out.append(groupFor('Locations', ll));
  out.append(h('p', { class: 'note' }, 'Click a prompt to edit it. Each box shows three lines until you do.'));
  return out;
}

// ---------- 4 images ----------
async function mutate(stage, fn, okMsg) {
  await attempt(stage, async () => { await fn(); await loadProject(); if (okMsg) toast(okMsg); render(true); });
}
function chooseOption(a, idx) {
  if (state.ui.compare) {
    const key = `${a.id}:${idx}`;
    const cmp = state.ui.cmp.includes(key) ? state.ui.cmp.filter((k) => k !== key) : [...state.ui.cmp, key].slice(-2);
    state.ui.cmp = cmp;
    if (cmp.length === 2) { openCompare(cmp); state.ui.cmp = []; state.ui.compare = false; }
    render(); return;
  }
  if (a.chosen === idx) return;
  return mutate('images', () => api(`/projects/${state.slug}/choose`, 'POST', { assetId: a.id, index: idx }));
}
function unpickOption(a) {
  return mutate('images', () => api(`/projects/${state.slug}/choose`, 'POST', { assetId: a.id, index: null }), 'Unpicked');
}
function removeOptionUi(a, i, title) {
  if (!confirm(`Remove picture ${i + 1} of ${title}? The file is deleted if it belongs to this project.`)) return Promise.resolve(false);
  return mutate('images', () => api(`/projects/${state.slug}/assets/${a.id}/options/remove`, 'POST', { index: i }), 'Picture removed');
}
function lightbox(title, urls) {
  modal(title, (d) => h('div', { class: 'dlg' },
    h('div', { class: 'sechead' }, h('h2', { class: 'h2' }, title), h('button', { class: 'btn sm quiet iconbtn', type: 'button', 'aria-label': 'Close', onclick: () => d.close() }, svg('close', 18))),
    h('div', { class: urls.length > 1 ? 'compare' : '' }, urls.map((u) => h('img', { src: u.src, alt: u.alt }))),
    urls.length > 1 ? h('div', { class: 'compare' }, urls.map((u) => h('span', { class: 'note' }, u.alt))) : null), true);
}
const optProv = (a, i) => a.sources?.[i]?.kind || 'generated';
/**
 * Big view of one option list (a sheet's pictures, a keyframe's stills): arrows move between options, Pick and Remove act on the shown one.
 * cfg: { get() -> {options, chosen, sources}, title(), caption(item, idx), pick(item, idx), unpick(item), remove(item, idx) }
 */
function openOptionsLightbox(start, cfg) {
  let idx = start;
  const d = modal('Picture', (dlg) => {
    const body = h('div', { class: 'dlg' });
    const paint_ = () => {
      const a = cfg.get();
      if (!a || !a.options?.length) { dlg.close(); return; }
      idx = Math.max(0, Math.min(idx, a.options.length - 1));
      const o = a.options[idx]; const on = a.chosen === idx; const n = a.options.length;
      const go = (dx) => { idx = (idx + dx + n) % n; paint_(); };
      body.replaceChildren(
        h('img', { class: 'lbimg', src: mediaUrl(o.path), alt: `${cfg.title()} · option ${idx + 1}` }),
        h('div', { class: 'lbcap' }, cfg.caption(a, idx)),
        h('div', { class: 'lbbar' },
          h('button', { class: 'ib', type: 'button', 'aria-label': 'Previous picture', disabled: n < 2, onclick: () => go(-1) }, svg('prev', 18)),
          h('span', { class: 'n' }, `${idx + 1} / ${n}`),
          h('button', { class: 'ib', type: 'button', 'aria-label': 'Next picture', disabled: n < 2, onclick: () => go(1) }, svg('next', 18)),
          h('button', { class: `pickbtn ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': on, onclick: async () => { await (on ? cfg.unpick(a) : cfg.pick(a, idx)); paint_(); } }, on ? svg('check', 15) : null, on ? 'Picked' : 'Pick'),
          h('button', { class: 'ib rm', type: 'button', 'aria-label': 'Remove picture', title: 'Remove picture', onclick: async () => { await cfg.remove(a, idx); paint_(); } }, svg('close', 18))),
        h('button', { class: 'ib lbclose', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, svg('close', 18)));
    };
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const n = cfg.get()?.options?.length || 0; if (n > 1) { idx = (idx + (e.key === 'ArrowLeft' ? -1 : 1) + n) % n; paint_(); } }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    paint_();
    return body;
  }, false);
  d.classList.add('lb');
}
/** Big view of one sheet's pictures. */
function openSheetLightbox(assetId, start) {
  const title = () => { const a = asset(assetId); return a.characterId ? stateLabel(a.characterId, a.stateId) : locName(a.locationId); };
  openOptionsLightbox(start, {
    get: () => asset(assetId), title,
    caption: (a, i) => [a.characterId ? charName(a.characterId) : null, title(), kindWord(a.kind), a.model ? assetModelName(a) : null, optProv(a, i)].filter(Boolean).join(' · '),
    pick: chooseOption, unpick: unpickOption, remove: (a, i) => removeOptionUi(a, i, title()),
  });
}
/**
 * One picture card: the big click zooms (or adds to compare), the strip has Pick / zoom / remove.
 * c: { i, title, src, chosen, picked?, cmp?, badge?, aspect?, open, toggle, zoom, remove }
 */
function optionThumb(c) {
  return h('div', { class: `thumb ${c.chosen ? 'chosen' : ''} ${c.picked ? 'picked' : ''}` },
    h('div', { class: 'shot', style: c.aspect ? `aspect-ratio:${c.aspect}` : null },
      h('button', { class: 'pick', type: 'button', 'aria-label': `${c.cmp ? 'Add to compare' : 'Enlarge'} option ${c.i + 1} for ${c.title}`, onclick: c.open },
        c.src ? h('img', { src: c.src, alt: '', loading: 'lazy' }) : null),
      c.badge ? h('span', { class: 'badge' }, c.badge) : null),
    h('div', { class: 'strip' },
      h('button', { class: 'pickbtn', type: 'button', 'aria-pressed': c.chosen, 'aria-label': `${c.chosen ? 'Unpick' : c.cmp ? 'Add to compare' : 'Pick'} option ${c.i + 1} for ${c.title}`, onclick: c.toggle }, c.chosen ? svg('check', 14) : null, c.chosen ? 'Picked' : 'Pick'),
      c.src ? h('button', { class: 'ib', type: 'button', 'aria-label': `Zoom option ${c.i + 1}`, title: 'Zoom', onclick: c.zoom }, svg('zoom', 16)) : null,
      h('button', { class: 'ib rm', type: 'button', 'aria-label': `Remove option ${c.i + 1}`, title: 'Remove picture', onclick: c.remove }, svg('close', 16))),
    c.made || null);
}
/** What made one option of a sheet: model, local or price per picture, or import / library. */
function assetMade(a, i) {
  const src = a.sources?.[i];
  if (src?.kind === 'import') return madeLine(['imported', 'free']);
  if (src?.kind === 'library') return madeLine(['from library', src.projectSlug, 'free']);
  if (src?.fromRef) return madeLine(['clean sheet', 'from your picture', a.costUsd != null ? 'Qwen edit' : null]);
  const model = src?.model || a.model; const info = modelInfo(model);
  const gen = a.options.filter((_, k) => (a.sources?.[k]?.kind || 'generated') === 'generated').length || 1;
  const name = model === 'alibaba/qwen-image-3/edit' ? 'Qwen edit' : MODEL_NAMES[model]?.split(' · ')[0] || modelShort(model);
  return madeLine([name, info?.local || model?.startsWith('local/') ? 'local GPU · free' : a.costUsd != null ? `${usd(a.costUsd / gen)} each` : null]);
}
/** What made one keyframe still. */
function kfMade(kf, i) {
  const src = kf.sources?.[i];
  if (src?.kind === 'import') return madeLine(['imported', 'free']);
  const gen = kf.options.filter((_, k) => (kf.sources?.[k]?.kind || 'generated') === 'generated').length || 1;
  const model = src?.model || kf.model;
  return madeLine([model === 'alibaba/qwen-image-3/edit' ? 'Qwen edit' : model?.startsWith('local/') ? 'local GPU · free' : modelShort(model), '1k', aspectBit(P().aspect, 11), kf.costUsd != null ? usd(kf.costUsd / gen) : null]);
}
/** What made one clip: "480p · 5 s · ▭ 16:9 · from keyframe · short · $1.03". */
function clipMade(c) {
  const secs = c.file?.durationSec ? Math.round(c.file.durationSec * 10) / 10 : isSeq(c) ? (c.sceneIds || []).reduce((a, x) => a + (spOf(x)?.durationSec || 0), 0) : spOf(c.sceneId)?.durationSec;
  return madeLine([c.resolution, secs != null ? `${secs} s` : null, aspectBit(P().aspect, 11), clipSource(c), clipMode(c), c.costUsd != null ? usd(c.costUsd) : null]);
}
function openCompare(keys) {
  lightbox('Compare', keys.map((k) => { const [id, i] = k.split(':'); const a = asset(id); return { src: mediaUrl(a.options[Number(i)].path), alt: `${shortLabel(a)} · ${kindWord(a.kind)} · option ${Number(i) + 1}` }; }));
}
async function importImage(row, dropped) {
  const file = dropped || await pickFile('image/png,image/jpeg,image/webp');
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { state.errs.images = `${file.name} is over 15 MB`; toast(state.errs.images, true); render(); return; }
  await mutate('images', async () => {
    const dataBase64 = await toBase64(file);
    if (row.asset) await api(`/projects/${state.slug}/assets/${row.id}/import`, 'POST', { filename: file.name, dataBase64 });
    else await api(`/projects/${state.slug}/assets/import-new`, 'POST', { kind: row.kind, characterId: row.characterId, stateId: row.stateId, locationId: row.locationId, filename: file.name, dataBase64 });
  }, 'Image added and chosen');
}

// ---------- your own pictures (v6.1): one "Add your picture" control on sheet and scene cards ----------
const IMG_ACCEPT = 'image/png,image/jpeg,image/webp';
const isImportOpt = (a, i) => i != null && a?.sources?.[i]?.kind === 'import';
/** Context pictures of one sheet ({assetId}) or one scene ({sceneId}). */
const ctxRefs = (t) => (P()?.contextRefs || []).filter((r) => (t.assetId && r.forAssetId === t.assetId) || (t.sceneId && r.forSceneId === t.sceneId));
const OWN_CHOICES = {
  images: [
    ['final', 'Use as final', 'It becomes the picked picture for this sheet. Free.'],
    ['context', 'Use as context', 'It guides the sheet prompt and the picture. Heartcut still draws the sheet, with Qwen Image edit ($0.04 a picture) because the look\'s own model cannot take a picture.'],
    ['clean', 'Make a clean sheet from it', 'Heartcut redraws it on the clean sheet background and framing, keeping the face, clothes and props. You see the price first and pick one of the results.'],
  ],
  scenes: [
    ['final', 'Use as the shot', 'The clip animates this picture (image to video). Works without the Keyframes step. Free.'],
    ['context', 'Use as context', 'It guides the scene prompt, the keyframe and clips made from the sheets. A clip that animates a keyframe does not send it again.'],
  ],
};
/** Upload one picture as context; returns the new ref. */
async function postContext(target, file, extra = {}) {
  return (await api(`/projects/${state.slug}/context`, 'POST', { ...target, filename: file.name, dataBase64: await toBase64(file), ...extra })).ref;
}
/**
 * "Add your picture": one picture, then a choice. t = { stage: 'images', row } | { stage: 'scenes', sceneId }.
 * Final: import and pick (free). Context: attach. Clean (sheets): attach, then the card shows a priced "Clean sheet" button.
 */
function ownPictureModal(t, dropped) {
  const sheet = t.stage === 'images';
  const what = sheet ? `${t.row.characterId ? `${charName(t.row.characterId)} · ${stateLabel(t.row.characterId, t.row.stateId)}` : locName(t.row.locationId)} · ${kindWord(t.row.kind)}` : `Scene ${beatNo(t.sceneId)} · ${beatTitle(t.sceneId)}`;
  modal('Add your picture', (d) => {
    let file = dropped || null;
    const err = h('div', { class: 'banner err', role: 'alert', hidden: true });
    const fail = (m) => { err.hidden = false; err.replaceChildren(h('span', { class: 'msg' }, m)); };
    const name = h('span', { class: 'note' }, file ? file.name : 'No picture chosen yet');
    const take = (f) => { if (!f) return; if (tooBig(f)) { fail(`${f.name} is over 15 MB`); return; } file = f; err.hidden = true; name.textContent = f.name; };
    const zone = dropzone({ compact: true, title: 'Drop a picture here', sub: 'or click to choose · png, jpg, webp · up to 15 MB', accept: isImg, acceptAttr: IMG_ACCEPT, onFiles: ([f]) => take(f), what: 'pictures' });
    const several = h('label', { class: 'radio', hidden: true }, h('input', { type: 'checkbox', name: 'several' }), h('span', {}, h('b', {}, 'More than one person is in this photo'), h('span', { class: 'note' }, 'A clean sheet needs one person. Crop it first, or use it as context.')));
    const choices = h('div', { class: 'radios', role: 'radiogroup', 'aria-label': 'How to use it' },
      OWN_CHOICES[t.stage].map(([v, label, note], i) => h('label', { class: 'radio' },
        h('input', { type: 'radio', name: 'use', value: v, checked: i === 0, onchange: () => { several.hidden = !(v === 'clean' && t.row?.kind !== 'location'); } }),
        h('span', {}, h('b', {}, label), h('span', { class: 'note' }, note)))));
    const f = h('form', { method: 'dialog', class: 'ownpic' }, h('h2', { class: 'h2' }, 'Add your picture'), h('p', { class: 'note' }, what), err, zone, name, choices, several,
      h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add picture')));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!file) { fail('Choose a picture first'); return; }
      const use = f.querySelector('input[name=use]:checked')?.value || 'final';
      const multi = !several.hidden && f.querySelector('input[name=several]').checked;
      if (use === 'clean' && multi) { fail('A clean sheet needs a photo of one person. Crop it to one person, or use it as context.'); return; }
      d.close();
      if (!(await saveIfDirty())) return; // typed block edits are saved before the project reloads
      if (use === 'final') { if (sheet) await importImage(t.row, file); else await importKf(kfId(t.sceneId, 'start'), file); return; }
      const target = sheet ? { forAssetId: t.row.id } : { forSceneId: t.sceneId };
      await mutate(t.stage, async () => {
        const ref = await postContext(target, file);
        if (use === 'clean') state.ui.cleanRef = ref.id;
      }, use === 'clean' ? 'Picture added. Press Clean sheet to see the price and make it.' : 'Picture added as context');
    });
    return f;
  });
}
/** "Clean this up" on an imported final: copy it into a context picture of the sheet, then offer the priced clean-up. */
async function cleanThisUp(a, i) {
  await mutate('images', async () => { state.ui.cleanRef = (await api(`/projects/${state.slug}/assets/${a.id}/context`, 'POST', { index: i })).ref.id; }, 'Ready. Press Clean sheet to see the price and make it.');
}
function removeContext(stage, r) {
  if (!confirm('Remove this picture? The file is deleted.')) return Promise.resolve(false);
  return mutate(stage, () => api(`/projects/${state.slug}/context/${r.id}/remove`, 'POST'), 'Picture removed');
}
async function replaceContext(stage, r) {
  const file = await pickFile(IMG_ACCEPT);
  if (!file) return;
  if (tooBig(file)) { toast(`${file.name} is over 15 MB`, true); return; }
  await mutate(stage, async () => api(`/projects/${state.slug}/context/${r.id}/replace`, 'POST', { filename: file.name, dataBase64: await toBase64(file) }), 'Picture replaced');
}
/** Small thumbnails of a card's context pictures, each with replace and remove; sheets also get a priced "Clean sheet". */
function ctxStrip(t) {
  const refs = ctxRefs(t.stage === 'images' ? { assetId: t.row.id } : { sceneId: t.sceneId });
  if (!refs.length) return null;
  const sheet = t.stage === 'images';
  return h('div', { class: 'ctxstrip', 'aria-label': 'Your pictures used as context' },
    h('span', { class: 'eyebrow' }, `YOUR PICTURES · CONTEXT (${refs.length})`),
    h('div', { class: 'ctxlist' }, refs.map((r) => {
      const opts = { ids: [t.row?.id], cleanFrom: r.id };
      return h('div', { class: `ctx ${state.ui.cleanRef === r.id ? 'hl' : ''}` },
        h('img', { src: refUrl(r.path), alt: r.note || 'your picture', loading: 'lazy' }),
        h('div', { class: 'ctxacts' },
          h('button', { class: 'ib', type: 'button', 'aria-label': 'Replace picture', title: 'Replace picture', onclick: () => replaceContext(t.stage, r) }, svg('upload', 14)),
          h('button', { class: 'ib rm', type: 'button', 'aria-label': 'Remove picture', title: 'Remove picture', onclick: () => removeContext(t.stage, r) }, svg('close', 14))),
        sheet ? priced({ key: `clean-${r.id}`, label: 'Clean sheet', stage: 'images', opts, cls: 'sm quiet', est: rowEst(opts), run: () => { state.ui.cleanRef = null; runStage('images', opts); } }) : null);
    })),
    h('span', { class: 'note' }, sheet
      ? 'These guide the sheet prompt (Sheets) and this picture. A sheet with your pictures is drawn by Qwen Image edit; the price on Regenerate already counts it.'
      : 'These guide the scene prompt, the keyframe and clips from the sheets (Seedance takes 30 pictures at most).'));
}
function imageRows() {
  const byId = new Map(P().assets.map((a) => [a.id, a]));
  const rows = sheetItems().map((s) => ({ ...s, asset: byId.get(s.id) || null }));
  for (const a of P().assets) if (!rows.some((r) => r.id === a.id)) rows.push({ id: a.id, kind: a.kind, characterId: a.characterId, stateId: a.stateId, locationId: a.locationId, prompt: a.prompt, asset: a });
  return rows;
}
/** A row's price comes from an estimate with the very ids and force flag its button will run, so shown == charged. */
function rowEst(opts, stage = 'images') {
  const e = want(stage, opts);
  if (!e || e.error) return e;
  return { usd: e.usd };
}
function imgRowEl(row) {
  const a = row.asset; const wide = row.kind === 'location';
  const dep = !!anchorOf(row); const waiting = isWaiting(row); const stale = dep && isStaleFace(row.id);
  const title = row.characterId ? stateLabel(row.characterId, row.stateId) : locName(row.locationId);
  const thumbs = h('div', { class: `thumbs ${wide ? 'wide' : ''}` });
  const opts = a?.options || [];
  opts.forEach((o, i) => {
    const src = a.sources?.[i];
    const chosen = a.chosen === i; const cmp = state.ui.compare;
    thumbs.append(optionThumb({
      i, title, src: o.path ? mediaUrl(o.path) : '', chosen, picked: state.ui.cmp.includes(`${a.id}:${i}`), cmp, badge: src && src.kind !== 'generated' ? src.kind : src?.fromRef ? 'clean' : null,
      open: () => (cmp ? chooseOption(a, i) : openSheetLightbox(a.id, i)), toggle: () => (chosen && !cmp ? unpickOption(a) : chooseOption(a, i)),
      zoom: () => openSheetLightbox(a.id, i), remove: () => removeOptionUi(a, i, title), made: assetMade(a, i),
    }));
  });
  for (let i = opts.length; i < Math.max(4, opts.length); i++) thumbs.append(h('div', { class: 'thumb ghost' }, h('div', { class: 'shot' }, 'not made')));
  const imp = a ? (isImportOpt(a, a.chosen) ? a.chosen : a.options.map((_, i) => i).filter((i) => isImportOpt(a, i)).at(-1)) : undefined;
  return dropTarget(h('div', { class: `imgrow ${waiting ? 'locked' : ''}`, title: 'Drop a picture here to use it: final, context or a clean sheet' },
    h('div', { class: 'imghead' },
      row.characterId ? h('b', {}, title) : renameable('location', row.locationId, title),
      h('span', { class: 'note' }, `${kindWord(row.kind)}${a?.model ? ` · ${assetModelName(a)}` : ''}`),
      dep && waiting ? h('span', { class: 'lockline note' }, svg('lock', 13), 'waiting for the face') : !a || !a.options.length ? h('span', { class: 'warn note' }, 'not generated yet') : a.chosen == null ? h('span', { class: 'warn note' }, 'pick one to continue') : null,
      dep && hasPics(row) ? (stale ? h('span', { class: 'pill s-stale tiny' }, 'face changed') : h('span', { class: 'pill depbadge tiny' }, 'from face ✓')) : null,
      h('div', { class: 'row-acts' },
        !hasPromptText(row) ? h('span', { class: 'note' }, 'no prompt — Add your picture… or regenerate Sheets')
          : waiting ? null
          : noFace(row) ? h('span', { class: 'note' }, 'pick the face to rebuild')
          : hasPics(row) ? priced({ key: `row-${row.id}`, label: stale ? 'Rebuild' : 'Regenerate', stage: 'images', opts: { ids: [row.id], force: true }, cls: 'sm quiet', est: rowEst({ ids: [row.id], force: true }), run: () => runStage('images', { ids: [row.id], force: true }) })
          : priced({ key: `row-${row.id}`, label: 'Generate', stage: 'images', opts: { ids: [row.id] }, cls: 'sm quiet', est: rowEst({ ids: [row.id] }), run: () => runStage('images', { ids: [row.id] }) }),
        h('button', { class: 'linkbtn', type: 'button', onclick: () => ownPictureModal({ stage: 'images', row }), title: 'Use as final, as context, or make a clean sheet from it. Or drop a picture on this row.' }, 'Add your picture…'),
        imp != null ? h('button', { class: 'linkbtn', type: 'button', onclick: () => cleanThisUp(a, imp), title: 'Make clean sheet options from your imported picture. The import stays.' }, 'Clean this up…') : null,
        h('button', { class: 'linkbtn', type: 'button', onclick: () => openLibrary({ mode: 'swap', kind: row.locationId && !row.characterId ? 'location' : 'character', assetId: row.id }) }, 'Use from library…'))),
    thumbs, ctxStrip({ stage: 'images', row })), { multiple: false, onFiles: ([f]) => ownPictureModal({ stage: 'images', row }, f) });
}
/** Group header buttons: "Generate missing" (primary, only when something is ready to make) and "Regenerate all". */
function groupActs(key, rows) {
  const miss = readyMissing(rows); const all = regenIds(rows);
  const anyPics = rows.some(hasPics);
  return [
    miss.length ? priced({ key: `${key}-miss`, label: 'Generate missing', stage: 'images', opts: { ids: miss }, cls: 'primary', est: rowEst({ ids: miss }), run: () => runStage('images', { ids: miss }) }) : null,
    anyPics && all.length ? priced({ key: `${key}-all`, label: 'Regenerate all', stage: 'images', opts: { ids: all, force: true }, cls: 'sm quiet', est: rowEst({ ids: all, force: true }), run: () => runStage('images', { ids: all, force: true }) }) : null,
  ];
}
/** Phase 2 header: locked until the face is picked, then one button that builds every ready dependent from it. */
function phaseBuild(c, deps, faced) {
  const ready = readyMissing(deps);
  const waitingN = deps.filter(isWaiting).length;
  return h('div', { class: `phase two ${faced ? '' : 'locked'}` },
    h('div', { class: 'phasehead' },
      !faced ? svg('lock', 15) : null,
      h('b', {}, '2 · Build from this face'),
      h('span', { class: 'note' }, faced ? `${plural(deps.length, 'sheet')} of ${c.name}, each made with the picked face as a reference` : 'waiting for the face — pick one above')),
    faced && ready.length ? priced({ key: `build-${c.id}`, label: `Build ${plural(ready.length, 'sheet')} from this face`, stage: 'images', opts: { ids: ready }, cls: 'primary', est: rowEst({ ids: ready }), run: () => runStage('images', { ids: ready }) })
      : !faced && waitingN ? h('span', { class: 'btn quiet', 'aria-disabled': 'true' }, svg('lock', 14), ` Build ${plural(waitingN, 'sheet')} from this face`) : null);
}
function imagesBody() {
  const rows = imageRows();
  if (!rows.length) return emptyCard('No sheets to draw yet', 'Make the sheet prompts first. Then this step makes four pictures for each.');
  const out = h('div', { class: 'stack' });
  const orderOf = (r) => (r.kind === 'character-portrait' ? 0 : 1);
  for (const c of chars()) {
    const mine = rows.filter((r) => r.characterId === c.id).sort((a, b) => c.states.findIndex((s) => s.id === a.stateId) - c.states.findIndex((s) => s.id === b.stateId) || orderOf(a) - orderOf(b));
    if (!mine.length) continue;
    const anchors = mine.filter((r) => !anchorOf(r)); const deps = mine.filter((r) => anchorOf(r));
    const faceAsset = anchors[0]?.asset; const faced = chosenOpt(faceAsset) !== undefined;
    out.append(h('section', { class: 'sec' },
      h('div', { class: 'sechead' },
        h('div', { class: 't' }, renameable('character', c.id, c.name, 'h2', 'h2'), h('span', { class: 'pill cap' }, `${c.species} · ${c.states.length} ${c.states.length === 1 ? 'state' : 'states'}`)),
        h('div', { class: 'acts' },
          h('button', { class: 'btn quiet', type: 'button', 'aria-pressed': state.ui.compare, onclick: () => { state.ui.compare = !state.ui.compare; state.ui.cmp = []; render(); } }, state.ui.compare ? 'Pick two to compare' : 'Compare'),
          groupActs(`img-${c.id}`, mine))),
      deps.length ? h('div', { class: 'phase' }, h('div', { class: 'phasehead' }, h('b', {}, '1 · Lock the face'), h('span', { class: 'note' }, `pick one — every other picture of ${c.name} is built from this face`))) : null,
      anchors.map((r) => imgRowEl(r)),
      deps.length ? phaseBuild(c, deps, faced) : null,
      deps.map((r) => imgRowEl(r))));
  }
  const lr = rows.filter((r) => r.locationId && !r.characterId);
  if (lr.length) {
    out.append(h('section', { class: 'sec' },
      h('div', { class: 'sechead' }, h('div', { class: 't' }, h('h2', { class: 'h2' }, 'Locations'), h('span', { class: 'pill cap' }, `${modelShort(mapped(curStyle().models?.places))} · `, aspectBit(P().aspect, 12))),
        h('div', { class: 'acts' }, groupActs('img-locs', lr))),
      lr.map((r) => imgRowEl(r))));
  }
  out.append(h('section', { class: 'sec' },
    h('div', { class: 'sechead' }, h('div', { class: 'intro' }, h('h2', { class: 'h2' }, 'Your own photo'), h('p', { class: 'note' }, 'Have a real picture of a person, dog or place? Add it as a new sheet and it can be chosen like any other.')),
      h('button', { class: 'btn', type: 'button', onclick: addPhotoModal }, 'Add a photo as a new sheet'))));
  return out;
}
function addPhotoModal() {
  const err = h('div', { class: 'banner err', role: 'alert', hidden: true });
  modal('Add a photo as a new sheet', (d) => {
    const kind = chipSelect({ name: 'kind', title: 'What is it', value: 'character-portrait', cls: 'block', options: [
      { value: 'character-portrait', label: 'Character portrait', hint: 'head and shoulders; locks the face', glyph: () => svg('face', 18, 'currentColor', 1.8) },
      { value: 'character-full', label: 'Character full body', hint: 'head to toe; wardrobe and build', glyph: () => svg('user', 18, 'currentColor', 1.8) },
      { value: 'location', label: 'Location', hint: 'a real place, wide', glyph: () => svg('pin', 18, 'currentColor', 1.8) }] });
    const who = chipSelect({ name: 'who', title: 'Which one', value: '', cls: 'block', options: [] });
    const st = chipSelect({ name: 'st', title: 'State', value: '', cls: 'block', icon: () => svg('layers', 16, 'currentColor', 1.8), options: [] });
    const sync = () => {
      const isLoc = kind.value === 'location';
      const list = isLoc ? locs() : chars();
      csSet(who, { options: list.map((x) => ({ value: x.id, label: x.name, hint: isLoc ? x.description?.slice(0, 70) : x.species, glyph: () => svg(isLoc ? 'pin' : 'user', 18, 'currentColor', 1.8) })), value: list.some((x) => x.id === who.value) ? who.value : list[0]?.id || '' });
      const c = chars().find((x) => x.id === who.value);
      const sts = c ? c.states : [];
      csSet(st, { options: sts.map((x) => ({ value: x.id, label: x.label, hint: x.description?.slice(0, 70) })), value: sts.some((x) => x.id === st.value) ? st.value : sts[0]?.id || '' });
      stWrap.hidden = isLoc;
    };
    const stWrap = h('div', { class: 'field' }, h('span', {}, 'State'), st);
    kind.addEventListener('change', sync); who.addEventListener('change', sync);
    const file = h('input', { type: 'file', name: 'f', accept: 'image/png,image/jpeg,image/webp', required: true });
    const f = h('form', { method: 'dialog' }, h('h2', { class: 'h2' }, 'Add a photo as a new sheet'), err,
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('span', {}, 'What is it'), kind), h('div', { class: 'field' }, h('span', {}, 'Which one'), who)),
      stWrap, h('label', { class: 'field' }, h('span', {}, 'Photo (png, jpg or webp, up to 15 MB)'), file),
      h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add photo')));
    sync();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fl = file.files[0];
      if (!fl) return;
      if (fl.size > 15 * 1024 * 1024) { err.hidden = false; err.replaceChildren(h('span', { class: 'msg' }, 'That file is over 15 MB')); return; }
      const isLoc = kind.value === 'location';
      try {
        await api(`/projects/${state.slug}/assets/import-new`, 'POST', { kind: kind.value, characterId: isLoc ? undefined : who.value, stateId: isLoc ? undefined : st.value, locationId: isLoc ? who.value : undefined, filename: fl.name, dataBase64: await toBase64(fl) });
        d.close(); await loadProject(); toast('Photo added as a new sheet'); render(true);
      } catch (x) { err.hidden = false; err.replaceChildren(h('span', { class: 'msg' }, x.status === 404 ? `${x.message} (the server may not have this feature yet)` : x.message)); }
    });
    return f;
  });
}

// ---------- 5 scenes: the block editor ----------
const LOCK_WHERE = { SUBJECT: ['Script', 'script'], IDENTITY: ['Script', 'script'], LOCATION: ['Script', 'script'], LIGHT: ['Script', 'script'], GRADE: ['Script', 'script'] };
function chipEl(v, onChange = markDirty) {
  return h('span', { class: 'chip', 'data-v': v }, v, h('button', { type: 'button', 'aria-label': `Remove ${v}`, onclick: (e) => { e.currentTarget.parentElement.remove(); onChange(); } }, '×'));
}
function chipsEditor(list, onChange = markDirty) {
  const holder = h('div', { class: 'chips', 'data-chips': '1' }, list.map((v) => chipEl(v, onChange)));
  const input = h('input', { type: 'text', 'aria-label': 'Add a negative', placeholder: '+ add "no …"' });
  const add = () => {
    const v = input.value.trim().replace(/,$/, '');
    if (!v) return;
    if (!$$('.chip', holder).some((c) => c.dataset.v === v)) holder.insertBefore(chipEl(v, onChange), holder.querySelector('.chipadd'));
    input.value = ''; onChange();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
  input.addEventListener('blur', add);
  holder.append(h('span', { class: 'chipadd' }, input));
  return holder;
}
function blockTa(j, text) {
  const t = h('textarea', { class: 'grow', 'data-b': j, rows: 1, placeholder: 'not used in this shot', value: text });
  t.addEventListener('input', () => grow(t));
  return t;
}
/**
 * The block editor rows for one prompt (a scene or a keyframe): locked blocks dashed with a link upstream,
 * editable blocks as growing textareas (data-b = block index), then the NEGATIVES chips. `key` keeps label ids unique.
 */
function blockList(item, key, labelOf = blockLabel, where = LOCK_WHERE) {
  const view = h('div', { class: 'stack', style: 'gap:8px' });
  if (item.blocks?.length) {
    item.blocks.forEach((blk, j) => {
      if (blk.name === 'NEGATIVES') return;
      if (blk.locked) {
        const w = where[blk.name];
        view.append(h('div', { class: 'blk locked' }, h('span', { class: 'k' }, labelOf(blk.name)),
          h('div', {}, h('div', { class: 'locked-txt' }, withRefChips(blk.text)),
            h('span', { class: 'hint' }, 'Locked. Edit upstream in ', h('a', { href: `#/p/${state.slug}/${w ? w[1] : 'script'}`, onclick: (e) => { e.preventDefault(); go(w ? w[1] : 'script'); } }, w ? w[0] : 'Script'), '.'))));
      } else {
        const t = blockTa(j, blk.text);
        t.addEventListener('focus', () => t.closest('.blk').classList.add('focus')); t.addEventListener('blur', () => t.closest('.blk')?.classList.remove('focus'));
        view.append(h('div', { class: 'blk' }, h('label', { class: 'k', for: `b-${key}-${j}` }, labelOf(blk.name)), (t.id = `b-${key}-${j}`, t)));
      }
    });
  } else {
    const t = h('textarea', { class: 'grow mono', 'data-plain': '1', rows: 6, value: item.prompt || '', 'aria-label': 'Prompt' }); t.style.fontSize = '12px';
    t.addEventListener('input', () => grow(t));
    view.append(h('div', { class: 'blk', style: 'grid-template-columns:1fr' }, t), h('p', { class: 'note' }, 'This prompt was written before blocks existed, so it is one piece of text. Regenerate to get named blocks.'));
  }
  view.append(h('div', { class: 'blk neg' }, h('span', { class: 'k' }, 'NEGATIVES'), chipsEditor(item.negatives || [])));
  return view;
}
function sceneCard(sp, i) {
  const b = beat(sp.sceneId);
  const open = state.ui.open[sp.sceneId] ?? i === 0;
  const hasBlocks = !!sp.blocks?.length;
  const body = h('div', { class: 'sbody', hidden: !open });
  const view = blockList(sp, i);
  const plain = h('div', { class: 'plain', hidden: true, tabindex: 0, 'aria-label': 'Prompt as plain text' });
  const chars_ = sp.prompt.length;
  body.append(view, plain,
    h('div', { class: 'eyebrow' }, 'REFERENCES IT WILL ATTACH'), refStrip(sp),
    h('div', { class: 'sfoot' }, h('span', {}, hasBlocks ? 'Dashed blocks come from the script and the chosen sheets. Edit them there and every scene updates.' : ''), h('span', { class: 'mono' }, `${chars_.toLocaleString()} chars${hasBlocks ? ` · ${sp.blocks.length} blocks` : ''}`)));
  const card = h('div', { class: 'card scene', 'data-i': i, 'data-scene': sp.sceneId });
  const toggle = () => {
    const o = body.hidden; body.hidden = !o; state.ui.open[sp.sceneId] = o; state.ui.scene = sp.sceneId;
    tt.setAttribute('aria-expanded', o); if (o) growAll(body);
  };
  const tt = h('button', { class: 'tt', type: 'button', 'aria-expanded': open, onclick: toggle },
    h('b', {}, `${b?.order ?? i + 1} · ${b?.title || sp.sceneId}`),
    h('span', {}, `${b?.era || ''} · ${sp.durationSec} s · `, aspectBit(sp.aspect, 11), ` · audio ${sp.audio ? 'on' : 'off'}${b?.mood ? ` · ${b.mood}` : ''}`));
  const showPlain = state.ui.plain[sp.sceneId];
  const plainBtn = h('button', { class: 'btn sm', type: 'button', 'aria-pressed': !!showPlain, onclick: () => {
    const on = plain.hidden; state.ui.plain[sp.sceneId] = on;
    if (on) { plain.replaceChildren(...withRefChips(livePlain(card, sp))); }
    plain.hidden = !on; view.hidden = on; plainBtn.textContent = on ? 'Back to blocks' : 'View as plain text'; plainBtn.setAttribute('aria-pressed', on); if (!on) growAll(view);
  } }, 'View as plain text');
  if (!hasBlocks) plainBtn.hidden = true;
  const ownBtn = h('button', { class: 'btn sm quiet', type: 'button', title: 'Use as the shot, or as context for this scene. Or drop a picture on this card.', onclick: () => ownPictureModal({ stage: 'scenes', sceneId: sp.sceneId }) }, svg('upload', 14), ' Add your picture');
  const own = sceneOwn(sp);
  card.append(h('div', { class: 'sh' }, tt, styleChip(), staleInfo('scenes') ? statusPill('stale') : null, ownBtn, plainBtn), own, body);
  dropTarget(card, { multiple: false, onFiles: ([f]) => ownPictureModal({ stage: 'scenes', sceneId: sp.sceneId }, f) });
  if (showPlain && hasBlocks) { plain.replaceChildren(...withRefChips(livePlain(card, sp))); plain.hidden = false; view.hidden = true; plainBtn.textContent = 'Back to blocks'; }
  return card;
}
/** The scene's own pictures, always visible: the chosen shot (a keyframe or your picture) and the context thumbnails. */
function sceneOwn(sp) {
  const kf = kfOf(sp.sceneId, 'start'); const o = kfChosen(sp.sceneId);
  const mine = kf && isImportOpt(kf, kf.chosen);
  const shot = o ? h('div', { class: 'ctxstrip shot' },
    h('span', { class: 'eyebrow' }, mine ? 'THE SHOT · YOUR PICTURE' : 'THE SHOT · KEYFRAME'),
    h('div', { class: 'ctxlist' }, h('div', { class: 'ctx wide' }, h('img', { src: mediaUrl(o.path), alt: 'the chosen shot', loading: 'lazy' }),
      h('div', { class: 'ctxacts' }, h('button', { class: 'ib rm', type: 'button', 'aria-label': 'Stop using this as the shot', title: 'Unpick: clips go back to the sheets', onclick: () => unpickKf(kf) }, svg('close', 14))))),
    h('span', { class: 'note' }, 'Clips animate this picture (image to video) with the short motion prompt.')) : null;
  const ctx = ctxStrip({ stage: 'scenes', sceneId: sp.sceneId });
  return shot || ctx ? h('div', { class: 'sown' }, shot, ctx) : null;
}
function livePlain(card, sp) {
  const blocks = sp.blocks.map((blk, j) => { const t = $(`textarea[data-b="${j}"]`, card); return { ...blk, text: t ? t.value : blk.text }; });
  return joinBlocks(blocks, $$('.chip', card).map((c) => c.dataset.v));
}
function scenesBody() {
  const sps = P().scenePrompts;
  if (!sps?.length) return emptyCard('No scene prompts yet', 'Press Write scenes below. Each beat becomes a video prompt in twelve named blocks.');
  const out = h('div', { class: 'stack' }, sps.map(sceneCard));
  if (sps.length > 1) out.prepend(h('div', { class: 'sechead' }, h('span', { class: 'note' }, `${sps.length} scenes · ${sps.reduce((a, s) => a + s.durationSec, 0)} s`),
    h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { const all = sps.some((s) => !(state.ui.open[s.sceneId] ?? s === sps[0])); for (const s of sps) state.ui.open[s.sceneId] = all; render(true); } }, 'Expand or collapse all')));
  return out;
}

// ---------- 6 keyframes: one relit still per beat (optional) ----------
const KF_LOCK_WHERE = { ...LOCK_WHERE, LOOK: ['Look', 'brief'] };
const kfLabel = (n) => (n === 'LIGHT' ? [h('span', { title: 'LIGHT · relit to scene' }, 'LIGHT'), h('span', { class: 'fromstyle' }, '· relit to scene')] : blockLabel(n));
/** Keyframe mutations save pending block edits first, so a click on a picture never throws typed text away. */
async function kfMutate(fn, okMsg) { if (!(await saveIfDirty())) return; await mutate('keyframes', fn, okMsg); }
const chooseKf = (kf, idx) => (kf.chosen === idx ? undefined : kfMutate(() => api(`/projects/${state.slug}/keyframes/choose`, 'POST', { keyframeId: kf.id, index: idx })));
const unpickKf = (kf) => kfMutate(() => api(`/projects/${state.slug}/keyframes/choose`, 'POST', { keyframeId: kf.id, index: null }), 'Unpicked');
function removeKfOption(kf, i, title) {
  if (!confirm(`Remove picture ${i + 1} of ${title}? The file is deleted.`)) return Promise.resolve(false);
  return kfMutate(() => api(`/projects/${state.slug}/keyframes/${encodeURIComponent(kf.id)}/options/remove`, 'POST', { index: i }), 'Picture removed');
}
/** Import a still for a keyframe; the id may name a frame that does not exist yet (the server creates it). */
async function importKf(id, dropped) {
  const file = dropped || await pickFile('image/png,image/jpeg,image/webp');
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { state.errs.keyframes = `${file.name} is over 15 MB`; toast(state.errs.keyframes, true); render(); return; }
  await kfMutate(async () => api(`/projects/${state.slug}/keyframes/${encodeURIComponent(id)}/import`, 'POST', { filename: file.name, dataBase64: await toBase64(file) }), 'Picture added and chosen');
}
/**
 * PATCH scenePrompts stamps "scenes", so a flag flip (endFrame) or a motion edit would mark the steps after it stale even
 * though nothing they were built from changed. After such a save, "keep" the listed steps that only became stale because of it,
 * in stage order (each keep bumps a stamp, so downstream first would re-stale the rest).
 */
async function keepIfNewlyStale(before, stages) {
  for (const st of stages) if (!before[st] && staleInfo(st) && hasContent(st)) await api(`/projects/${state.slug}/keep`, 'POST', { stage: st });
  if (stages.some((st) => !before[st] && staleInfo(st) && hasContent(st))) await loadProject();
}
const staleSnap = () => Object.fromEntries(STEPS.map((s) => [s.id, !!staleInfo(s.id)]));
/** The End frame switch: PATCH scenePrompts with endFrame on that one scene; the server keeps blocks, motion and the rest. */
async function setEndFrame(sceneId, on) {
  const before = staleSnap();
  await kfMutate(async () => {
    const sps = structuredClone(P().scenePrompts || []).map((s) => (s.sceneId === sceneId ? { ...s, endFrame: on } : s));
    await api(`/projects/${state.slug}`, 'PATCH', { scenePrompts: sps });
    await loadProject();
    await keepIfNewlyStale(before, ['keyframes', 'clips', 'export']); // the flag changes no picture or prompt that exists yet
  }, on ? 'End frame on. Generate it in the new row.' : 'End frame off');
}
function openKfLightbox(id, start) {
  const title = () => { const k = keyframes().find((x) => x.id === id); return k ? `${beatNo(k.sceneId)} · ${beatTitle(k.sceneId)} · ${k.role} frame` : id; };
  openOptionsLightbox(start, {
    get: () => keyframes().find((x) => x.id === id), title,
    caption: (k, i) => [title(), k.model === 'import' ? 'import' : k.model === 'alibaba/qwen-image-3/edit' ? 'Qwen Image 3 edit' : k.model, optProv(k, i)].filter(Boolean).join(' · '),
    pick: chooseKf, unpick: unpickKf, remove: (k, i) => removeKfOption(k, i, title()),
  });
}
/** Status word for one frame row. */
function kfStatus(sceneId, kf) {
  const target = (j) => !j.targetId || j.targetId === sceneId || j.targetId === kf?.id;
  if (P().jobs.some((j) => j.stage === 'keyframes' && (j.status === 'running' || j.status === 'queued') && target(j)) || (isRunning('keyframes') && !kf?.options?.length)) return 'generating…';
  if (!kf?.options?.length) return 'empty';
  if (staleInfo('keyframes')) return 'stale';
  return kf.chosen == null ? 'needs you' : 'done';
}
/** One row: scene title, status, actions, two picture cards, the collapsed block editor. role = 'start' | 'end'. */
function kfRow(b, role) {
  const id = b.id; const sp = spOf(id); const kf = kfOf(id, role);
  const key = kfId(id, role); const title = `${b.order} · ${b.title}`; const ttl = `${title} · ${role} frame`;
  const idx = keyframes().indexOf(kf);
  const st = kfStatus(id, kf);
  const aspect = (P().aspect || '16:9').replace(':', '/');
  const both = kfWanted(b).length > 1;
  const regen = priced({ key: `kf-regen-${key}`, label: both ? 'Regenerate both' : 'Regenerate', stage: 'keyframes', opts: { ids: [id], force: true }, cls: 'sm quiet', est: rowEst({ ids: [id], force: true }, 'keyframes'), run: () => runStage('keyframes', { ids: [id], force: true }) });
  const gen = priced({ key: `kf-gen-${key}`, label: 'Generate', stage: 'keyframes', opts: { ids: [id] }, cls: 'sm primary', est: rowEst({ ids: [id] }, 'keyframes'), run: () => runStage('keyframes', { ids: [id] }) });
  const thumbs = h('div', { class: 'thumbs kf' });
  const opts = kf?.options || [];
  opts.forEach((o, i) => {
    const chosen = kf.chosen === i; const src = kf.sources?.[i];
    thumbs.append(optionThumb({
      i, title: ttl, src: o.path ? mediaUrl(o.path) : '', chosen, aspect, badge: src && src.kind !== 'generated' ? src.kind : null,
      open: () => openKfLightbox(kf.id, i), toggle: () => (chosen ? unpickKf(kf) : chooseKf(kf, i)), zoom: () => openKfLightbox(kf.id, i), remove: () => removeKfOption(kf, i, ttl), made: kfMade(kf, i),
    }));
  });
  for (let i = opts.length; i < 2; i++) thumbs.append(h('div', { class: 'thumb ghost' }, h('div', { class: 'shot', style: `aspect-ratio:${aspect}` }, st === 'generating…' ? 'generating…' : 'not made')));
  let editor = null;
  if (kf) {
    const open = !!state.ui.open[`kf:${key}`];
    const body = h('div', { class: 'sbody', hidden: !open }, blockList(kf, key, kfLabel, KF_LOCK_WHERE),
      h('div', { class: 'sfoot' }, h('span', {}, kf.blocks?.length ? 'Dashed blocks come from the script, the sheets and the look. POSE is the frozen instant, mid-action. LIGHT carries the relight clause.' : ''), h('span', { class: 'mono' }, `${(kf.prompt || '').length.toLocaleString()} chars${kf.blocks?.length ? ` · ${kf.blocks.length} blocks` : ''}`)));
    const caret = h('span', { class: 'mono' }, open ? '▾' : '▸');
    const tt = h('button', { class: 'kftoggle', type: 'button', 'aria-expanded': open, onclick: () => { const o = body.hidden; body.hidden = !o; state.ui.open[`kf:${key}`] = o; tt.setAttribute('aria-expanded', o); caret.textContent = o ? '▾' : '▸'; if (o) growAll(body); } },
      caret, ` Prompt · ${kf.blocks?.length ? `${kf.blocks.length} blocks` : 'plain text'} · ${kf.model === 'import' ? 'imported' : kf.model === 'alibaba/qwen-image-3/edit' ? 'Qwen Image 3 edit' : kf.model || ''}`);
    editor = h('div', { class: 'kfed', 'data-k': idx }, tt, body);
  }
  const sw = role === 'start' && sp ? h('label', { class: 'sw', title: 'Also freeze the last instant of the beat. Seedance gets it as the end image.' },
    h('input', { type: 'checkbox', role: 'switch', checked: !!sp.endFrame, 'aria-label': `End frame for scene ${b.order}`, onchange: (e) => setEndFrame(id, e.target.checked) }), 'End frame') : null;
  // Selecting the row drives the right rail. The re-render is deferred a tick: a synchronous rebuild here would detach the
  // End frame checkbox before its change event fires, and the first toggle after a load would be lost.
  return dropTarget(h('section', { class: `kfrow ${role}`, 'data-scene': id, 'aria-label': ttl, onclick: () => { if (state.ui.scene !== id) { state.ui.scene = id; setTimeout(render, 0); } } },
    h('div', { class: 'kfhead' },
      h('div', { class: 't' }, h('b', {}, title), h('span', { class: 'note' }, `${role === 'end' ? 'end frame · last instant' : 'start frame'}${sp ? ` · ${sp.durationSec} s` : ''}${b.era ? ` · ${b.era}` : ''}`), statusPill(st)),
      h('div', { class: 'acts' },
        kf?.options?.length ? regen : gen,
        h('button', { class: 'btn sm quiet', type: 'button', onclick: () => importKf(key), title: 'Or drop a picture on this row' }, 'Import picture…'),
        sw)),
    thumbs, editor,
    !kf ? h('p', { class: 'note' }, role === 'end' ? 'No end frame yet. Generate writes its prompt and two stills of the last instant.' : 'No keyframe yet. Generate writes the still prompt and two pictures from the chosen sheets, or import a picture of your own.') : null), { multiple: false, onFiles: ([f]) => importKf(key, f) });
}
function keyframesBody() {
  const bs = kfBeats();
  if (!bs.length) return emptyCard('Nothing to freeze yet', 'Write the scene prompts first. Then every beat gets one still, lit by its scene, before any video is paid for. This step can be skipped.');
  const out = h('div', { class: 'stack' });
  if (!keyframes().length) out.append(h('div', { class: 'phase' }, h('div', { class: 'phasehead' }, h('b', {}, 'No keyframes yet'),
    h('span', { class: 'note' }, `Generate ${plural(kfMissingFrames().length, 'keyframe')} below: the language model writes one still prompt per beat, then Qwen Image 3 edits the chosen sheets into two pictures of each, relit to the scene.`))));
  for (const b of bs) {
    out.append(kfRow(b, 'start'));
    if (spOf(b.id)?.endFrame) out.append(kfRow(b, 'end'));
  }
  return out;
}

// ---------- 7 clips: film strip + scene table + drawer ----------
const videoThumb = (clip, stale) => (clip?.file ? h('video', { class: `frame ${stale ? 'stale' : ''}`, muted: true, preload: 'metadata', src: `${mediaUrl(clip.file.path)}#t=0.1`, 'aria-hidden': 'true' }) : h('div', { class: 'frame empty' }));
/** Estimate for one scene's clip. Uses the all-scenes estimate; if that fails (one bad scene fails them all) asks scene by scene. */
function sceneEst(tier, id) {
  const e = want('clips', tier === 'draft' ? { tier } : { tier, force: true });
  if (!e) return undefined;
  if (!e.error) { const it = e.items.find((x) => x.id === id); return it ? { usd: it.usd, model: it.model } : { error: 'no price for this scene' }; }
  return want('clips', tier === 'draft' ? { tier, ids: [id] } : { tier, ids: [id], force: true });
}
const scenePrice = (tier, id) => { const e = sceneEst(tier, id); return e && !e.error ? e.usd : undefined; };
/** Price of a whole action. Clips are summed per scene so one unpicked asset does not hide every price. */
function actionEst(a) {
  if (a.stage === 'clips' && a.opts.ids) {
    const es = a.opts.ids.map((id) => sceneEst(a.opts.tier || 'draft', id));
    if (es.some((x) => !x)) return undefined;
    const bad = es.find((x) => x.error);
    return bad ? { error: bad.error } : { usd: Math.round(es.reduce((t, x) => t + x.usd, 0) * 1000) / 1000, items: a.opts.ids.map((id, i) => ({ id, model: es[i].model || (kfChosen(id) ? SEEDANCE_I2V : 'bytedance/seedance-2.5/reference-to-video'), usd: es[i].usd })) };
  }
  return want(a.stage, a.opts, a.debounce || 0);
}
function clipsBody() {
  const sps = P().scenePrompts;
  if (!sps?.length) return emptyCard('Nothing to shoot yet', 'Write the scene prompts first. Then every scene gets a cheap 480p draft before you spend on a final.');
  const sel = state.ui.sel;
  const staleFrom = P().stamps?.scenes;
  const totalSec = sps.reduce((a, s) => a + s.durationSec, 0);
  const approvedIds = sps.filter((s) => sceneApproved(s.sceneId));
  // One-take clips span the beats they cover (one tile); everything else is one tile per scene.
  const tiles = []; const covered = new Set();
  const seqAt = (sceneId) => { const list = seqClips().filter((c) => c.status === 'done' && (c.sceneIds || [])[0] === sceneId); return list.find((c) => c.approved) || list[0]; };
  sps.forEach((s, i) => {
    if (covered.has(s.sceneId)) return;
    const seq = seqAt(s.sceneId);
    const ids = seq ? (seq.sceneIds || []) : [];
    const consecutive = ids.length > 1 && ids.every((x, k) => sps[i + k]?.sceneId === x);
    if (seq && consecutive && (seq.approved || !ids.some((x) => clipsOf(x).some((c) => c.approved)))) {
      for (const x of ids) covered.add(x);
      const secs = ids.reduce((a, x) => a + (spOf(x)?.durationSec || 0), 0);
      tiles.push(h('button', { class: `cell seq ${seq.approved ? 'ok' : 'draft'}`, style: `grid-column:span ${ids.length}`, type: 'button', title: `One take, scenes ${beatNo(ids[0])}–${beatNo(ids.at(-1))}`, 'aria-label': `Scenes ${beatNo(ids[0])} to ${beatNo(ids.at(-1))}, one take, ${seq.approved ? 'approved' : 'draft'}`, onclick: () => openClipDrawer(ids[0]) },
        `Scenes ${beatNo(ids[0])}–${beatNo(ids.at(-1))} · one take · ${secs}s${seq.approved ? ' ✓' : ''}`));
      return;
    }
    const ok = clipsOf(s.sceneId).some((c) => c.approved); const dr = !!bestClip(s.sceneId);
    tiles.push(h('button', { class: `cell ${ok ? 'ok' : dr ? 'draft' : 'none'}`, type: 'button', title: beatTitle(s.sceneId), 'aria-label': `Scene ${beatNo(s.sceneId)}, ${ok ? 'approved' : dr ? 'draft' : 'empty'}`, onclick: () => openClipDrawer(s.sceneId) }, `${beatNo(s.sceneId)} · ${s.durationSec}s${ok ? ' ✓' : ''}`));
  });
  const strip = h('div', { class: 'strip', style: `grid-template-columns:${sps.map((s) => `${s.durationSec}fr`).join(' ')}` }, tiles);
  const withoutDraft = sps.filter((s) => !clipsOf(s.sceneId, 'draft').some((c) => c.status === 'done'));
  const shown = state.ui.filter ? sps.filter((s) => !sceneApproved(s.sceneId)) : sps;
  const rows = shown.map((sp) => clipRow(sp, staleFrom));
  const selIds = sps.filter((s) => sel[s.sceneId]).map((s) => s.sceneId);
  const selSum = selIds.reduce((a, id) => a + (scenePrice('draft', id) ?? 0), 0);
  const known = selIds.every((id) => scenePrice('draft', id) != null);
  const bulkEst = { usd: Math.round(selSum * 1000) / 1000 };
  const over = overBy(bulkEst.usd);
  // One take: the selected beats must be next to each other in order. Duration is the sum, clamped to Seedance's 4–30 s.
  const selPos = selIds.map((id) => sps.findIndex((s) => s.sceneId === id)).sort((a, b) => a - b);
  const adjacent = selPos.length >= 2 && selPos.every((v, i) => i === 0 || v === selPos[i - 1] + 1);
  const seqSecs = Math.min(30, Math.max(4, selIds.reduce((a, id) => a + (spOf(id)?.durationSec || 0), 0)));
  const seqOpts = { tier: 'draft', ids: selIds, sequence: true };
  const seqBtn = adjacent
    ? priced({ key: 'bulk-seq', label: `One take: ${selIds.length} scenes in one clip · ${seqSecs} s`, stage: 'clips', opts: seqOpts, run: () => { state.ui.sel = {}; runStage('clips', seqOpts); } })
    : h('button', { class: 'btn', type: 'button', disabled: true, title: 'Select two or more scenes that follow each other' }, `One take: ${selIds.length} scenes in one clip`, h('span', { class: 'why' }, selIds.length >= 2 ? 'scenes must follow each other' : 'select 2+ scenes in a row'));
  return h('div', { class: 'stack' },
    !P().clips.length ? stepCards([
      ['checklist', 'Pick scenes', 'Tick the rows to shoot, or "Select all without a draft".'],
      ['tag', 'Check the price', 'Every button shows its $ first. Open a row to change length, quality and audio.'],
      ['film', 'Generate drafts', 'Cheap 480p drafts. Approve the ones you like, then render finals.'],
    ]) : null,
    h('div', { class: 'film' }, h('div', { class: 'sechead' }, h('div', { class: 'eyebrow' }, 'FILM STRIP · APPROVED CUT'), h('span', { class: 'note' }, `${approvedIds.length} of ${sps.length} scenes approved · ${approvedIds.reduce((a, s) => a + s.durationSec, 0)} s of ${totalSec} s`)), strip),
    h('div', { class: 'toolbar' },
      h('label', {}, h('input', { type: 'checkbox', checked: withoutDraft.length > 0 && withoutDraft.every((s) => sel[s.sceneId]), disabled: !withoutDraft.length, onchange: (e) => { for (const s of withoutDraft) sel[s.sceneId] = e.target.checked; render(); } }), 'Select all without a draft'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn sm', type: 'button', 'aria-pressed': state.ui.filter, onclick: () => { state.ui.filter = !state.ui.filter; render(); } }, state.ui.filter ? 'Showing: needs attention' : 'Filter: needs attention')),
    h('div', { class: 'table', role: 'table', 'aria-label': 'Scenes' },
      h('div', { class: 'tr head', role: 'row' }, h('span', { class: 'c-chk' }), h('span', { class: 'c-sc' }, 'Scene'), h('span', { class: 'c-refs' }, 'Refs'), h('span', { class: 'c-src' }, 'Source'), h('span', { class: 'c-pr' }, 'Prompt'), h('span', { class: 'c-draft' }, 'Draft 480p'), h('span', { class: 'c-final' }, 'Final 720p'), h('span', { class: 'c-appr' }, 'Approve')),
      rows.length ? rows : h('div', { class: 'tr', style: 'display:block;cursor:default' }, 'Every scene is approved.'),
      h('div', { class: 'bulk' },
        h('span', { class: 'note', style: 'font-size:13px' }, `${plural(selIds.length, 'scene')} selected`), h('div', { class: 'grow' }),
        over > 0 ? h('span', { class: 'msg' }, `Over the sitting cap by ${usd(over)}. Raise it or pick fewer.`) : null,
        selIds.length
          ? priced({ key: 'bulk-drafts', label: `Generate ${plural(selIds.length, 'draft')}`, stage: 'clips', opts: { tier: 'draft', ids: selIds }, est: known ? bulkEst : { error: 'price unavailable' }, cls: 'primary', run: () => { state.ui.sel = {}; runStage('clips', { tier: 'draft', ids: selIds }); } })
          : h('button', { class: 'btn', type: 'button', disabled: true }, 'Generate drafts · ', h('span', { class: 'price' }, '$0.00'), h('span', { class: 'why' }, 'select scenes first')),
        seqBtn),
      adjacent ? h('div', { class: 'bulk note', style: 'padding-top:0' }, 'One take: one Seedance clip with hard cuts inside it, every chosen start keyframe and the sheets as references. Approve it and the beats it covers are cut as one piece.') : null));
}
function clipRow(sp, staleFrom) {
  const id = sp.sceneId; const b = beat(id);
  const draft = clipsOf(id, 'draft').find((c) => c.status === 'done'); const final = clipsOf(id, 'final').find((c) => c.status === 'done');
  const best = final || draft;
  const draftStale = !!(draft && staleFrom && draft.createdAt < staleFrom);
  const dP = scenePrice('draft', id); const fP = scenePrice('final', id);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };
  const miniBtn = (label, stage, opts, price, key, dis, why) => priced({ key, label, stage, opts, est: price != null ? { usd: price } : { error: 'x' }, cls: 'sm', disabled: dis, why, run: () => runStage(stage, opts) });
  const blocksN = sp.blocks?.length;
  const dCell = h('div', { class: 'cellc c-draft', onclick: (e) => e.stopPropagation() }, videoThumb(draft, draftStale),
    draft ? (draftStale ? miniBtn('Redo', 'clips', { tier: 'draft', ids: [id] }, dP, `redo-${id}`) : h('span', { class: 'mini' }, draft.costUsd != null ? usd(draft.costUsd) : '')) : miniBtn('Draft', 'clips', { tier: 'draft', ids: [id] }, dP, `draft-${id}`));
  const fCell = h('div', { class: 'cellc c-final', onclick: (e) => e.stopPropagation() }, videoThumb(final),
    final ? h('span', { class: 'mini' }, final.costUsd != null ? usd(final.costUsd) : '')
      : miniBtn('Final', 'clips', { tier: 'final', ids: [id] }, fP, `final-${id}`, !(draft && draft.approved), 'approve the draft first'));
  const seqs = seqCovering(id).filter((c) => c.status === 'done'); const seqA = seqs.find((c) => c.approved);
  const appr = seqA && !best?.approved ? h('button', { class: 'pill s-approved', type: 'button', style: 'border:0;cursor:pointer;min-height:32px', title: 'Approved as part of a one-take clip. Click to remove that approval.', 'aria-label': `Scene ${b?.order} approved in a one take, click to remove approval`, onclick: stop(() => approveClip(seqA.id, false)) }, 'approved', h('span', { class: 'mini', style: 'color:inherit' }, '· one take'))
    : best ? (best.approved ? h('button', { class: 'pill s-approved', type: 'button', style: 'border:0;cursor:pointer;min-height:32px', 'aria-label': `Scene ${b?.order} approved, click to remove approval`, onclick: stop(() => approveClip(best.id, false)) }, 'approved')
    : h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;min-height:44px', onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', onchange: (e) => approveClip(best.id, e.target.checked), 'aria-label': `Approve scene ${b?.order}` }), 'approve'))
    : seqs[0] ? h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;min-height:44px', onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', onchange: (e) => approveClip(seqs[0].id, e.target.checked), 'aria-label': `Approve the one take covering scene ${b?.order}` }), 'approve one take')
    : statusPill('empty');
  const kfo = kfChosen(id);
  const srcCell = h('div', { class: 'c-src', title: kfo ? 'Next run: Seedance image-to-video from the chosen start keyframe; the still carries the identity.' : 'Next run: Seedance reference-to-video from the chosen sheets.' },
    kfo ? [h('img', { class: 'frame', src: mediaUrl(kfo.path), alt: 'chosen start keyframe', loading: 'lazy' }), h('span', { class: 'mini' }, 'keyframe')] : h('span', { class: 'mini' }, 'sheets'));
  return h('div', { class: `tr ${state.ui.sel[id] ? 'sel' : ''}`, role: 'row', tabindex: 0, 'aria-current': state.ui.drawer?.sceneId === id ? 'true' : null,
    onclick: () => openClipDrawer(id), onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openClipDrawer(id); } },
    h('div', { class: 'c-chk', onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', checked: !!state.ui.sel[id], 'aria-label': `Select scene ${b?.order}`, onchange: (e) => { state.ui.sel[id] = e.target.checked; render(); } })),
    h('div', { class: 'c-sc' }, h('b', {}, `${b?.order ?? ''} · ${b?.title || id}`), h('span', { class: b?.mood && /core|heart/i.test(b.mood) ? 'core' : '' }, `${b?.era || ''} · ${sp.durationSec} s · ${(b?.cameraSimple || '').split(',')[0]}`)),
    h('div', { class: 'c-refs refcell' }, h('div', { class: 'avs' }, sp.refAssetIds.map((rid) => { const o = chosenOpt(asset(rid)); return o ? h('img', { src: mediaUrl(o.path), alt: '', loading: 'lazy' }) : h('i'); })),
      h('span', { class: 'mini', title: `Refs ${sp.refAssetIds.length} of ${REF_LIMIT}` }, `${sp.refAssetIds.length}/${REF_LIMIT}`)),
    srcCell,
    h('div', { class: 'c-pr' }, h('span', { class: 't' }, effectiveMode(id) === 'short' ? (sp.motion || shortFallback(sp) || sp.prompt) : sp.prompt),
      draftStale ? h('span', { class: 'm warn' }, 'prompt edited after draft')
        : h('span', { class: 'm' }, effectiveMode(id) === 'short' ? `short · motion only · ${(sp.motion || shortFallback(sp)).length.toLocaleString()} chars${sp.motion ? '' : ' · fallback from the blocks'}` : `full · ${blocksN ? `${blocksN} blocks · ` : ''}${plural(sp.negatives.length, 'negative')} · ${sp.prompt.length.toLocaleString()} chars`)),
    dCell, fCell, h('div', { class: 'c-appr' }, appr));
}
/**
 * Duration / audio from the drawer chips: PATCH scenePrompts after 600 ms of quiet. The server stamps only `keyframes` for these
 * fields, so scenes and keyframes stay fresh; clips made with the old value read as stale, which is right.
 */
const sceneTimers = {};
function setSceneField(sceneId, patch) {
  state.ui.scenePatch = { ...state.ui.scenePatch, [sceneId]: { ...state.ui.scenePatch?.[sceneId], ...patch } };
  state.ui.confirm = null; render();
  clearTimeout(sceneTimers[sceneId]);
  sceneTimers[sceneId] = setTimeout(async () => {
    const pend = state.ui.scenePatch?.[sceneId];
    if (!pend) return;
    await attempt('clips', async () => {
      const sps = structuredClone(P().scenePrompts || []).map((s) => (s.sceneId === sceneId ? { ...s, ...pend } : s));
      try { await api(`/projects/${state.slug}`, 'PATCH', { scenePrompts: sps }); await loadProject(); }
      finally { const { [sceneId]: _, ...rest } = state.ui.scenePatch || {}; state.ui.scenePatch = rest; }
      const said = [pend.durationSec != null ? `${pend.durationSec} s` : null, 'audio' in pend ? `audio ${pend.audio ? 'on' : 'off'}` : null].filter(Boolean).join(' · ');
      toast(`Scene ${beatNo(sceneId)} · ${said} · re-priced`); render();
    });
  }, 600);
}
function approveClip(clipId, approved) {
  mutate('clips', () => api(`/projects/${state.slug}/approve`, 'POST', { clipId, approved }));
}
/** Save the short-mode motion text for one scene. PATCH scenePrompts keeps the rest of the scene as it is. */
async function saveMotion(sceneId, text) {
  await attempt('clips', async () => {
    const before = staleSnap();
    const sps = structuredClone(P().scenePrompts || []).map((s) => (s.sceneId === sceneId ? { ...s, motion: text } : s));
    await api(`/projects/${state.slug}`, 'PATCH', { scenePrompts: sps });
    state.ui.motionDraft = null; await loadProject();
    await keepIfNewlyStale(before, ['keyframes']); // motion text is not used by the stills; clips do go stale, as they should
    toast('Motion prompt saved'); state.sig.drawer = null; render();
  });
}
const promptSent = (c) => (c.prompt ? h('details', { class: 'sent' }, h('summary', {}, `Prompt sent · ${stripRefTags(c.prompt).length.toLocaleString()} chars`), h('div', { class: 'plain' }, stripRefTags(c.prompt))) : null);
function openClipDrawer(sceneId) { state.ui.drawer = { type: 'clip', sceneId }; state.ui.scene = sceneId; render(); }

// ---------- 7 export ----------
function exportBody() {
  const p = P();
  const sps = p.scenePrompts || [];
  const items = sps.map((s) => ({ s, clip: clipsOf(s.sceneId, 'final').find((c) => c.approved && c.status === 'done') || clipsOf(s.sceneId, 'draft').find((c) => c.approved && c.status === 'done') })).filter((x) => x.clip);
  const res = chipSelect({ key: 'export-res', id: 'res', title: 'Export resolution', value: state.ui.exportRes, cls: 'block', icon: () => svg('monitor', 16, 'currentColor', 1.8),
    options: [{ value: '1080p', label: '1080p', hint: 'fast, free', price: '$0.00', tag: 'Recommended', glyph: () => svg('monitor', 18, 'currentColor', 1.7) }, { value: '4k', label: '4K', short: '4K (upscaled)', hint: 'upscaled + light grain, free', price: '$0.00', glyph: () => svg('monitor', 18, 'currentColor', 2.4) }],
    onChange: (v) => { state.ui.exportRes = v; render(); } });
  const music = p.brief.refs.find((r) => r.role === 'music');
  const out = h('div', { class: 'stack' },
    h('div', { class: 'group' }, h('h2', { class: 'h2' }, 'Settings'),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('span', {}, 'Resolution'), res),
        h('div', { class: 'field' }, h('span', {}, 'Music'), h('div', { style: 'min-height:40px;display:flex;align-items:center;color:var(--text)' }, music ? (music.note || fileName(music.path)) : p.brief.musicPath ? fileName(p.brief.musicPath) : 'None. Add a music reference in the Brief step.'))),
      h('p', { class: 'note' }, 'Seedance 2.5 renders at 720p at most. 1080p scales the finals up; 4K adds light grain.')),
    h('div', { class: 'group' }, h('h2', { class: 'h2' }, `In the cut · ${items.length} ${items.length === 1 ? 'scene' : 'scenes'}`),
      items.length ? items.map(({ s, clip }) => h('div', { class: 'cast' }, videoThumb(clip), h('div', {}, h('b', {}, `${beatNo(s.sceneId)} · ${beatTitle(s.sceneId)}`), clipMade(clip))))
        : h('p', { class: 'note' }, 'No approved clips yet. Approve a draft or final in the Clips step.')),
    h('div', { class: 'group' }, h('h2', { class: 'h2' }, 'Exports'),
      p.exports.length ? p.exports.slice().reverse().map((x) => h('div', { class: 'stack', style: 'gap:8px' },
        x.file?.path ? h('video', { class: 'player', controls: true, preload: 'metadata', src: mediaUrl(x.file.path) }) : null,
        h('div', { class: 'sechead' }, h('span', { class: 'mono note' }, `${x.resolution} · ${plural(x.sceneOrder.length, 'scene')} · ${x.createdAt.slice(0, 16).replace('T', ' ')}`),
          x.file?.path ? h('a', { class: 'btn sm', href: mediaUrl(x.file.path), download: '' }, 'Download') : null)))
        : h('p', { class: 'note' }, 'Nothing exported yet. Press Export below.')));
  return out;
}

// ---------- drawers ----------
function drawerShell(type, label, nodes) {
  const host = h('div', { id: 'drawerhost', 'data-t': type },
    h('div', { class: 'scrim', onclick: () => closeDrawer() }),
    h('aside', { class: 'drawer', role: 'dialog', 'aria-label': label },
      h('header', {}, h('div', { class: 'eyebrow' }, label.toUpperCase()), h('button', { class: 'btn quiet iconbtn', id: 'drawerclose', type: 'button', 'aria-label': 'Close', onclick: () => closeDrawer() }, svg('close', 18))),
      nodes));
  $('#overlay').append(host);
  return host;
}
function paintDrawer(base) {
  const d = state.ui.drawer; const host = $('#drawerhost');
  if (!d) { host?.remove(); return; }
  if (d.type === 'library') {
    if (!host || host.dataset.t !== 'library') { host?.remove(); buildLibShell(); loadLib(); $('#drawerclose')?.focus(); } else fillLib();
    return;
  }
  if (host && host.dataset.t === 'clip' && state.sig.drawer === base + d.sceneId) return;
  state.sig.drawer = base + d.sceneId;
  const fresh = !host;
  const top = $('.drawer', host || document)?.scrollTop || 0;
  // A rebuild (a price arrived, a chip changed) must not throw keyboard focus to the body: remember the control and refocus it.
  const ae = host?.contains(document.activeElement) ? document.activeElement : null;
  const fk = ae ? (ae.dataset.cs ? `[data-cs="${ae.dataset.cs}"]` : ae.getAttribute('aria-label') ? `[aria-label="${CSS.escape(ae.getAttribute('aria-label'))}"]` : null) : null;
  host?.remove(); buildClipDrawer(d.sceneId);
  if (!fresh) { const dr = $('.drawer'); if (dr) dr.scrollTop = top; }
  if (fresh) $('#drawerclose')?.focus();
  else if (fk) $(`#drawerhost ${fk}`)?.focus({ preventScroll: true });
}
function closeDrawer(silent) {
  if (!state.ui.drawer) return;
  state.ui.drawer = null; state.sig.drawer = null; $('#drawerhost')?.remove();
  if (!silent) render();
}

function buildClipDrawer(sceneId) {
  const sp = P().scenePrompts?.find((x) => x.sceneId === sceneId);
  if (!sp) { closeDrawer(true); return; }
  const b = beat(sceneId);
  const draft = clipsOf(sceneId, 'draft').find((c) => c.status === 'done'); const final = clipsOf(sceneId, 'final').find((c) => c.status === 'done');
  const dP = scenePrice('draft', sceneId); const fP = scenePrice('final', sceneId);
  const staleFrom = P().stamps?.scenes; const draftStale = !!(draft && staleFrom && draft.createdAt < staleFrom);
  const player = (clip, none, stale) => (clip?.file ? h('video', { class: `player ${stale ? 'stale' : ''}`, controls: true, preload: 'metadata', src: mediaUrl(clip.file.path) }) : h('div', { class: 'player none' }, none));
  const approveRow = (clip) => (clip ? h('div', { class: 'sechead' }, clipMade(clip),
    h('label', { style: 'display:flex;gap:8px;align-items:center;min-height:44px;font-size:13px' }, h('input', { type: 'checkbox', checked: clip.approved, onchange: (e) => approveClip(clip.id, e.target.checked) }), 'approve')) : null);
  const sum = sp.blocks?.length
    ? sp.blocks.map((blk) => h('div', {}, h('span', { class: 'k' }, blk.name), h('span', { class: 'v' }, (blk.name === 'NEGATIVES' ? sp.negatives.join(', ') : refPlain(blk.text)).slice(0, 180), blk.locked ? h('span', { class: 'pill tiny cap', style: 'margin-left:6px' }, 'locked') : null)))
    : h('div', {}, h('span', { class: 'k' }, 'PROMPT'), h('span', { class: 'v' }, refPlain(sp.prompt).slice(0, 400)));
  // What the next run will send: source (keyframe or sheets) and the prompt text in the effective mode.
  const kfo = kfChosen(sceneId); const kfe = kfChosen(sceneId, 'end');
  const mode = effectiveMode(sceneId);
  const source = h('div', { class: 'srcline' },
    kfo ? h('img', { class: 'frame', src: mediaUrl(kfo.path), alt: 'start keyframe' }) : null,
    kfe ? h('img', { class: 'frame', src: mediaUrl(kfe.path), alt: 'end keyframe' }) : null,
    h('span', { class: 'note' }, kfo ? `from keyframe · ${MODEL_NAMES[SEEDANCE_I2V]}${kfe ? ' · with an end frame' : ''}. The still carries the face, the light and the framing.` : 'from sheets · Seedance 2.5 reference-to-video with the chosen sheets attached. Freeze a keyframe in the step before to lock the face first.'));
  let promptNode;
  if (mode === 'short') {
    const draftText = state.ui.motionDraft?.sceneId === sceneId ? state.ui.motionDraft.text : (sp.motion || '');
    const ta = h('textarea', { class: 'mono', rows: 5, 'aria-label': 'Motion prompt', placeholder: 'What the body does, what the camera does as movement words, the sound if any. 2–3 sentences. No appearance, no wardrobe, no location.', value: draftText });
    const save = h('button', { class: 'btn sm', type: 'button', disabled: draftText === (sp.motion || ''), onclick: () => saveMotion(sceneId, ta.value.trim()) }, 'Save motion');
    ta.addEventListener('input', () => { state.ui.motionDraft = { sceneId, text: ta.value }; save.disabled = ta.value.trim() === (sp.motion || ''); });
    const fb = shortFallback(sp);
    promptNode = h('div', { class: 'motion' }, ta,
      h('div', { class: 'sechead' }, h('span', { class: 'mono note' }, `${draftText.length.toLocaleString()} chars · target 150–450`), save),
      !sp.motion && !draftText ? h('div', { class: 'stack', style: 'gap:6px' }, h('p', { class: 'note' }, 'No motion text was written for this scene, so the server sends this fallback (SHOT, PERFORM, PHYSICS and the motion negatives). Type your own above, or regenerate Scenes.'), fb ? h('div', { class: 'plain' }, fb) : null) : null);
  } else promptNode = h('div', { class: 'bsum' }, sum);
  const seqs = seqCovering(sceneId).filter((c) => c.status === 'done');
  const seqNodes = seqs.length ? [h('div', { class: 'eyebrow' }, `ONE TAKE · SCENES ${beatNo(seqs[0].sceneIds[0])}–${beatNo(seqs[0].sceneIds.at(-1))}`),
    ...seqs.slice(0, 2).map((c) => h('div', { class: 'stack', style: 'gap:8px' }, player(c, 'not rendered'),
      h('div', { class: 'sechead' }, clipMade(c),
        h('label', { style: 'display:flex;gap:8px;align-items:center;min-height:44px;font-size:13px' }, h('input', { type: 'checkbox', checked: c.approved, onchange: (e) => approveClip(c.id, e.target.checked) }), 'approve')), promptSent(c)))] : [];
  // Settings chips (the Higgsfield pattern): every change re-prices the Generate button below.
  const canFinal = !!(draft && draft.approved);
  const tier = state.ui.tier?.[sceneId] === 'final' && canFinal ? 'final' : 'draft';
  const pend = state.ui.scenePatch?.[sceneId];
  const dur = pend?.durationSec ?? sp.durationSec; const audioOn = pend && 'audio' in pend ? pend.audio : !!sp.audio;
  const ic = (n) => () => svg(n, 15, 'currentColor', 1.8);
  const settings = h('div', { class: 'csrow', role: 'group', 'aria-label': 'Clip settings' },
    chipStepper({ label: 'duration', value: dur, min: 4, max: 10, unit: ' s', icon: ic('clock'), onChange: (n) => setSceneField(sceneId, { durationSec: n }) }),
    chipRO(() => aspectGlyph(P().aspect, 16), P().aspect, 'Aspect is fixed when the project is made'),
    chipSelect({ key: `cl-tier-${sceneId}`, title: 'Quality', value: tier, icon: ic('diamond'), sub: (o) => o?.price, subCls: 'price', options: [
      { value: 'draft', label: 'Draft 480p', short: 'Draft 480p', hint: 'cheap look first; silent', glyph: () => svg('diamond', 16, 'currentColor', 1.8), price: pend ? '$…' : dP != null ? usd(dP) : '$…' },
      { value: 'final', label: 'Final 720p', short: 'Final 720p', glyph: () => svg('diamond', 16, 'var(--ember)', 2.2), hint: 'a fresh render, not an upscale; no seed', price: pend ? '$…' : fP != null ? usd(fP) : '$…', disabled: !canFinal, reason: 'approve the draft first' }],
      onChange: (v) => { state.ui.tier = { ...state.ui.tier, [sceneId]: v }; state.ui.confirm = null; render(); } }),
    chipSelect({ key: `cl-audio-${sceneId}`, title: 'Audio', value: audioOn ? 'on' : 'off', options: [
      { value: 'on', label: 'Audio on', short: 'Audio on', hint: 'finals only; drafts are silent', glyph: () => svg('speaker', 18, 'currentColor', 1.8) },
      { value: 'off', label: 'Audio off', short: 'Audio off', hint: 'silent clip; music is added at export', glyph: () => svg('mute', 18, 'currentColor', 1.8) }],
      onChange: (v) => setSceneField(sceneId, { audio: v === 'on' }) }),
    chipSelect({ key: `cl-src-${sceneId}`, title: 'Source', value: kfo ? 'keyframe' : 'sheets', options: [
      { value: 'keyframe', label: 'From keyframe', hint: 'image-to-video from the chosen still; keeps the face', glyph: () => svg('image', 18, 'currentColor', 1.8), disabled: !kfo, reason: 'no chosen start keyframe: freeze one in Keyframes' },
      { value: 'sheets', label: 'From sheets', hint: 'reference-to-video with the chosen sheets', glyph: () => svg('layers', 18, 'currentColor', 1.8), disabled: !!kfo, reason: 'a chosen keyframe wins: unpick it in Keyframes to shoot from the sheets' }] }),
    chipSelect({ key: 'cl-mode', title: 'Video prompt', value: state.ui.promptMode || 'auto', icon: ic('text'), options: [
      { value: 'auto', label: 'Auto', short: `Auto · ${mode}`, hint: 'short with a chosen keyframe, full without' },
      { value: 'short', label: 'Short — motion only', short: 'Short', hint: '150–450 chars; the still already fixed the look' },
      { value: 'full', label: 'Full — every block', short: 'Full', hint: 'every block; best when shooting from the sheets' }],
      onChange: (v) => { state.ui.promptMode = v === 'auto' ? null : v; state.ui.confirm = null; render(); } }));
  const tierP = tier === 'draft' ? dP : fP;
  const genBtn = priced({ key: `dr-gen-${sceneId}`, label: tier === 'draft' ? (draft ? 'Redo draft' : 'Generate draft') : (final ? 'Render final again' : 'Render final 720p'), stage: 'clips', opts: { tier, ids: [sceneId] },
    est: pend ? undefined : tierP != null ? { usd: tierP } : { error: 'x' }, cls: 'primary', run: () => runStage('clips', { tier, ids: [sceneId] }) });
  const nodes = [
    h('div', { class: 'sechead' }, h('div', { class: 'intro' }, h('h2', { class: 'h2' }, `${b?.order ?? ''} · ${b?.title || sceneId}`), h('span', { class: 'note' }, `${b?.era || ''} · ${dur} s · `, aspectBit(P().aspect, 12))),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { state.ui.open[sceneId] = true; closeDrawer(true); go('scenes'); } }, 'Open editor')),
    h('div', { class: 'eyebrow' }, 'SETTINGS · NEXT RUN'), settings, genBtn,
    pend ? h('p', { class: 'note' }, 'Saving and re-pricing…') : null,
    h('div', { class: 'eyebrow' }, 'SOURCE · NEXT RUN'), source,
    h('div', { class: 'eyebrow' }, `PROMPT IT WILL SEND · ${mode.toUpperCase()}${state.ui.promptMode ? '' : ' (default)'}`), promptNode,
    ...seqNodes,
    h('div', { class: 'eyebrow' }, draftStale ? 'DRAFT · 480P · MADE FROM THE OLD PROMPT' : 'DRAFT · 480P'), player(draft, 'no draft yet', draftStale), approveRow(draft),
    // Higgsfield's "GENERATE 1080P" on a draft: the next step sits right under the approved draft.
    draft?.approved && !final && tier === 'draft' ? priced({ key: `dr-final-${sceneId}`, label: 'Render final 720p', stage: 'clips', opts: { tier: 'final', ids: [sceneId] }, est: pend ? undefined : fP != null ? { usd: fP } : { error: 'x' }, cls: 'sm', run: () => runStage('clips', { tier: 'final', ids: [sceneId] }) }) : null,
    draft ? promptSent(draft) : null,
    h('div', { class: 'eyebrow' }, 'FINAL · 720P'), player(final, draft?.approved ? 'not rendered yet' : 'needs an approved draft'), approveRow(final), final ? promptSent(final) : null,
    h('p', { class: 'note' }, 'A final is a fresh 720p render with the same prompt and references. Seedance 2.5 has no seed, so it will not match the draft exactly.'),
    mode === 'short' ? h('div', { class: 'eyebrow' }, 'FULL PROMPT BY BLOCK · NOT SENT IN SHORT MODE') : null, mode === 'short' ? h('div', { class: 'bsum' }, sum) : null,
    h('div', { class: 'eyebrow' }, kfo ? 'REFERENCES · SHEETS (ONE TAKE ONLY)' : 'REFERENCES'), refStrip(sp),
  ];
  drawerShell('clip', `Scene ${b?.order ?? ''}`, nodes);
}

// ---------- library ----------
function openLibrary(cfg) {
  state.ui.drawer = { type: 'library', mode: cfg.mode, kind: cfg.kind, tab: cfg.mode === 'adopt' ? cfg.kind : cfg.kind, q: '', assetId: cfg.assetId, charId: cfg.charId };
  state.lib = { entries: [], loading: true, err: '' };
  state.sig.drawer = null; render();
}
let libTimer; let libSeq = 0;
function buildLibShell() {
  const d = state.ui.drawer; const fixed = d.mode !== 'adopt';
  const title = d.mode === 'swap' ? 'Use a picture from the library' : d.mode === 'replace' ? 'Replace from library' : 'Library';
  const search = h('input', { type: 'search', id: 'libq', 'aria-label': 'Search the library', placeholder: 'Search characters and places', value: d.q });
  search.addEventListener('input', () => { d.q = search.value; clearTimeout(libTimer); libTimer = setTimeout(loadLib, 300); });
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Kind' }, [['', 'All'], ['character', 'Characters'], ['location', 'Locations']].map(([k, l]) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': (d.tab || '') === k, onclick: () => { d.tab = k; for (const b of $$('.tabs button')) b.setAttribute('aria-selected', b.dataset.k === k); loadLib(); }, 'data-k': k }, l)));
  drawerShell('library', title, [fixed ? h('p', { class: 'note' }, d.mode === 'swap' ? 'Pick one picture. It is copied into this asset and chosen.' : 'Pick a character. Scenes that used the old one switch to it.') : tabs,
    search, h('div', { id: 'liberr' }), h('div', { class: 'stack', id: 'libres', 'aria-live': 'polite' })]);
  fillLib();
}
async function loadLib() {
  const d = state.ui.drawer; if (!d || d.type !== 'library') return;
  const seq = ++libSeq;
  state.lib.loading = true; fillLib();
  try {
    const kind = d.mode === 'adopt' ? (d.tab || '') : d.kind;
    const qs = new URLSearchParams(); if (kind) qs.set('kind', kind); if (d.q) qs.set('q', d.q);
    const entries = await api(`/library?${qs}`);
    if (seq !== libSeq) return;
    state.lib = { entries: Array.isArray(entries) ? entries : [], loading: false, err: '' };
  } catch (e) {
    if (seq !== libSeq) return;
    state.lib = { entries: [], loading: false, err: e.status === 404 ? 'The library is not available on this server yet.' : e.message };
    toast(state.lib.err, true);
  }
  fillLib();
}
function entryThumb(en) {
  const pick = en.kind === 'location' ? en.sheets[0] : (en.sheets.find((s) => s.kind === 'character-full') || en.sheets[0]);
  return pick ? libUrl(en.projectSlug, pick.file) : '';
}
function fillLib() {
  const d = state.ui.drawer; const res = $('#libres'); if (!res || !d) return;
  const err = $('#liberr');
  err.replaceChildren(state.lib.err ? h('div', { class: 'banner err', role: 'alert' }, h('span', { class: 'msg' }, state.lib.err), h('button', { class: 'btn sm', type: 'button', onclick: loadLib }, 'Try again')) : null);
  const entries = state.lib.entries.filter((e) => e.projectSlug !== state.slug);
  if (state.lib.loading && !entries.length) { res.replaceChildren(h('p', { class: 'note' }, 'Loading…')); return; }
  if (!entries.length) { res.replaceChildren(state.lib.err ? null : h('p', { class: 'note' }, d.q ? 'Nothing matches that search.' : 'The library is empty. Characters and places from your other projects show up here.')); return; }
  const wantKind = d.assetId ? (asset(d.assetId)?.kind || imageRows().find((r) => r.id === d.assetId)?.kind) : null;
  res.replaceChildren(...entries.map((en) => {
    const url = entryThumb(en);
    const states = en.kind === 'character' && en.spec.states ? en.spec.states.map((s) => s.id).join(' · ') : 'location';
    const card = h('div', { class: 'libcard' },
      url ? h('img', { class: 'im', src: url, alt: '', loading: 'lazy' }) : h('div', { class: 'im' }),
      h('div', { class: 'info' }, h('b', {}, en.name), h('span', {}, `${en.projectTitle} · ${states}`), h('span', { title: en.summary }, en.summary)));
    if (d.mode === 'swap') {
      const byKind = (a, b) => (b.kind === wantKind) - (a.kind === wantKind);
      const list = en.sheets.slice().sort(byKind);
      const pic = (s, ring) => h('button', { type: 'button', class: ring ? 'ring' : '', title: `${s.kind.replace('character-', '')}${s.stateId ? ` · ${s.stateId}` : ''} · option ${s.index + 1}`, 'aria-label': `Use ${en.name} ${s.kind.replace('character-', '')} ${s.stateId || ''} option ${s.index + 1}`, onclick: () => useLibPicture(en, s) },
        h('img', { src: libUrl(en.projectSlug, s.file), alt: '', loading: 'lazy' }));
      const rest = (en.allSheets || []).filter((s) => !s.chosen).sort(byKind);
      card.append(h('div', { class: 'picks' }, !list.length ? h('span', { class: 'note' }, 'No chosen pictures in that project.') : null, list.map((s) => pic(s, true))));
      if (rest.length) {
        const key = `${en.id}`;
        card.append(h('details', { class: 'allpics', open: !!state.ui.plain['lib:' + key], ontoggle: (e) => { state.ui.plain['lib:' + key] = e.target.open; } },
          h('summary', {}, `all pictures (${(en.allSheets || []).length})`),
          h('div', { class: 'grid4' }, rest.map((s) => pic(s, false)))));
      }
    } else {
      card.append(h('button', { class: 'btn act', type: 'button', 'aria-label': `Use ${en.name}`, onclick: () => useLibEntry(en) }, 'Use'));
    }
    return card;
  }));
}
async function useLibEntry(en) {
  const d = state.ui.drawer; const stage = state.step;
  const old = d.mode === 'replace' ? d.charId : null;
  closeDrawer(true);
  await mutate(stage, async () => {
    const before = new Set(chars().map((c) => c.id));
    await api(`/projects/${state.slug}/adopt`, 'POST', { entryId: en.id, as: en.kind });
    await loadProject();
    if (old) {
      const added = chars().find((c) => !before.has(c.id));
      if (added) {
        const sc = structuredClone(P().script);
        for (const b of sc.scenes) for (const ch of b.characters) if (ch.characterId === old) { ch.characterId = added.id; if (!added.states.some((s) => s.id === ch.stateId)) ch.stateId = added.states[0]?.id || ch.stateId; }
        sc.characters = sc.characters.filter((c) => c.id !== old);
        await api(`/projects/${state.slug}`, 'PATCH', { script: sc, sheets: { items: sheetItems().filter((s) => s.characterId !== old) } });
      }
    }
  }, old ? `Replaced with ${en.name}` : `${en.name} added from the library`);
}
async function useLibPicture(en, s) {
  const id = state.ui.drawer.assetId;
  closeDrawer(true);
  await mutate('images', () => api(`/projects/${state.slug}/assets/${id}/adopt`, 'POST', { fromSlug: en.projectSlug, fromAssetId: s.assetId, index: s.index }), `Picture from ${en.projectTitle} chosen`);
}

// ---------- live updates ----------
let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => { if (!state.slug) return; try { await loadProject(); render(); } catch { /* next event retries */ } }, 150);
}
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    let ev; try { ev = JSON.parse(m.data); } catch { return; }
    if (ev.type === 'project') {
      if (!state.slug) refreshProjects().then(() => render()).catch(() => {});
      else if (!ev.slug || ev.slug === state.slug) scheduleReload();
      return;
    }
    if (ev.slug !== state.slug) return;
    if (ev.type === 'job') {
      const prev = state.runs[ev.jobId];
      state.runs[ev.jobId] = { ...prev, slug: ev.slug, stage: ev.stage, status: ev.status };
      if (ev.status !== 'running') {
        refreshSpend();
        const what = prev?.what || pendingWhat[ev.stage] || STEPS[STEP_IDX[ev.stage]]?.label || ev.stage;
        if (ev.error) { state.errs[ev.stage] = `${ev.stage} failed: ${ev.error}`; toast(`${what} failed: ${ev.error}`, true); }
        else if (prev?.status === 'running') toast(`${what} done`);
      }
      scheduleReload(); render();
    }
  };
}

// ---------- boot ----------
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.closest?.('#centre')) return;
  if (t.matches('[data-p], textarea[data-b], textarea[data-plain]')) markDirty();
  if (t.classList.contains('grow')) grow(t);
  if (t.matches('.sheetrow textarea')) grow(t);
});
// Web fonts land after first paint and change line heights, so measure the boxes again once they are in.
if (document.fonts?.ready) document.fonts.ready.then(() => growAll(document));
window.addEventListener('resize', () => growAll(document));
document.addEventListener('focusin', (e) => { if (e.target.matches?.('.sheetrow textarea')) grow(e.target); });
document.addEventListener('focusout', (e) => { if (e.target.matches?.('.sheetrow textarea')) e.target.style.height = ''; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.ui.drawer && !$('dialog[open]')) closeDrawer(); });
window.addEventListener('hashchange', () => { onRoute(); });
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

(async function boot() {
  try { localStorage.removeItem('heartcut.dry'); } catch { /* no storage */ }
  render(true);
  connectEvents();
  await onRoute();
  setInterval(() => { if (state.slug) refreshSpend(); }, 30000);
})().catch((e) => { toast(e.message, true); });

// Sticky masthead: publish the top bar and stepper heights as CSS variables so the stepper sits right under the
// top bar and the save bar sits under both, whatever their wrapped height.
(() => {
  const set = () => {
    const top = document.getElementById('top'); const steps = document.getElementById('steps');
    const r = document.documentElement.style;
    r.setProperty('--top-h', `${top ? top.offsetHeight : 0}px`);
    r.setProperty('--steps-h', `${steps && !steps.hidden ? steps.offsetHeight : 0}px`);
  };
  try { const ro = new ResizeObserver(set); ['top', 'steps'].forEach((id) => { const el = document.getElementById(id); if (el) ro.observe(el); }); } catch { /* old browser: static fallback below */ }
  new MutationObserver(set).observe(document.getElementById('steps') || document.body, { attributes: true, attributeFilter: ['hidden'] });
  addEventListener('resize', set); set();
})();
