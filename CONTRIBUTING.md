# Contributing to Heartcut

Thanks for helping. This page covers setup, the gates, fake mode, and how to add a provider or a style. The engineering rules are in [CLAUDE.md](CLAUDE.md). The interfaces are in [docs/CONTRACT.md](docs/CONTRACT.md).

## Setup

```sh
git clone https://github.com/viapolaris/heartcut-oss.git
cd heartcut-oss
npm install          # dev tools only: TypeScript and Node types
cp .env.example .env
npm run doctor
```

You need Node 22.18 or newer, and ffmpeg with ffprobe. Heartcut has no runtime dependencies. Do not add one. Node runs the `.ts` files directly; there is no build step.

## Fake mode

`HEARTCUT_FAKE=1` turns off every network call. The language model returns canned JSON and the generation layer writes placeholder pictures and clips. No keys, no spend.

```sh
npm run fake                  # dashboard with placeholder media
npm run demo                  # all eight stages, fake, from the CLI
```

Every feature must work in fake mode. Tests always run in it.

## Gates

Run all of these before you open a pull request:

```sh
npm test
npm run typecheck
npm run demo
cmp prompts/blocks.md skills/cinedance/blocks.md
```

`npm test` runs in fake mode with local pictures off. Then start `npm run fake` and check that the demo project ("Demo: the last apple") renders every stage with no console errors. CI runs the typecheck, the tests, the demo and `npm run doctor` in fake mode, on Linux, macOS and Windows (Windows does not block yet), on Node 22.18 and newer. It does not run the `cmp` check or the dashboard check, so run those yourself.

## Adding a language model provider

1. Add a preset in `src/llm/config.ts`: id, label, base URL, key variable name, default model per tier (`opus`, `sonnet`, `haiku`). If it speaks the OpenAI chat API, it reuses the OpenAI-compatible adapter in `src/llm/http.ts`.
2. Add the key variable, empty, to `.env.example`.
3. Add tests to `test/llm-providers.test.ts`. Stub `globalThis.fetch`; never call the real service.
4. Add a row to the table in `README.md`.

## Adding a picture or video provider

1. Add the provider in `src/gen/<name>.ts`. It implements `HttpProvider` from `src/gen/provider-types.ts`: `supports`, `modelFor`, `perCall` (optional), `quote`, `run` and `check`. Stages never call it; they call `estimate` and `run` in `src/gen/provider.ts`.
2. Register it: add the id to `GEN_PROVIDERS`, the auto order and `GEN_META` (label, key variable, site) in `src/gen/config.ts`, and to `PROVIDERS` in `src/gen/provider.ts`.
3. Map each capability (`faces`, `places`, `drawn`, `edit`, `refVideo`, `i2v`) to the provider's model ids, with a dated price table. A quote from a table must return `exact: false`, so the dashboard says "approx." and an unpriced clip reserves against the cap.
4. `src/gen/provider.ts` already prices before every submit, takes the cap reservation, and runs one job at a time. In `run`, submit once and never retry after a timeout. Send an idempotency key if the service has one. `check` must be a free, read-only call.
5. Read the key from the environment only (`genKey` in `src/gen/config.ts`). Never print or return it.
6. Add the key variable, empty, to `.env.example`. The doctor picks the provider up from `src/gen/config.ts`. Add its key name to the "No picture service is set up" message there.
7. Add tests to `test/gen-providers.test.ts` with `fetch` stubbed. Add a row to the provider table in `README.md` and `docs/MANUAL.md`.

## Adding a style

Built-in looks live in `prompts/styles.json`. Each has an `id`, a `name`, a family, `look`, `sheetLook`, `negatives`, `videoHints` and `models` (which picture model draws faces and places). Copy an existing entry and change it. Never name a studio, show, artist or film in any field; describe the method instead. Run `test/styles.test.ts`.

## Prompts

`prompts/blocks.md` is the prompt grammar. If you edit it, copy it to `skills/cinedance/blocks.md` so the two stay byte-identical. Write prompt text fresh; do not paste prompts from videos, guides or other people's work. Never name a real film, studio, actor or illustrator in a prompt.

## Pull requests

- One change per pull request. Keep it small.
- All gates green. Say in the description that you ran them.
- Add tests for new behaviour. No test may make a real network call or spend money.
- No test may depend on the machine it runs on: OS, CPU, installed programs, your home folder, your `.env`. Start every test file with `import './fixtures/isolate.ts';` and inject the rest through the hooks in `src/` (for example `checkAvailable(host)` in `src/gen/local.ts`, `llmHooks.which` in `src/llm/config.ts`, `findOnPath(bin, env, platform)`).
- Add optional fields only to shared types. Never rename or remove one.
- If you change a JSON shape in `src/types.ts`, update the matching system prompt in the same change.
- Update the docs your change touches.
- No keys, `.env` files, project data or generated media in commits.
- Plain short sentences in UI text and docs. No emojis.

By contributing you agree that your work is released under the [MIT License](LICENSE) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
