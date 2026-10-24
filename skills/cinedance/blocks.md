# Cinedance block library

Every good shot prompt in Heartcut is built the same way: a fixed list of blocks, always in the same order. Each block answers one question (what frame, who, what never changes, what the face does, what moves, where, what light, what colour, what camera, what to avoid). Pick one line per block, join the lines with commas, and the prompt is done.

Use this file in four ways:
- Write a **sheet prompt** (a character or location reference image).
- Write a **shot prompt** (one video clip).
- Write a **keyframe prompt** (one still frame of a shot, lit by the scene; see "13b. KEYFRAME (still) assembly").
- Check a prompt someone else wrote: which block is missing?

## How to assemble

Join the picked lines with commas into one flowing prompt. No headings, no bullets, no line breaks inside the prompt. Skip a block only when the table says it is optional.

**Shot prompt order** (12 blocks, plus LOOK for a non-default style, in this order):

1. SHOT
2. SUBJECT + CONTINUITY TAGS
3. IDENTITY ANCHORS (including the STATE line)
4. PERFORMANCE
5. ACTION WITH PHYSICS
6. MATCH CUT (only when the beat cuts across eras)
7. LOCATION
8. LIGHT
9. PALETTE / GRADE
10. CAMERA / LENS / STOCK
11. LOOK (style) — only when the project's style is not the default; see "LOOK (style)" below
12. QUALITY TAGS
13. NEGATIVES (also kept as a separate list, see the rules)

**Sheet prompt order:** STUDIO SHEET OPENER, SUBJECT, IDENTITY ANCHORS + STATE, STUDIO SHEET BACKGROUND + LIGHT, CAMERA, TEXTURE TAGS. Location sheets use LOCATION, LIGHT, PALETTE, CAMERA.

**Keyframe (still) order:** SHOT, SUBJECT, IDENTITY, POSE, LOCATION, LIGHT (+ relight), GRADE, CAMERA, LOOK, QUALITY, NEGATIVES. No PERFORMANCE, ACTION or MATCH CUT: a still has no duration. See 13b.

**Heartcut tags.** Some video tools point at reference images with tags such as `@Image 1`. Heartcut writes `{{char:<characterId>}}` and `{{loc:<locationId>}}` instead. The scenes stage turns each one into a reference image (`refAssetIds`). Put the placeholder straight after the noun it points at.

---

## 1. SHOT

Names the frame and what the camera does. It always comes first. Pick one.

- `one unbroken take with no cuts, close-up of {subject}`
- `close-up of {subject}`
- `medium shot of {subject}`
- `wide shot, {subject}`
- `over-the-shoulder shot from behind {him}, past his raised arm, {other subject} further off and in focus`
- `locked-off medium shot, no camera movement, no zoom, {subject}`
- `very low angle close-up with the lens almost on the boards, the camera height fixed for the whole shot`
- `high angle wide shot from above, looking down over all of {place}`
- `very wide shot from across {place}, {subjects} small in the frame`
- `very wide shot through a long lens, {subjects} tiny and flattened against the background`
- `medium shot of {subject} lowering himself to his knees, the camera sinking with him to floor height`
- `close-up on the hands, face out of shot`

Notes:
- The most emotional shot can open with "one unbroken take with no cuts". It tells the model to hold the moment instead of chopping it up.
- An over-the-shoulder shot hides one face on purpose. Say so.
- A shot where the camera sinks with a kneeling character ties the view to the body.
- **Camera as movement, never as an object.** Say what the view does: pushes in, drifts left, sinks to floor height, stays locked. Never name the rig. The model tries to draw anything named as an object: "FPV drone shot" can put a drone in the frame, "GoPro" can put a camera in someone's hand. Describe the path of the view instead.

## 2. SUBJECT + CONTINUITY TAGS

Tells the model which reference image is who. Every character and the location get a tag.

- `{{char:<id>}}` straight after the character noun: `an old lighthouse keeper {{char:odran}}`
- `his big orange tabby cat {{char:marigold}}`
- `an 8-year-old girl {{char:june}} holding a kite string`
- `... at the top of the spiral stairs {{loc:lamp}}`
- `on the grassy crest of a windy hill {{loc:hill}}`
- `a folded paper boat {{char:boat}} turning in the stream {{loc:stream}}`
- Two characters in one shot: tag both, each once, at first mention.
- Same character in a new era: same tag, different STATE line (block 3).

Rule: one tag per subject per shot. Do not tag things that are not in the shot.

## 3. IDENTITY ANCHORS (and STATE)

What must be true in every frame. Two parts.

**3a. Numbers** (the numbers rule):
- `a 78-year-old man`
- `a big orange tabby cat, 9 years old, about 6 kg`
- `a 62-year-old lighthouse keeper, 178cm, 80kg, broad and stooped`
- `small for her age`, `tall and a little bent`, `thin and narrow-shouldered`
- one mark that never changes: `a torn left ear`, `a white tip on the tail`, `a small scar through the left eyebrow`
- hair and eyes: `two short black braids`, `a short grey beard`, `deep-set pale blue eyes`

**3b. Fixed props and wardrobe.** One line, restated in every shot. Copy it word for word.
- `dark blue wool jumper with a hole at the left elbow`
- `round wire glasses, brown corduroy jacket with leather elbow patches`
- `yellow raincoat with the hood down, red rubber boots`
- `a long red wool scarf knotted twice at the neck`
- `a ring of brass keys on a leather cord at his belt`
- `a green jumper two sizes too big, sleeves rolled at the wrist`
- `a thin leather collar with a small brass bell`

**3c. STATE line.** The only part that changes between eras.
- Clean / past: `clean and rested, no cuts, no dirt`, `smooth unlined skin`, `hair neat and dark`, `a full glossy coat`, `clear bright eyes`
- Worn / present: `deep lines around the eyes, grey stubble, salt dried white on his cuffs, a fresh cut across two knuckles`
- Worn animal: `a thin coat with grey hairs around the muzzle, one cloudy eye, a stiff slow walk`
- Worn clothing: `the jumper stretched and pilled, one cuff unravelling`, `boots cracked across the toes`
- When the model keeps losing a detail, spell it out: "both arms in the sleeves, the coat buttoned to the top". Be that specific.

## 4. PERFORMANCE / MICRO-EXPRESSIONS

What the face and body do, in small movements. The emotion lives here. Write it as a short sequence.

- `his jaw tightens, he breathes slowly through his nose`
- `his eyes fill, and he blinks the wet away before it falls`
- `his hand shakes a little on the rail and he grips harder to stop it`
- `he lets out a long breath, then closes his eyes for a moment`
- `one tear runs down beside his nose and he does not wipe it`
- `his face softens from tired duty into something close to a smile`
- `her lower lip pushes out and her breath catches`
- `he does not cry`
- `the feeling stays held in, never let out`
- `a real, surprised laugh, nothing posed about it`
- Animal: `the cat's ears turn toward him, her tail lifts and curls at the tip, she blinks slowly`
- Animal calm: `the cat sits neat and still with her tail around her paws`
- Pace: `slow and quiet, almost nothing moves`

Rule: show the feeling through the body, and say what NOT to show (`he does not cry`). Holding back reads as true.

## 5. ACTION WITH PHYSICS

Verbs with weight. Say what the objects do, not only the people.

- `the kite dips, catches the wind again and climbs in short tugging jerks, the string pulling taut`
- `a dropped key skitters across the iron floor and spins to a stop`
- `the cat springs onto the next step, landing soft, then waits with her weight on her back legs`
- `the paper boat tips in the current, rights itself and slides on, its wet corner darkening`
- `he wipes the lens in slow circles, the cloth squeaking on the glass`
- `he sets the oil lamp down on the boards and it rocks once before it settles`
- `the beam swings out over the water, slow and heavy, lighting the spray`
- `the grass bends flat in a gust, then springs back up in a ripple`
- `everything in the frame holds still for one beat`
- Long-take glue: `one unbroken action` (keeps a wide frame whole).

Lesson: an object that only glides looks weightless and false. Give it a wobble, a catch, a bounce, a stop, in plain words, and render again.

### 5b. POSE (stills only)

Keyframe prompts use this in place of PERFORMANCE and ACTION. One frozen instant of the action, caught halfway through, with weight and direction. The face is one held expression, not a sequence.

- `caught halfway down to his knees, weight on his right heel, the lantern a hand's width above the boards`
- `her arm stretched toward the attic latch, fingers not yet touching it, weight on the balls of her feet`
- `the kite a metre off the grass and rising, the string just going tight in her fist`
- `head turned toward the sound, lips parted on a breath, eyes wet and held`
- `the lamp already dark, his hand still on the switch` (an `end` frame: the last instant)
- `he leans in, chin tucked, eyes on the fish, whiskers forward`

Rule: **never a static pose.** No "standing facing camera", no "posing", no "neutral stance", no hands hanging at the sides. That is the pose from the sheet, and it animates like a stiff shop dummy. Tell the model what the character is doing at this instant.

## 6. MATCH CUT / SHAPE MONTAGE (only when eras change)

A cut between two frames that share one shape or one action, so a jump in time feels like a single movement. Use it at most once per film. Write it in two halves.

Template:

`first half: {object doing something in the present place}, everything holds still for one beat, then we cut on the resting {object}, second half: the same framing at the same camera height, the same {object} now resting {in the past place}, and at once {past subject} {enters and acts}, only the {object} carries over, the place, the light and the time all change at once, a straight cut with no dissolve, no morph, no blend between the halves`

Other lines to pick from:
- `the camera height does not change across the two halves`
- `first half {present palette}, second half {past palette}`
- `the same angle, the same {object}, but now {he is young and the morning is bright}`

## 7. LOCATION

Where, plus the objects that make it a real place. A list of concrete things beats a pile of adjectives.

- `the lamp room at the top of a stone lighthouse, a huge ribbed glass lens, brass fittings dulled green, a wooden stool, an old wind-up clock on a shelf, rain streaks on the outer glass`
- `a tight spiral of iron stairs inside a whitewashed tower, a worn rope handrail, small square windows at each landing, peeling paint`
- `a green hilltop in wind, long grass in waves, a few grey rocks, a wire fence half down, low clouds moving fast`
- `a narrow stream behind a row of houses after rain, muddy banks, a wooden fence, a low stone bridge, tall reeds, a lily leaf with a frog on it`
- `a cramped tin-roofed workshop, oil-stained concrete, pegboard of worn tools, a dusty window`
- `a narrow harbour jetty of grey boards, mooring ropes, small waves slapping the posts`
- Depth cue: `soft and far out of focus`, `blurred behind`, `in the foreground`.

## 8. LIGHT

Name the source, the direction and what is in the air.

- `cold blue dawn light through the small window on his left, the rest of the room in shadow`
- `a warm rim of lamplight along his beard and shoulders`
- `fine sea spray and dust drifting through the beam`
- `bright bounced daylight off the white walls, shadows open and soft`
- `one shaft of morning sun across the cat's back`
- `low afternoon sun behind the girl, long shadows of her and the old man stretching down the hill`
- `sun through moving clouds, patches of light racing over the grass`
- `late gold light, long soft shadows, still warm air`
- `bright spring day, high sun, glitter on the water`
- `a thin haze between the camera and the subject`

**Relight clause.** Whenever a character is in the shot, the LIGHT block ends with:

- `the face, hair and clothes are lit by this scene's light, from its direction and in its colour, with hard shadows where the scene has them, no flat white studio light left on the skin`

Why: the character sheets are shot on a plain white studio backdrop with soft, flat, even light, on purpose. Dropped into a lit scene with that studio light still on the face, the character looks pasted in instead of filmed. Name the direction and the colour of the scene's light in plain words, and ask for hard shadows where the scene has hard shadows. Soft, hazy light everywhere is what makes a shot look careless.

## 9. PALETTE / GRADE

Colour in a few words. Use a different one for each era.

- `cold slate blue and grey with one warm amber accent` (present, hard)
- `steel grey and sea green with a little rust` (cold, worn)
- `warm amber and slate blue palette`
- `muted wool colours: navy, oatmeal, faded red and brown` (worn wardrobe)
- `warm sunny grade, lifted shadows, a soft glow on the highlights` (memory, past, joy)
- `first half cold slate blue, second half warm sunny grade with lifted shadows` (match cut)

## 10. CAMERA / LENS / STOCK

Camera behaviour first, then the lens, then the stock look. Write "no zoom" every time you want a steady frame.

- Behaviour: `handheld, a slow breathing sway, no zoom` / `handheld, drifting gently, no zoom` / `handheld, only the faintest tremor` / `handheld, following the action` / `handheld, sinking with him` / `locked off, no movement`
- Lens: `24mm, wide, from above` / `35mm` / `50mm, wide open, shallow depth of field` / `long 135mm lens, background pressed close`
- Body: `shot on a large-format digital cinema camera`
- Stock: `soft highlight roll-off, true film colour, no HDR look, fine grain`
- Focus: `focus on the cat`, `shallow depth of field`

Rule: **movement, never an object.** Behaviour words say what the view does. Never name a rig or a device (no "drone", "FPV", "GoPro", "crane", "dolly", "Steadicam"): the model tries to draw anything named as an object. A camera type and a lens in millimetres are fine; they set the look and are not things in the scene. In a keyframe (still) prompt this block keeps only framing, height, lens and stock, with no behaviour at all.

## LOOK (style)

The blocks above speak the language of one look: realistic, filmic, photographed. A project can carry another look (anime, a children's cartoon, watercolour, clay animation, black-and-white film, anything the user saves). The engine hands the stages a STYLE: a `LOOK` sentence, a `SHEET LOOK`, style `NEGATIVES` and `VIDEO HINTS`.

- **Photographic styles (photoreal, film).** Keep every block as written and add the `LOOK` block after CAMERA. It sits on top of the realism words.
- **Every other style.** `LOOK` replaces the realism and camera-stock words. In an anime or cartoon prompt there is no cinema camera, no lens in millimetres, no "skin pores", no "8k photorealistic", no film grain. Block 10 keeps only camera behaviour (static, handheld drift, push-in); block 11 carries the style's LOOK text verbatim; block 12 QUALITY becomes the style's own quality tags, then the VIDEO HINTS as the last words before the NEGATIVES.
- **Sheets.** Replace the opener, background, camera and texture tags with the style's `SHEET LOOK` (character sheets) or `LOOK` (location sheets). Keep the subject, the numbers, the wardrobe line and the state line exactly as before: consistency still comes from details.
- **NEGATIVES** also carry the style's guards ("no photorealism, no 3D render" for anime, "no illustration, no cartoon" for a photographic look).
- Never name a studio, show, artist or film in a LOOK. Describe the medium: line, shading, colour, texture.

## 12. QUALITY TAGS

The last positive words. Keep the set small.

- `photorealistic, natural skin texture, filmed not rendered` (people)
- `photorealistic, natural fur and whisker detail, filmed not rendered` (animals)
- `photorealistic, filmed not rendered`
- Aspect: `vertical 9:16` or `wide 16:9` when the app does not set it.

## 13. NEGATIVES

Seedance has no negative field, so every "no ..." goes into the prompt text as well as into the `negatives` list. Say what you do NOT want.

- `no camera movement, no zoom`
- `no slow push-in`
- `a straight cut with no dissolve, no morph, no blend`
- `no wounds, no blood, no sores` (a sick or old animal)
- `frail but dignified, not pitiful`
- `he does not cry`
- `no text, no subtitles, no logos`
- `no extra characters`
- `no makeup` (sheets)

**Fakeness set.** Photographic styles always carry these three, in shots and in keyframes:

- `no shiny plastic skin, no harsh sharpening, no oversaturated colours`

These three are what most often give a generated picture away, and naming each flaw to remove works better than asking for "realistic". Keyframes add `no flat studio lighting on the face` (the relight guard). Drawn styles skip the set and carry their own style negatives instead; "plastic skin" means nothing to a watercolour.

## 13b. KEYFRAME (still) assembly

A keyframe is one still picture of a shot, made from the sheets and the location before any video is rendered. The video is then animated **from that picture** with a short motion prompt.

**Why still first.** A picture costs cents and a clip costs dollars (here: $0.04 a picture, about $1 to $2.30 a clip). The still is where the face, the light and the framing get settled, and where that is cheap: look at it, render it again, pick one. Once the still is right the video prompt only has to move it. It no longer has to invent the face, the place or the light, so the face stops drifting from shot to shot. Clips animated from a chosen still keep their detail; clips made from sheets plus a written description let the framing and the angles wander, for the same price.

**Keyframe block order** (`KEYFRAME_BLOCKS`):

1. SHOT, as a still: the framing and height words from the shot, with every movement word removed
2. SUBJECT + CONTINUITY TAGS, copied from the shot
3. IDENTITY ANCHORS + STATE, copied from the shot word for word
4. POSE (5b): the frozen instant, halfway through the action; `start` = the first instant of the beat, `end` = the last
5. LOCATION, copied
6. LIGHT, copied, plus the relight clause
7. PALETTE / GRADE, copied
8. CAMERA, as a still: framing, height, lens, depth of field, stock; no behaviour
9. LOOK (style), only when the style is not the default
10. QUALITY TAGS for a still: `photorealistic, natural skin texture with visible pores, fine film grain, a still photograph` (drawn styles: the style's own tags)
11. NEGATIVES: the fakeness set plus `no flat studio lighting on the face`, `no text, no subtitles, no logos`, `no extra characters`, `no mannequin pose`; never motion negatives, a still cannot move

SUBJECT, IDENTITY, LOCATION, GRADE and LOOK are locked copies. The work is SHOT, POSE, LIGHT and CAMERA.

### Example D. Keyframe (start) for Example B

Same beat as Example B: Odran sits on the jetty, sets down the lantern, holds out a fish to Pip. The `start` frame freezes the first instant.

```text
medium shot, camera at board level, a 62-year-old lighthouse keeper {{char:odran}} caught halfway down to sitting on the edge of a grey wooden jetty {{loc:jetty}}, his one-eyed grey seal {{char:pip}} hauled out three metres away watching him, 178cm, 80kg, short grey beard, navy wool fisherman's cap, patched yellow oilskin coat worn open, faded red scarf, brass lantern key on a leather cord at his belt, salt crusting his sleeves, a fresh cut across his knuckles, the seal thin with scarred flanks and a milky left eye, a torn blue tag on his front flipper, weight on his right heel, one hand on the boards, the lantern a hand's width above the planks, his jaw set, eyes wet and held, the seal's head lifted toward him, whiskers forward, a narrow harbour jetty of grey boards, mooring ropes, small waves slapping the posts, tin buoys, low evening mist over the water, low gold sun behind the hills, soft rim light on his cap and shoulders, sea spray drifting in the light, the face, hair and clothes are lit by this scene's light, from its direction and in its colour, with hard shadows where the scene has them, no flat white studio light left on the skin, warm amber and slate blue palette, 35mm, shallow depth of field, shot on a large-format digital cinema camera, soft highlight roll-off, true film colour, fine grain, photorealistic, natural skin texture with visible pores, fine film grain, a still photograph, no shiny plastic skin, no harsh sharpening, no oversaturated colours, no flat studio lighting on the face, no text, no subtitles, no logos, no extra characters, no mannequin pose
```

What changed from Example B: "slowly sitting down ... the camera lowering with him" became "caught halfway down to sitting ... camera at board level" (one instant, no movement); the PERFORMANCE sequence became one held face; the ACTION became one frozen position with the lantern in the air; the relight clause closed the LIGHT block; CAMERA lost "handheld, sinking with him, no zoom"; the negatives gained the fakeness set and lost the motion negatives. Everything locked is byte-identical.

### Short motion prompt

When a clip is animated from a keyframe, the video prompt is the scene's `motion` text, not the full block prompt. 150 to 450 characters, 2 to 3 sentences, present tense. It holds three things: what the body does (ACTION verbs and the PERFORMANCE face, in order), what the camera does in movement words, and the sound if any. It repeats **nothing** the keyframe already fixed: no appearance, numbers, wardrobe, state line, location dressing, light, grade, lens or camera type, quality tags or placeholders. The reference picture already fixes the look; describing it a second time only gives the model a chance to change something that was settled. Motion negatives (`no camera movement, no zoom, no slow push-in`) may close it when stillness matters.

Example, for Example B: `He lowers himself onto the boards, breathes out shakily and sets the lantern down with a trembling hand. He slides a small silver fish across the planks; the seal shuffles forward and stops at its edge, whiskers twitching. The view sinks with him to board level with a soft handheld sway, no zoom. Boards creak, small waves slap the posts.`

### One take / sequence

Several neighbouring beats can be rendered as **one generation** with hard cuts inside it, for example a 20-second clip with four cuts. Every start keyframe goes in as a reference, then the character sheets, then the location, so each cut has an exact picture to match. The prompt names the number of cuts and keeps the cuts in beat order: `<N> hard cuts, one continuous sequence, same location, same light:` then `cut 1 (4s): <SHOT>, <PERFORMANCE>, <ACTION>, <CAMERA>`, `cut 2 (5s): ...`, and once at the end IDENTITY, LOCATION, LIGHT, GRADE and QUALITY, then the negatives. Rules: same location and same light across every cut (a sequence does not change place); `hard cuts not dissolves, no morphing between cuts`; keep the action moving from the first cut to the last, otherwise the model stalls near the end. Duration is the sum of the beats, clamped to what the model allows.

---

## STUDIO SHEET BLOCK (character and animal sheets)

For reference images only. Not for shots.

**Opener, pick one:**
- `hyperrealistic studio photograph, close-up portrait, head and shoulders, {subject} facing camera` (portrait)
- `hyperrealistic studio photograph, full body shot, head to toe, {subject} standing straight facing camera` (human full body)
- `full body studio photograph, head to tail, {animal} standing and facing camera` (animal)

Never write "sheet", "model sheet", "reference sheet", "turnaround" or "chart" in a prompt. Some image models cope, but illustration models (Qwen, Z-Image, Recraft) take the word literally and draw a design page with labels, arrows and colour swatches (seen 2026-10-11). Say what the picture IS (one figure, plain background), not what it is FOR.

**Subject + anchors + state:** blocks 2 and 3. Add posture (`a tired stoop, shoulders rounded`) on the worn full-body sheet. Add `calm neutral expression` on a portrait.

**Background and light, pick one:**
- `plain white seamless studio backdrop, broad soft frontal light, even and shadowless` (portrait)
- `plain white seamless studio backdrop, broad soft even light from the front, a faint shadow on the floor under the feet` (full body)
- `plain light grey studio backdrop, soft neutral light` (animal)

**Camera, pick one:**
- `medium-format portrait look, 85mm lens, f/5.6` (portrait)
- `full-frame stills camera, 50mm lens, f/8, in focus from head to feet` (full body)

**Texture tags:**
- Human: `real skin with pores and fine facial hair, no retouching, each hair separate, the weave of the cloth and the grain of the leather visible, crisp detail, 8k, photorealistic, bare face with no makeup, plain documentary feel`
- Full-body extra: `seams and stitching visible, scuffed boots, dust on the hems`
- Animal: `photorealistic, every hair and whisker sharp`

---

## The rules

### Two-state rule
When a story spans two eras, every character gets two sheets: a clean past one and a worn present one. Same face, same scarf, same keys, same numbers. Only the wear changes. This is what lets a flashback prove "this is the same person". Do the same for animals.

### Numbers rule
Age, weight and height give the model something fixed to hold. Exact numbers stop it inventing odd body proportions. Consistency comes from details. Always include them.

### Location sheet rule
Without location sheets every shot gets a different place. A location sheet carries the light and the camera package too (blocks 7, 8, 9, 10), not only the set. Attach the location image to every shot that happens there.

### Draft, then final rule
Test at the cheapest tier (480p) first. Fix the prompt. Only then pay for the final. Price every run before pressing the button. In Heartcut the final is a fresh render at a higher tier, not an upscale of the draft.

### Tell the model what NOT to do
Left alone, a video model tends to add a slow push-in nobody asked for. So when stillness matters, write `no camera movement, no zoom` in the SHOT block and again in NEGATIVES.

### Never copy, play it your own way
Take a feeling you have seen and pass it through your own story. Never name the source film, studio, actor or illustrator inside a prompt. Describe the method and the feeling instead.

---

## Three assembled examples

Our own story: a lighthouse keeper (Odran, age 62) and his one-eyed seal (Pip). Present: Odran is worn, Pip is thin and scarred. Past: both are healthy. Tags below use ids `odran`, `pip`, `light`, `jetty`.

### Example A. Sheet prompt (worn full body, human)

```text
hyperrealistic studio photograph, {{char:odran}} full body shot, head to toe, a 62-year-old lighthouse keeper standing straight facing camera, 178cm, 80kg, broad and stooped with shoulders rounded, short grey beard, deep-set pale blue eyes, small scar through the left eyebrow, navy wool fisherman's cap, patched yellow oilskin coat worn open, faded red scarf, brass lantern key on a leather cord at his belt, heavy rubber boots, salt stains and deep creases in the coat, weathered skin with broken veins on the cheeks, muted wool colours: navy, faded yellow, grey and rust, plain white seamless studio backdrop, broad soft even light from the front, a faint shadow on the floor under the feet, full-frame stills camera, 50mm lens, f/8, in focus from head to feet, seams and stitching visible, scuffed rubber boots, crisp detail, 8k, photorealistic, bare face with no makeup, plain documentary feel
```

### Example B. Shot prompt (the emotional core, present era)

Beat: Odran sits on the jetty, sets down the lantern, and holds out a fish to Pip. Present era.

```text
medium shot of a 62-year-old lighthouse keeper {{char:odran}} slowly sitting down on the edge of a grey wooden jetty {{loc:jetty}}, the camera lowering with him to board level, his one-eyed grey seal {{char:pip}} hauled out three metres away watching him, 178cm, 80kg, short grey beard, navy wool fisherman's cap, patched yellow oilskin coat worn open, faded red scarf, brass lantern key on a leather cord at his belt, salt crusting his sleeves, a fresh cut across his knuckles, the seal thin with scarred flanks and a milky left eye, a torn blue tag on his front flipper, he breathes out shakily, his jaw works, his eyes fill and he blinks the wet away, his hand shakes as he sets the lantern down on the boards, he does not cry out, the feeling stays held in, he takes a small silver fish from his pocket and slides it slowly across the planks, the seal shuffles forward on his flippers and stops at the edge of the fish, whiskers twitching, a narrow harbour jetty of grey boards, mooring ropes, small waves slapping the posts, tin buoys, low evening mist over the water, low gold sun behind the hills, soft rim light on his cap and shoulders, sea spray drifting in the light, warm amber and slate blue palette, handheld, sinking with him, no zoom, 35mm, shallow depth of field, shot on a large-format digital cinema camera, soft highlight roll-off, true film colour, no HDR look, fine grain, photorealistic, natural skin texture, filmed not rendered, no slow push-in, no extra characters, no text
```

### Example C. Match cut shot (present to past)

```text
very low angle close-up with the lens at the level of the jetty boards, the camera height fixed for the whole shot, first half: a small silver fish lying on grey wet planks in thin evening light, a thin scarred seal's flipper {{char:pip}} edges into frame, the fish stays where it is, everything holds still for one beat, then we cut on the resting fish, second half: the same framing at the same camera height, the same silver fish now resting on bright sunlit planks of the same jetty {{loc:jetty}} years earlier, and at once a healthy glossy two-eyed grey seal {{char:pip}} drops his head into frame and flicks the fish into the air, catches it, shakes it in play, flippers slapping the boards, a young keeper's clean hand {{char:odran}} with no cut and no dirt rests beside it, navy wool cap and faded red scarf at the edge of frame, only the fish carries over, the place, the light and the time all change at once, a straight cut with no dissolve, no morph, no blend between the halves, bright sun and sea spray in the second half, first half cold slate blue, second half warm sunny grade with lifted shadows and a soft glow, handheld, a slow breathing sway throughout, no zoom, 50mm, shallow depth of field, shot on a large-format digital cinema camera, soft highlight roll-off, true film colour, photorealistic, filmed not rendered, no slow push-in
```

Note on Example C: in the past Pip has two eyes. If a character feature changes between eras, say so in the STATE line of that era, and keep face shape, size and tags the same.
