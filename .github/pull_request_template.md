## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## How you tested it

<!-- What you ran and what you looked at in the dashboard. -->

## Gates

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run demo` runs all eight stages
- [ ] `cmp prompts/blocks.md skills/cinedance/blocks.md` is silent
- [ ] The demo project renders every stage in `npm run fake` with no console errors

## Rules

- [ ] No new runtime dependency
- [ ] Works in fake mode; no test makes a real network call
- [ ] Every new paid action shows its price first and goes through the spending cap
- [ ] No retry of a submit after a timeout
- [ ] No key, `.env`, project data or generated media in the diff
- [ ] Shared types: optional fields added only, nothing renamed or removed
- [ ] No real film, studio, actor or illustrator named in a prompt
- [ ] Docs updated where the change touches them
