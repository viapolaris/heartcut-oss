# Heartcut: guide for contributors and coding agents

This file is for anyone changing the code, person or agent. `AGENTS.md` points here.

Read `docs/CONTRACT.md` before changing any interface. Shared shapes live in `src/types.ts`. Add optional fields only; never rename or remove.

## Non-negotiables

- **Zero runtime dependencies.** No bundler, no framework in `web/`. Dev types only.
- **Node runs TypeScript directly** (`node src/cli.ts`). The minimum version is `engines` in `package.json`. Tests use `node --test`.
- **All LLM calls go through `src/llm.ts`** (`llmJson()`). With nothing chosen, auto picks the `claude` CLI when it is on PATH (no key; never make a key required for it), else the first API key, else a local server (`src/llm/config.ts`). API providers (Anthropic, OpenAI, xAI, Gemini, OpenRouter, Ollama, LM Studio, custom) are optional and opt-in (`src/llm/`).
- **All image and video generation goes through `src/gen` (the provider layer).** Stages never call a provider API directly.
- **Keys come only from the environment or the gitignored `.env`.** Never save, print, log or return a key. Tests stub `fetch`; never make a real paid call from a test.
- **Price before spend.** Every generating stage exposes `estimate()`, and the dashboard shows the number before the button fires. `dryRun` must work end to end.
- **Respect the spending cap.** Every paid submit goes through the cap in `src/gen`. A job with no known price reserves against the cap before it runs.
- **Generations run sequentially.** Providers have concurrency limits.
- **Never retry a submit after a timeout.** Not every provider takes an idempotency key, so a retry can bill twice. Poll or report instead.
- **Offline first.** Everything must work with `HEARTCUT_FAKE=1`: no network, no keys, canned LLM output, placeholder media.
- **Projects and media are gitignored.** Project JSON in `projects/<slug>/`, media in `media/<slug>/` (`HEARTCUT_MEDIA_ROOT` overrides).
- **Never name a real film, studio, actor or illustrator in a prompt.** Describe the method and the feeling. Inspiration notes stay in `Script.inspiration`, never in a prompt.
- Seedance 2.5 caps at 720p and has no seed. "Final" is a re-render, not an upscale. Say so in the UI.

## Prompts

- `prompts/blocks.md` is the single source of the prompt grammar. `skills/cinedance/blocks.md` must stay byte-identical. Run `cmp prompts/blocks.md skills/cinedance/blocks.md` after any edit.
- The LLM stages load `system-*.md` plus `blocks.md`. If you change a JSON shape in `src/types.ts`, update the matching system prompt in the same change.
- Write prompt text fresh. Do not copy prompts from videos, guides or other people's work.

## Gates

Before calling anything done:

```sh
npm test
npm run typecheck
npm run demo
cmp prompts/blocks.md skills/cinedance/blocks.md
```

Then run `npm run fake` and check that the demo project renders every stage in the dashboard with no console errors.

## Style

Short sentences, plain English. No emojis. No marketing words in the UI or the docs.
