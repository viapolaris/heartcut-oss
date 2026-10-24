// Demo brief + canned LLM outputs used under HEARTCUT_FAKE=1 (and by `heartcut demo`).
// An original story written for this repo: an old orchard keeper and her old pony, one apple carrying
// the cut between two eras. The prompts follow the block grammar in prompts/blocks.md (numeric anchors,
// a fixed wardrobe line, camera blocks, small expressions, physical verbs, explicit "no ..." lines).
// No real films, studios or actors are named in any prompt.
import type { PromptBlock, ScenePrompt, Script, Sheets, SheetPrompt } from '../types.ts';
import { KEYFRAME_BLOCKS } from '../types.ts';

export const DEMO_BRIEF = `An old woman who has kept an apple orchard all her life goes out to the stable on a frozen morning. Her pony is very old now. One eye has gone cloudy, her back sags, and she can hardly put weight on one front leg. Today the vet is coming, and the old woman knows what that means. She stands in the doorway holding the halter rope and tries to be brave about it.

She does not say goodbye. She kneels down in the straw, puts her basket aside and takes one red apple out of her pocket. She rolls it slowly across the floor. It wobbles through the straw and comes to rest against the pony's hoof.

Then we cut on that same apple, framed exactly the same, but now it is lying in long summer grass forty years earlier. A young grey pony snatches it and crunches it. The woman is young too. They run through the orchard together, the pony knocks her basket over, and she falls back into the grass laughing. We finish very far away: the two of them on the hill by the old pear tree at dusk, her sitting on the stone wall cutting slices of apple and handing them over one by one. Quiet, gentle, and a little sad.`;

const ILSE_BASE = 'a 71-year-old woman, 163 cm tall, 58 kg, narrow and upright, long white hair in one thick plait over her shoulder, pale grey-green eyes, a small white scar across her chin';
const ILSE_WARDROBE = 'mustard-yellow knitted cardigan with wooden toggle buttons, faded blue cotton headscarf, brass pocket knife on a green cord around her neck, wicker basket on her left arm';
const FENNA_BASE = 'a dapple-grey pony mare, 27 years old, 142 cm at the withers, about 380 kg, a white star on her forehead, a dark mane, a small nick in her right ear';
const FENNA_WARDROBE = 'worn red leather halter with a brass nameplate, plaited blue wool browband';

const ILSE_PRESENT = 'tired, hands red and chapped from the cold, mud on her boots and on the hem of the cardigan, the left pocket torn at one corner, slow and careful in every movement';
const ILSE_PAST = 'rested and clean, the cardigan new with bright unfaded wool, standing tall with her shoulders back, a wide unguarded smile that reaches her eyes';
const FENNA_PRESENT = 'old and stiff but dignified, a sagging back, a cloudy left eye, a thin dull winter coat, standing with the weight off her left foreleg, no wounds, no blood, not starved';
const FENNA_PAST = 'young and strong, a glossy dappled coat, both eyes clear and dark, a full thick mane, alert ears, a light springy stance';

export const FAKE_SCRIPT: Script = {
  logline: 'On the morning the vet is due, an old orchard keeper rolls one last apple to her old pony, and the apple carries us back to the summer they were both young.',
  emotionalCore: 'She kneels in the straw and rolls a red apple to the mare: the small daily gift, offered one more time, where goodbye turns into memory.',
  arc: 'Present: a frozen stable, an old woman and her failing pony, a goodbye she cannot say out loud. She kneels and rolls an apple across the boards. A match cut on the apple takes us into a summer orchard: the same pony young and quick, the same woman young and laughing. We end far away on the hilltop at dusk, the two of them sharing apple slices by the wall. Soft light on both sides of the cut, so the sadness comes from the story and not from darkness.',
  characters: [
    {
      id: 'ilse', name: 'Ilse', species: 'human',
      baseDescription: ILSE_BASE,
      wardrobe: ILSE_WARDROBE,
      states: [
        { id: 'present', label: 'present day, worn out', description: ILSE_PRESENT },
        { id: 'past', label: 'flashback, young summer', description: ILSE_PAST },
      ],
    },
    {
      id: 'fenna', name: 'Fenna', species: 'animal',
      baseDescription: FENNA_BASE,
      wardrobe: FENNA_WARDROBE,
      states: [
        { id: 'present', label: 'present day, very old', description: FENNA_PRESENT },
        { id: 'past', label: 'flashback, young', description: FENNA_PAST },
      ],
    },
  ],
  locations: [
    {
      id: 'barn', name: 'Winter stable',
      description: 'an old timber stable at dawn, loose straw over wide worn floorboards, a cold iron lantern on a nail, frost on the small four-pane window, an empty hay rack, a stall door with the name FENNA painted on it in white',
      lighting: 'thin blue dawn light through the frosted window and the open door, a pale shaft across the straw, breath visible in the cold air, deep soft shadow in the corners',
      cameraPackage: 'shot on a large-format digital cinema camera, 35 to 50 mm, fast stop, gentle handheld sway, soft highlight roll-off, true film colour, fine grain',
      palette: 'cold slate blue and pale straw gold, with dark weathered wood',
    },
    {
      id: 'orchard', name: 'Summer orchard',
      description: 'rows of old gnarled apple trees in long uncut grass, red and green apples fallen in the grass, a wooden ladder leaning on a trunk, white beehives at the far edge, a low dry-stone wall along one side',
      lighting: 'high summer afternoon sun through the leaves, dappled patches of light moving on the grass, warm haze, bright backlit leaf edges',
      cameraPackage: 'shot on a large-format digital cinema camera, 24 to 85 mm, relaxed handheld float, warm soft contrast, soft highlight roll-off, true film colour, fine grain',
      palette: 'deep summer green, apple red and warm honey yellow',
    },
    {
      id: 'hill', name: 'Hilltop wall',
      description: 'a dry-stone wall running along the top of a grassy hill above the orchard, one big old pear tree leaning over it, the valley and its fields spread out below',
      lighting: 'dusk after sunset, a soft peach and lavender sky, low even light with no hard shadows, light mist settling in the valley',
      cameraPackage: 'shot on a large-format digital cinema camera, long lens around 200 mm, very slow drift, soft highlight roll-off, true film colour, fine grain',
      palette: 'peach, lavender and muted sage green',
    },
  ],
  scenes: [
    { id: 's1', order: 1, title: 'The stable door', era: 'present', characters: [{ characterId: 'ilse', stateId: 'present' }], locationId: 'barn', cameraSimple: 'close-up, gentle handheld sway, no zoom', actionSimple: 'she stands in the stable door at dawn holding the halter rope, her breath misting, her jaw set hard, her eyes fill but she does not cry, she looks down at the rope in her hands', mood: 'grief held in', durationSec: 8 },
    { id: 's2', order: 2, title: 'The mare in her stall', era: 'present', characters: [{ characterId: 'ilse', stateId: 'present' }, { characterId: 'fenna', stateId: 'present' }], locationId: 'barn', cameraSimple: 'over-the-shoulder past her, focus on the mare, handheld', actionSimple: 'the old mare stands in her stall three meters away, ears flicking toward the door, she shifts her weight off the bad leg', mood: 'tender and uneasy', durationSec: 5 },
    { id: 's3', order: 3, title: 'An old horse breathing', era: 'present', characters: [{ characterId: 'fenna', stateId: 'present' }], locationId: 'barn', cameraSimple: 'static medium shot, locked off, no camera movement, no zoom', actionSimple: 'she lowers her head, lets out one slow breath through her nose, a tremor runs down the foreleg', mood: 'calm, tired, dignified', durationSec: 5 },
    { id: 's4', order: 4, title: 'One apple', era: 'present', characters: [{ characterId: 'ilse', stateId: 'present' }, { characterId: 'fenna', stateId: 'present' }], locationId: 'barn', cameraSimple: 'medium shot, the camera lowers with her as she kneels', actionSimple: 'she kneels in the straw, sets the basket down, takes one red apple from her pocket, rolls it across the floorboards toward the mare', mood: 'the daily gift, one more time, the heart of the film', durationSec: 8, notes: 'emotional core of the film' },
    { id: 's5', order: 5, title: 'The apple stops', era: 'present', characters: [{ characterId: 'fenna', stateId: 'present' }], locationId: 'barn', cameraSimple: 'extreme low angle at board level, locked camera height, apple centered', actionSimple: 'the apple rolls through the straw, wobbles, slows, stops against her front hoof, the frame holds still', mood: 'everything waits', durationSec: 5 },
    { id: 's6', order: 6, title: 'The same apple in summer', era: 'past', characters: [{ characterId: 'fenna', stateId: 'past' }], locationId: 'orchard', cameraSimple: 'same framing and same camera height as the shot before, locked', actionSimple: 'the same red apple lies in long summer grass, the young mare drops her head into frame, takes it and crunches it', mood: 'summer arriving all at once', durationSec: 5, matchCutFrom: 's5' },
    { id: 's7', order: 7, title: 'Running the rows', era: 'past', characters: [{ characterId: 'ilse', stateId: 'past' }, { characterId: 'fenna', stateId: 'past' }], locationId: 'orchard', cameraSimple: 'high wide shot over the orchard rows, slow drift', actionSimple: 'young Ilse runs between the trees, the mare canters beside her, hooves throw up grass, fallen apples roll away from them', mood: 'free and young', durationSec: 8 },
    { id: 's8', order: 8, title: 'The basket goes over', era: 'past', characters: [{ characterId: 'ilse', stateId: 'past' }, { characterId: 'fenna', stateId: 'past' }], locationId: 'orchard', cameraSimple: 'close-up that moves with them, handheld', actionSimple: 'she laughs as the mare nudges her shoulder, the basket tips and apples tumble out, she falls back into the grass laughing, the mare lips at her plait', mood: 'easy, silly joy', durationSec: 6 },
    { id: 's9', order: 9, title: 'Slices on the hill', era: 'past', characters: [{ characterId: 'ilse', stateId: 'past' }, { characterId: 'fenna', stateId: 'past' }], locationId: 'hill', cameraSimple: 'extreme wide from across the valley, long lens', actionSimple: 'they rest on the hilltop by the pear tree, she sits on the wall cutting an apple with the pocket knife, holds out a slice, the mare takes it gently, nothing moves much', mood: 'still, warm, a little sad', durationSec: 10 },
  ],
  inspiration: 'A small story about an old animal and the person who loves it: soft light, no melodrama, one ordinary object carrying the cut between two eras.',
};

const PORTRAIT_TAIL = 'plain white studio backdrop, soft even front light, no strong shadows, medium-format portrait look, 85mm lens, f/5.6, fine skin detail with wrinkles and pores left in, natural untouched skin, single hairs visible in the plait, the knit of the wool and the grain of the wooden toggles visible, sharp detail, photorealistic, honest and plain';
const FULL_TAIL = 'plain white studio backdrop, soft even light from the front and both sides, a faint shadow on the floor under the feet, full-frame stills camera, 50mm lens, f/8, in focus from head to feet, the stitches, the leather and the scuffs visible, sharp detail, photorealistic, honest and plain';

function characterSheets(): SheetPrompt[] {
  const items: SheetPrompt[] = [];
  const ilse = FAKE_SCRIPT.characters[0];
  const fenna = FAKE_SCRIPT.characters[1];
  const wear: Record<string, string> = { present: ILSE_PRESENT, past: ILSE_PAST };
  const ponyWear: Record<string, string> = { present: FENNA_PRESENT, past: FENNA_PAST };
  for (const s of ilse.states) {
    items.push({
      id: `ilse_${s.id}_portrait`, kind: 'character-portrait', characterId: 'ilse', stateId: s.id,
      prompt: `realistic studio photograph, close-up portrait, head and shoulders, ${ilse.baseDescription}, looking straight into the lens, ${wear[s.id]}, ${ilse.wardrobe}, quiet neutral face, ${PORTRAIT_TAIL}, no makeup`,
    });
    items.push({
      id: `ilse_${s.id}_full`, kind: 'character-full', characterId: 'ilse', stateId: s.id,
      prompt: `realistic studio photograph, full length, head to boots, ${ilse.baseDescription}, standing upright facing the lens, ${wear[s.id]}, ${ilse.wardrobe}, a long brown wool skirt, thick grey socks, laced brown leather work boots with worn heels, the same face and the same props as the portrait, earthy palette of mustard, faded blue, brown and grey, ${FULL_TAIL}`,
    });
  }
  for (const s of fenna.states) {
    items.push({
      id: `fenna_${s.id}_full`, kind: 'character-full', characterId: 'fenna', stateId: s.id,
      prompt: `full body studio photograph, head to tail, ${fenna.baseDescription}, standing square and quiet, seen from the side turned slightly toward the lens, ${ponyWear[s.id]}, ${fenna.wardrobe}, the same face and the same markings in every picture, a real working pony, no saddle, no rider, no fantasy look, ${FULL_TAIL}`,
    });
  }
  return items;
}

// Anchor chaining: Ilse's first portrait and Fenna's first full body lock the face; everything else of theirs is built from it.
const ANCHORS: Record<string, string> = {
  ilse_present_full: 'ilse_present_portrait', ilse_past_portrait: 'ilse_present_portrait', ilse_past_full: 'ilse_present_portrait',
  fenna_past_full: 'fenna_present_full',
};

export const FAKE_SHEETS: Sheets = {
  items: [
    ...characterSheets().map((s): SheetPrompt => (ANCHORS[s.id] ? { ...s, dependsOn: ANCHORS[s.id] } : s)),
    ...FAKE_SCRIPT.locations.map((l): SheetPrompt => ({
      id: `loc_${l.id}`, kind: 'location', locationId: l.id,
      prompt: `wide photograph of an empty place, no people, no animals, ${l.description}, ${l.lighting}, ${l.palette}, ${l.cameraPackage}, natural colour, no HDR look, photorealistic, no text, no watermark`,
    })),
  ],
};

const ILSE_P_LINE = `${ILSE_BASE}, ${ILSE_WARDROBE}, ${ILSE_PRESENT}`;
const ILSE_Q_LINE = `${ILSE_BASE}, ${ILSE_WARDROBE}, ${ILSE_PAST}`;
const QUALITY = 'photorealistic, cinematic, natural detail';
const LOCKED = new Set(['SUBJECT', 'IDENTITY', 'LOCATION', 'LIGHT', 'GRADE']);
const ORDER = ['SHOT', 'SUBJECT', 'IDENTITY', 'PERFORM', 'PHYSICS', 'MATCHCUT', 'LOCATION', 'LIGHT', 'GRADE', 'CAMERA', 'QUALITY'] as const;
type Parts = Partial<Record<(typeof ORDER)[number], string>>;

// One scene as the model returns it: blocks in library order (MATCHCUT only on the match-cut beat),
// NEGATIVES last, and prompt == the blocks joined with ', ' (same rule as joinBlocks in stages/scenes.ts).
function sc(sceneId: string, durationSec: number, parts: Parts, negatives: string[], refs: string[], motion: string): ScenePrompt {
  const blocks: PromptBlock[] = ORDER.filter((n) => parts[n]).map((n) => (LOCKED.has(n) ? { name: n, text: parts[n]!, locked: true } : { name: n, text: parts[n]! }));
  blocks.push({ name: 'NEGATIVES', text: negatives.join(', ') });
  return { sceneId, prompt: blocks.map((b) => b.text).join(', '), blocks, negatives, refAssetIds: refs, durationSec, aspect: '16:9', audio: false, motion };
}

const CAM = 'shot on a large-format digital cinema camera, soft highlight roll-off, true film colour, fine grain';

export const FAKE_SCENES: ScenePrompt[] = [
  sc('s1', 8, {
    SHOT: 'continuous single take, close-up',
    SUBJECT: 'an old woman {{char:ilse}} standing in the open door of a timber stable at dawn, a halter rope in both hands {{loc:barn}}',
    IDENTITY: ILSE_P_LINE,
    PERFORM: 'small real expressions the whole time: her jaw is set hard, her lips press together, her eyes fill with water and she blinks slowly, her chin gives one small shake, she does not cry',
    PHYSICS: 'her breath comes out as mist in the cold air, her thumbs work along the rope, she draws one long breath and lets it out, then lowers her eyes to the rope in her hands',
    LOCATION: 'the doorway of an old timber stable, straw on the floorboards behind her far out of focus, frost on the small window',
    LIGHT: 'thin blue dawn light from outside on one side of her face, a little warm spill from inside the stable, breath catching the light',
    GRADE: 'cold slate blue with pale straw gold',
    CAMERA: `gentle handheld sway, 50mm, fast stop, shallow focus, ${CAM}`,
    QUALITY,
  }, ['no cuts', 'no zoom', 'no sobbing'], ['ilse_present_full', 'loc_barn'],
    'She stands in the doorway with the rope in both hands, breath misting. Her eyes fill and she blinks it back, then looks down at the rope. Gentle handheld sway, no zoom.'),
  sc('s2', 5, {
    SHOT: "over-the-shoulder shot past an old woman's shoulder and her headscarf, focus on the pony",
    SUBJECT: 'an old dapple-grey pony mare {{char:fenna}}, about 380 kg, standing in her stall three meters away, facing the door {{loc:barn}}',
    IDENTITY: `${FENNA_PRESENT}, ${FENNA_WARDROBE}`,
    PERFORM: 'her ears flick toward the door and back, she shifts her weight off the bad front leg, calm but uneasy, old not pitiful',
    LOCATION: 'a wooden stall with her name painted on the door, straw on the floor, an empty hay rack',
    LIGHT: 'a pale shaft of dawn light across the straw',
    GRADE: 'cold blue with a little straw gold',
    CAMERA: 'light handheld sway, 35mm',
    QUALITY,
  }, ['no zoom', 'no wounds'], ['ilse_present_full', 'fenna_present_full', 'loc_barn'],
    'The mare flicks her ears toward the door and shifts her weight off the bad leg. The camera stays behind the woman\'s shoulder with a small sway and keeps the mare sharp.'),
  sc('s3', 5, {
    SHOT: 'static medium shot, locked off',
    SUBJECT: 'an old dapple-grey pony mare {{char:fenna}}, about 380 kg, standing side-on in a straw-covered stall in a timber stable {{loc:barn}}',
    IDENTITY: `${FENNA_PRESENT}, ${FENNA_WARDROBE}`,
    PERFORM: 'she lowers her head slowly, lets one long breath out through her nostrils, the cloudy eye half closes, calm and tired, dignified',
    PHYSICS: 'a small tremor runs down the left foreleg and the hoof lifts a little off the boards, the dull winter coat stirs with her breath',
    LOCATION: 'wide worn floorboards under loose straw, a cold iron lantern on the wall behind her, frost on the window',
    LIGHT: 'blue dawn light from the window falling along her back, deep soft shadow behind her',
    GRADE: 'cold slate blue and straw gold',
    CAMERA: `50mm, ${CAM}`,
    QUALITY,
  }, ['no camera movement', 'no zoom', 'no blood'], ['fenna_present_full', 'loc_barn'],
    'She lowers her head and lets out one slow breath. A tremor runs down the left foreleg. The camera is locked off, no movement.'),
  sc('s4', 8, {
    SHOT: 'medium shot, the camera lowering with her as she kneels',
    SUBJECT: 'an old woman {{char:ilse}} kneeling down slowly in the straw of a timber stable {{loc:barn}}',
    IDENTITY: ILSE_P_LINE,
    PERFORM: 'she lets out a shaky breath, a small tired smile, she murmurs something to the pony off frame',
    PHYSICS: 'one knee then the other goes down into the straw, she sets the wicker basket beside her, reaches into the torn cardigan pocket, takes out one red apple, turns it once in her fingers and rolls it across the floorboards, the apple bumping over the gaps and pushing through the straw',
    LOCATION: 'the inside of an old timber stable, straw on wide floorboards, the stall door behind',
    LIGHT: 'a pale dawn shaft from the door across the floor, soft bounce off the straw',
    GRADE: 'cold slate blue and straw gold',
    CAMERA: `handheld, lowering with her, 35mm, shallow focus, ${CAM}`,
    QUALITY,
  }, ['no zoom', 'no cut'], ['ilse_present_full', 'fenna_present_full', 'loc_barn'],
    'She kneels in the straw, sets down the basket, takes an apple from her pocket and rolls it across the boards. The camera lowers with her as she goes down.'),
  sc('s5', 5, {
    SHOT: 'extreme low angle close-up at floorboard level, locked camera height throughout',
    SUBJECT: "a red apple rolling through straw across the floor of a timber stable {{loc:barn}}, toward an old grey pony's front hoof {{char:fenna}}",
    IDENTITY: `${FENNA_PRESENT}, only her legs and hooves in shot`,
    PHYSICS: 'the apple rolls over the boards, catches on straw, wobbles, slows down and comes to rest against the front hoof, a few straws settle, then nothing moves for a beat',
    LOCATION: 'worn floorboards, loose straw, a crack of cold light under the stall door',
    LIGHT: 'a low pale shaft of dawn light across the boards',
    GRADE: 'cold slate blue and straw gold',
    CAMERA: `50mm, shallow focus, ${CAM}`,
    QUALITY,
  }, ['no face in shot', 'no camera movement after the apple stops'], ['fenna_present_full', 'loc_barn'],
    'The apple rolls through the straw, wobbles, slows and stops against her front hoof. The camera holds at board level and goes completely still.'),
  sc('s6', 5, {
    SHOT: 'extreme low angle close-up at ground level, the same framing and the same camera height as the shot before',
    SUBJECT: 'a young dapple-grey pony mare {{char:fenna}}, about 380 kg, drops her head into frame and takes a red apple from the grass {{loc:orchard}}',
    IDENTITY: `${FENNA_PAST}, ${FENNA_WARDROBE}`,
    PHYSICS: 'her lips find the apple, she lifts it and bites down, juice and bits of apple spraying, grass bending under her muzzle',
    MATCHCUT: 'the same red apple lies still in long summer grass, a clean cut on the resting apple, the apple is the one thing that stays the same across the cut, a straight cut and not a dissolve',
    LOCATION: 'long uncut grass in an old orchard, fallen apples, tree trunks soft and far behind',
    LIGHT: 'high summer sun through leaves, moving dapples on the grass',
    GRADE: 'warm summer green with soft bloom',
    CAMERA: `50mm, shallow focus, ${CAM}`,
    QUALITY,
  }, ['no morphing', 'no blending', 'no dissolve'], ['fenna_past_full', 'loc_orchard'],
    'The apple lies still for a beat, then her head drops into frame, takes it and crunches it. The camera stays locked at ground level.'),
  sc('s7', 8, {
    SHOT: 'high wide shot looking down over the rows of an orchard from above the trees',
    SUBJECT: 'a young woman {{char:ilse}} running between the apple trees {{loc:orchard}}, with her young dapple-grey pony mare {{char:fenna}} cantering beside her',
    IDENTITY: `${ILSE_Q_LINE}; ${FENNA_PAST}, ${FENNA_WARDROBE}`,
    PHYSICS: 'one unbroken action: she runs down the row with her plait flying, the mare canters level with her, hooves kicking up tufts of grass, fallen apples knocked rolling away from them, they turn together at the end of the row',
    LOCATION: 'the whole orchard seen from above, rows of old apple trees in long grass, a ladder against one trunk, white beehives at the far edge, the dry-stone wall along one side',
    LIGHT: 'high afternoon sun, short dappled shadows of the trees, the runners\' shadows moving with them',
    GRADE: 'deep green, apple red and honey yellow',
    CAMERA: `slow drift from height, 24mm, ${CAM}`,
    QUALITY,
  }, ['no zoom', 'no hard cuts'], ['ilse_past_full', 'fenna_past_full', 'loc_orchard'],
    'She runs between the trees and the mare canters beside her, hooves throwing up grass, apples rolling away. The camera drifts slowly from high above, no zoom.'),
  sc('s8', 6, {
    SHOT: 'close-up that moves with them',
    SUBJECT: 'a young woman {{char:ilse}} in the long orchard grass with her young dapple-grey pony mare {{char:fenna}} {{loc:orchard}}',
    IDENTITY: `${ILSE_Q_LINE}; ${FENNA_PAST}, ${FENNA_WARDROBE}`,
    PERFORM: 'she laughs out loud, a real open laugh, clean summer skin',
    PHYSICS: 'the mare pushes her muzzle into her shoulder, the wicker basket tips and apples tumble out over the grass, she falls back into the grass laughing, the mare lowers her head and lips at the end of her plait',
    LOCATION: 'long grass under old apple trees, fallen apples, a trunk soft in the background',
    LIGHT: 'summer sun through leaves, moving dapples, bright leaf edges',
    GRADE: 'deep green and honey yellow, soft bloom',
    CAMERA: `handheld, moving with them, 35mm, ${CAM}`,
    QUALITY,
  }, ['no mud on her', 'no grey hair'], ['ilse_past_full', 'fenna_past_full', 'loc_orchard'],
    'The mare nudges her shoulder, the basket tips and apples tumble, and she falls back into the grass laughing while the mare nibbles at her plait. Handheld and close, moving with them.'),
  sc('s9', 10, {
    SHOT: 'extreme wide shot from far across the valley',
    SUBJECT: 'a young woman {{char:ilse}} and her young dapple-grey pony mare {{char:fenna}} on the top of a grassy hill by a big old pear tree {{loc:hill}}, both small in the frame',
    IDENTITY: `${ILSE_Q_LINE}; ${FENNA_PAST}, ${FENNA_WARDROBE}`,
    PERFORM: 'unhurried and quiet, nothing moves much',
    PHYSICS: 'she sits on the stone wall cutting an apple with the brass pocket knife, holds out a slice on her flat palm, the mare reaches over and takes it gently, she cuts the next slice',
    LOCATION: 'a dry-stone wall along the hilltop, the pear tree leaning over it, fields and the orchard below in the valley',
    LIGHT: 'dusk after sunset, peach and lavender sky, low soft light, mist gathering below',
    GRADE: 'peach, lavender and muted sage',
    CAMERA: 'long lens around 200 mm, very slow drift, soft contrast, fine grain',
    QUALITY,
  }, ['no zoom', 'no fast movement'], ['ilse_past_full', 'fenna_past_full', 'loc_hill'],
    'She sits on the wall cutting an apple and holds out a slice; the mare takes it gently. Seen from far across the valley on a long lens, a slow drift, nothing moves much.'),
];

// --- keyframes (v5): one `start` still per FAKE_SCENES beat, as the model returns it (raw blocks + negatives) ---
export interface RawKeyframe { sceneId: string; role: 'start' | 'end'; blocks: PromptBlock[]; negatives: string[] }

const RELIGHT = 'her face and clothes take this scene\'s light, no leftover white studio light on the skin';
const PONY_RELIGHT = 'her head and coat take this scene\'s light, no leftover white studio light on the coat';
const KF_QUALITY = 'photorealistic still frame from a film, sharp natural detail';
const KF_NEG = ['no waxy skin', 'no oversharpening', 'no oversaturated colours', 'no text', 'no subtitles', 'no logos'];

type KfParts = Partial<Record<(typeof KEYFRAME_BLOCKS)[number], string>>;
function kf(sceneId: string, parts: KfParts, negatives: string[]): RawKeyframe {
  const blocks: PromptBlock[] = KEYFRAME_BLOCKS.filter((n) => n !== 'NEGATIVES' && parts[n]).map((n) => ({ name: n, text: parts[n]! }));
  const neg = [...negatives, ...KF_NEG];
  blocks.push({ name: 'NEGATIVES', text: neg.join(', ') });
  return { sceneId, role: 'start', blocks, negatives: neg };
}

const kfOf = (sceneId: string, pose: string, relight: string, extraNeg: string[] = []): RawKeyframe => {
  const sp = FAKE_SCENES.find((x) => x.sceneId === sceneId)!;
  const t = (n: string) => sp.blocks!.find((b) => b.name === n)?.text ?? '';
  return kf(sceneId, {
    SHOT: t('SHOT').replace(/^continuous single take, /, ''),
    SUBJECT: t('SUBJECT'),
    IDENTITY: t('IDENTITY'),
    POSE: pose,
    LOCATION: t('LOCATION'),
    LIGHT: `${t('LIGHT')}, ${relight}`,
    GRADE: t('GRADE'),
    CAMERA: t('CAMERA'),
    QUALITY: KF_QUALITY,
  }, extraNeg);
};

export const FAKE_KEYFRAMES: RawKeyframe[] = [
  kfOf('s1', 'held still in the doorway: the rope in both hands, a breath of mist leaving her lips, jaw set, eyes wet and open', RELIGHT, ['no zoom']),
  kfOf('s2', 'held mid-shift: the mare with one ear turned to the door, her weight just coming off the bad leg, the woman\'s shoulder and headscarf soft in the foreground', PONY_RELIGHT, ['no wounds']),
  kfOf('s3', 'held mid-breath: head low, nostrils flared on the out-breath, the left hoof just lifted off the boards', PONY_RELIGHT, ['no blood']),
  kfOf('s4', 'held mid-roll: kneeling in the straw, the basket beside her, her hand open just after letting the apple go, a small tired smile', RELIGHT),
  kfOf('s5', 'held mid-roll: the red apple a hand\'s width from her front hoof, straw lifting behind it', PONY_RELIGHT, ['no face in shot']),
  kfOf('s6', 'held mid-bite: the young mare\'s muzzle just closing on the red apple in the long grass', PONY_RELIGHT, ['no morphing']),
  kfOf('s7', 'held mid-stride: she is in full run with her plait flying out, the mare beside her with one front hoof up, grass tufts in the air', RELIGHT),
  kfOf('s8', 'held mid-fall: she is tipping back into the grass laughing, apples in the air from the basket, the mare\'s muzzle at her shoulder', RELIGHT, ['no mud on her']),
  kfOf('s9', 'held mid-offer: she holds a slice out on her flat palm from her seat on the wall, the mare leaning in, both small under the pear tree', RELIGHT),
];

/** The `end` keyframe of a beat as the fake backend returns it: the start still with POSE at the beat's last instant. */
export function fakeEndKeyframe(k: RawKeyframe): RawKeyframe {
  const beat = FAKE_SCRIPT.scenes.find((b) => b.id === k.sceneId);
  const last = beat ? beat.actionSimple.split(',').map((x) => x.trim()).filter(Boolean).at(-1) ?? beat.actionSimple : 'the last instant of the beat';
  return { ...k, role: 'end', blocks: k.blocks.map((b) => (b.name === 'POSE' ? { ...b, text: `the last instant of the beat, frozen: ${last}` } : b)) };
}
