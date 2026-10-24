# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First public release.

### Added

- Eight stages from a plain-language brief to a finished cut: brief, script, sheets, images, scenes, keyframes (optional), clips, export.
- Script stage: characters with number anchors and fixed props, character states, places, and 6 to 12 beats with an emotional core and match cuts.
- Character and place sheets: four options per sheet, you pick one. Faces are locked from a chosen anchor or from a tagged photo.
- Scene prompts in named blocks, with a block editor, plus a short motion-only prompt per beat.
- Optional keyframes: one still per shot, relit to the scene, two options each, with an optional end frame.
- Clips: a 480p draft first, a 720p final after approval. Clips start from a keyframe when one is chosen, from the sheets otherwise. Adjacent beats can render as one take.
- Export: ffmpeg concat, one music track, optional 4K upscale.
- Styles: built-in looks (photoreal, film, anime, kids cartoon, illustration, 3D and more) and your own saved styles.
- Library: reuse characters and places from past projects.
- Your own pictures on any sheet or scene: use as final, use as context, or make a clean sheet from it.
- Any language model: the `claude` CLI (default, no key), Anthropic, OpenAI, xAI, Gemini, OpenRouter, Ollama, LM Studio, or any OpenAI-compatible server. Pick one in the dashboard or with `HEARTCUT_LLM_PROVIDER`; set models with `HEARTCUT_LLM_MODEL` or one per tier. Keys in `.env`. Test connection in the dashboard.
- Picture and video providers: the Higgsfield API, fal and Replicate, each covering character sheets, place sheets, drawn looks, photo edits, and video from sheets or from a start frame. Pick one in the dashboard or with `HEARTCUT_GEN_PROVIDER`, or let Heartcut pick the first key it finds. An optional external Higgsfield command-line tool (`HEARTCUT_HIGGSFIELD_TOOL`) keeps its own key and cap. Keys in `.env`. A free Check button in the dashboard.
- Free local pictures for drawn looks on an Apple Silicon Mac (MLX, `tools/local-image.py`).
- Price before every paid click, a confirm at $0.50 or more, and a spending cap in Heartcut: $5 by default per sitting (the last 6 hours), set in the dashboard or with `HEARTCUT_SPEND_CAP`. A clip with no exact price holds $2.50 (`HEARTCUT_VIDEO_RESERVE`) until it finishes. A job that would cross the cap is refused before anything is sent.
- First-run setup: `npm start`, a Get set up card with a demo project ("Demo: the last apple"), `npm run demo`, and `npm run doctor`, which checks Node, ffmpeg, the language model, the picture provider, local pictures, folders and `.env`, and names keys without showing them.
- Fake mode (`HEARTCUT_FAKE=1`): the whole pipeline offline, no keys, no spend.
- Prompts written fresh for this release: the prompt grammar in `prompts/blocks.md` and the system prompt for each writing stage (script, sheets, scenes, keyframes).
- Example briefs in `examples/`.
- Docs: README, user manual (`docs/MANUAL.md`), the method (`docs/process-breakdown.md`) and the developer contract (`docs/CONTRACT.md`).
- CI, contributor guide, security policy, code of conduct, issue and pull request templates.
