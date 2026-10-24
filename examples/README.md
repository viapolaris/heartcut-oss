# Example briefs

Short stories to try Heartcut with. Each one is plain writing, the way you would tell a friend, with a suggested look and aspect at the end.

| File | Story | Look | Aspect |
|---|---|---|---|
| `lighthouse-keeper.md` | An old keeper and his cat on the last night before the light is automated. | Cinematic realism | 16:9 |
| `kite-day.md` | A girl and her grandfather make a crooked kite and fly it. | Documentary natural | 9:16 |
| `paper-boat.md` | A boy follows his paper boat down a stream to a new friend. Drawn. | Storybook watercolour | 16:9 |

Start a project from one:

```sh
node src/cli.ts new lighthouse --title "The Last Light" --brief-file examples/lighthouse-keeper.md
node src/cli.ts new lighthouse --title "The Last Light" --example lighthouse-keeper
```

Or paste the text into the brief box in the dashboard. Pick the look on the Brief step and the aspect when you make the project; the aspect cannot change later.
