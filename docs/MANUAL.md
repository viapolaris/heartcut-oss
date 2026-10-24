# Heartcut manual

## What Heartcut is

Heartcut turns a story you tell in plain words into a short, emotional AI film. You write the story the way you would tell a friend. Heartcut writes the script, designs the characters and places, writes every shot, renders the clips, and joins them into one cut.

You stay the director. At each step the machine makes options, and you pick, edit, or redo. Nothing moves to the next step until you approve it.

It runs on your own computer as a small web dashboard. AI services you choose do the writing, the pictures and the video. A free local option can do the pictures.

## The big idea

A picture costs cents and a video clip costs dollars, so Heartcut fixes everything it can in cheap pictures first. Most AI films fail because the face, the clothes or the room change from shot to shot. Heartcut stops that with four rules.

1. **Story first.** The AI reads the whole story before it writes any single shot. Each shot then keeps the same mood and the same people.
2. **Lock the look early.** Each character gets a fixed "sheet": a portrait and a full-body picture, with numbers (age, height, weight) and fixed props (a collar, a hat). Each place gets a sheet too. Every later shot is made from these sheets.
3. **Still before motion.** An optional keyframe step makes one still picture of each shot, relit to that scene. A re-roll here costs about 4 cents. The video then only has to move the picture.
4. **Draft before final.** Every clip renders first as a cheap 480p draft (about $1 for 5 seconds). Only a draft you like becomes a 720p final (about $2.30 for 5 seconds).

## The 8 stages

Every film goes through the same eight stages, in order. You approve each one before the next starts.

Brief -> Script -> Sheets -> Images -> Scenes -> Keyframes (optional, can be skipped) -> Clips -> Export. Clips is where almost all the money goes.

| # | Stage | You do | Heartcut does |
| --- | --- | --- | --- |
| 1 | Brief | Tell the story in simple words. Add reference photos. | Saves the brief and the references. |
| 2 | Script | Read it. Edit or redo. | Writes the characters (with numbers and props), the places, and 6 to 12 scene beats. |
| 3 | Sheets | Check the descriptions. | Writes a portrait and a full-body prompt for each character state, and one per place. |
| 4 | Images | Pick the best of four for each sheet. | Makes four picture options per sheet. |
| 5 | Scenes | Read and tweak each shot. | Turns each beat into a detailed video prompt, plus a short motion-only prompt. |
| 6 | Keyframes (optional) | Pick one of two stills per shot, or skip. | Makes a still of each shot from the sheets, relit to the scene. |
| 7 | Clips | Watch the draft. Approve it, then order the final. | Renders a 480p draft, then a 720p final. Two beats side by side can go out as one take. |
| 8 | Export | Pick music. Choose 4K or not. | Joins the approved clips, adds the music, and can upscale to 4K. |

A "beat" is one moment of the story, about one shot long. A "character state" is one look of a character, for example clean in a flashback and hurt in the present.

## Get set up

You need Node 22.18 or newer, and ffmpeg with ffprobe.

1. Get the code and make your settings file:

   ```sh
   git clone https://github.com/viapolaris/heartcut-oss.git
   cd heartcut-oss
   cp .env.example .env
   ```

2. Start it with `npm start`. Open http://127.0.0.1:5088 in a browser. To use another port, start it with `PORT=8080 npm start` (`HEARTCUT_PORT` works too, and wins when both are set). The dashboard only listens on this computer (`HEARTCUT_HOST`, default 127.0.0.1).
3. The projects page shows a **Get set up** card the first time. It checks your language model and your picture and video provider, and offers a demo project called "Demo: the last apple". Making the demo is free. Its steps are free only in fake mode (below); otherwise they use your real services at the prices shown. To run the whole demo from a terminal, free, run `npm run demo`.
4. If something is not ready, run `npm run doctor` in the Heartcut folder. It prints a checklist and says what to fix. It names the keys it found, never their values.

To practise with no keys and no cost, start in fake mode: `npm run fake`. It uses canned text and placeholder pictures. Red squares and colour bars are normal in this mode.

Your projects live in `projects/` and your pictures and clips in `media/`, both inside the Heartcut folder. To keep media somewhere else, set `HEARTCUT_MEDIA_ROOT` in `.env`. To keep both `projects/` and `media/` in another folder, set `HEARTCUT_ROOT`. Both are read when Heartcut starts.

## Your first film

Follow these steps in the dashboard. Each step has a Continue button that opens the next one.

1. **Start Heartcut.** Run `npm start` and open http://127.0.0.1:5088.
2. **Make a project.** Click **New project**. Give it a title. Pick the aspect ratio (16:9 for wide, 9:16 for phones). The aspect cannot change later.
3. **Write the brief.** Tell the story the way you would tell a friend. Who is in it, what happens, how it should feel. Add reference pictures if you have them, and mark each one as a selfie, a character, a location or a mood.
4. **Shape the story.** Heartcut writes a logline (one-sentence summary), the cast, the places and the beats. Change anything that is wrong. Then continue.
5. **Check the sheet prompts.** Read each character and place description. Add a detail if one is missing, such as a scar or a hat.
6. **Lock the cast.** Pick one face per character first. Every other picture of that character is built from that face. Then pick each place.
7. **Write the shots.** Each beat is now a video prompt in named parts (shot, subject, light, camera, and more). Dashed parts come from your cast and places. Edit the others.
8. **Freeze the frames (optional).** Heartcut makes two stills per shot. Pick the one that looks most like a real film. Or click **Skip keyframes**.
9. **Shoot the drafts.** Click **Generate drafts**. Watch each 480p draft. Approve the good ones and redo the rest. Then render finals at 720p for the approved shots.
10. **Cut and export.** Pick music and the size (1080p or 4K). Heartcut joins the approved clips in scene order and gives you the film.

Want a story to start from? The `examples/` folder has short briefs. Paste one into the brief box, or start a project from one in a terminal:

```sh
node src/cli.ts new lighthouse --title "The Last Light" --example lighthouse-keeper
```

## Your own pictures

If you already have pictures, you can use them at the Images step (on any sheet) and the Scenes step (on any scene). Click **Add your picture** and pick one of three uses.

| Choice | What happens | Cost |
| --- | --- | --- |
| Use as final | Your picture becomes the pick. On a scene it becomes the shot, even if you skip keyframes. | Free |
| Use as context | The AI looks at it when it writes, and the picture model gets it as a reference. | About $0.16 per sheet, because a model that can see pictures does the drawing |
| Make a clean sheet from it | Heartcut redraws it with the clean sheet background and framing. It keeps the face, hair, clothes and props. | About $0.16 per set of 4 |

The usual rules still apply. You see the price first, you get options, and you pick. Heartcut never picks for you. A picture with more than one person cannot become a character sheet. A sheet that already holds your picture also gets a **Clean this up** button.

## Choosing a language model

The writing steps (script, sheets, scenes, keyframes) can use any of these: Claude, ChatGPT (OpenAI), Grok (xAI), Gemini, OpenRouter, a model on your own computer (Ollama, LM Studio), or any server that speaks the OpenAI chat API. If you pick nothing, Heartcut picks for you: the `claude` command-line tool if it is installed (your Claude plan, no key), else the first key it finds in `.env` (Anthropic, OpenAI, xAI, Gemini, then OpenRouter), else Ollama or LM Studio if one is running on this computer. The panel says what it picked and why.

1. Open the **Brief** step and find **Language model**, under Look.
2. Pick the provider and, if you want, the model.
3. Put the API key in a file named `.env` in the Heartcut folder, for example `OPENAI_API_KEY=...`. The panel shows the exact name to use. Local models need no key.
4. Click **Test connection**. It sends one tiny request.

Keys stay in `.env`. Heartcut never saves them or shows them on screen. It reads `.env` again on every check, so a new key needs no restart: reload the page.

A model on your own computer is free and private. A bigger model writes better scripts. The script step looks at your photos, so pick a model that can see pictures.

## Choosing a picture and video provider

The picture and video steps (images, keyframes, clips) can use any of these:

| Provider | Key in `.env` | What it does |
| --- | --- | --- |
| Higgsfield | `HIGGSFIELD_API_KEY` and `HIGGSFIELD_API_SECRET` (or `HIGGSFIELD_API_KEY=id:secret`) | Pictures and video. The prices in this manual are its prices. |
| fal | `FAL_KEY` | Pictures and video. Pictures cost $0.035 to $0.04 each. Clips cost about $1.10 (draft) and $2.37 (final) per 5 seconds. |
| Replicate | `REPLICATE_API_TOKEN` | Pictures and video. Pictures cost $0.003 to $0.04 each. Video costs about half the prices below. |

Each one covers every step: character sheets, place sheets, drawn looks, photo edits, and video from sheets or from a start frame. fal and Replicate draw sheets with their own models, so a character or place sheet costs more there than on Higgsfield (about $0.14 to $0.16 for 4 instead of about $0.02) and looks a little different. Their prices are from each provider's published price list, read on 2026-10-24, and the dashboard marks them "approx.".

1. Open the **Brief** step and find **Pictures and video**, next to Language model.
2. Pick the provider. If you pick none, Heartcut uses the first one whose key it finds: Higgsfield, then fal, then Replicate. You can also set `HEARTCUT_GEN_PROVIDER` in `.env`. A choice made in the panel wins.
3. Put its key in `.env`. The panel shows the exact name to use.
4. Click **Check**. It makes a free, read-only call. It never makes a picture.

Heartcut always shows the price of the provider you picked before you click.

If you already run a separate Higgsfield command-line tool, set `HEARTCUT_HIGGSFIELD_TOOL` to its path. Heartcut then uses it first. The tool keeps its own key and its own spending cap.

**Free local pictures.** On an Apple Silicon Mac (M1 or newer), drawn looks (anime, cartoon, illustration) can be drawn on your own computer for free. This does not work on Intel Macs, Linux or Windows. Turn on "Render drawn looks on this Mac" in the Look section (the same switch is on the Images step). With the optional local edit model downloaded, faces made from your photos also render locally. Setup is in `tools/local-image.py` and `tools/requirements-local.txt`. The picture models are large downloads. `npm run doctor` says whether local pictures are ready. Video always needs a provider.

## Costs and safety

An 8-shot film with 5-second shots costs about $28 at the listed prices (Higgsfield), and almost all of it is video. Heartcut shows the price on every button before you click it, and asks you to confirm any run of $0.50 or more.

| Item | Model | Price |
| --- | --- | --- |
| Character sheet, 4 options | Soul 2 | $0.023 |
| Place sheet, 4 options | Soul Cinema | $0.022 |
| Keyframe, 2 options | Qwen Image Edit | $0.08 |
| Draft clip, 5 s at 480p | Seedance 2.5 | about $1 |
| Final clip, 5 s at 720p | Seedance 2.5 | about $2.30 |
| 4K upscale and export | ffmpeg on your computer | free |

The $28 is 8 drafts ($8), 8 finals ($18), keyframes ($0.64) and sheets (under $0.50). Each re-rolled draft adds about $1.

Safety rules built in:

- **Price first.** Every paid step shows an estimate before it runs.
- **One at a time.** Generations run one after another, never in a burst.
- **Spending cap.** Heartcut stops at a set limit per sitting, $5 by default. A sitting is the last 6 hours. The count is saved, so a restart does not reset it. A job that would cross the cap is refused before anything is sent. A clip whose exact price is not known in advance holds at least $2.50 against the cap until it finishes, so about two clips fit under the default cap (`HEARTCUT_VIDEO_RESERVE` changes the $2.50). To change the cap, set it in the Pictures and video panel, or set `HEARTCUT_SPEND_CAP` in `.env`, for example `HEARTCUT_SPEND_CAP=30`. It can be 0 to 1000 dollars. The panel wins when both are set. If you use the Higgsfield command-line tool, that tool keeps its own cap instead.
- **Draft first.** A final is only offered after a draft is approved.
- **Free local option.** Pictures can be made on your own computer at no cost, but more slowly.

## Tips

- **Put numbers in.** "A 7-year-old dog, 30 kg, red collar with a bell" stays the same dog. "A big dog" does not.
- **Two looks, two states.** If a character changes (clean, then hurt), make two character states. Same face, different details.
- **Say what must not happen.** Write "no camera movement, no zoom" on a still shot. If you do not, the model often adds a slow push-in.
- **Describe physics in words.** "The ball bounces, each bounce lower than the last" beats "the ball rolls".
- **Pick a look before the sheets.** The Look setting sets the style: photoreal, film, anime, kids cartoon, illustration, 3D, or your own words. Change it before images are made, not after.
- **Use one take for linked beats.** Select two or more beats in a row and click **One take**. They render as one clip with cuts inside it, which keeps the motion smooth.

## Words to know

| Word | Meaning |
| --- | --- |
| Brief | Your story in plain words. |
| Beat | One moment of the story, about one shot. |
| Sheet | A fixed reference picture of a character or a place. |
| Character state | One look of a character, such as clean or hurt. |
| Keyframe | A still picture of one shot, made before the video. |
| Draft | A cheap 480p test clip. |
| Final | A new 720p render of an approved draft. It is not an upscale. |
| One take | Several beats rendered as one clip. |

## What it does not do yet

- Final video tops out at 720p. 4K is an upscale on your computer, not a new render.
- A final is a fresh render, so it can differ a little from its draft.
- There is no per-scene "rewrite this shot" button yet.
- The end frame of a shot cannot be redone alone. A redo makes both frames again.
- The Export step is not yet tested on a phone.
- It runs on one computer only. It is not a hosted website.
