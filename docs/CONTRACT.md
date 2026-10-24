# Heartcut — developer contract

Heartcut is an engine + dashboard that turns a plain-language director's brief into a
short emotional AI film: brief → script → character/location sheets → sheet images →
scene prompts → keyframes (optional) → draft clips → final clips → assembled export.
The method it follows is described in `docs/process-breakdown.md`.

This file is the contract between the parts of the code. **Code against `src/types.ts`
and the interfaces below.** Add optional fields only; never rename or remove. The
sections are in the order the features were added; a later section wins where they differ.

## Non-negotiable house rules

- **TypeScript run directly by Node** (`node src/cli.ts` — type stripping is native; see
  `engines` in `package.json` for the minimum version). **Zero runtime
  dependencies.** Tests with `node --test`. No bundler, no framework in `web/`.
- **All LLM calls go through `src/llm.ts`** (`llmJson()`). The default shells out to the `claude` CLI
  on the subscription (`claude -p --model sonnet --output-format json --json-schema <schema>`), which
  needs no API key. API providers (Anthropic, OpenAI-compatible) are optional and opt-in; see
  "v6.2 — LLM providers" below. Never require a key for the default path.
- **All image/video generation goes through `src/gen` (the provider layer).** Stages never
  call a provider API themselves. The provider layer owns keys, the spending cap,
  estimate-before-run, polling and download. Never read, print or return a key. Never retry
  a submit after a timeout (not every provider takes an idempotency key → double bill).
- **Price before you spend.** Every generating stage exposes `estimate()` and the dashboard
  shows the number before the button fires. `dryRun` must work end to end with no spend.
- **Run generations sequentially**, never in parallel (account concurrency limit).
- Media lives in `media/<slug>/` in the repo folder (gitignored; `HEARTCUT_MEDIA_ROOT`
  overrides). Project JSON lives in `projects/<slug>/project.json` (gitignored).
- Never name a real film, studio, actor or illustrator inside a generated prompt. Describe
  the method and the feeling. (Inspiration notes stay in `Script.inspiration`, not prompts.)

## Model routing (Higgsfield model slugs — copy exactly)

| Need | Slug | Params that matter | ~$ |
|---|---|---|---|
| Character sheet (photoreal face) | `higgsfield-ai/soul/v2/standard` | `prompt`, `resolution:"1080p"`, `aspect_ratio`, `batch_size:4`, `enhance_prompt:false`, `seed?` | 0.023 / 4 |
| Character sheet from a selfie (identity lock) | `alibaba/qwen-image-3/edit` | `prompt`, `image_urls` (array — the selfie), `resolution` `1k`/`2k`; returns ONE image | 0.040 |
| Location sheet (cinematic, cheapest) | `higgsfield-ai/soul/cinema` | `prompt`, `aspect_ratio`, `batch_size:4` | 0.004 each |
| Video, draft | `bytedance/seedance-2.5/reference-to-video` | `prompt`, `resolution:"480p"`, `duration`, `aspect_ratio`, `generate_audio:false`, `image_urls` (chosen sheet images: characters + location) | token-metered, ~$1/5s |
| Video, final | same | `resolution:"720p"`, `generate_audio` per scene | ~$2.3/5s |
| 4K upscale | ffmpeg lanczos `-vf scale=3840:-2` + light grain | — | 0 |

Seedance 2.5 caps at 720p and has **no seed** — "final" is a re-generation at 720p with the
same prompt and refs, not an upscale of the exact draft. Say so in the UI. Other providers
map these needs to their own model ids in `src/gen/` (see "v7" below).

## Filesystem

```
heartcut/
  src/types.ts                shared model
  src/store.ts                project CRUD on disk, ids, media paths
  src/llm.ts                  llmJson(): saved > HEARTCUT_LLM_PROVIDER > auto (claude CLI on PATH, first API key, local Ollama/LM Studio); structured JSON output
  src/llm/config.ts           provider presets, default model ids, settings > env > CLI precedence
  src/llm/http.ts             Anthropic + OpenAI-compatible HTTP adapters (plain fetch)
  src/env.ts                  zero-dep loader for the gitignored repo-root .env
  src/pipeline.ts             runStage() / estimateStage() dispatcher + job records
  src/stages/script.ts        brief -> Script
  src/stages/sheets.ts        Script -> Sheets (prompts only)
  src/stages/scenes.ts        Script + Assets -> ScenePrompt[]
  src/cli.ts                  heartcut CLI
  src/gen/                    provider layer: estimate/run/upload/spend per provider
  src/gen/models.ts           routing table above, input builders per model
  src/stages/images.ts        Sheets -> Assets (4 options each)
  src/stages/clips.ts         ScenePrompt[] -> Clip (draft/final)
  src/stages/export.ts        approved finals -> ExportResult (ffmpeg)
  src/ffmpeg.ts               concat / music / upscale / probe
  src/server.ts               HTTP + SSE API, static web/
  web/index.html,app.js,app.css
  prompts/blocks.md           the cinedance block library
  prompts/system-script.md, system-sheets.md, system-scenes.md, system-keyframes.md
  skills/cinedance/SKILL.md   installable Claude skill
  docs/process-breakdown.md   the method and how Heartcut maps to it
  README.md, CONTRIBUTING.md, CLAUDE.md (= AGENTS.md)
  test/*.test.ts              tests, one file per area
projects/<slug>/project.json, projects/<slug>/refs/*      (gitignored)
media/<slug>/{assets,keyframes,clips,export}/                      (gitignored)
```

## Interfaces

```ts
// src/store.ts
export const ROOT: string;                       // the repo folder (HEARTCUT_ROOT overrides)
export const PROJECTS_DIR: string;               // ROOT/projects
export const MEDIA_ROOT: string;                 // ROOT/media (HEARTCUT_MEDIA_ROOT overrides)
export function newId(prefix: string): string;   // e.g. 'job_8f3k2a'
export function listProjects(): Project[];
export function loadProject(slug: string): Project;           // throws if missing
export function saveProject(p: Project): void;                // atomic write, bumps updatedAt
export function createProject(input: { title: string; slug?: string; briefText: string; aspect?: Aspect }): Project;
export function addRef(slug: string, input: { role: RefRole; filename: string; bytes: Buffer; note?: string; forCharacterId?: string; forLocationId?: string }): RefImage;
export function mediaDir(slug: string, sub: 'assets' | 'clips' | 'export'): string;   // mkdir -p
export function addJob(p: Project, job: Omit<Job, 'id' | 'startedAt' | 'status' | 'outputs' | 'log'> & Partial<Job>): Job;
export function updateJob(p: Project, id: string, patch: Partial<Job>): Job;

// src/llm.ts
export interface LlmCall { system: string; user: string; schema: object; model?: 'sonnet' | 'opus' | 'haiku'; maxTokens?: number }
export async function llmJson<T>(call: LlmCall): Promise<T>;     // validated against schema (basic required/type checks)
export function loadPrompt(name: 'blocks' | 'system-script' | 'system-sheets' | 'system-scenes'): string;  // reads prompts/<name>.md

// src/pipeline.ts — the one entry point server and CLI use
export async function runStage(slug: string, stage: Stage, opts: RunOptions, emit: Emit): Promise<Project>;
export async function estimateStage(slug: string, stage: Stage, opts: RunOptions): Promise<Estimate>;
// dispatch: every stage -> src/stages/<stage>.ts
// Each stage module exports:  run(p: Project, opts: RunOptions, emit: Emit): Promise<Project>
//                             estimate(p: Project, opts: RunOptions): Promise<Estimate>   (LLM stages return {usd:0,items:[]})

// src/gen/ — every provider exposes this shape
export interface GenResult { files: string[]; usd: number; requestId?: string; raw?: unknown }
export async function estimate(slug: string, input: object): Promise<number>;          // usd
export async function run(slug: string, input: object, opts: { name: string; dryRun?: boolean; allowUnpriced?: boolean; emit?: Emit }): Promise<GenResult>;
export async function upload(filePath: string): Promise<string>;                        // public url
export async function spend(): Promise<{ sittingUsd: number; capUsd: number; remainingUsd: number }>;

// src/ffmpeg.ts
export async function probe(file: string): Promise<{ width: number; height: number; durationSec: number }>;
export async function concat(files: string[], out: string, opts?: { music?: string; fadeSec?: number }): Promise<string>;
export async function upscale4k(input: string, out: string, opts?: { grain?: boolean }): Promise<string>;

// src/server.ts  — port 5088, PORT or HEARTCUT_PORT overrides
GET  /api/projects                         -> Project[] (slim: no jobs.log)
POST /api/projects        {title, briefText, aspect?} -> Project
GET  /api/projects/:slug                   -> Project
PATCH /api/projects/:slug  {brief?, script?, sheets?, scenePrompts?, approvals?} -> Project (deep-merge top-level keys, replace arrays)
POST /api/projects/:slug/refs  {role, filename, dataBase64, note?} -> RefImage
POST /api/projects/:slug/estimate/:stage   RunOptions -> Estimate
POST /api/projects/:slug/run/:stage        RunOptions -> { jobId }   (runs in background; progress over SSE)
POST /api/projects/:slug/choose     {assetId, index} -> Project
POST /api/projects/:slug/approve    {clipId, approved: boolean} -> Project
POST /api/projects/:slug/approve-stage {stage} -> Project
GET  /api/projects/:slug/jobs              -> Job[]
GET  /api/spend?slug=                      -> Spend
GET  /api/events                           -> SSE: {type:'log'|'job'|'project', slug, jobId?, line?, status?}
GET  /media/<slug>/<sub>/<file>            -> bytes from MEDIA_ROOT (read-only, no traversal)
GET  /refs/<slug>/<file>                   -> bytes from projects/<slug>/refs
GET  /                                     -> web/index.html
```

`runStage` for `images`/`clips` runs one generation at a time and calls `emit` per step
("estimate $0.023 for asset ch_girl_present_portrait", "submitted", "downloaded 4 files").
Jobs are appended to `project.jobs`; `Job.log` collects emit lines.

## Stage semantics (what "done" means)

- **script**: `Script` saved. Characters carry numeric anchors. Every character has ≥ 2
  states when the brief implies two eras; otherwise 1. 6–12 scene beats, durations 4–10s,
  one beat flagged as the emotional core, at least one `matchCutFrom` when eras change.
- **sheets**: for every (character, state): a portrait AND a full-body `SheetPrompt`
  (white seamless cyclorama, even octabox light, camera+lens block, "same face/same props"
  language, state-specific wear). For every location: one `SheetPrompt` with lighting and
  camera package. Built from `prompts/blocks.md`.
- **images**: each `SheetPrompt` → one `Asset` with 4 options. `chosen` undefined until the
  user picks (CLI auto-picks 0). Identity-locked characters use qwen edit with the selfie.
- **scenes**: one `ScenePrompt` per beat. Prompt = shot block + continuity block (same
  wardrobe/props per state) + action with micro-expressions + physics verbs for objects +
  location block + light + palette + camera/lens/stock + quality tags. `negatives` carry
  explicit "no …" lines that are ALSO appended into the prompt text (Seedance has no
  negative_prompt field). `refAssetIds` = chosen character full-body sheets for every
  character in the beat + the location sheet.
- **clips**: `tier:'draft'` → 480p, audio off. `tier:'final'` → 720p, audio per scene.
  Draft requires chosen assets for every ref; final requires an approved draft for the scene
  unless `force`. One `Clip` per run; old clips stay (history).
- **export**: ordered approved finals (fallback: approved drafts) → concat → optional music
  → `resolution:'4k'` runs `upscale4k` → `ExportResult` appended.

## Dashboard

One page, vanilla JS, dark, phone-safe. Left: projects list + "New project" (title, aspect,
brief textarea, ref uploads with role). Main: stage rail Brief → Script → Sheets → Images →
Scenes → Clips → Export, each a card with: current content (editable JSON-backed forms —
script fields, sheet prompts, scene prompts), **Estimate** (shows $ before anything),
**Run / Regenerate**, **Approve stage**. Images: 2×2 option grid per asset, click to choose.
Clips: per scene, draft + final thumbnails/video tags, cost badge, Approve toggle, "Draft
→ Final" button that re-shows the price. Top bar: **live credit tracker** — project $, sitting
$ / cap, remaining; turns amber at 70 %, red at 90 %. Right rail: live log (SSE). Everything
survives a reload (server is the source of truth). No dry-run toggle in the dashboard: every priced button already shows its $ first, ≥ $0.50 confirms, and the sitting cap stops runaway spend. `dryRun` stays an engine/CLI option (`--dry-run`) for tests and the demo.

## Tests

`node --test test/` must pass offline: mock the language model and the generation provider
via an env var (`HEARTCUT_FAKE=1` → `src/llm.ts` and `src/gen/` return canned fixtures and
write 1×1 PNG / tiny MP4 placeholders). Store tests use a temp `HEARTCUT_ROOT`.

## Gates before a change merges

`npm test` green · `npm run typecheck` green ·
`npm run demo` runs all eight stages dry · `node src/server.ts`
serves the dashboard and the demo project renders every stage.

---

## v2 — Guided dashboard, library, import, staleness

Design: a guided, step-by-step studio, with a scene table inside the Clips step and a block
editor as the prompt field.

### Types added (`src/types.ts`)
`Provenance`, `Asset.sources?`, `PromptBlock`, `ScenePrompt.blocks?`, `LibraryEntry`,
`Project.stamps?`, `Staleness`. Optional fields only; nothing renamed.

### Staleness (server + store)
- `saveProject` callers stamp: `p.stamps[stage] = now` whenever a stage's content changes —
  `runStage` after a successful run; `PATCH` when `script`/`sheets`/`scenePrompts` are in the
  body (stamp the matching stage); `choose` stamps `images`; `approve` stamps `clips`.
- `GET /api/projects/:slug` returns the project plus `staleness: Staleness`: for each stage S
  with content, `stale = exists upstream U with stamps[U] > stamps[S]`, `because = U`.
  Order: brief < script < sheets < images < scenes < clips < export.
- `POST /api/projects/:slug/keep {stage}` → `stamps[stage] = now` ("keep anyway").

### Scene prompt blocks
- `prompts/system-scenes.md` asks for `blocks: [{name,text}]` per scene in block-library
  order; `src/stages/scenes.ts` sets `prompt = blocks.map(b => b.text).join(', ')`, marks
  `locked:true` on SUBJECT, IDENTITY, LOCATION, LIGHT, GRADE, and still appends negatives.
  `src/demo/demo.ts` FAKE_SCENES carry blocks. Old projects without blocks still render
  (plain textarea fallback).
- `PATCH` with `scenePrompts` whose items carry `blocks` → server re-joins `prompt` from blocks
  (negatives appended once) so the two never disagree.

### Library (cross-project reuse)
- `GET /api/library?kind=character|location&q=<text>` → `LibraryEntry[]` from every project
  (store: `listLibrary()`), newest first. Only characters/locations whose sheets have a chosen
  option appear with `sheets`; ones without still appear (spec only).
- `POST /api/projects/:slug/adopt {entryId, as?: 'character'|'location'}` → copies the spec
  into `script.characters` / `script.locations` (new id if it collides; `identityRefId` dropped),
  copies each chosen sheet file into this project's `mediaDir(slug,'assets')`, creates the
  matching `Asset`s (ids per the sheets rule) with that single option, `chosen:0`,
  `model:'library'`, `sources:[{kind:'library',…}]`, and the matching `SheetPrompt`s in
  `p.sheets` (prompt copied). Stamps `script`, `sheets`, `images`. Returns the project.
- `POST /api/projects/:slug/assets/:assetId/adopt {fromSlug, fromAssetId, index}` → appends
  that one option (file copied) to this asset and chooses it. For swapping a single picture.
- `POST /api/projects/:slug/assets/:assetId/import {filename, dataBase64}` → png/jpg/webp only,
  ≤ 15 MB, saved into `mediaDir(slug,'assets')` as `<assetId>-import-<n>.<ext>`, appended as an
  option with `sources` `{kind:'import'}`, chosen. Also `POST …/assets/import-new
  {kind, characterId?, stateId?, locationId?, filename, dataBase64}` to create an asset that has
  no sheet prompt yet (e.g. a real photo of a location) — creates a minimal `SheetPrompt`
  with `prompt: '(imported)'`.
- CLI mirrors: `heartcut library [--kind] [--q]`, `heartcut adopt <slug> <entryId>`,
  `heartcut import <slug> <assetId> <file>`.

### Dashboard (web/)
- **Shell**: top bar (wordmark, project, spend meter with "≈ N drafts left" where N =
  floor(remaining / 1.03), "All projects"); stepper row (7 steps: done ✓ /
  current / locked; a stale banner on the right when `staleness` says so); 3-column body
  (left: step intro + cost card + progress; centre: the step; right: context rail); sticky
  footer (Back · note · secondary priced action · primary "Continue →").
- **Projects** view (no project open or "All projects"): card grid + "New project" modal
  (title, aspect, brief, refs). The empty state is one card: "Write the brief like you'd tell a friend."
- **Steps**: Brief (text + refs with roles; library button "Start from a past character");
  Script (fields + characters/locations/beats; per-character "Replace from library" and a
  "Add from library" button that opens the library drawer); Sheets (prompt per (character,
  state) collapsed to 3 lines, expand to edit; mono); Images (per character: rows of 4 thumbs
  + label column, chosen ring, "Regenerate row · $"; per row: "Import image…" and "Use from
  library…"; cast panel on the right); Scenes (one card per beat with the **block editor**:
  locked blocks dashed, editable blocks, NEGATIVES chips, "View as plain text", refs strip);
  Clips (**scene table**: # · scene · refs · prompt summary · draft · final · approve; film
  strip above; row select + bulk "Generate N drafts · $"; row click opens a right drawer with
  the block summary and draft/final players); Export (resolution, music, exports list).
- **Price-first**: every priced button shows its `$` from `POST …/estimate/:stage` called
  automatically when the step opens and (debounced 600 ms) when its inputs change; ≥ $0.50
  → one-line confirm with the number; over the sitting cap → red state "over cap by $x".
- **Library drawer**: slides in from the right; search box; kind tabs; cards with thumbnail
  (chosen full-body or location), name, project, states; "Use" button. Used from Script
  (adopt spec+sheets) and Images (adopt one picture).
- **Status words**: empty · needs you · generating… · done · approved · stale. Nothing else.
- **Foundations**: Instrument Sans + JetBrains Mono from Google Fonts (one `<link>`), tokens
  in `web/app.css`, 8-pt spacing, one level of nesting, 16 px phone gutters,
  no horizontal scroll at 390 px (stepper scrolls horizontally inside its row; 3 columns stack).
- Log: right rail "Jobs" list, one row per job, expandable; errors also render as a banner
  inside the step they belong to.

---

## v3 — Styles

A project can use any look, not only photoreal: anime, a kids' cartoon, custom, saved for
reuse. A project carries one `StyleSpec` (`src/types.ts`). It changes three things: the words the LLM
puts in every sheet and scene prompt, which image model draws the sheets, and the hints Seedance gets.

### Model notes
- `higgsfield-ai/soul/v2/standard` takes `style_id` from about 33 photographic looks (listed by `GET /api/soul-styles`). They are free. None is anime or cartoon.
- Non-photo mediums must use another image model: `alibaba/qwen-image-3/text-to-image` $0.040 (anime/illustration strong), `z-image/turbo` $0.015, `recraft/v4.1/text-to-image` $0.035 (vector/flat illustration), `ideogram/v4.0` $0.060, `xai/grok-imagine-image-2.0` $0.060. For a model without documented params, probe the schema by submitting `{}` (free; the 400 names the next required field) — never guess field names, `/estimate` does not validate. Identity lock stays `alibaba/qwen-image-3/edit` (selfie → "redraw in this style").
- Seedance 2.5 reference-to-video follows the reference images' medium. Anime sheets + "2D anime animation, cel shading" in the prompt → anime clip.

### Files
- `prompts/styles.json` — built-in presets (`builtin:true`), ids: `cinematic-realism` (default: filmic, documentary realism), `documentary-natural`, `film-noir-bw` (Soul Retro BW), `nostalgia-35mm` (Soul Warm contrast film), `y2k-flash` (Soul Flash editorial), `anime-2d` (qwen t2i), `anime-painterly` (qwen), `cartoon-flat-kids` (recraft or qwen: flat vector cartoon, thick clean outlines, rounded shapes, bright friendly pastel palette, minimal shading — never name a show), `storybook-watercolour`, `comic-ink`, `pixel-art`, `claymation`, `animated-3d-feature`. Each with `look`, `sheetLook`, `negatives`, `videoHints`, `models`. Never name a studio, show, artist or film in any field.
- `projects/_styles.json` — user styles (gitignored with projects/). `src/styles.ts`: `listStyles()` (builtin + user, user wins on id clash), `getStyle(id)`, `saveStyle(spec)` (user; `builtin` stripped; id slugified from name), `deleteStyle(id)` (user only), `DEFAULT_STYLE_ID = 'cinematic-realism'`, `styleFor(p): StyleSpec`.

### Engine
- `src/stages/sheets.ts` and `scenes.ts`: pass `styleFor(p)` into the LLM user message as a STYLE section (name, look, sheetLook, negatives, videoHints). `prompts/system-sheets.md` / `system-scenes.md`: a "Style" rule — the LOOK text replaces the realism/camera-stock vocabulary when the family is not photoreal/film; QUALITY block = style quality tags; NEGATIVES include the style negatives; scenes append `videoHints`. `prompts/blocks.md`: add a short "LOOK (style)" note explaining the swap so the skill matches the engine.
- `src/gen/models.ts`: `sheetModel(kind, hasIdentityRef, style)` → `style.models.faces` / `.places` / `.identity`; `buildSheetInput` adds `style_id` when the model is Soul 2 and `style.soulStyleId` is set; builds the right body per model (probe qwen t2i / z-image / recraft once with `--dry-run` and record the shapes in comments). `images.ts` labels the model in the asset. Prices per model in `fakePrice`.
- Changing `p.style` stamps `brief` (everything downstream goes stale, which is correct).

### API
- `GET /api/styles` → `StyleSpec[]` (builtin first). `POST /api/styles` body `StyleSpec` (without id → new; with id → update user style) → `StyleSpec`. `DELETE /api/styles/:id` (user only; 403 for builtin).
- `PATCH /api/projects/:slug {style}` already works via deep-merge; the server stamps `brief` when `style` is in the body. `POST /api/projects/:slug/style {styleId}` → copies the preset into `p.style` and returns the view.
- `GET /api/projects/:slug` view carries `style` (resolved to the default when missing).

### Dashboard
- Brief step gets a **Look** section under the brief text: preset cards (name, family tag, description, "faces: Soul 2 · places: Soul Cinema · ≈ $0.02 per 4" line), the chosen one ringed in ember. Buttons: "Customise this…" (opens the style editor pre-filled from the chosen preset) and "My styles" tab in the same grid. Style editor = a modal: name, family select, look (textarea, grows), sheet look, negatives chips, video hints, faces model select, places model select, Soul style select (only when faces = Soul 2; list from `GET /api/soul-styles`), "Save to my styles", "Use for this project". Deleting a user style asks once.
- The stepper/left rail shows the active style name on every step ("Look: Anime 2D").
- Sheets and Scenes steps show a small "Style: Anime 2D" chip next to the prompt so the user can see what is being injected; the QUALITY block in the block editor is labelled "QUALITY · from style".
- CLI: `heartcut styles`, `heartcut style <slug> <styleId>`.

## v4 — local GPU + option management

### Local GPU rendering (free)
- Models in `IMAGE_MODELS` (`local: true`, `usd: 0`, `calls: 4`, kind `any`): `local/qwen-image` ("Qwen-Image · local GPU · free") and `local/z-image-turbo` ("Z-Image Turbo · local GPU · free"). `buildSheetInput` returns `{prompt, width, height}` (3:4 896x1152, 2:3 832x1248, 16:9 1280x720, 1:1 1024x1024, 9:16 720x1280, plus 4:3, 3:2, 21:9).
- `src/gen/local.ts`: `isLocalAvailable() -> {ok, reason?, models}` (needs `uv` on PATH, the worker `tools/local-image.py`, and the Hugging Face cache folders `Qwen/Qwen-Image` and `Tongyi-MAI/Z-Image-Turbo` with `snapshots/*/transformer`); `run(model, items, {width,height,steps,emit}) -> {files, secs}` spawns `uv run tools/local-image.py` ONCE per sheet (`HEARTCUT_LOCAL_WORKER` overrides) (all four variants share one model load). Steps: z-image-turbo 8, qwen-image 20 (`HEARTCUT_LOCAL_STEPS` overrides). Seed = stable hash of `<assetId>-v<n>`. Timeout 30 min. `HEARTCUT_FAKE=1` writes placeholder PNGs.
- Failure policy (`stages/images.ts`): a generation failure falls back to `local/z-image-turbo` (`FALLBACK`); a worker that cannot run at all (no uv, no weights) falls back to the Higgsfield twin (`LOCAL_TWIN`: `alibaba/qwen-image-3/text-to-image`, `z-image/turbo`) with a loud "THIS COSTS MONEY" log line and note. Partial results are kept; provenance is `{kind:'generated', model}`.
- Settings: `projects/_settings.json` `{preferLocal}` (default on when local is available; `HEARTCUT_PREFER_LOCAL=0|1` sets the default). `resolveModels(style)` (`src/settings.ts`) maps `alibaba/qwen-image-3/text-to-image` -> `local/qwen-image` and `z-image/turbo` -> `local/z-image-turbo` for faces/places when `preferLocal` is on and local is available; the identity edit stays on Higgsfield.
- API: `GET /api/settings -> {preferLocal, local:{ok,reason?,models}}`; `PATCH /api/settings {preferLocal}` (400 for a non-boolean, 409 when turning it on while local is unavailable). `GET /api/image-models` lists the local entries.
- CLI: `heartcut local [--smoke] [--model z_image_turbo|qwen_image]` (smoke writes one image to `.../heartcut/_smoke/`).
- Dashboard: Look header switch "Render drawn looks on this computer (free)" (disabled with the reason when unavailable); preset cards show the mapped model; the cost card shows "$0.00 · local GPU" rows.

### Option management
- `POST /api/projects/:slug/choose {assetId, index}`: `index: null` unpicks (clears `chosen`, stamps images). Store `chooseAsset(slug, assetId, index | null)`.
- `POST /api/projects/:slug/assets/:assetId/options/remove {index}` removes that option and its `sources` entry, fixes `chosen` (removed chosen -> unset; lower index removed -> shifts down) and deletes the file only when it lives under this project's `mediaDir` and no other option uses it (never a library/other-project source). Returns the project view (400 bad index, 404 unknown asset). Store `removeOption`.
- CLI: `heartcut unpick <slug> <assetId>`, `heartcut remove <slug> <assetId> <index>`.
- Images step: the **chosen** pill unpicks (title "Unpick"); every thumb has a top-right x (`aria-label="Remove picture"`, hover on desktop, always visible with a 44px target on touch) with one confirm.
- Library: `LibraryEntry.allSheets` = every option of every asset of that character/location `{assetId, kind, stateId?, file, index, chosen}` (`sheets` stays chosen-only). The swap drawer shows the chosen pictures ringed, then an "all pictures (N)" expander (4-up grid); any picture adopts via `.../assets/:id/adopt`.
- Estimate: `images.estimate/run` accept an asset that has no sheet item when `ids` names it (priced from `asset.prompt`); sheets with no prompt or the `(imported)` placeholder are skipped at $0 with "skipped: no prompt to draw from" instead of failing or drawing the literal text.

---

## v5 — Keyframes, relight, short motion prompts, one-take sequences

Method background: `docs/process-breakdown.md`. Everything here is additive; nothing is renamed.

Four additions: (1) a **still keyframe per scene** first (sheets + location as
references, face **relit** to the scene), then animates the still with image-to-video and a
**short motion-only prompt** (the references already fix the look; describing it a second time
invites drift); (2) one **15–20 s generation with all keyframes as references** and hard cuts
inside it; (3) **fakeness negatives** (no shiny plastic skin, no harsh sharpening, no oversaturated
colours) and **camera as movement, never as an object** ("FPV drone" puts a drone in frame);
(4) never a static pose — describe what the character is doing.

### Stage order (8 stages)
`brief < script < sheets < images < scenes < keyframes < clips < export`. `STAGES` and the
staleness order gain `keyframes` between `scenes` and `clips`. **Keyframes are optional**: `clips`
still runs from `scenePrompts` alone (reference-to-video, as today). Guard for `keyframes`:
`scenePrompts` exist and every asset they reference has a chosen option.

### Types (`src/types.ts`, additive)
```ts
export type Stage = … | 'keyframes';
export type KeyframeRole = 'start' | 'end';
export interface Keyframe {
  id: string;               // `kf_${sceneId}_${role}`
  sceneId: string;
  role: KeyframeRole;
  prompt: string;           // == blocks.map(b => b.text).join(', ') + negatives
  blocks?: PromptBlock[];   // KEYFRAME block order (below)
  negatives: string[];
  refAssetIds: string[];    // chosen full-body sheets of the beat's characters + the location sheet
  model: string;            // 'alibaba/qwen-image-3/edit' | 'import'
  options: MediaFile[];     // 2 generated options (+ imports)
  chosen?: number;
  sources?: Provenance[];
  jobId?: string;
  costUsd?: number;
}
export type PromptMode = 'full' | 'short';
export type ClipSource = 'reference' | 'keyframe' | 'sequence';
// ScenePrompt additions
//   motion?: string;      2–3 sentences, motion + camera movement only (short mode prompt). Written by the scenes LLM stage.
//   endFrame?: boolean;   user wants an end keyframe for this beat (default false)
// Clip additions
//   source?: ClipSource;  how it was made (missing == 'reference')
//   mode?: PromptMode;    which prompt text was sent (missing == 'full')
//   sceneIds?: string[];  sequence clips: every beat covered, in order (sceneId == sceneIds[0])
//   prompt?: string;      the exact text sent (so it can be read back)
// Project additions:  keyframes?: Keyframe[]
// JobKind adds 'keyframe'.  RunOptions adds  promptMode?: PromptMode;  sequence?: boolean;
// store.mediaDir sub adds 'keyframes'.
```

### Keyframes stage (`src/stages/keyframes.ts`, LLM + generation in one run)
1. **Prompts** (LLM, `prompts/system-keyframes.md`, `$0`): for every beat in `opts.ids` (default all)
   that has no keyframe prompt yet (or `force`), one `start` keyframe; plus an `end` keyframe when
   `sp.endFrame`. Output JSON `{ keyframes: [{ sceneId, role, blocks: [{name,text}], negatives }] }`.
   Block order **KEYFRAME_BLOCKS = SHOT, SUBJECT, IDENTITY, POSE, LOCATION, LIGHT, GRADE, CAMERA, LOOK, QUALITY, NEGATIVES**
   (no PERFORM/PHYSICS/MATCHCUT; `POSE` = the frozen instant of `actionSimple`, mid-action, never a
   static pose; `LIGHT` = the location's light **plus the relight clause**: the face and clothes are lit
   by this scene's light, no flat white studio light left on the skin; `end` role = the last instant of
   the beat). `{{char:id}}`/`{{loc:id}}` placeholders resolve to `refAssetIds` exactly as scenes do.
   SUBJECT, IDENTITY, LOCATION, GRADE, LOOK are `locked:true`. `prompt` = blocks joined + negatives.
2. **Pictures**: model `alibaba/qwen-image-3/edit`, `image_urls` = chosen files of `refAssetIds`
   (characters first, location last), `resolution:'1k'` (`2k` when `opts.model==='2k'` is not needed —
   keep 1k), aspect = project aspect. **Two sequential calls per keyframe** (`$0.04` each, `KEYFRAME_CALLS = 2`),
   appended as options with `sources:{kind:'generated',model}`. `estimate()` prices only keyframes that
   have no options (or all when `force`). `HEARTCUT_FAKE=1` writes placeholder PNGs. Media:
   `mediaDir(slug,'keyframes')`, filename `<keyframeId>-v<n>.png`.
3. Store: `chooseKeyframe(slug, keyframeId, index|null)` (stamps `keyframes`), `removeKeyframeOption`.
   `src/demo/demo.ts` adds `FAKE_KEYFRAMES` (one `start` per FAKE_SCENES beat).

### Clips stage changes (`src/stages/clips.ts`, `src/gen/models.ts`)
- **Source**: a scene whose `start` keyframe has a chosen option → `bytedance/seedance-2.5/image-to-video`
  (`image_url` = that file, `end_image_url` = the chosen `end` keyframe when present, **no `aspect_ratio`**,
  **no `image_urls`**; the keyframe carries identity). Otherwise reference-to-video exactly as today.
  `SEEDANCE_I2V` constant; `fakePrice` uses the same per-second formula.
- **Prompt mode**: `opts.promptMode` else default = `'short'` when the source is a keyframe, `'full'`
  otherwise. `short` sends `sp.motion` (fallback when missing: SHOT + PERFORM + PHYSICS block texts +
  motion negatives only: the "no camera movement / no zoom / no slow push-in / no morphing" family) —
  target 150–450 characters. `full` sends `sp.prompt` as today. The clip records `mode`, `source`, `prompt`.
- **Sequence** (`opts.sequence:true`, needs ≥ 2 `ids` in beat order): ONE reference-to-video clip.
  `image_urls` = chosen start keyframes of those beats in order, then the characters' full-body sheets,
  then the location(s) (≤ 30). `duration` = clamp(sum of beat durations, 4, 30). Prompt built
  deterministically by `buildSequencePrompt(p, sceneIds)`: `"<N> hard cuts, one continuous sequence, same
  location, same light: "` + for each beat `"cut k (<durationSec>s): <SHOT>, <PERFORM>, <PHYSICS>, <CAMERA>"` +
  once at the end IDENTITY, LOCATION, LIGHT, GRADE, QUALITY, then negatives (`hard cuts not dissolves, no
  morphing between cuts` + the union of scene negatives). `sceneId = sceneIds[0]`, `sceneIds` set,
  `source:'sequence'`. Draft/final tiers as today; `final` needs an approved sequence draft covering the
  same `sceneIds` unless `force`.
- **Export**: when an approved sequence clip covers beats, it is placed at its first beat's position and
  the beats it covers are skipped (prefer: final sequence > final per-scene > draft sequence > draft).

### Scenes stage (`prompts/system-scenes.md`, `src/stages/scenes.ts`)
- Output gains `"motion": string` per scene (2–3 sentences, present tense: what the body does, what the
  camera does as **movement words**, the sound if any; **no appearance, no wardrobe, no location, no
  lens brand, no object named as a camera**). Stored on `sp.motion`. `PATCH scenePrompts` keeps `motion`.
- `LIGHT` block gains the relight clause (see above) whenever a character is in the beat.
- `NEGATIVES` always include the fakeness set: `no shiny plastic skin, no harsh sharpening, no
  oversaturated colours` (photo families only; drawn families keep the style negatives), plus
  `no text, no subtitles, no logos`.
- Rules add: "Describe the camera as movement (push in, drift left, drop to floor level), never as an
  object (no 'drone', 'GoPro', 'FPV'). Never a static pose: say what the character is doing."
- `prompts/blocks.md` gets the same three notes (SHOT/CAMERA rule, POSE note, fakeness negatives) and a
  **"13b. KEYFRAME (still) assembly"** section + the relight clause under LIGHT. `skills/cinedance/blocks.md`
  stays byte-identical (copy it).

### API (`src/server.ts`)
- `POST /api/projects/:slug/keyframes/choose {keyframeId, index|null}` → project view (stamps `keyframes`).
- `POST /api/projects/:slug/keyframes/:id/options/remove {index}` → view.
- `POST /api/projects/:slug/keyframes/:id/import {filename, dataBase64}` → png/jpg/webp ≤ 15 MB appended + chosen (`sources:{kind:'import'}`); `:id` may name a not-yet-existing `kf_<sceneId>_<role>` → creates a minimal Keyframe (`prompt:'(imported)'`).
- `PATCH /api/projects/:slug {keyframes}` → re-join `prompt` from `blocks` (+ negatives once), stamp `keyframes`. `{scenePrompts}` items keep `motion` and `endFrame`.
- `POST /api/projects/:slug/run/clips` and `estimate/clips` accept `promptMode` and `sequence` in the body.
- The project view includes `keyframes`; staleness covers `keyframes`.
- CLI: `run <slug> keyframes [--ids] [--force]`, `run <slug> clips --mode short|full [--sequence] --ids a,b`, `choose-keyframe <slug> <kfId> <index>`, `demo` runs 8 stages.

### Dashboard (`web/`)
- **8 steps**: insert **Keyframes** ("freeze the frames", title "Freeze one frame per shot", intro: "A still
  picture of each shot, lit by the scene. Pick the one that looks filmed. Video then only has to move it.
  Skip this and clips are made from the sheets instead.") between Scenes and Clips. Step is **skippable**:
  footer secondary "Skip keyframes →" goes to Clips. Done ✓ when every beat has a chosen start keyframe.
- Keyframes step: one row per beat — scene title, the keyframe block editor collapsed (same component as
  Scenes; order KEYFRAME_BLOCKS; `LIGHT` labelled "LIGHT · relit to scene"), 2 picture cards with chosen ring
  + remove x + lightbox (reuse the Images card), "Regenerate · $0.08", "Import picture…", an **End frame**
  switch (sets `sp.endFrame`; a second row appears for the `end` keyframe). Cost card: "Generate N keyframes
  · $" (priced from `estimate/keyframes`). Right rail: the beat's refs strip + "Why keyframes" note (3 lines).
- Clips step: cost card gets **Video prompt** radio: "Short — motion only (default with a keyframe)" /
  "Full — every block"; the drawer shows the text that will be sent (editable `motion` textarea in short
  mode, block summary in full) and badges on existing clips: source (`from keyframe` / `from sheets` /
  `one take`) + mode. Scene table gets a **Source** column (keyframe thumb or "sheets"). Bulk bar gains
  **"One take: N scenes in one clip · $"** (sequence; enabled with ≥ 2 selected, adjacent in order; duration
  shown). Film strip shows sequence clips spanning their beats. Intro text updated to say drafts from a
  keyframe keep the face because the still already fixed it.
- `MODEL_NAMES` adds `'bytedance/seedance-2.5/image-to-video': 'Seedance 2.5 · from keyframe'`.

### Gates
`npm test` green (new: `test/keyframes.test.ts`, clips source/mode/sequence tests, server route tests,
`ui.test.ts` step count 8) · `npm run typecheck` · `npm run demo` runs 8 stages ·
dashboard renders the Keyframes step on the demo project with no console errors.

## v6 — Real faces from real photos

- `RefImage.who?`: the person in a selfie/character photo, by name; `SEVERAL_PEOPLE` ("several people") marks a group photo, which never locks a face. Dashboard: a "Who is this?" box (cast names suggested) under every person photo, with a status pill (locks X / run Script to link / group photo / who is this?).
- The script stage sends every person photo to the LLM as a real image (`LlmCall.images`: the CLI gets `--tools Read --allowedTools Read --add-dir <photo dirs>`, `--max-turns 3 + n`), so `baseDescription` carries the real hair, eyes, skin and face. Director's notes still win over the photo; the photo wins over guesses.
- `attachIdentityRefs`: tagged photo (forCharacterId, or `who` = name/id) > the LLM's pick if it is a valid unclaimed one-person photo > the single untagged selfie only when exactly one human is still unlocked.
- `Brief.notes` (v5.x) and any change to brief refs (PATCH or upload, music excepted) stamp `brief`.
- Generation failures lead with a plain headline (`failHeadline`): out of credits, refused login, rate limit, or the HTTP status.

## v6.1 — Your own pictures

A user who already has pictures can add them to a sheet or a scene, either as context or as the final pick, or have Heartcut make a clean sheet (white background, house framing) from one.

### Data (`src/types.ts`, additive)
- `Project.contextRefs?: RefImage[]`. Each has `role: 'context'` (new `RefRole` member) and exactly one of `forAssetId` (a sheet id, == Asset id) or `forSceneId`. Files live in `projects/<slug>/refs/` like brief refs. Same check: png, jpg or webp by magic bytes, 15 MB max.
- Context refs never join `Brief.refs`. The script stage does not read them, and adding one does not stamp `brief`.
- `Provenance` `generated` gains `fromRef?: string`: the context ref a clean sheet option was made from.
- `RunOptions.cleanFrom?: string`: images stage, a context ref id; needs exactly one sheet id in `ids`.
- Store: `contextFor(p, {assetId}|{sceneId})`. Library: `addContextRef`, `removeContextRef`, `replaceContextRef`, `contextFromOption`.
- Adding, replacing or removing a sheet's context stamps `sheets`; a scene's stamps `scenes`.

### Use as final
- Sheets: unchanged `POST …/assets/:id/import` (or `…/assets/import-new`): appended, picked, `sources:{kind:'import'}`. Dependents see the anchor's pick change through `anchorStale`, exactly as with a generated pick, and rebuild from the imported face.
- Scenes: unchanged `POST …/keyframes/kf_<sceneId>_start/import`. It creates the start keyframe when missing (`model:'import'`) and picks it. Clips then use image-to-video from it. The Keyframes stage never has to run.

### Use as context
- Sheets LLM step: the context pictures of the sheets it writes go in `LlmCall.images`, labelled with `photoList()`. `system-sheets.md` says to describe what the picture shows but keep the sheet's own background and framing.
- Images stage: a sheet with context pictures is drawn by the photo edit (`alibaba/qwen-image-3/edit`, or `local/qwen-image-edit` when local edits are on), because every face/place model a style routes to is text-only. `image_urls` = selfie (if locked), then the context pictures; dependents: the anchor face, the selfie, then the context pictures. 4 calls for a context-only edit (4 options, $0.16), the selfie edit keeps its 1. The prompt gains `CONTEXT_CLAUSE`. `estimate()` prices the model that actually runs and its note says why.
- Scenes / keyframes LLM steps: a scene's pictures go in `images` with `photoList()` labels.
- Keyframe edit: `image_urls` = chosen sheets (characters, then location), then the scene's pictures. Price unchanged (flat per call).
- Clips, reference-to-video and one-take: the scene's pictures follow the sheets in `image_urls`, capped at 30 total. Image-to-video (a chosen keyframe) sends no `image_urls`; the estimate note says the pictures are not sent.

### Make a clean sheet from it
- The upload is stored as a context ref of that sheet. Then `run/images {ids:[sheetId], cleanFrom: refId}`.
- Same edit route as the selfie path. `image_urls` = the picture, then the sheet's other context pictures. Prompt = `cleanClause()` + the sheet's own prompt (tags stripped, sheet words scrubbed; built from the script spec when the sheet has no prompt).
- `cleanClause` reuses the house sheet rules: portrait / full body on the white seamless cyclorama with even octabox light (blocks.md STUDIO SHEET BLOCK), animals on plain grey, drawn styles on a plain background in the style's sheet look; framing per kind. Locations: keep the place, remove people, vehicles, text and clutter, light and frame as described.
- 4 calls ($0.16) on Higgsfield, 2 locally. Options are **appended**; `chosen` and `jobId` are untouched, so nothing is auto-picked and dependents of the old pick stay valid. Sources `{kind:'generated', model, fromRef}`.
- A character photo whose `who` is `several people` (or `isGroupWho`) is refused in plan, so the estimate already fails with the reason.
- "Clean this up" on an imported final: `POST …/assets/:id/context {index}` copies that option into a context ref; then the same run.

### API (`src/server.ts`)
- `POST /api/projects/:slug/context {forAssetId|forSceneId, filename, dataBase64, note?, who?}` → 201 view + `ref`.
- `POST /api/projects/:slug/context/:refId/replace {filename, dataBase64}` → view (same id and target).
- `POST /api/projects/:slug/context/:refId/remove` → view (file deleted when no other ref uses it).
- `POST /api/projects/:slug/assets/:assetId/context {index}` → 201 view + `ref`.
- `estimate/images` and `run/images` accept `cleanFrom` (string, else 400).

### Dashboard
- Sheet rows and scene cards share one **Add your picture** control (button, or drop a picture on the row/card): a picture plus a choice. Sheets: Use as final / Use as context / Make a clean sheet from it (with a "more than one person" box). Scenes: Use as the shot / Use as context.
- Context pictures show as small thumbnails on the card with replace and remove. Each sheet context picture has a priced **Clean sheet · $** button (price first, confirm at ≥ $0.50 as everywhere). A row whose options include an import offers **Clean this up…**.
- Scene cards show the chosen shot ("THE SHOT · YOUR PICTURE" or "· KEYFRAME") with an unpick button.
- Clean options carry a `clean` badge and "clean sheet · from your picture".

### Tests
`test/own-pictures.test.ts`: final on a sheet and on a scene with no keyframe, context reaching the Qwen edit / Seedance inputs and the LLM `images`, estimates, clean sheet input / provenance / no auto-pick / several-people refusal, removal, routes.

## v6.2 — LLM providers

Heartcut works with whatever language model the user has. Callers do not change: `llmJson<T>(call: LlmCall)` keeps its signature, and `LlmCall` gains only the optional `llm` (a config to use instead of the saved one).

### Providers (`src/llm/config.ts`)
- `claude-cli`: the default. The `claude` CLI on the subscription. Photos through the Read tool.
- `anthropic`: Messages API. Structured output with `output_config.format` (`json_schema`; every object gets `additionalProperties:false`). No forced tool use (current models reject it). On a 400, falls back to the schema in the system prompt.
- `openai-compatible` with a preset: `openai`, `xai`, `gemini` (Google's OpenAI-compatible endpoint), `openrouter`, `ollama`, `lmstudio`, `custom` (any base URL). Tries `response_format: json_schema` (strict false), then a forced `emit` function call, then `json_object` with the schema in the system prompt. A step down happens only on 400/404/415/422, which are refused before any work. The mode that worked is remembered per server and model.
- Every reply runs through `validate()`. One repair retry when the reply is not JSON or fails the schema, with the error fed back. HTTP errors and timeouts are never retried.
- Images: API providers get them inline as base64 (Anthropic `image` blocks, OpenAI `image_url` data URLs), each after a "Photo N (file name)" text part. `photoList()` keeps its name and argument and reads the active provider: Read-tool wording for the CLI, "Photo N" labels otherwise.
- Tiers: `call.model` (`opus` | `sonnet` | `haiku`) maps to a model id per provider. `models.all` sets one id for every tier. Local presets have no default; the user names the model.
- Fake mode (`HEARTCUT_FAKE=1`) returns before any provider is resolved.

### Settings and keys
- `Settings.llm?: { provider, preset?, baseUrl?, models?: { opus?, sonnet?, haiku?, all? } }` in `projects/_settings.json`. Precedence: saved > env > `claude-cli`.
- Env: `HEARTCUT_LLM_PROVIDER` (or `HEARTCUT_LLM`; `HEARTCUT_LLM=api` still means `anthropic`), `HEARTCUT_LLM_PRESET`, `HEARTCUT_LLM_BASE_URL`, `HEARTCUT_LLM_MODEL`, `HEARTCUT_LLM_MODEL_{OPUS,SONNET,HAIKU}`, `HEARTCUT_LLM_TIMEOUT_MS` (default 300000).
- Keys come only from the environment or the gitignored repo-root `.env` (`src/env.ts`, re-read on each resolve so an edit needs no restart; a real env var wins). Names: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `HEARTCUT_LLM_API_KEY` (custom, and a fallback for any preset). `.env.example` lists them empty.
- Keys are never stored in settings, never printed, never returned. A PATCH with a key-like field is a 400.

### API (`src/server.ts`)
- `GET /api/settings` adds `llm` (saved or absent), `llmStatus {provider, preset, baseUrl, models, source, label, keyEnv, keyRequired, keyFound, error}`, `llmOptions` (providers, presets with default models and key variable names), `fake`.
- `PATCH /api/settings` takes `preferLocal` and/or `llm` (`null` clears it).
- `POST /api/llm/test {llm?}` sends one tiny structured call on the haiku tier and returns `{ok, ms, provider, preset, model, label, error?}`. It runs only when the user clicks; on a paid API it costs a fraction of a cent. In fake mode it sends nothing and returns `fake: true`.

### Dashboard
- Brief step, under Look: a **Language model** group. Provider, service (preset), base URL (custom only), model fields (one for every step, or one per tier), a key indicator naming the variable to set, **Test connection**, and **Reset to default**.

### Tests
`test/llm-providers.test.ts` (request shape per provider, images, schema fallback, retry rules, precedence, `.env` loader, fake short-circuit) and `test/settings-llm.test.ts` (round trip, keys never stored or returned, the test route). Both stub `globalThis.fetch`; no network.

## v7 — Generation providers, spending cap, first-run setup

Heartcut makes pictures and video with whatever the user has. Stages keep calling the same
`src/gen/` shape (`estimate`, `run`, `upload`, `spend`); the provider is chosen underneath.

### Providers (`src/gen/`)
- `higgsfield-tool`: an optional external subprocess tool, used automatically when it is
  present. Nobody needs it.
- `higgsfield`: the public Higgsfield API, `HIGGSFIELD_API_KEY` and `HIGGSFIELD_API_SECRET`.
- `fal`: fal.ai, `FAL_KEY` in `.env`.
- `replicate`: Replicate, `REPLICATE_API_TOKEN` in `.env`.
- Local pictures (v4) are not a provider: a settings switch routes drawn-look sheets to
  `tools/local-image.py` (Apple Silicon, MLX; `tools/requirements-local.txt`). Video always
  uses a provider.
- `src/gen/config.ts`: precedence is saved setting > `HEARTCUT_GEN_PROVIDER` > auto
  (`higgsfield-tool` when present, else the first provider whose key is found: Higgsfield
  API, fal, Replicate).
- Each provider maps the needs in "Model routing" to its own model ids and prices.
  Fake mode (`HEARTCUT_FAKE=1`) returns before any provider is resolved.

### Spending cap (in Heartcut)
- One cap per sitting (the last 6 hours, kept on disk so a restart does not reset it), default $5 (`DEFAULT_CAP_USD`). Saved setting
  `gen.capUsd` > `HEARTCUT_SPEND_CAP` > default.
- A job whose price is unknown before it runs (a clip on a token-metered model) reserves
  $2.50 (`DEFAULT_VIDEO_RESERVE_USD`) against the cap until the real price comes back.
- A run that would go over the cap is refused before submit, with the number.
- `GET /api/spend` reports sitting spend, cap and remaining.

### Setup
- `npm start` serves the dashboard (`PORT`, default 5088).
- `npm run doctor` (or `node src/cli.ts doctor`) prints a checklist: Node version, ffmpeg,
  language model, picture and video provider, keys found (names only, never values),
  media folder.
- The projects page shows a **Get set up** card on first run, with a free demo project.
- `node src/cli.ts new <slug> --title "<t>" [--brief-file f | --brief "<text>" | --example <name>]`
  starts a project from a brief; `--example` reads `examples/<name>.md`.

### Dashboard
- Brief step: a **Pictures and video** group next to **Language model**: provider, key
  indicator naming the variable to set, and the cap.
