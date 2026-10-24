# The method, step by step

Heartcut is built on a common workflow for short AI films: story first, fixed reference sheets, cheap stills, cheap drafts, then finals. This page explains that method and how Heartcut does each step.

Inspiration: two public walkthrough videos by the creator kaye.creatives, "3 Steps to Master AI Realism in 2026 (Secret Workflow)" (https://youtu.be/mJUULemmPV8) and "6 Steps to Stop Burning AI Credits (Full Workflow)" (https://youtu.be/USPWGH5YcIU). Heartcut is an independent project. It does not include her prompts, her films or her words, and it is not endorsed by her.

## The steps

### 1. The brief

Write the whole story before any shot prompt. A model that has read the full story keeps the mood and the people the same from shot to shot. Tell it in simple words, the way you would tell a friend. The language model turns that into a first draft: beats, places and characters, in one file.

### 2. Lock the characters and the places

Most consistency problems start here. Each character gets a fixed reference sheet: a portrait and a full-body picture on a plain background.

- **Numbers, not adjectives.** Age, height, weight and fixed props give the model clear limits and stop odd proportions. "A 7-year-old dog, 30 kg, red collar" stays the same dog. "A big dog" does not.
- **One sheet per state.** If a character changes over the story (clean in a flashback, hurt in the present), make two sheets with the same face and props and different wear.
- **Places get sheets too.** Otherwise every shot gets a different room. Put the light and the camera package in the place description.
- **Plain background on purpose.** An empty sheet gives the video model nothing extra to copy.
- **Use the cheapest model that is good enough.** Place sheets do not need the expensive face model.

### 3. Freeze one still per shot

Before any video, make one still of each shot from the sheets and the place. Two things matter:

- **Relight the face.** The sheet was shot in flat studio light. Without a relight instruction the character is dropped into the scene still carrying that light, and it looks fake.
- **Pick the shot scale on purpose.** A wide shot proves a real space. A close-up throws the background out. A low wide lens makes the subject strong.

A still costs cents. A re-roll here is cheap. The video then only has to move the picture.

### 4. Write the shots

Each beat becomes a detailed video prompt. Some rules that save re-rolls:

- **Say what must not happen.** If you do not write "no camera movement, no zoom" on a still shot, the model often adds a slow push-in.
- **Describe physics in words.** "The ball bounces, each bounce lower than the last" beats "the ball rolls".
- **Describe camera movement, never the device.** Name a drone and the model may put a drone in the frame.
- **Never a static pose.** Say what the character is doing.
- **Turn off the fake look.** Ask for no shiny plastic skin, no harsh sharpening, no oversaturated colours.
- **Borrow a feeling, not a scene.** Take the emotion of a moment you love and play it your own way.

When the shot starts from a still, keep the video prompt short: two or three sentences about motion only. The still already fixes the look, and describing it again invites drift.

### 5. Draft, then final

- **Check the price before every run.**
- **Draft low.** Render a cheap low-resolution draft first. Spend on a final only when the draft works.
- **Keep the settings the same across shots.** Change the prompt, not the settings.

### 6. Cut and finish

Join the approved clips in story order, add one music track, and upscale if needed.

## Three ways to animate

| Method | Inputs | Result |
|---|---|---|
| One still per clip | the still and a short motion prompt | The look and face hold in every shot. No transitions inside a clip. |
| One take | sheets, place and several stills in one prompt framed as one sequence with hard cuts | One longer clip with cuts inside it. Smooth motion across beats. |
| Sheets only | sheets and place, each shot described in full | Face and place hold, but framing and angles drift. |

The first two look better than the third. That is the reason to make the stills first.

## How Heartcut does each step

| Step | Heartcut | Where |
|---|---|---|
| Brief in simple words | `brief` stage: a text box and reference uploads, each with a role | dashboard, `src/store.ts` |
| Script, characters, places | `script` stage writes a typed `Script` JSON. Number anchors, states and match cuts are enforced by the prompt. | `src/stages/script.ts`, `prompts/system-script.md` |
| Sheet prompts | `sheets` stage, from the block library | `src/stages/sheets.ts`, `prompts/system-sheets.md`, `prompts/blocks.md` |
| Sheet pictures | `images` stage: four options per sheet, you pick one | `src/stages/images.ts`, `src/gen/` |
| Shot prompts | `scenes` stage: named blocks per beat, plus a short `motion` prompt | `src/stages/scenes.ts`, `prompts/system-scenes.md` |
| Stills, relit | `keyframes` stage (optional): two options per beat, relight clause in every LIGHT block | `src/stages/keyframes.ts`, `prompts/system-keyframes.md` |
| Short motion prompts | sent when a clip starts from a chosen keyframe | `src/stages/clips.ts` |
| One take | sequence run over adjacent beats, prompt built by the engine | `src/stages/clips.ts` `buildSequencePrompt` |
| Price check | `estimate()` per stage. The dollar figure is on the button before it fires. | every generating stage |
| Spend control | a spending cap per sitting, enforced in Heartcut | `src/gen/` |
| Draft, then final | 480p draft, 720p final | `clips` |
| Cut and music | `export` stage: ffmpeg concat plus one music track, optional 4K upscale | `src/stages/export.ts`, `src/ffmpeg.ts` |

## What differs from the videos

| In the videos | In Heartcut |
|---|---|
| An in-app button turns a draft into a higher-resolution version of the same take. | The video API tops out at 720p and takes no seed, so a final is a fresh render with the same prompt and references. It can differ a little from its draft. The dashboard says so. |
| A trained face model replaces the sheet. | Heartcut locks identity through the sheets and by building every later picture from the chosen face. |
| Start and end frames in a separate studio tool. | An end keyframe per beat, sent as the end image of an image-to-video clip. |
| Prices in platform credits. | Prices in dollars, from the provider you choose. |
