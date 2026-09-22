# ASCII Bot Shooter

An ASCII team shooter tournament with indirect control. The player sets the
tactics of a team of three bots. The bots fight. The player does not control a
bot directly.

The full design is in [`docs/dev-guide.md`](docs/dev-guide.md).

## Status

**Milestone M4 — utility AI and tactics.** Each bot gives a score to every
action (engage, chase, retreat, seek a pickup, hold, reposition, switch weapon,
follow) and takes the highest. The tactics of the player are the weights. A
round with an equal score at the time limit goes to sudden death. The kill feed
carries the classic arena shooter announcements. The headless batch harness
arrives with Milestone M5.

Earlier milestones gave the build, the seeded RNG, the data loader, the event
bus, the tests, the GitHub Pages deployment (M0), the arena map files with the
rot.js display (M1), A* movement with the tick loop and the speed controls (M2),
and FOV, the baseline weapon, and the round end condition (M3).

## Commands

| Command | Action |
|---|---|
| `npm install` | Install the dependencies. |
| `npm run dev` | Start the development server. |
| `npm run build` | Typecheck and build to `dist/`. |
| `npm run preview` | Serve the build from `dist/`. |
| `npm test` | Run the tests one time. |
| `npm run test:watch` | Run the tests and watch for changes. |
| `npm run typecheck` | Typecheck only. |
| `npm run lint` | Run ESLint. |

## Rules for the code

These rules come from Sections 4 and 13 of the dev guide.

1. The simulation and the display are separate. A module in `src/core`,
   `src/arena`, `src/weapons`, `src/sim`, `src/ai`, `src/progression`,
   `src/meta`, `src/names`, or `src/report` must not import `src/render`,
   `src/ui`, or `src/main.ts`, and must not use a browser API.
2. Headless first. Every system must run in Node with no display.
3. Deterministic. One seed gives one result.
4. Use the RNG streams of `src/core/rng.ts`. Do not use `Math.random()` or the
   global `ROT.RNG` instance.
5. Tunable numbers go in `data/`, not in the code. A placeholder number is
   listed in the `tbd` array of its data file.
6. Implement the milestones of Section 11 of the dev guide in order. Do not
   implement a feature before its milestone.

The ESLint configuration and the test `tests/boundary.test.ts` check rules 1
and 4 automatically.

## Arena map files

A file in `data/arenas/` holds one hand-made arena. The file has an optional
header, a line with `---`, and then the map:

```
name: Proving Ground
notes: free text
---
##########
#S..,.^..#
##########
```

| Glyph | Tile |
|---|---|
| `#` | wall |
| `.` | floor |
| `,` | low cover |
| `^` | hazard |
| `S` | spawn |
| `W` `A` `H` `U` `M` | a weapon, armor, health, powerup, or ammo pickup |

Every row must have the same width, and the map needs two spawn cells at
minimum.

## Deployment

The workflow `.github/workflows/deploy.yml` builds the project and deploys it
to GitHub Pages on each push to `main`. Enable Pages for the repository with
the source **GitHub Actions**.
