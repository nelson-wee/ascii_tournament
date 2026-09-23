# ASCII Bot Shooter

An ASCII team shooter tournament with indirect control. The player sets the
tactics of a team of three bots. The bots fight. The player does not control a
bot directly.

The full design is in [`docs/dev-guide.md`](docs/dev-guide.md). The measured
state of the weapons and the balance after M8 is in
[`docs/m8-weapon-analysis.md`](docs/m8-weapon-analysis.md).

## Status

**After M8 — the weapon economy.** A bot spawns with the baseline weapon alone
and takes the generated weapons from the weapon points of the arena, which makes
the arena decide who is armed. A pair of points that face each other holds the
same item, so a symmetric arena gives both teams the same offer. A cone now
declares the range it really has, the power budget weighs the range bands the
way the arena fires in them, a projectile leads a moving target and carries its
critical hit, and the AI aims an area weapon at the enemy that lines up two. A
pickup point shows its glyph only while it holds its item.

A second pass made the arena decide the contest and gave a weapon choice a
price. An arena must now pass `checkArenaFairness`: a power-up and at least one
weapon point sit on ground that both teams reach together, which is an
acceptance rule for the generator of Milestone M7. The `retreatThreshold` tactic
is gone — a bot takes health or armour only when it has no enemy to engage,
while weapons, ammo and power-ups stay worth fighting for — and a weapon swap
costs firing ticks inside a fight but nothing outside one, so a team arms itself
by its role and its doctrine before contact.

A third pass added the **Redeemer**: a power-up that hands over one shot, a slow
homing projectile with a six-cell blast that kills a whole bot at the centre,
leaves one alive at the edge, and can be shot down in the air — where it
detonates on the spot. It is a fixed file outside the power budget, because a
single event is not a damage-per-second profile. Power-ups now spawn about three
times in a round, and one match in four offers a Redeemer.

Over 1080 rounds: aggressive 53.9 %, anchor 40.9 %, balanced 55.0 %, no balance
failure, and every round reaches the score limit. The tournament weapon priority
is now worth 11 points of win rate, and item control fell from a 36-point spread
to 20. [`docs/m8-weapon-analysis.md`](docs/m8-weapon-analysis.md) holds the
measurements and the questions that are still open.
[`docs/m8-weapon-analysis.md`](docs/m8-weapon-analysis.md) holds the
measurements and the two balance questions that are still open.

**Milestone M8 — teams, roles, matches, and pickups.** A full best-of-3 match
plays in the browser. Between the rounds the tactics screen opens and the
player sets the tactics and the role of each bot. The arena now gives a reason
to move: health, armor, universal ammo, a weapon point, and the two power-ups
of the classic arena shooter (double damage and a shield belt), each on its own
respawn timer, from one spawn table per match. Each team has three roles
(tank, overwatch, skirmisher), and the influence maps give the AI a danger map
and a control map.

The pickups changed the game more than any milestone before: a round went from
10.9 kills in 5125 ticks to 25.9 kills in 2030 ticks, 98 % of rounds now reach
the score limit, and the preset that holds its ground fell from 82 % to 42.5 %.
The batch reports a win rate per role composition, and a rush composition beats
a turtle composition by 8 points. Sections 7.20.13 and 7.20.14 of the dev guide
hold the measurements and the three faults they found, among them an arena that
was symmetric to the cell and still gave one side the better start.

**Milestone M6 — weapon generation.** A run gets five weapons: one fixed
baseline and four generated from a role trait (precise, assault, sniper, heavy)
and one of seven attack types (hitscan, projectile, cone, burst, line, ricochet,
tile). Every generated weapon costs the same power budget, and its archetype is
a label that the generator derives at the end. Combat gained area damage,
projectiles, hazard tiles, damage over time, a crit against a target that stands
still, a dodge for one that moves, and an order of fire that comes from the
reaction speed of the bot and its weapon.

The power budget trades four things, not one: an area weapon pays for its power
in reach, in magazine size, and in cadence before it pays in damage. A run holds
a clear tier ranking (`prize`, `strong`, `standard`), and ammo is counted, so an
empty weapon drops a bot back to the baseline.

**Milestone M5.5 — directional vision (off).** A bot can have a facing, a narrow
focus arc where it can fire, a wide peripheral arc where it only notices, and a
turn rate. The batch says the change did not move the balance, and Section
7.20.10 of the dev guide says why. `perception.directionalVision` in
`data/tuning.json` turns it on; it is off until the pickups of Milestone M8
give a reason to cross the arena.

**Milestone M5 — headless batch harness.** `npm run batch` runs rounds in Node
with no display and prints a win-rate table, the round end reasons, the weapon
use, and any balance failure. It writes three CSV files. Weapon generation
arrives with Milestone M6.

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
| `npm run batch` | Run the headless batch harness (see below). |

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

## The batch harness

`npm run batch` runs rounds with no display and reports the balance.

```
npm run batch                                # data/batch.json, 1000 rounds
npm run batch -- --rounds 200 --seed 7
npm run batch -- --config my-batch.json --out results --quiet
```

It prints a win-rate matrix (tactics preset × arena), the matchup table, a
win rate per role composition with its own matchup table, the round end
reasons, the kills by weapon archetype, the weapon use, and any balance
failure. Every win rate carries its standard error, because a win rate from few
rounds says little (Section 7.2.1 of the dev guide).

`hits per shot` is not a share: one shot of an area weapon hits several bots,
so the number passes 1.

It writes `rounds.csv`, `matchups.csv`, and `presets.csv` into the output
folder. With `--fail-on-balance` the command ends with a non-zero exit code
when it finds a balance failure, so a workflow can use it as a gate.

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

The test arena has 180-degree rotational symmetry, so the two teams get the
same arena. The parser also pairs the spawn slots of the two teams, because a
row-major scan reads the second spawn group in the reverse order of the first,
and the slot decides the role of a bot. Section 7.2.1 of the dev guide says why
this matters and how to check it.

## Deployment

The workflow `.github/workflows/deploy.yml` builds the project and deploys it
to GitHub Pages on each push to `main`. Enable Pages for the repository with
the source **GitHub Actions**.
