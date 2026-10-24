// Heartcut — shared data model. Every module codes against this file.
// Shared shapes. Add optional fields only; never rename or remove one (docs/CONTRACT.md).

export type Aspect = '16:9' | '9:16' | '1:1' | '4:3' | '21:9';

export type Stage =
  | 'brief'    // human writes the director's brief + uploads refs
  | 'script'   // LLM: brief -> storyline, characters, locations, scene beats
  | 'sheets'   // LLM: character/location sheet prompts (N states per character)
  | 'images'   // Higgsfield: generate sheet images, 4 options each, pick one
  | 'scenes'   // LLM: scene beats -> detailed video prompts (block library)
  | 'keyframes' // LLM + Higgsfield: one still per shot (sheets + location as references, face relit to the scene); optional
  | 'clips'    // Higgsfield: Seedance 2.5 draft (480p) -> final (720p)
  | 'export';  // ffmpeg: concat approved finals, music, upscale, export

export const STAGES: Stage[] = ['brief', 'script', 'sheets', 'images', 'scenes', 'keyframes', 'clips', 'export'];

export type RefRole = 'selfie' | 'character' | 'location' | 'mood' | 'music' | 'context'; // 'context' (v6.1): a user picture attached to one sheet or one scene (Project.contextRefs)

export interface RefImage {
  id: string;
  role: RefRole;
  path: string;          // absolute path under projects/<slug>/refs/
  note?: string;         // "old woman in a mustard cardigan (my own sketch)"
  forCharacterId?: string;
  forLocationId?: string;
  who?: string;          // the person in the photo, as the director names them ("Cate"); SEVERAL_PEOPLE = more than one person
  forAssetId?: string;   // v6.1 context refs: the sheet (SheetPrompt.id == Asset.id) this picture guides
  forSceneId?: string;   // v6.1 context refs: the scene beat this picture guides
}

/** RefImage.who value for a photo with more than one person: never used to lock a face. */
export const SEVERAL_PEOPLE = 'several people';

export interface Brief {
  text: string;          // plain language, "the way I'd tell it to a friend"
  notes?: string;         // director's notes: hard facts (ages, heights, marks, props) that win over anything the LLM would guess
  refs: RefImage[];
  musicPath?: string;
}

export interface CharacterState {
  id: string;            // 'present' | 'past' | anything
  label: string;         // "modern day — wounded", "flashback — clean"
  description: string;   // what differs: scratches, dirt, matted fur...
}

export interface CharacterSpec {
  id: string;
  name: string;
  species: 'human' | 'animal' | 'other';
  // Must carry numeric anchors: age, height, weight — consistency is built on details.
  baseDescription: string;
  wardrobe: string;      // fixed props/clothing that identify them across every frame
  states: CharacterState[];
  identityRefId?: string; // RefImage.id of a selfie/photo to lock the face
}

export interface LocationSpec {
  id: string;
  name: string;
  description: string;
  lighting: string;      // "thick volumetric sunbeams through caved-in roof..."
  cameraPackage: string; // "ARRI Alexa 35, 35–50mm, T1.8, handheld breathing shake"
  palette: string;       // "cold slate blue and grey, one warm amber accent"
  refId?: string;        // RefImage.id
}

export interface SceneBeat {
  id: string;
  order: number;
  title: string;
  era: string;                          // 'present' | 'past' — matches CharacterState.id
  characters: { characterId: string; stateId: string }[];
  locationId: string;
  cameraSimple: string;                 // "static medium shot, no camera movement"
  actionSimple: string;                 // "he reaches up, stops, breathes out, turns the lamp off"
  mood: string;                         // "the 'want to play' moment, emotional center"
  durationSec: number;                  // 4–10
  matchCutFrom?: string;                // sceneId this shot shape-matches into
  notes?: string;
}

export interface Script {
  logline: string;
  emotionalCore: string;   // the one moment the whole film exists for
  arc: string;             // paragraph: how it unfolds, where the reveal lands
  characters: CharacterSpec[];
  locations: LocationSpec[];
  scenes: SceneBeat[];
  inspiration?: string;    // "I Am Legend — played our own way, not copied"
}

export type AssetKind = 'character-portrait' | 'character-full' | 'location';

export interface SheetPrompt {
  id: string;              // becomes Asset.id
  kind: AssetKind;
  characterId?: string;
  stateId?: string;
  locationId?: string;
  dependsOn?: string;      // anchor sheet id: this sheet is built from the anchor's chosen picture (see anchorFor)
  prompt: string;          // full block-library prompt
}

export interface Sheets {
  items: SheetPrompt[];
}

export interface MediaFile {
  path: string;            // absolute, under the project media root
  url?: string;            // provider URL (expires ~7 days) — never rely on it
  width?: number;
  height?: number;
  durationSec?: number;
}

// Where an asset option or a character came from when it was not generated here.
export type Provenance =
  | { kind: 'generated'; model?: string; anchor?: string; fromRef?: string } // fromRef (v6.1): the context RefImage a clean sheet was made from
  | { kind: 'library'; projectSlug: string; assetId: string; index: number }
  | { kind: 'import'; filename: string };

export interface Asset {
  id: string;              // == SheetPrompt.id
  kind: AssetKind;
  characterId?: string;
  stateId?: string;
  locationId?: string;
  prompt: string;
  model: string;           // Higgsfield slug used ('library' | 'import' for adopted options)
  options: MediaFile[];    // 4 variants (adopted/imported options are appended)
  chosen?: number;         // index into options
  jobId?: string;
  costUsd?: number;
  sources?: Provenance[];  // parallel to options; missing entry == generated
  anchorIndex?: number;    // dependents: the anchor's chosen option index when this was generated
  anchorJob?: string;      // dependents: the anchor asset's jobId when this was generated (catches regenerate + re-pick of the same index)
}

// One block of a scene prompt, in block-library order. prompt == blocks.map(b => b.text).join(', ').
export interface PromptBlock {
  name: string;            // SHOT | SUBJECT | IDENTITY | PERFORM | PHYSICS | MATCHCUT | LOCATION | LIGHT | GRADE | CAMERA | QUALITY | NEGATIVES
  text: string;
  locked?: boolean;        // derived from script/sheets (SUBJECT, IDENTITY, LOCATION, LIGHT, GRADE) — edit upstream instead
}

// A reusable thing from any project: a character spec with its chosen sheets, or a location.
export interface LibraryEntry {
  id: string;              // `${projectSlug}:${characterId|locationId}`
  kind: 'character' | 'location';
  projectSlug: string;
  projectTitle: string;
  name: string;
  summary: string;         // baseDescription / description, first 160 chars
  spec: CharacterSpec | LocationSpec;
  sheets: { assetId: string; kind: AssetKind; stateId?: string; file: string; index: number }[]; // chosen options only
  allSheets: { assetId: string; kind: AssetKind; stateId?: string; file: string; index: number; chosen: boolean }[]; // every option of every asset
  updatedAt: string;
}

export interface ScenePrompt {
  sceneId: string;
  prompt: string;          // detailed video prompt, starts with the shot block
  blocks?: PromptBlock[];  // the same prompt split by block; when present the UI edits blocks and re-joins
  negatives: string[];     // "no camera movement", "no zoom", "hard cut not a dissolve"
  refAssetIds: string[];   // character sheets + location to attach as image_urls
  durationSec: number;
  aspect: Aspect;
  audio: boolean;
  motion?: string;         // 2-3 sentences, motion + camera movement only: the short-mode video prompt (written by the scenes stage)
  endFrame?: boolean;      // the user wants an `end` keyframe for this beat too (default false)
}

export type ClipTier = 'draft' | 'final';
/** Which text the clip was made from: every block (`full`) or motion only (`short`, the default from a keyframe). */
export type PromptMode = 'full' | 'short';
/** How a clip was made: from the sheets (reference-to-video), from a chosen still (image-to-video), or one take over several beats. */
export type ClipSource = 'reference' | 'keyframe' | 'sequence';

export interface Clip {
  id: string;
  sceneId: string;
  tier: ClipTier;
  model: string;
  resolution: '480p' | '720p';
  file?: MediaFile;
  jobId?: string;
  costUsd?: number;
  status: 'pending' | 'done' | 'failed';
  approved: boolean;
  createdAt: string;
  source?: ClipSource;     // missing == 'reference'
  mode?: PromptMode;       // missing == 'full'
  sceneIds?: string[];     // sequence clips: every beat covered, in order (sceneId == sceneIds[0])
  prompt?: string;         // the exact text sent, so the A/B can be read back
}

// --- keyframes (v5): one still per shot, made from the chosen sheets, then animated ---

export type KeyframeRole = 'start' | 'end';

/** Block names of a keyframe prompt, in order. No PERFORM/PHYSICS/MATCHCUT: a still has POSE (the frozen instant) instead. */
export const KEYFRAME_BLOCKS = ['SHOT', 'SUBJECT', 'IDENTITY', 'POSE', 'LOCATION', 'LIGHT', 'GRADE', 'CAMERA', 'LOOK', 'QUALITY', 'NEGATIVES'] as const;

export interface Keyframe {
  id: string;               // `kf_${sceneId}_${role}`
  sceneId: string;
  role: KeyframeRole;
  prompt: string;           // == blocks joined + negatives (see stages/keyframes.ts joinKeyframe)
  blocks?: PromptBlock[];   // KEYFRAME_BLOCKS order
  negatives: string[];
  refAssetIds: string[];    // chosen full-body sheets of the beat's characters + the location sheet
  model: string;            // 'alibaba/qwen-image-3/edit' | 'import'
  options: MediaFile[];     // 2 generated options per run (+ imports)
  chosen?: number;
  sources?: Provenance[];   // parallel to options; missing entry == generated
  jobId?: string;
  costUsd?: number;
}

export type JobKind = 'script' | 'sheets' | 'scenes' | 'keyframe' | 'image' | 'clip' | 'export';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  projectSlug: string;
  kind: JobKind;
  stage: Stage;
  model?: string;
  targetId?: string;       // assetId / clipId / sceneId
  input?: unknown;
  estimateUsd?: number;
  actualUsd?: number;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  outputs: MediaFile[];
  log: string[];           // human-readable progress lines
  error?: string;
}

export interface ExportResult {
  file: MediaFile;
  resolution: '1080p' | '4k';
  sceneOrder: string[];
  musicPath?: string;
  createdAt: string;
}

export interface Spend {
  projectUsd: number;      // sum of actualUsd over this project's jobs
  sittingUsd: number;      // from higgsfield.mjs spend (rolling 6h)
  capUsd: number;
  remainingUsd: number;
  fake?: boolean;          // server runs with HEARTCUT_FAKE=1: placeholders, no Higgsfield calls
}

// The visual style of a whole project. Injected into every sheet and scene prompt and used to route
// image models. Built-ins live in prompts/styles.json; user styles in projects/_styles.json.
export type StyleFamily = 'photoreal' | 'film' | 'anime' | 'cartoon' | 'illustration' | '3d' | 'custom';

export interface StyleSpec {
  id: string;
  name: string;
  family: StyleFamily;
  description: string;     // one line for the picker card
  look: string;            // LOOK block: medium, rendering, line, colour, texture — replaces the realism vocabulary
  sheetLook?: string;      // override for character/location sheets (background, framing in this medium)
  negatives: string[];     // style guards, e.g. ["no photorealism", "no 3D render"]
  videoHints: string;      // appended to every scene prompt for Seedance ("2D anime, cel shading, limited animation")
  models: { faces: string; places: string; identity?: string }; // Higgsfield slugs
  soulStyleId?: string;    // only when models.faces is Soul 2
  builtin?: boolean;
  updatedAt?: string;
}

export interface Project {
  id: string;
  style?: StyleSpec;       // snapshot of the chosen style; missing == the built-in 'cinematic-realism'
  slug: string;
  title: string;
  owner: 'viaPolaris';
  aspect: Aspect;
  createdAt: string;
  updatedAt: string;
  brief: Brief;
  script?: Script;
  sheets?: Sheets;
  assets: Asset[];
  scenePrompts?: ScenePrompt[];
  keyframes?: Keyframe[];  // v5, optional stage between scenes and clips
  contextRefs?: RefImage[]; // v6.1: the user's own pictures attached to one sheet (forAssetId) or one scene (forSceneId) as guidance; files in projects/<slug>/refs/
  clips: Clip[];
  exports: ExportResult[];
  jobs: Job[];
  approvals: Partial<Record<Stage, string>>;  // ISO timestamp when stage was approved
  stamps?: Partial<Record<Stage, string>>;    // ISO timestamp of the last change to that stage's content
}

// Computed by the server on every GET: a stage is stale when any upstream stage changed after it.
export type Staleness = Partial<Record<Stage, { stale: boolean; because?: Stage }>>;

export interface RunOptions {
  dryRun?: boolean;        // price everything, generate nothing, write placeholder outputs
  ids?: string[];          // restrict to these asset/scene/clip ids
  tier?: ClipTier;         // clips stage
  resolution?: '1080p' | '4k'; // export stage
  force?: boolean;         // regenerate even if present
  model?: string;          // override routing
  promptMode?: PromptMode; // clips stage: which text to send (default: short from a keyframe, full otherwise)
  sequence?: boolean;      // clips stage: ONE clip over every id in `ids` (>= 2, beat order), hard cuts inside it
  cleanFrom?: string;      // images stage (v6.1): context RefImage id; make clean sheet options for the one sheet in `ids` from that picture
}

export interface Estimate {
  usd: number;
  items: { id: string; model: string; usd: number; note?: string }[];
}

export type Emit = (line: string) => void;
