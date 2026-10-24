# Heartcut

Tell a story in plain words. Get a short, emotional AI film.

<!-- screenshot -->

Heartcut runs on your computer as a small web dashboard. You write the story the way you would tell a friend. Heartcut writes the script, makes fixed reference pictures of each character and place, writes every shot, renders cheap drafts, renders finals, and joins them into one cut. You approve each step before the next one starts.

It has no runtime dependencies. Node runs the TypeScript directly.

## Quick start in 5 minutes

```sh
git clone https://github.com/viapolaris/heartcut-oss.git
cd heartcut-oss
npm start
```

Open http://127.0.0.1:5088. The **Get set up** card on the projects page checks what you have and offers a demo project, "Demo: the last apple". Making it is free. In fake mode (below) every step of it is free too, with canned text and placeholder pictures. Without fake mode its steps use your real language model and provider, at the prices shown.

Something missing? Run `npm run doctor`. It prints a checklist of what works and what to fix.

To practise without any key or spend, start in fake mode: `npm run fake`. To run all eight stages of the demo from the terminal, run `npm run demo`. Both work the same on macOS, Linux and Windows. To use another port: `node src/server.ts --port 5099` (add `--fake` for fake mode).

There is nothing to install with npm. Heartcut has no runtime dependencies, so `npm install` is only for contributors (it adds TypeScript for `npm run typecheck`).

## Requirements

- **Node 22.18 or newer.** Node 24 is a good choice.
- **ffmpeg** and **ffprobe** on your PATH. Heartcut needs them to make clips, the final film, and the placeholder clips in fake mode. `HEARTCUT_FFMPEG` and `HEARTCUT_FFPROBE` point at other copies.
- A language model (below). If you have the `claude` CLI, you need no key.
- A picture and video provider (below), for anything past the demo.

## For AI assistants

This section is for an AI assistant (Claude Code, Codex, Cursor, or a chat assistant) asked to "download, install and run Heartcut". Follow it in order. Every command runs from a terminal. Each step says what success looks like.

### Rules

- **Never invent an API key.** If the human wants real films, ask them for a key. Tell them to paste it into the `.env` file themselves.
- **Never put a key in a chat message, a commit, an issue, a log or a command line.** Keys belong only in `.env`, which git ignores.
- **Try the free demo first** (step 7). It needs no key and spends nothing.
- `npm start` and `npm run fake` keep running until stopped. Run them in the background or in a second terminal, then do the success check.

### 1. Check Node

```sh
node --version
```

It must print `v22.18.0` or newer (`v24.x` and later are fine). If Node is missing or older, install the current LTS:

| OS | Command |
|---|---|
| macOS | `brew install node` (Homebrew is at brew.sh), or the installer from nodejs.org |
| Linux | the installer from nodejs.org, or your distribution's `nodejs` package if it is 22.18 or newer |
| Windows | `winget install --id OpenJS.NodeJS.LTS -e`, then open a new terminal |

### 2. Check ffmpeg

```sh
ffmpeg -version
ffprobe -version
```

Both must print a version. If not:

| OS | Command |
|---|---|
| macOS | `brew install ffmpeg` |
| Debian, Ubuntu | `sudo apt-get install -y ffmpeg` |
| Other Linux | install `ffmpeg` with your package manager |
| Windows | `winget install --id Gyan.FFmpeg -e`, then open a new terminal |

### 3. Get the code

```sh
git clone https://github.com/viapolaris/heartcut-oss.git
cd heartcut-oss
```

No git? Download the ZIP from the repository page, unzip it, and `cd` into the folder. Windows: `winget install --id Git.Git -e` installs git.

### 4. Install

Nothing to install. Heartcut has no runtime dependencies and Node runs its TypeScript directly. Skip `npm install` and `npm ci` unless you will change the code (they add TypeScript for `npm run typecheck`).

### 5. Make the settings file

| OS | Command |
|---|---|
| macOS, Linux | `cp .env.example .env` |
| Windows (PowerShell) | `Copy-Item .env.example .env` |
| Windows (cmd) | `copy .env.example .env` |

The file is optional. You only need it for API keys. Leave the keys empty unless the human gives you one.

### 6. Run the doctor

```sh
npm run doctor
```

It prints one line per check:

- `ok`: fine.
- `note`: optional. Ignore it.
- `todo`: Heartcut runs, but this is needed for real films. Fake mode works anyway.
- `FAIL`: Heartcut cannot run. Fix it and run the doctor again.

The exit code is 0 when Heartcut can run (no `FAIL`) and 1 when it cannot. `node src/cli.ts doctor --json` prints the same as JSON, with nothing else on the line: `canRun` is true when nothing failed, and `ready` is true when there is nothing left to do.

On a new computer the usual result is `todo` for **Pictures and video** (no provider key yet), and either `ok` or `todo` for **Language model**. Heartcut picks a language model by itself: the `claude` command if it is installed, else the first key it finds in `.env`, else Ollama or LM Studio running on this computer. The doctor line says what it picked and why.

### 7. Try the free demo

Start Heartcut in fake mode. Fake mode makes no network calls and spends nothing. It writes canned text and placeholder pictures and clips.

```sh
npm run fake
```

It prints `Heartcut is running. Open http://127.0.0.1:5088 in your browser.` Open that address. On the **Get set up** card, press **Try the demo (free)**, then press each step's button in order.

Or run all eight stages from the terminal, with no server:

```sh
npm run demo
```

It takes under a minute and exits 0. The last line reads `Spend: $13.81 at list prices (fake mode: nothing was sent or charged)` or similar: the dollar figure is what a real run would cost, and nothing is charged.

### 8. Check that it is running

While `npm start` or `npm run fake` runs, in another terminal:

```sh
node -e "fetch('http://127.0.0.1:5088/api/doctor').then(r=>r.json()).then(j=>{console.log(j.canRun?'running':'not ready');process.exit(j.canRun?0:1)})"
```

It prints `running` and exits 0. This works the same on every OS. On macOS and Linux, `curl -s http://127.0.0.1:5088/api/doctor` shows the full JSON.

Port 5088 in use? Start on another port with `node src/server.ts --port 5099` (fake mode: `node src/server.ts --fake --port 5099`) and use that port in the address and the check. These work the same on every OS. Avoid `npm start -- --port 5099` in Windows PowerShell, which can drop the `--`.

### 9. Real films

Stop fake mode (Ctrl+C) and run `npm start`. Real films need:

- **A language model.** If the doctor's Language model line is `ok`, you are done. If not, ask the human which they use. They can install Claude Code and sign in, or add one key to `.env`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY` or `OPENROUTER_API_KEY`.
- **A picture and video provider.** Ask the human to add one key to `.env`: `FAL_KEY`, `REPLICATE_API_TOKEN`, or `HIGGSFIELD_API_KEY` with `HIGGSFIELD_API_SECRET`. See the table below.

Heartcut reads `.env` again on every check, so a new key needs no restart. Run `npm run doctor` again to confirm. Only `PORT`, `HEARTCUT_PORT`, `HEARTCUT_HOST`, `HEARTCUT_ROOT` and `HEARTCUT_MEDIA_ROOT` need a restart.

Real runs cost money. Every price shows before anything is spent, and a $5 cap per sitting is on by default. Do not press a paid button for the human. Show them the price and let them decide. The **Test connection** button sends one small paid request.

### If you are a chat assistant with no terminal

You cannot run Heartcut for the human. Tell them to:

1. Install Node 22.18 or newer from nodejs.org, and ffmpeg (see step 2 above for their OS).
2. Open a terminal and run `git clone https://github.com/viapolaris/heartcut-oss.git`, then `cd heartcut-oss`.
3. Run `npm run doctor` and read the list. Fix any `FAIL` line.
4. Run `npm run fake` and open http://127.0.0.1:5088. Press **Try the demo (free)**.
5. For real films, put their own keys in the `.env` file (copy `.env.example`). Tell them never to paste a key into the chat.

Ask them to paste the doctor's output (it never contains a key) if something does not work.

## How it works

1. **Brief.** You write the story and add reference photos.
2. **Script.** A language model writes the characters (with numbers and fixed props), the places, and 6 to 12 beats.
3. **Sheets.** It writes a portrait and a full-body prompt for each character state, and one per place.
4. **Images.** Four options per sheet. You pick one.
5. **Scenes.** Each beat becomes a detailed video prompt, plus a short motion-only prompt.
6. **Keyframes** (optional). One still per shot, relit to the scene. You pick one of two, or skip.
7. **Clips.** A 480p draft first. A 720p final only after you approve the draft.
8. **Export.** ffmpeg joins the approved clips, adds music, and can upscale to 4K.

A picture costs cents and a clip costs dollars. So Heartcut fixes the face, the light and the framing in cheap pictures first, and the video only has to move them. The method is in [docs/process-breakdown.md](docs/process-breakdown.md).

You can also bring your own pictures. Any sheet or scene can take one as the final pick, as context for the model, or as the source for a clean sheet.

## Choosing a language model

The script, sheets, scenes and keyframe prompts are written by a language model. Pick one in the dashboard (Brief step, **Language model**) and press **Test connection**, or set `HEARTCUT_LLM_PROVIDER` in `.env`. A choice saved in the dashboard wins over `.env`. With nothing set, Heartcut picks one by itself: the `claude` CLI if the `claude` command is installed, else the first key it finds in this order: Anthropic, OpenAI, xAI, Gemini, OpenRouter. Else it uses Ollama or LM Studio if one is running on this computer, with its first model.

| Provider | Key in `.env` | Notes |
|---|---|---|
| `claude` CLI | none | Uses your Claude plan. Picked first when installed. |
| Anthropic API | `ANTHROPIC_API_KEY` | |
| OpenAI | `OPENAI_API_KEY` | |
| xAI | `XAI_API_KEY` | |
| Google Gemini | `GEMINI_API_KEY` | |
| OpenRouter | `OPENROUTER_API_KEY` | Many models behind one key. |
| Ollama, LM Studio | none | Free, on your computer. Name the model you pulled. |
| Custom | `HEARTCUT_LLM_API_KEY` if needed | Any server that speaks the OpenAI chat completions API. |

Local models work. A bigger model writes better scripts. The Script step reads your photos, so pick a model that can see pictures.

## Choosing a picture and video provider

Pick one in the dashboard (Brief step, **Pictures and video**), or set `HEARTCUT_GEN_PROVIDER` in `.env` (`auto`, `higgsfield`, `fal`, `replicate` or `higgsfield-tool`). A choice saved in the dashboard wins over `.env`. With nothing set, Heartcut uses the first provider whose key it finds, in this order: Higgsfield, fal, Replicate.

| Provider | Key in `.env` | Covers | Approx cost |
|---|---|---|---|
| Higgsfield | `HIGGSFIELD_API_KEY` and `HIGGSFIELD_API_SECRET` (or `HIGGSFIELD_API_KEY=id:secret`) | pictures and video | sheets about $0.02 per 4; clips about $1 (draft) and $2.30 (final) per 5 s |
| fal | `FAL_KEY` | pictures and video | pictures $0.035 to $0.04 each; clips about $1.10 (draft) and $2.37 (final) per 5 s |
| Replicate | `REPLICATE_API_TOKEN` | pictures and video | pictures $0.003 to $0.04 each; clips about $0.51 (draft) and $1.16 (final) per 5 s |
| Local | none | drawn-look sheets, and faces from your photos once the local edit model is downloaded | free and slower; Apple Silicon Mac only. See `tools/requirements-local.txt`. |

Each provider covers every step: character sheets, place sheets, drawn looks, photo edits, and video from sheets or from a start frame. fal and Replicate use their own models for sheets, so their pictures look a little different. Their prices come from each provider's published price list, read on 2026-10-24, and show as "approx." in the dashboard. Higgsfield prices come from Higgsfield itself, except clips, which use its published per-second rate.

Local pictures are a switch in the Look section ("Render drawn looks on this Mac"), not a provider. They need an Apple Silicon Mac (M1 or newer). They do not run on Intel Macs, Linux or Windows. You still need a provider for video.

If you already run a separate Higgsfield command-line tool, point `HEARTCUT_HIGGSFIELD_TOOL` at it. Heartcut then uses it first, and the tool keeps its own key and its own spending cap.

## Costs

- An 8-shot film with 5-second shots costs about **$28** at Higgsfield's listed prices. Almost all of it is video: 8 drafts (about $8) and 8 finals (about $18). Each re-rolled draft adds about $1.
- **Every price is shown before you click.** Runs of $0.50 or more ask you to confirm.
- **Spending cap.** Heartcut stops at $5 per sitting by default. A sitting is the last 6 hours, and the count survives a restart. A job that would cross the cap is refused before anything is sent. Set the cap (0 to 1000 dollars) in the Pictures and video panel, or with `HEARTCUT_SPEND_CAP` in `.env`. The panel wins when both are set. A clip whose exact price is not known in advance holds at least $2.50 against the cap until it finishes (`HEARTCUT_VIDEO_RESERVE` changes this). The Higgsfield command-line tool, if you use it, keeps its own cap instead.
- Generations run one at a time. A final is offered only after its draft is approved.
- The language model is separate. The `claude` CLI and local models cost nothing extra; a paid API costs cents per film.

## Privacy

- Heartcut runs on your computer. Your projects and media stay in the Heartcut folder (`projects/` and `media/`, both gitignored).
- Keys live only in `.env` or your shell. Heartcut never saves them in settings, prints them or shows them in the dashboard.
- Your brief, photos and prompts are sent to the providers you choose, and only to them.

## Docs

- [docs/MANUAL.md](docs/MANUAL.md): the user manual.
- [docs/process-breakdown.md](docs/process-breakdown.md): the method, step by step.
- [docs/CONTRACT.md](docs/CONTRACT.md): interfaces and engineering rules.
- [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [CHANGELOG.md](CHANGELOG.md).
- [examples/](examples/): briefs to try.

## License

MIT. See [LICENSE](LICENSE).
