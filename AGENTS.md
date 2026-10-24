# Agents

Two kinds of agent read this file.

- **Asked to install and run Heartcut?** Follow the steps below. They are the same as the "For AI assistants" section of [README.md](README.md).
- **Changing the code?** Read [CLAUDE.md](CLAUDE.md), then [docs/CONTRACT.md](docs/CONTRACT.md), first.

## Install and run (for AI assistants)

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
- **A picture and video provider.** Ask the human to add one key to `.env`: `FAL_KEY`, `REPLICATE_API_TOKEN`, or `HIGGSFIELD_API_KEY` with `HIGGSFIELD_API_SECRET`. See the provider table in [README.md](README.md).

Heartcut reads `.env` again on every check, so a new key needs no restart. Run `npm run doctor` again to confirm. Only `PORT`, `HEARTCUT_PORT`, `HEARTCUT_HOST`, `HEARTCUT_ROOT` and `HEARTCUT_MEDIA_ROOT` need a restart.

Real runs cost money. Every price shows before anything is spent, and a $5 cap per sitting is on by default. Do not press a paid button for the human. Show them the price and let them decide. The **Test connection** button sends one small paid request.

### If you are a chat assistant with no terminal

You cannot run Heartcut for the human. Tell them to:

1. Install Node 22.18 or newer from nodejs.org, and ffmpeg (step 2 above has the command for each OS).
2. Open a terminal and run `git clone https://github.com/viapolaris/heartcut-oss.git`, then `cd heartcut-oss`.
3. Run `npm run doctor` and read the list. Fix any `FAIL` line.
4. Run `npm run fake` and open http://127.0.0.1:5088. Press **Try the demo (free)**.
5. For real films, put their own keys in the `.env` file (copy `.env.example`). Tell them never to paste a key into the chat.

Ask them to paste the doctor's output (it never contains a key) if something does not work.
