// Stage: script — brief text + ref notes -> Script (characters, locations, scene beats).
import type { CharacterSpec, Emit, Estimate, Project, RefImage, RunOptions, Script } from '../types.ts';
import { SEVERAL_PEOPLE } from '../types.ts';
import { llmJson, loadPrompt, photoList } from '../llm.ts';
import { saveProject } from '../store.ts';

const str = { type: 'string' };
const strArr = { type: 'array', items: str };

export const SCRIPT_SCHEMA = {
  type: 'object',
  required: ['logline', 'emotionalCore', 'arc', 'characters', 'locations', 'scenes'],
  properties: {
    logline: str,
    emotionalCore: str,
    arc: str,
    inspiration: str,
    characters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'species', 'baseDescription', 'wardrobe', 'states'],
        properties: {
          id: str, name: str,
          species: { type: 'string', enum: ['human', 'animal', 'other'] },
          baseDescription: str, wardrobe: str,
          states: {
            type: 'array',
            items: { type: 'object', required: ['id', 'label', 'description'], properties: { id: str, label: str, description: str } },
          },
        },
      },
    },
    locations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'description', 'lighting', 'cameraPackage', 'palette'],
        properties: { id: str, name: str, description: str, lighting: str, cameraPackage: str, palette: str },
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'order', 'title', 'era', 'characters', 'locationId', 'cameraSimple', 'actionSimple', 'mood', 'durationSec'],
        properties: {
          id: str, order: { type: 'integer' }, title: str, era: str,
          characters: {
            type: 'array',
            items: { type: 'object', required: ['characterId', 'stateId'], properties: { characterId: str, stateId: str } },
          },
          locationId: str, cameraSimple: str, actionSimple: str, mood: str,
          durationSec: { type: 'number' }, matchCutFrom: str, notes: str,
        },
      },
    },
  },
};

/** The director's notes as a user-message section ('' when there are none). Shared by the script and sheets stages. */
export function notesSection(p: Project): string {
  const n = p.brief.notes?.trim();
  return n ? `# Director's notes (hard facts: they override the brief, the references and any guess)\n${n}\n\n` : '';
}

function refNotes(p: Project): string {
  if (!p.brief.refs.length) return '(no reference images)';
  return p.brief.refs
    .map((r) => `- ${r.id}: role=${r.role}${r.who ? `, who="${r.who}"` : ''}${r.note ? `, note="${r.note}"` : ''}${r.forCharacterId ? `, forCharacter=${r.forCharacterId}` : ''}${r.forLocationId ? `, forLocation=${r.forLocationId}` : ''}`)
    .join('\n');
}

/** A `who` that describes more than one person: "several people", "both", "Cate and Tori", "Cate on left, Tori on right",
 *  or any text naming two or more cast members. Such a photo is described to the script but never locks a face. */
export function isGroupWho(who: string | undefined, castNames: string[] = []): boolean {
  const w = (who ?? '').trim().toLowerCase();
  if (!w) return false;
  if (w === SEVERAL_PEOPLE || /\b(several|group|both|together|everyone|all of them)\b|\s(and|&|\+)\s|\bleft\b[\s\S]*\bright\b|\bright\b[\s\S]*\bleft\b/.test(w)) return true;
  const named = castNames.filter((n) => n && new RegExp(`(?<![\\p{L}])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(w));
  return named.length >= 2;
}
let castForGroup: string[] = [];
const isSeveral = (r: RefImage) => isGroupWho(r.who, castForGroup);
const sameName = (a: string | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
/** Photos that can lock a face: selfie/character refs of one person (a group photo never can). */
export const faceRefs = (p: Project): RefImage[] => { castForGroup = (p.script?.characters ?? []).map((c) => c.name); return p.brief.refs.filter((r) => (r.role === 'selfie' || r.role === 'character') && !isSeveral(r)); };

// Lock each character's face to the right photo. Priority: a photo the director tagged for this character (by id or by
// name in `who`) > the LLM's own pick when it is a valid one-person photo nobody else claimed > the single untagged
// selfie when exactly one human is still unlocked. A group photo or a mood picture never locks a face.
export function attachIdentityRefs(p: Project, script: Script): void {
  castForGroup = script.characters.map((c) => c.name);
  const faces = p.brief.refs.filter((r) => (r.role === 'selfie' || r.role === 'character') && !isSeveral(r));
  const ok = new Set(faces.map((r) => r.id));
  const taken = new Set<string>();
  const tagged = (c: CharacterSpec) => faces.find((r) => r.forCharacterId === c.id) ?? faces.find((r) => sameName(r.who, c.name) || sameName(r.who, c.id));
  for (const c of script.characters) {
    const t = tagged(c);
    if (t) { c.identityRefId = t.id; taken.add(t.id); }
  }
  const claimedByTag = new Set(script.characters.map((c) => tagged(c)?.id).filter(Boolean) as string[]);
  for (const c of script.characters) {
    if (tagged(c)) continue;
    const pick = c.identityRefId;
    const taggedForOther = pick ? faces.find((r) => r.id === pick && (r.who || r.forCharacterId)) : undefined;
    if (pick && ok.has(pick) && !taken.has(pick) && !claimedByTag.has(pick) && !taggedForOther) taken.add(pick);
    else delete c.identityRefId;
  }
  const loose = faces.filter((r) => !r.who && !r.forCharacterId && !taken.has(r.id));
  const unlocked = script.characters.filter((c) => c.species === 'human' && !c.identityRefId);
  if (loose.length === 1 && unlocked.length === 1) unlocked[0].identityRefId = loose[0].id;
}

function tidy(script: Script): void {
  script.scenes.sort((a, b) => a.order - b.order).forEach((s, i) => {
    s.order = i + 1;
    s.durationSec = Math.min(10, Math.max(4, Math.round(s.durationSec)));
  });
}

export async function run(p: Project, _opts: RunOptions, emit: Emit): Promise<Project> {
  emit('writing script from brief');
  // Person photos go to the model as real images so it describes the real hair, eyes, skin and face, not a guess.
  const photos = p.brief.refs.filter((r) => (r.role === 'selfie' || r.role === 'character') && /\.(png|jpe?g|webp|gif)$/i.test(r.path));
  const photoLines = photoList(photos.map((r) => ({ path: r.path, label: `ref ${r.id}, role=${r.role}${r.who ? `, this is ${r.who}` : ''}${isSeveral(r) ? ' (more than one person: describe each, lock no face to it)' : ''}${r.note ? `, note="${r.note}"` : ''}` })));
  if (photos.length) emit(`looking at ${photos.length} photo${photos.length === 1 ? '' : 's'}`);
  const user = `Aspect ratio: ${p.aspect}\n\n# Director's brief\n${p.brief.text}\n\n${notesSection(p)}${photoLines}# Reference images\n${refNotes(p)}`;
  const script = await llmJson<Script>({ system: loadPrompt('system-script'), user, schema: SCRIPT_SCHEMA, maxTokens: 16000, images: photos.map((r) => r.path) });
  tidy(script);
  attachIdentityRefs(p, script);
  p.script = script;
  saveProject(p);
  emit(`script saved: ${script.characters.length} characters, ${script.locations.length} locations, ${script.scenes.length} scenes`);
  return p;
}

export async function estimate(_p: Project, _opts: RunOptions): Promise<Estimate> {
  return { usd: 0, items: [] };
}
