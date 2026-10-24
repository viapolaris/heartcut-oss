---
name: cinedance
description: Write cinematic AI video prompts and character sheet prompts from a one-line idea using a reusable block library. Use when the user asks for a "cinematic prompt", "video prompt", "character sheet", "location sheet", "Seedance" prompt, "Higgsfield" prompt, or help making an "AI film" with consistent characters and real emotion.
allowed-tools: Read
---

# Cinedance

Turns a one-line idea into a prompt built from a fixed set of blocks, always in the same order. The vocabulary lives in `blocks.md` beside this file. Read it first. Do not rewrite it from memory.

## Steps

1. Read `blocks.md` (same folder as this file).
2. Decide what you are writing:
   - **Sheet prompt**: a reference image of one character in one state, or one location.
   - **Shot prompt**: one video clip, 4 to 10 seconds.
   - **Keyframe prompt**: one still frame of a shot, lit by the scene, for image-to-video. Pair it with a short motion prompt (2 to 3 sentences, body + camera movement + sound, nothing the still already fixed).
3. Ask only for what is missing: who (age, kg, cm), what they always wear or carry, where, which era.
4. Pick one line per block from `blocks.md`, in block order. Join with commas. One paragraph, no line breaks.
5. Run the five rules below. Fix anything that fails.
6. Return the prompt, then one line listing the blocks you used.

## Block order

- Shot prompt: SHOT, SUBJECT + CONTINUITY TAGS, IDENTITY ANCHORS + STATE, PERFORMANCE, ACTION WITH PHYSICS, (MATCH CUT), LOCATION, LIGHT, PALETTE, CAMERA / LENS / STOCK, QUALITY TAGS, NEGATIVES.
- Sheet prompt: STUDIO SHEET opener, subject, anchors + state, background + light, camera, texture tags.
- Location sheet: LOCATION, LIGHT, PALETTE, CAMERA.
- Keyframe (one still of a shot, animated afterwards): SHOT (as a still), SUBJECT, IDENTITY, POSE, LOCATION, LIGHT + relight clause, PALETTE, CAMERA (framing and lens only), (LOOK), QUALITY, NEGATIVES with the fakeness set. See "13b. KEYFRAME (still) assembly" in `blocks.md`.

## The five rules

1. **Two states.** A character in two eras gets a clean sheet and a worn sheet. Same face, same scarf, same props. Only wear changes.
2. **Numbers.** Age, kg and cm in every character line. Consistency comes from details.
3. **Locations carry light and camera.** A location sheet also holds the lighting and the camera package.
4. **Draft, then final.** Test cheap (480p), price before you spend, then do the final.
5. **Say what NOT to do.** Left alone, the model tends to add a slow push-in nobody asked for. Put "no camera movement, no zoom" in the shot and in the negatives.

Also: never name a real film, studio, actor or illustrator in a prompt. Take the feeling, play it your own way.

Two more: describe the camera as movement, never as an object ("FPV drone" can put a drone in the frame); never a static pose, say what the character is doing. Photographic prompts always end with `no shiny plastic skin, no harsh sharpening, no oversaturated colours`, and a character in a lit scene gets the relight clause from `blocks.md` §8.

## Tags

If the user's tool has its own image tags (for example `@Image 1`), write them straight after the noun they point to. In Heartcut, write `{{char:<id>}}` and `{{loc:<id>}}`.

## Worked example

Idea: "a mechanic says goodbye to her one-eyed cat in the garage."

```text
close-up of a 34-year-old mechanic @Image 1 crouching beside a one-eyed ginger cat, 168cm, 61kg, short black hair with a grey streak, navy coveralls with a stitched name patch, red bandana at her neck, brass wrench on a leather loop at her hip, grease on her knuckles and a fresh cut on her thumb, her jaw tight, her eyes fill and she blinks the wet away, her hand shakes a little as she smooths his ear, she does not cry out, the feeling stays held in, the cat presses his head into her palm, tail curling slowly, a cramped tin-roofed garage, oil-stained concrete, pegboard of worn tools, one shaft of afternoon sun through a dusty window, dust drifting in it, warm amber and slate blue palette, handheld, a slow breathing sway, no zoom, 50mm, wide open, shallow depth of field, shot on a large-format digital cinema camera, soft highlight roll-off, true film colour, fine grain, photorealistic, natural skin texture, filmed not rendered, no slow push-in, no text
```

Blocks used: SHOT, SUBJECT, ANCHORS (numbers, props, state), PERFORMANCE, ACTION, LOCATION, LIGHT, PALETTE, CAMERA, QUALITY, NEGATIVES.

## Checklist before you answer

- Numbers present? Fixed props line present and copied exactly?
- State line right for the era (clean and rested, or the list of wear)?
- Is there a "no ..." clause wherever stillness or restraint matters?
- Match cut: both halves, the same framing at the same camera height, a straight cut with no dissolve, no morph, no blend?
- No real film, studio, actor or illustrator named?
