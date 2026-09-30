# ASCII Bot Shooter — Development Guide (Skeleton)

Working title: **TBD**. This document uses "the game".

Status: Pre-production. This guide defines the structure. Most numbers and content are placeholders. A later pass will set the details.

---

## 0. How to use this document

This document is a blueprint for Claude Code.

1. Read the full document before you write code.
2. Implement the milestones in Section 11 in order.
3. Do not implement a feature before its milestone.
4. Keep the interfaces in Section 7 stable. If an interface must change, update this document in the same commit.
5. Mark each placeholder value with the comment `// TBD`. A JSON data file cannot hold a
   comment, so the file lists the key of each placeholder value in its `tbd` array.
6. Put all tunable numbers in data files (Section 9), not in code.

---

## 1. Glossary

| Term | Meaning |
|---|---|
| Run | One tournament from start to end. |
| Match | A best-of-3 contest between two teams on one arena. |
| Round | One game inside a match. A round ends at a score limit or a time limit. |
| Arena | One generated map. All rounds of a match use the same arena. |
| Tick | One step of the simulation. |
| Headless | The simulation runs with no display. |
| Archetype | A weapon role template (for example, Precision). |
| DPS profile | Expected damage per second of a weapon at close, mid, and long range. |
| Tactics | Settings that the player gives to a bot. Orders. |
| Attributes | Fixed abilities of a bot (accuracy, reaction time). What a bot *is*. |
| Role | Overwatch, Tank, or Skirmisher. A preset of tactics plus role behaviors. |
| Affinity | A meter that increases when a bot does or experiences a type of event. |
| Trait | A double-edged modifier. A bot gets a trait when an affinity reaches a threshold. Every trait has a cost and a bonus. |
| Rivalry | A relation between two bots on different teams, made by repeated kills. |
| Rivalry log | The record of all kill events between two rivals. |
| Spawn table | The list of which item spawns at each weapon pickup point in a match. |
| Snapshot | A saved copy of a champion team. |
| Championship roster | The list of all snapshots. |
| Utility AI | An AI that gives a score to each possible action and selects the highest. |
| Influence map | A grid of values (for example, danger) that bots read. |
| Grammar | A set of text patterns with symbols. The generator replaces each symbol with an entry from a table. |
| Spark table | A table of short words or phrases with weights. The generator selects one entry at random. |

---

## 2. Design summary

### 2.1 Core loop

1. The player enters a team name.
2. The game generates a run: arenas, weapons, and opponent teams.
3. Before each match, the player reads the arena data, the spawn table, and a scouting report.
4. The player sets team tactics, bot tactics, and roles.
5. The match starts. Each round runs as a simulation. The player watches or skips.
6. Between rounds, the player reads a round report and can change tactics.
7. After the match, the game shows a match report.
8. Bots gain affinity. Bots can gain traits. Rivalries can start.
9. Repeat from step 3 until the run ends.
10. If the player wins the run, the team enters the championship roster.

### 2.2 Locked decisions

- **Stack:** TypeScript and rot.js. Browser build hosted on GitHub Pages (Section 3).
- **Display:** 2D top-down ASCII grid.
- **Control:** indirect. The player sets parameters. The player does not control a bot.
- **First game mode:** Team Deathmatch (TDM). CTF and Domination come later.
- **Team size:** 3 bots per team (3v3). Reason: the player can follow and care about each bot.
- **Match format:** best of 3 rounds. All rounds use the same arena and the same opponent team.
- **Tactics between rounds:** the player can change tactics between rounds.
- **Progression timing:** affinity collects during all rounds. Traits apply after the match, not during it.
- **Collision:** an enemy bot blocks movement. A teammate does not.
- **Round end:** a round ends when one team makes 15 kills, or after 3 simulated minutes (3600 ticks at 20 ticks per second).
- **A drawn round:** an equal score at the time limit starts sudden death. The next kill wins the round.
- **Pickups:** the spawn table is fixed for all rounds of a match. The spawn table can change in the next match.
- **Arenas:** spawn points and pickup points are fixed per arena.
- **Weapons per run:** 5 total. 1–2 are fixed baseline weapons. The other weapons are procedural.
- **Weapons** come from archetypes with a power budget.
- **Roles:** Overwatch, Tank (includes Anchor behavior), Skirmisher (includes Flanker behavior).
- **Traits:** one mechanic. Every trait is double-edged. Traits differ only by their trigger affinity.
- **Rivalry scope:** rivalry log, plus affinity and traits from kills between rivals. Nothing more for now.
- **Championship roster:** a winning team is saved. A championship mode unlocks. The player can fight previous champion teams.
- **Names:** a grammar-based name generator makes team names, bot names, and nicknames (Section 7.19).

### 2.3 Open decisions (do not implement yet)

- **Run length.** The number of opponent teams and matches per run. Set these from a target average run duration (TBD). The number of arenas per run (currently 4–5) depends on this. If matches are more than arenas, arenas repeat.
- **Run structure:** ladder, league, or bracket.
- Role duplication (can a team use the same role two times). Default: yes.
- Progression reset per run or across runs.
- Meta-progression.
- Weapon alt-fire.
- Verticality substitutes (jump pads, high ground).
- Arena size for mobile screens (Section 7.18).
- Final visual style and color palette.

---

## 3. Technology stack

| Area | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict mode) | Runs in the browser and in Node. Fast enough for the simulation. |
| Roguelike toolkit | `rot-js` | ASCII display on canvas, FOV, A* and Dijkstra pathfinding, map generators. Works in the browser and in Node. |
| Build | Vite | Fast development server. Simple static build. |
| UI screens | Plain TypeScript, or React (optional) | Menus and reports. The arena view uses the rot.js display. |
| Data files | JSON, validated with `zod` at load | Native import in Vite and Node. Validation finds data errors early. |
| Saves | Browser `localStorage`, plus JSON export and import | Saves stay on one device. Export and import move teams between devices. |
| Tests | `vitest` | Works with Vite. |
| Batch harness | Node CLI (run with `tsx`) | Runs the simulation headless. |
| Batch analysis | CSV or JSON output, analyzed in Python and pandas (optional) | Analysis stays outside the game code. |
| Hosting | GitHub Pages, deployed by a GitHub Actions workflow | One URL for all devices. |

**Randomness.** Do not use `Math.random()`. Do not use the global `ROT.RNG` instance. Implement a small seeded PRNG (for example, sfc32) in `core/rng.ts`. Each system gets its own instance (Section 7.1).

---

## 4. Architecture principles

1. **Simulation and display are separate.** Simulation modules never import DOM code, the rot.js display, or UI code. rot.js FOV and pathfinding are allowed in the simulation, because they have no DOM dependency.
2. **Headless first.** Every system must work in Node with no display. The batch harness (Section 7.16) uses this.
3. **Deterministic.** One seed gives one result. All randomness comes from seeded RNG streams.
4. **Fixed tick.** The simulation advances in fixed ticks. Display speed does not change simulation results.
5. **Data-driven.** Archetypes, traits, roles, name grammars, and tuning numbers are in data files.
6. **Events are the record.** Systems emit events. Stats, progression, rivalries, the kill feed, and reports read events. They do not read internal state of other systems.
7. **Small interfaces.** Each module has one clear entry point (Section 7).

---

## 5. Directory layout

The project root is the repository root.

```
./
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts                 # build and test configuration
├── eslint.config.js               # module boundary rules (Section 4.1)
├── index.html
├── .github/workflows/deploy.yml   # build and deploy to GitHub Pages
├── docs/
│   └── dev-guide.md               # this document
├── data/
│   ├── tuning.json                # global numbers (tick rate, speeds, limits)
│   ├── arenas/*.txt               # hand-made arena maps (M1 test arena)
│   ├── weapon-roles.json          # role traits, attack types, power budget
│   ├── weapons/*.json             # fixed weapons (the M3 baseline weapon)
│   ├── tactics.json               # tactics presets
│   ├── batch.json                 # batch harness configuration
│   ├── announcements.json         # kill announcement tables
│   ├── weapon-traits.json         # weapon mutations
│   ├── bot-traits.json            # bot traits
│   ├── roles.json                 # role presets
│   ├── arena-profiles/*.json      # generator parameter sets
│   └── names/
│       ├── team-grammar.json
│       ├── bot-grammar.json
│       ├── nicknames.json         # epithet tables, linked to traits
│       └── blocklist.json
├── src/
│   ├── core/                      # rng.ts, types.ts, events.ts, schemas.ts, data.ts
│   ├── arena/                     # generation, metrics, validation, pickups
│   ├── weapons/                   # generation, budget, dps profile
│   ├── sim/                       # round loop, match, movement, combat, pickups
│   ├── ai/                        # perception, navigation, utility AI, influence
│   ├── progression/               # affinity, traits, rivalry log
│   ├── meta/                      # run, championship, saves, migrations
│   ├── names/                     # grammar expander and name generators
│   ├── report/                    # stats, reports, kill feed text
│   ├── render/                    # canvas display, weapon VFX, speed control (browser only)
│   ├── ui/                        # screens and menus (browser only)
│   ├── main.ts                    # browser entry point
│   └── cli/
│       ├── batch.ts               # Node entry point for the batch harness
│       └── styles.ts              # Node entry point for the arena-style harness
└── tests/
```

Rule: only `render/`, `ui/`, and `main.ts` can use browser APIs.

---

## 6. Core data model

These are sketches. Field names can change. Keep the structure.

### 6.1 Geometry

```ts
type Cell = { x: number; y: number };   // grid position
type Vec2 = { x: number; y: number };   // sub-cell position for movement and projectiles
```

### 6.2 Arena

```ts
enum Tile { Floor, Wall, CoverLow, Hazard, Spawn, Pickup }

interface PickupPoint {
  cell: Cell;
  kind: "weapon" | "armor" | "health" | "powerup" | "ammo";
  slotId: string;          // the spawn table sets the item for weapon slots
  respawnTicks: number;
}

interface Arena {
  seed: number;
  profile: string;         // generator profile id
  width: number;
  height: number;
  tiles: Uint8Array;       // width × height, values from Tile
  rooms: Room[];           // macro graph nodes
  links: Link[];           // macro graph edges
  spawns: Cell[];
  pickups: PickupPoint[];
  metrics: ArenaMetrics;   // Section 7.2
}
```

### 6.3 Weapon

> **Section 7.20 changes this interface.** `delivery` becomes `attackType` with
> seven values, the weapon gains a role trait and a reaction per range band, and
> the archetype list changes: `burst` goes, `assault` and `marksman` arrive.

```ts
type Archetype = "precision" | "splash" | "burst" | "denial" | "versatile" | "baseline";

interface Weapon {
  id: string;
  name: string;
  archetype: Archetype;
  delivery: "hitscan" | "projectile";
  damage: number;
  fireIntervalTicks: number;
  rangeMax: number;
  projectileSpeed: number | null;
  aoeRadius: number;          // 0 = no area damage
  dotDamage: number;          // damage per tick, 0 = none
  dotTicks: number;
  hazardTicks: number;        // persistent hazard tiles, 0 = none
  critChance: number;
  critConditions: string[];   // for example "targetStationary", "targetUnaware"
  ammoMax: number;
  traits: string[];           // weapon mutations
  dpsProfile: { close: number; mid: number; long: number };
  budgetUsed: number;
}
```

### 6.4 Bot

```ts
interface Attributes {        // what the bot IS
  accuracy: number;
  reactionTicks: number;
  moveSpeed: number;
  awareness: number;
}

interface Tactics {           // what the player TELLS the bot (0.0–1.0 unless stated)
  aggression: number;
  // `retreatThreshold` was removed after M8. A bot no longer leaves a fight to
  // heal: it takes health and armor only when it has no enemy to engage
  // (Section 7.20.17).
  preferredRange: "close" | "mid" | "long";
  weaponRolePref: Archetype | null;
  itemControl: number;
  holdPosition: number;       // 0 = roam, 1 = hold
  evasion: number;
  hazardTolerance: number;
}

type Role = "overwatch" | "tank" | "skirmisher";

// Section 7.20.8 adds an optional advanced layer beside Tactics. Its first
// setting is the weapon priority of the run.  // TBD

interface Bot {
  id: string;
  name: string;
  nickname: string | null;
  teamId: string;
  role: Role;
  attributes: Attributes;
  tactics: Tactics;
  affinities: Record<string, number>;
  traits: string[];           // trait ids, capped
  rivalryIds: string[];
}
```

### 6.5 Team

```ts
interface TeamTactics {
  cohesion: number;
  focusFire: number;
  spacing: number;
  trading: number;
}

interface Team {
  id: string;
  name: string;
  theme: string | null;       // name theme
  bots: [Bot, Bot, Bot];      // 3v3
  tactics: TeamTactics;
  doctrine: string | null;    // label for AI teams, for example "rushSplash"
}
```

### 6.6 Match and round

```ts
interface SpawnTable {
  slots: Record<string, string>;   // slotId -> weapon id or item id
}

interface RoundResult {
  roundNumber: 1 | 2 | 3;
  winnerTeamId: string;
  score: Record<string, number>;
  events: GameEvent[];
  tacticsUsed: Record<string, TeamTactics & { bots: Record<string, Tactics> }>;
}

interface MatchResult {
  matchId: string;
  arenaSeed: number;
  spawnTable: SpawnTable;          // same for all rounds
  rounds: RoundResult[];           // 2 or 3 rounds
  winnerTeamId: string;
}
```

### 6.7 Rivalry

```ts
interface RivalryEvent {
  runId: string;
  matchId: string;
  roundNumber: number;
  arenaProfile: string;
  tick: number;
  killerId: string;
  victimId: string;
  weaponArchetype: Archetype;
  rangeBand: "close" | "mid" | "long";
}

interface Rivalry {
  id: string;
  botA: string;
  botB: string;
  events: RivalryEvent[];          // the rivalry log
  active: boolean;
}
```

### 6.8 Events

All systems emit events to one event bus. Each event has `tick`, `roundNumber`, and `type`.

Minimum event types:

- `MatchStart`, `MatchEnd`, `RoundStart`, `RoundEnd`
- `Spawn`, `Death`, `Kill`, `Assist`
- `Shot`, `Hit`, `Crit`, `DotTick`, `HazardCreated`
- `PickupTaken`, `PickupRespawned`
- `DecisionChanged` (debug)
- `TraitGained`, `RivalryStarted`, `RivalryEventAdded`, `NicknameGained`
- `Announcement` (a multi-kill, a killing spree, the end of a spree, sudden death)

`Kill` events must include context: weapon archetype, range band, killer in cover, target aware, killer health, multi-kill count.

---

## 7. Systems

Each subsection gives: purpose, entry point, and rules. Details are TBD unless stated.

### 7.1 RNG (`core/rng.ts`)

- Purpose: deterministic randomness.
- Entry point: `createRngStreams(seed)` returns named streams: `arena`, `weapons`, `names`, `sim`, `ai`, `progression`.
- Rule: each system uses its own stream. A change in one system must not change results in another system.
- Rule: each round gets a sub-seed from the match seed. A round can be replayed alone.

### 7.2 Arena generation (`arena/`)

Purpose: generate arenas with different feels from parameter profiles.

Entry point: `generateArena(profile, rng): Arena`

Steps:

1. **Macro graph.** Generate rooms and links. Profile parameters: room count, room size range, corridor length, loop count, links per room.
2. **Micro fill.** Fill rooms with cover, pillars, and hazards. The profile selects the fill method:
   - Rooms and corridors (closed feel). Use rot.js `Digger` or `Uniform` as a base, or write a BSP generator.
   - Cellular automata (open, organic feel). Use rot.js `Cellular`.
   - Prefab chunks (designed spaces). Later.
3. **Loops.** Add links until the loop count reaches the profile minimum. rot.js generators often make tree-like maps with few loops, so this step is necessary.
4. **Spawn placement.** Place spawns far from each other and at fair distances from pickups.
5. **Pickup placement.** Put important pickups (armor, powerup) in contested cells. Use betweenness centrality on the macro graph to find contested rooms.
6. **Metrics.** Calculate `ArenaMetrics`.
7. **Validation.** Reject and regenerate if the arena fails a rule.

`ArenaMetrics` (minimum):

- Connectivity (all floor cells reachable: yes or no).
- Loop count.
- Dead-end count.
- Sightline length distribution (mean, 90th percentile).
- Chokepoint count.
- Cover density.
- Open area ratio.
- Spawn fairness (difference in distance from each spawn to key pickups).

Validation rules (starting set, values TBD):

- Connectivity must be true.
- Loop count ≥ minimum.
- Spawn fairness ≤ maximum.
- At least one long sightline and one close-quarters area.

The pre-match screen shows the metrics to the player in plain words (for example, "Long sightlines. Three chokepoints.").

### 7.2.1 Symmetry, spawn fairness, and how to measure them

This subsection holds what the work on the M1 test arena taught. It applies to
the generator of M7 and to the batch harness of M5.

**Why it matters.** A batch result measures the tactics only if the arena gives
the two teams the same conditions. The first test arena was hand-made and not
symmetric. With the same tactics on both teams, the south-east spawn group won
68 % of 60 rounds. Every doctrine and role measurement on that arena would have
carried the spawn advantage inside it.

**Symmetry is the simple answer.** An arena with 180-degree rotational symmetry
gives each team the same rooms, the same sightlines, and the same distances to
every pickup point. Build it from one half: take the cells of the half, add the
image of every cell under `(x, y) → (width − 1 − x, height − 1 − y)`, and the
result is symmetric whatever shape the half has. A 60 × 30 grid has no fixed
point under this map, so a "centre" item is always a pair.

Mirror symmetry (left to right) also works, but rotational symmetry suits
spawns at opposite corners, and it does not make a pair of rooms that are each
other's reflection, which plays differently for a right-handed sightline.

**Rules for a symmetric arena:**

1. Place every spawn cell, every pickup point, every cover cell, and every
   hazard cell in pairs. An odd count of any pickup kind means the arena is not
   symmetric.
2. Keep the spawn groups in the order that the teams read: the arena file
   gives the first `teamSize` spawn cells to team A. Put one group in the top
   half, so a row-major scan reads that group first.
3. Check the symmetry with a test, not by eye. `tests/arena.test.ts` compares
   every cell with its image.

**Symmetry is not enough.** Two other faults give one team an advantage, and
neither shows in the arena file:

- **Tick order.** The simulation walked the bots in a fixed order, so team A
  decided, moved, and fired before team B on every tick. In an exchange at the
  same tick, the bot that fires first can kill the other before it fires. On
  the symmetric arena this alone gave team A 55 % of 100 rounds. `botsInTickOrder`
  now turns the order around on every second tick. The order stays a function
  of the tick, so the simulation stays deterministic.
- **The order of the spawn list.** A row-major scan reads the second spawn
  group in the reverse order of the first, so the slot 0 of team B stands where
  the slot 2 of team A stands. The slot decides the role, so two symmetric
  halves gave two different fights, worth 5.75 points of win rate.
  `orderSpawnsForFairness` pairs the slots at parse time. Section 7.20.14 holds
  the measurement, and **an M7 generator must do the same**.
- **Any "first one wins" rule over the bot list.** `applyPickups` handed every
  contested pickup point to team A, because it walked `state.bots` in team
  order. Every rule of that shape needs `botsInTickOrder`, or a list order
  becomes a side advantage.
- **A stall that looks like balance.** Before the fix of `selectTarget`, two or
  three enemies at almost the same distance made the nearest one change on
  every tick. The reaction timer started again with every change, so the bot
  never fired. 6 % of rounds ended 0–0 after the full time limit. A batch that
  counts only wins does not show this. **The batch harness must report the mean
  kills per round and the number of rounds that reach the time limit.** A round
  with no kill is a defect, not a draw.

**How many rounds to trust.** A win rate from `n` rounds has a standard error of
about `50 / √n` percent:

| Rounds | Standard error | A result of 50 % ± this is normal |
|---|---|---|
| 100 | 5.0 % | 45 % – 55 % |
| 400 | 2.5 % | 47.5 % – 52.5 % |
| 1000 | 1.6 % | 48.4 % – 51.6 % |

So a 100-round test cannot show a 5 % bias: the noise is the same size as the
limit. Use 400 rounds or more before you call an arena or a doctrine unfair,
and state the number of rounds with every win rate.

**A test that separates the arena from the code.** To find out whether a bias
comes from the arena or from the simulation, run the batch two times and give
the spawn groups to the other teams the second time. A bias that follows the
spawn position is the arena. A bias that stays with the team name is the code.

Read the result with care: swapping the groups also swaps which team stands
near which pickup slot, and the slot ids do not turn around with them. The test
names a suspect; it does not measure the size of the bias. The number to report
is the win rate of team A in the configuration you actually ship, over 600
rounds or more.

#### 7.20.11 Measurement: what the weapons changed, and what they did not

M6 was measured against the same 900 rounds, the same seed, and the same three
presets as Section 7.20.10.

| Preset | Before M6 | After M6 |
|---|---|---|
| anchor | 82.0 % ±1.6 | **74.2 % ±1.8** |
| balanced | 27.0 % ±1.8 | **50.8 % ±2.0** |
| aggressive | 41.0 % ±2.0 | **24.9 % ±1.8** |

**The weapons did what Section 7.20.1 asked of them.** A bot that holds a
position lost almost 8 points, which is four standard errors, and the middle
preset went from a clear loser to even. Section 7.20.10 said that weapons alone
could not bring `anchor` to 50 % before the pickups of M8, and that still holds.

`aggressive` fell by 16 points. An area weapon punishes the bot that closes in,
because the bot arrives inside the area. This is worth a second look when M8
gives a reward for moving.

**One target was missed: the kill share.** Section 7.20.9 asks that no archetype
takes more than about half the kills. `splash` takes 80 %.

Three configurations were measured while looking for the cause:

| Model of an area weapon | `splash` share of kills |
|---|---|
| Area and damage over time inside the DPS profile | 73 % |
| …plus a factor for "an area does not roll to hit" | 88 % |
| …plus a higher estimate of how many bots an area touches | 95 % |

**Every change that raised the modelled value of an area weapon raised its kill
share, although each one lowered its damage.** That is the cause:

1. The DPS profile has two readers that pull in opposite directions. The power
   budget reads it as a cost, so a higher number gives the weapon less damage.
   The AI reads it as the key for its choice (Section 7.8), so a higher number
   makes the bot take the weapon more often. A better model of an area weapon
   therefore makes a weaker weapon that the AI picks more.
2. **The AI is winner-take-all.** A bot holds every weapon of the run and fires
   the one with the highest DPS at the current band. The kill share of that one
   weapon goes to almost 100 %, however near the others are in power. The kill
   share measures which weapon has the top number, not whether the weapons are
   balanced.

**The kill share cannot be fixed by tuning.** It needs one of:

- **Ammo, and pickups (M8).** A bot that runs a weapon dry must change to
  another. A bot that does not hold every weapon must use what it found. This
  is the answer that the design already plans.
- **An AI that spreads its choice**, for example a weapon preference per bot
  (Section 7.20.8 gives the player that control), or a rule that keeps a bot on
  a weapon for a time.

Until then, read the kill share as "which weapon had the top DPS number", and
read the **budget** test as the real check on weapon balance: every generated
weapon costs the same.

**Two faults were found and fixed on the way.** Both are the same shape: a
number that the budget charged for, and the AI could not see.

1. **The baseline weapon beat the weapons that paid a full budget.** It was not
   priced at all, so its 60 mean DPS sat above the generated median of 57. A
   bot often chose the fallback over everything else. The DPS profile now holds
   the expected damage, the generated median is 96, and the baseline is a
   fallback again at 63 % of it. Section 7.3 asks for a viable fallback, not
   the best weapon.
2. **Damage over time cost up to 45 of the 100 budget points, and the AI could
   not see any of it.** A weapon paid nearly half its budget for an effect that
   did not appear in its DPS profile, so it looked weak and the AI passed it
   over. One shot could also deliver 150 damage against 100 health. The damage
   over time and the hazard tiles are now inside the DPS profile, the budget no
   longer charges for them twice, and both are much smaller.

#### 7.20.12 The budget must trade more than damage

Section 7.20.11 left `splash` at 80 % of the kills and could not explain it away
by tuning. The cause was simpler than the models: **the budget solved for the
damage and for nothing else.**

Every other attribute came from the role and was never touched again. Inside
the `heavy` role, the measurement was:

| Attack type | damage | range | magazine | ticks per shot |
|---|---|---|---|---|
| burst (an area) | 33.5 | 25.8 | 19 | 13.3 |
| line | 32.1 | 23.6 | 18 | 12.0 |
| projectile | 38.4 | 27.3 | 24 | 12.0 |

An area weapon that never misses and touches more than one bot held the same
range, the same magazine, and the same cadence as a plain shot. It paid for all
of that with about one point of damage.

**The fix: the attack type now shifts four numbers.**

| Attack type | Range | Magazine | Ticks per shot |
|---|---|---|---|
| hitscan | 1.00 | 1.00 | 1.00 |
| projectile | 0.95 | 0.90 | 1.05 |
| ricochet | 0.90 | 0.80 | 1.10 |
| line | 0.90 | 0.60 | 1.25 |
| cone | 0.55 | 0.65 | 1.15 |
| burst | 0.80 | 0.45 | 1.30 |
| tile | 0.75 | 0.40 | 1.35 |

A cone now reaches about half as far. A tile weapon holds four rounds in ten
and fires a third more slowly. The budget then solves for the damage on top of
that shape, so an area weapon pays in reach, in rounds, and in cadence before
it pays in damage.

**Two more changes came with it.**

- **Weapons have tiers.** A run holds one `prize` weapon at 1.25 of the budget,
  one `strong` at 1.0, and the rest at `standard` at 0.85. A run therefore has
  a clear ranking, and the player can build tactics around the best weapon of
  the run. Five weapons of equal power give the player nothing to choose.
- **Ammo is counted.** A shot spends a round, and an empty weapon drops the bot
  back to the baseline. A magazine is now a real cost: a strong weapon with a
  small magazine gives a short burst of power and then the fallback. The
  baseline weapon never runs dry, which is what Section 7.3 means by a viable
  fallback. The ammo pickups of M8 refill the rest.
- **The budget was rescaled.** `dpsWeight` went from 1.0 to 2.7. At 1.0 a
  weapon needed about 85 mean DPS against 100 health, so a slow weapon had to
  deal more than 150 damage in one shot, and no `sniper` or `heavy` weapon
  could be built at all: **0 of 200 drafts fitted their damage range**. The
  damage ranges of every role were then measured from what the budget asks for,
  instead of guessed. Every role now builds 75 % to 98 % of the time.

**The result.**

| Measurement | Before M6 | M6 | M6 with the full budget |
|---|---|---|---|
| `anchor` win rate | 82.0 % ±1.6 | 74.2 % ±1.8 | **69.1 % ±1.9** |
| `balanced` win rate | 27.0 % ±1.8 | 50.8 % ±2.0 | 48.1 % ±2.0 |
| `aggressive` win rate | 41.0 % ±2.0 | 24.9 % ±1.8 | 32.8 % ±1.9 |
| Highest archetype kill share | — | 80 % (`splash`) | **22 % (`assault`)** |

The kill share now reads: assault 22 %, precision 19 %, marksman 15 %, heavy
13 %, baseline 10 %, splash 10 %, denial 8 %. Section 7.20.9 asked that no
archetype take more than about half. It takes 22 %.

**What this says about the winner-take-all reading of Section 7.20.11.** That
reading was right about the mechanism and wrong about the cure. The AI does
take the weapon with the top DPS at the current band. Once no single weapon
holds the top place at every band, and once a magazine runs out, the bot rotates
on its own. A weapon that reaches 12 cells cannot hold the long band, and a
weapon with 7 rounds cannot hold any band for long. Ammo and a real shape did
what tuning a single number could not.

**A tier is not a fault.** Weapons are not meant to be equal. A run should have
a best weapon, and the player should plan around it. The balance question is
whether the strong weapon pays for its power in reach, in rounds, and in
cadence, and whether the batch still shows every archetype taking kills.

#### 7.20.13 Measurement: what the pickups changed, and the two faults they found

M8 gave the arena its first reward for moving: health, armor, universal ammo, a
weapon point, and the two power-ups of Section 7.12. The measurement is 1080
rounds, three presets, three role compositions, one arena.

**The pace of a round.** Before the pickups a round made 10.9 kills in 5125
ticks and 40 % of rounds ran to the time limit. After them a round makes **25.9
kills in 2035 ticks and 98.1 % of rounds reach the score limit.** The teams now
meet, because the arena gives them a reason to.

**The balance of the presets.**

| Preset | Before M6 | M6 | M6 full budget | M8 |
|---|---|---|---|---|
| anchor | 82.0 % ±1.6 | 74.2 % ±1.8 | 69.1 % ±1.9 | **41.9 % ±1.9** |
| balanced | 27.0 % ±1.8 | 50.8 % ±2.0 | 48.1 % ±2.0 | **56.3 % ±1.9** |
| aggressive | 41.0 % ±2.0 | 24.9 % ±1.8 | 32.8 % ±1.9 | **51.8 % ±1.8** |

The preset that holds its ground no longer wins the game by standing still, and
no preset passes the 60 % balance rule of Section 7.16. `anchor` is now the
weakest of the three, which is the opposite of the fault of Section 7.20.10 and
is worth watching, not fixing by another 10 points of tuning.

**Role composition.** This is the acceptance test of M8: the batch reports a
win rate per composition, and the compositions differ.

| Composition | Roles | Win rate |
|---|---|---|
| standard | tank, overwatch, skirmisher | 52.8 % ±1.9 |
| turtle | overwatch, overwatch, tank | 48.8 % ±1.9 |
| rush | skirmisher, skirmisher, tank | 48.5 % ±1.9 |

Four points between `standard` and the other two is more than two standard
errors, so one of each role is a real choice and not noise. The matchup table
says more than the column does: `standard` beats `turtle` 60.8 % ±4.5 and
`rush` beats `turtle` 62.5 % ±4.4, while `standard` against `rush` is even. Two
bots that hold a sightline lose to any composition that moves.

A caution about this table. Before the spawn order fix of Section 7.20.14 the
same batch read `rush` 54.4 %, `standard` 49.3 %, `turtle` 46.3 %, which put
`rush` on top. A side bias of six points was enough to turn the ranking of the
compositions around. Do not read a composition table from a batch whose mirror
matchups are not near 50 %.

**The first fault: holding ground was free.** A bot that chose `HoldPosition`
almost never had an enemy in sight: **28 962 of 29 051 HoldPosition ticks were
blind**, and those ticks were 47 % of every bot tick in a round. Both teams
stood in an empty corner until the clock ran out.

Holding ground is a **sightline** action, so its value now falls with the time
since the last contact (`ai.holdContactTicks`, `ai.holdBlindShare`), and the
memory of a last seen position lasts long enough for the `Chase` action to use
it (`perception.memoryTicks` went from 60 ticks to 200). A bot that has seen
nobody for ten seconds holds nothing, and it goes to find a fight or an item.

The `holdPosition` tactic also suppressed `SeekPickup` completely, by a factor
of `1 - holdPosition`. Items decide fights from M8 on, so that made the anchor
preset unplayable; the factor is now `1 - holdPosition × ai.holdSuppressesPickup`.

**The second fault: a weapon was chosen for one band.** With no enemy in sight
a bot picked its weapon by the DPS at the band of its `preferredRange` tactic
alone. A close-range preference therefore put a short-range weapon in its hands,
and the bot then could not fire at the distance where the arena's fights happen.
The cost was measured by giving the aggressive preset one changed value at a
time, over 700 rounds each:

| Change to the aggressive preset | Win rate |
|---|---|
| none | 43.4 % ±3.5 |
| `retreatThreshold` 0.15 → 0.3 | 42.9 % ±3.5 |
| `itemControl` 0.3 → 0.5 | 44.9 % ±3.5 |
| `evasion` 0.2 → 0.4 | 41.5 % ±3.4 |
| `hazardTolerance` 0.7 → 0.3 | 44.9 % ±3.5 |
| **`preferredRange` close → mid** | **63.6 % ±3.4** |

One value was worth 20 points and every other value was worth nothing. That is
not a balance problem, it is a bug: a tactic that a player can set must not be a
trap. A weapon is now worth what it **reaches**, summed over every band inside
its range, and `preferredRange` is a bias on that sum
(`ai.preferredRangeBias`). The band that a bot fights at comes from the weapon
in its hands, not from the tactic, and `Reposition` measures the mismatch in
lost damage instead of in cells. After the fix the same seven presets sat inside
41.5 % to 53.0 %.

**The pattern, again.** Both faults are the pattern of Section 7.20.12 read from
the other side: **a number that the AI reads but that does not mean what the
name says.** `positionValue` measured the ground and not the sightline;
`bestWeaponAt` measured one band and not the reach. Both gave the AI a confident
wrong answer, and neither showed up as a crash or a failing test. Only a batch
that reports why a round ended found them.

#### 7.20.14 A symmetric arena is not a fair match

Section 7.2.1 said that the test arena has 180-degree rotational symmetry, and
it does: every one of its 1800 cells matches its turned-around partner. The
match was still unfair by 5.75 points of win rate.

**The cause is the order of the spawn list.** A scan of the map collects the
spawn cells from the top left to the bottom right. Team A takes the first three
and team B the next three. Under a half turn the first group maps onto the
second **in reverse**, so the slot 0 of team B stood where the slot 2 of team A
stood. The slot decides the role (Section 7.11), so the tank of one team started
in the corner that faced the skirmisher of the other. Two symmetric halves, two
different fights.

`orderSpawnsForFairness` now reorders the list: the cell of slot *i* of every
later team is the one nearest to the turned-around cell of slot *i* of the first
team. On a symmetric arena that is the exact partner; on any other arena it is
the nearest one, and nothing breaks. After the fix the side bias measured over
600 rounds is **50.7 % ±2.0**, which is even.

A second, smaller side bias came from `applyPickups`, which walked the bot list
in team order, so team A took every point that two enemies reached in the same
tick. It now walks the bots in reaction order, as firing does (Section 7.20.7).

**The rule for M7.** An arena generator must not only make the two halves the
same shape. It must also hand the two teams their spawn cells in matching slot
order, or a generated arena will carry this same hidden bias into every
measurement made on it.

#### 7.20.15 The weapons are gated, and three more numbers stopped lying

The measurement of Section 7.20.13 was made on a game where **every bot spawned
holding every weapon**. `makeBot` gave each bot the whole run set with a full
magazine, and a weapon point only refilled ammo. The prize weapon was free, and
it took 82.7 % of the kills from a 1.26 times edge in damage.

**A bot now spawns with the baseline weapon alone.** A generated weapon comes
from a weapon point and from nowhere else. A bot keeps what it finds for the
round; death costs it the armor, the shield, the power-ups, and the ground.

Three more numbers were found to mean something other than their name.

**A cone declared 2.2 times the range it had.** `shape.coneRangeFactor` was
applied at damage time, on top of the `rangeFactor` of the attack type, so a
cone with `rangeMax` 12.3 reached 5.5 cells and faded to nothing across them.
The AI read the declared 12.3 and fired at 10. A cone delivered 1.5 damage per
shot. The generator now applies both factors, so `rangeMax` is the real reach,
and `value.coneFadeShare` puts the fade inside the DPS profile.

**The budget paid for reach the arena never uses.** It averaged the three range
bands equally, while the arena fires 51 % close, 48 % mid and 1 % long. A
marksman paid 9 of its 100 points for cells it never shot through.
`value.bandShare` now weighs the bands, for the budget and for the AI alike, and
`budget.rangeValueCapCells` with `budget.rangeValueTailShare` prices reach past
the mid band at 45 % — a price, not a wall. A hard wall gave the sniper role its
9 points back as damage, and it took 29 % of the kills.

**The projectile family paid for a critical hit it could not land.**
`releaseShot` rolled the crit and then dropped it on every path but `hitscan`
and `line`. A projectile now carries its crit to the impact. It also leads a
moving target: a shot flies 4 to 9 ticks at the distance the arena fights at,
and a bot crosses 1 to 2 cells in that time against a hit radius of half a cell,
so a shot at the present position missed by default.

**An area weapon is now worth aiming.** `selectTarget` divides the distance to
an enemy by the number of enemies that one shot would catch, so an enemy behind
an enemy is worth turning to. Before this, nothing in the code ever tried for a
multi-hit, and multi-hits still made up 36 % of burst landings and 30 % of line
landings: they were accidents.

**A pickup point draws its glyph only while it holds its item.** The display
read the glyph from the map tile, so an empty pad looked the same as a live
power-up. `readyPickupCells` gives the display the truth, and it lives in the
simulation so that a test can reach it without a browser.

#### 7.20.16 Three faults that the fixes themselves found

**1. One weapon per point is not fair on a symmetric arena.** No weapon point of
the test arena is even: the most contested pair still sits 31 steps from one
team and 51 from the other. Placing one weapon per point therefore handed the
prize to whichever side won the tie-break, and the mirror matchup read 68 %.

A pair of points that face each other under a half turn now holds the **same**
weapon, and the strongest weapon takes the most contested pair. The power-up
points had the same fault — they rolled once per point, so one team could get
the double damage and the other the shield belt — and they now roll once per
pair. `pickupEvenness` measures how even a point is by walking the floor from
the two spawn groups; Section 7.2 step 5 wants betweenness centrality on the
macro graph, which arrives with M7.

**The rule for M7:** a generated arena must offer both teams the same item on
the same ground, not only the same shape of ground.

**2. Equipping a weapon was an action, and it always lost.** `SwitchWeapon`
competed with `Engage` for the one action of a tick, and `Engage` almost always
scored higher. A bot that ran a weapon dry stayed on the baseline even after an
ammo point refilled it. The baseline took 50 % of the kills, which is not a
fallback (Section 7.3).

Equipping the best weapon is now a **rule**, applied at every decision, and
`SwitchWeapon` is gone from the scored actions. A real bot changes weapon while
it moves and fires. The baseline fell to 25 %.

**3. Two tactic fixes were measured and one was reverted.** Aggression was flat
at M8, so it was given a discount on the danger map: a bold bot would walk into
ground a careful bot walks around. The sweep said aggression 0.9 then lost 17
points to aggression 0.1. Danger is about the ground, and nothing rewards
standing in it, so the discount was a cost with no benefit — the same fault the
rule of Section 7.8 forbids, in the other direction.

Aggression now shortens the aim delay instead (`ai.aggressionReactionDiscount`):
**a bold bot shoots first.** Its cost is already in place — it fights at low
health, it does not break off, and it does not walk to the band where its weapon
is strongest. The sweep now reads 0.1 → 46.2 %, 0.3 → 57.1 %, 0.9 → 50.4 %, so
the lowest setting is the worst one. That is a choice, not a trap and not a
dead axis.

The `holdPosition` tactic suppressed every pickup, including the one under the
bot's feet, so an anchor held ground it could not arm itself from and won
34.6 %. The suppression now falls to nothing as the point gets closer: a camper
takes what lands on it, and only the run across the arena is suppressed. That
one change brought `anchor` back to 46.1 %.

**The state after all of it (1080 rounds).** `aggressive` 46.6 % ±1.8,
`anchor` 46.1 % ±1.9, `balanced` 57.4 % ±1.9 — the three presets inside 11
points for the first time, and none of them over the 60 % rule of Section 7.16.
Kills by archetype: baseline 25.1 %, marksman 23.1 %, precision 12.2 %, heavy
11.3 %, denial 10.2 %, splash 9.3 %, assault 8.7 %. Every round reaches the
score limit.

**Two questions stay open, and a weight will not close them.**
`docs/m8-weapon-analysis.md` Section 5.3 holds them in full:

- **`itemControl` is now structural.** Gating the weapons is what made the arena
  matter, and it also made item control the price of holding a weapon at all:
  the spread grew from 19 points to 36. The answer is a bigger arena with more
  weapon points (M7) or a doctrine that says *which* items a team contests
  (M11).
- **`retreatThreshold` is still a cost with no benefit.** Never retreating is
  worth 28 points. A bot that breaks contact must gain something for it — a
  heal, a re-arm, a regroup — and that is a mechanic, not a number.

#### 7.20.17 The arena decides the contest, and a weapon choice costs something

Four changes, from the reading of Section 7.20.16.

**1. A contested point is an arena acceptance rule, not a placement trick.**
Section 7.20.16 answered an unfair weapon point by mirroring it. That is a
patch: the real answer is that **an arena must offer ground that both teams
reach together**. `checkArenaFairness` is the rule, and the generator of M7 must
pass it:

1. A power-up point sits in a **conflict zone** — both teams reach it inside
   `CONTESTED_STEPS` of each other. A power-up is the item worth a fight, so an
   arena that hides one in a corner turns item control into a chore.
2. At least one weapon point sits in a conflict zone, so the **prize weapon** of
   a run has fair ground to stand on.
3. Every pickup point has a partner of its own kind under the half turn of
   Section 7.2.1.

The placement then follows from the arena instead of working around it: a point
in a conflict zone holds **its own** weapon, and only a point that one team
reaches first is mirrored with the point it faces. The test arena now puts both
power-ups and one pair of weapon points on the line where both teams arrive in
34 steps, so a run offers every weapon it generated.

**2. `retreatThreshold` is gone, and healing is for between fights.** It was a
cost with no benefit worth 28 points of win rate (Section 7.20.16), and the
answer was not to pay it back. Section 2.1 asks for fast combat, so a bot no
longer leaves a fight to heal:

- **A bot takes health or armor only when it has no enemy to engage.**
- **A weapon, its ammo, and a power-up stay contestable under fire.** They are
  what a fight over ground is about, and they are what the arena should make
  people fight for.
- The `Retreat` action is removed. Aggression now has its cost inside the fight:
  a bold bot presses, it cannot heal while it presses, and it dies for it.

This is also what brought item control back under control. The tactic no longer
buys a safe heal in the middle of a fight, so its spread fell from **36 points
to 20** without any change to its weight.

**3. A weapon swap costs firing ticks.** Section 7.20.16 made equipping a rule,
which fixed a bot that never re-armed and also made the choice of weapon free.
A free choice means the best weapon is always in hand, and every tactic about
weapons means nothing.

- **Out of a fight the swap is free.** This is where a role and a doctrine arm a
  bot, and where `weaponRolePref` — the tournament weapon priority of
  Section 7.20.8 — does its work.
- **Inside a fight the swap costs `combat.weaponSwapTicks`** of firing, and the
  bot takes it only when the extra damage over `combat.weaponSwapPayoffTicks`
  beats the shots it gives up. Firing a weapon that is merely good is now
  sometimes right.

`weaponRolePref` became a real choice the moment the swap had a price:
`assault` 61.9 %, `marksman` 54.2 %, `splash` 54.2 %, no preference 51.3 %,
`precision` 50.8 % over 700 rounds. A player who names the right weapon for the
run wins 11 points more than one who names the wrong one.

**The state after all four (1080 rounds).**

| Measurement | Before | After |
|---|---|---|
| `aggressive` | 46.6 % ±1.8 | 53.1 % ±1.8 |
| `anchor` | 46.1 % ±1.9 | **40.9 % ±1.8** |
| `balanced` | 57.4 % ±1.9 | 55.8 % ±1.9 |
| mean ticks per round | 2043 | **1916** |
| `itemControl` spread | 36 pts | **20 pts** |
| `weaponRolePref` spread | not measurable | **11 pts** |
| baseline kill share | 25.1 % | 30.2 % |

Rounds are faster, which is what Section 2.1 asks for. Two costs came with it,
and both are stated rather than hidden:

- **`anchor` fell to 40.9 %.** The preset that holds ground lost the most from
  the healing rule, because holding ground was how it stayed alive. It is still
  inside the 60 % balance rule of Section 7.16, and it is the number to watch.
- **The baseline took 30.2 % of the kills**, up from 25.1 %. A swap with a price
  means a bot that is caught holding the baseline keeps firing it. That is the
  point of the change, and 30 % is the top of what Section 7.3 can call a
  fallback. If it rises again, lower `combat.weaponSwapTicks` before anything
  else.
- **Aggression 0.9 now loses about 10 points to aggression 0.3.** Its cost — no
  healing in a fight — landed harder than its benefit. The next lever is the
  benefit, not the cost: a bold bot should gain more than a shorter aim delay.

#### 7.20.18 The Redeemer: a power-up that is not a weapon

A power-up that hands over **one shot**: a slow homing projectile with a wide
blast, which the other team can shoot down. It answers the question that
Section 7.20.17 left open — what makes a power-up point worth a fight.

**Why a power-up and not a generated weapon.** Double damage and a shield belt
are personal: one bot gets stronger and the other team finds out afterwards. A
Redeemer is a **board state**. Everyone sees the shot in the air, and for a few
seconds the round is about that shot and not about attrition. That is the pull a
conflict zone needs.

**It sits outside the power budget, on purpose.** `data/weapons/redeemer.json`
is a fixed file with `tier: "powerup"` and `budgetUsed: 0`, and the generator
never makes one. The budget of Section 7.3 prices a damage-per-second profile,
and a Redeemer is not one: it is a single event. Pricing it would either make it
useless or make `expectedTargets` lie, which is the fault that Section 7.20.12
spent a whole pass removing.

**What it does.**

| Number | Value | Why |
|---|---|---|
| damage | 120 | Above `combat.healthMax`, so a centre hit kills a whole bot outright |
| `aoeRadius` | 6 cells | The area falls to half at the edge, so 60 damage leaves a whole bot alive |
| `projectileSpeed` | 0.85 cells per tick | Slow enough to see coming and to answer |
| `homingTurnRate` | 0.09 radians per tick | It follows, but it cannot follow a bot that breaks hard around cover |
| `projectileHealth` | 18 | One solid hit sets it off early; a weak one does not |
| `ammoMax` / `ammoPerPickup` | 1 / 0 | One shot means one shot: an ammo point does not refill it |

A bot loses it when it dies, with the other power-ups. Without that rule a bot
could fire it, die, and come back holding another one, because an empty ammo map
reads as a full magazine.

**Shooting it down is the point.** `tryIntercept` runs before a bot picks a bot
to shoot at: a Redeemer flying at a team is a bigger problem than the bot that
fired it. It takes the full reaction of the bot, like any other shot, so a bot
that has just turned around cannot answer in time. A shot that is destroyed
**detonates where it flies**, so an interception at the wrong moment kills the
team that made it. That is three choices in one moment — scatter, shoot it down,
or push while the enemy is busy — and it is the most tactical second the game
has.

**Power-up cadence.** The user's rule is about three power-up spawns in a round,
so that item control is a real strategy and not a chore. `powerup.respawnTicks`
is 1750: two points open the round and about one comes back. Measured over 540
rounds: **2.96 spawns and 2.81 taken per round**. The Redeemer holds weight 2 of
8 in the power-up table, so **26.5 % of matches** have one on the map. A spawn
table is rolled once per match (Section 7.12), so a match either offers the
Redeemer all round or never.

**Measured over 540 rounds, and 1080 for the batch.**

| Measurement | Value |
|---|---|
| Matches whose spawn table holds a Redeemer | 26.5 % |
| Redeemers fired per round | 0.67 |
| Bots caught per shot | 1.26 |
| Kills per Redeemer fired | 1.05 |
| Shots destroyed in the air | 12.2 % |
| Share of all kills | 2.4 % |

One Redeemer is worth about one kill, one in eight is answered in the air, and
it takes 2.4 % of the kills of a round. It is an event, not a strategy: a team
cannot win on Redeemers, and a team that ignores the point gives away a free
kill every few rounds.

**What it cost.** Item control is stronger again: the sweep spread went from 20
points to **32** (0.1 → 40.7 %, 0.9 → 72.6 %). That is the trade the cadence
asks for — a power-up worth a fight makes contesting power-ups worth doing — and
it is the number to watch after M7 gives the arena more ground to fight over.
The preset balance did not move: `aggressive` 53.9 % ±1.8, `anchor` 40.9 % ±1.8,
`balanced` 55.0 % ±1.9, with no balance failure.

#### 7.20.19 Three arena styles, three shapes of fight

Milestone M7, first pass. Three generators, chosen so that each one makes a
different fight and not only a different picture.

| Style | Algorithm | Intent |
|---|---|---|
| `bastion` | a grid of rooms, carved, with corridors and extra doors | closed, many corners, short range |
| `openfield` | one open field, with obstacles dropped into it | open, with fire lanes kept on purpose |
| `cavern` | noise, then a cellular automaton | organic, no straight lane, a wide middle |

**One pipeline, because fairness is not a style question.** Every style writes
into the same grid and then runs the same steps: close the edge, turn the first
half onto the second, join what the turn broke, place the spawns and the
pickups, measure, and reject an arena that fails a rule. The generator takes the
`arena` stream of Section 7.1, so one seed gives one arena, and it never touches
the global rot.js RNG.

The symmetry is exact by construction. In scan order the cell `i` and the cell
`total - 1 - i` are the two ends of a half turn, so copying the first half over
the second gives the 180-degree symmetry of Section 7.2.1 with no rounding and
no seam to check. The spawns go through `orderSpawnsForFairness`, and the
pickups are placed as pairs, so a cover cell never lands where a spawn faces it.

**The acceptance rules of Section 7.20.17 are wired in.** Every generated arena
must pass `checkArenaFairness`: a power-up point and one weapon point sit on
ground that both teams reach together, and every pickup point has a partner of
its own kind. The generator looks for those cells first — the even line that
runs through the middle of a symmetric arena — and puts the power-up and the
prize weapon pair there before it places anything else.

**A style may replace a rule.** A closed arena cannot meet the sightline rule of
an open one, and it is not meant to. `data/arena-profiles.json` holds the shared
rules and the per-style replacements.

**What the shapes measure**, over 25 seeds each:

| Style | floor | open | cycles | chokepoints | mean sightline | 90th | longest |
|---|---|---|---|---|---|---|---|
| `bastion` | 756 | 42 % | 417 | 15 | 14.5 | 37.5 | 40.6 |
| `cavern` | 1087 | 60 % | 844 | 9 | 18.5 | 29.5 | 33.0 |
| `openfield` | 1307 | 73 % | 1030 | 0 | 27.6 | 45.4 | 58.0 |

**What the shapes play like**, over 810 rounds each (270 per seed, three seeds
per style), against 270 on the hand-made arena:

| Arena | mean kill distance | close | mid | long | kills per round | ticks |
|---|---|---|---|---|---|---|
| `bastion` | **8.4** | 57.3 % | 41.6 % | 1.2 % | 24.8 | 2896 |
| hand-made | 9.3 | 50.1 % | 48.3 % | 1.6 % | 25.1 | 1955 |
| `cavern` | 10.6 | 40.9 % | 53.9 % | 5.2 % | 24.4 | 2486 |
| `openfield` | **11.4** | 35.2 % | 58.5 % | **6.3 %** | 25.0 | 2331 |

The styles separate in play, not only on paper. `bastion` fights 3 cells closer
than `openfield` and takes 57 % of its kills at close range. `openfield` takes
**five times** the long-range share of the hand-made arena, which is what the
fire lanes were for. Every style keeps about 25 kills a round, so the pace of
Section 2.1 holds, and the side bias stays near even (51.7 %, 50.7 %, 47.0 %),
which says the symmetry works.

A generated arena runs a round 400 to 900 ticks slower than the hand-made one.
They are larger and more open, so a bot walks further between fights. That is
worth watching, not fixing: the score limit is still reached.

**Two faults found while building this.**

- **The sightline metric counted low cover as a screen.** It is not:
  `blocksSight` of Section 7.7 stops at a wall alone, so low cover is a shooting
  position. With cover counted, all three styles measured the same, and the
  difference between them vanished. This is the pattern of Section 7.20.13
  again — a number that does not mean what its name says — this time in a
  metric rather than in the AI.
- **Rooms on a line give an arena a fire lane across its whole width.** The
  first `bastion` rolled a room's size and its position together, so the centres
  of two rooms in a row lined up and the corridor between them ran the full
  width of the map. The closed style measured a 51-cell sightline. The size and
  the position are now rolled apart, and a large room gets a pillar.

**What this pass does not build.** Section 7.2 step 1 asks for a **macro graph**
of rooms and links. Only `bastion` has rooms at all, and it does not export
them, so `ArenaMap` still carries no `rooms` or `links`. Three things wait on
that graph and use a grid measure in its place today:

- Section 7.2 step 5 wants betweenness centrality to find contested rooms. The
  generator uses the distance from the two spawn groups instead
  (`pickupEvenness`), which is the same idea with no graph.
- Section 7.9 wants control per **area**. An area is one cell until then.
- Section 7.11 describes the roles in terms of areas and side routes.

The metrics also carry a crude `floorCycles`, the cyclomatic number of the floor
graph. An open field has a thousand cycles and a maze has few, so it separates a
tree-like arena from every other kind and little else. The route count that
Section 7.2 asks for needs the macro graph as well.

#### 7.20.20 A session: the game does not stop on a loss

The browser used to play one match on the hand-made arena and then stand still.
It now opens a **main menu** with two modes, and a match is followed by another
one, on new ground, whoever won.

**Tournament.** Best-of-3 matches, one after another. Every match builds a new
arena, and the three styles of Section 7.20.19 take their turn: `bastion`, then
`openfield`, then `cavern`, then round again. A match that is lost is followed
by the next one, which is the point: a session is a tour of every kind of
ground, not a gate that the player has to pass.

**Test arena.** One style, chosen from the menu, with a new arena and a new
weapon set on every press. It is the mode to watch a change in.

**Where the rules live.** `meta/session.ts` holds the mode, the seed, the style
to use next, and the tally. It is simulation code, not screen code: a test runs
a whole session with no browser. `ui/menu.ts` holds the two screens, and
`main.ts` joins them to the match loop.

Every part of a match takes its own sub-seed from the session seed
(`match:<n>`, then `arena`, `weapons` and `spawnTable` under it), so one session
seed replays a whole session, which is the rule of Section 7.1.

`nextMatch` builds a match but does not advance the session. `recordMatch`
advances it. A match that the player leaves from the menu therefore does not
skip a number, and the arena that the match-over screen describes is the arena
that the next match really plays on: it is built before the screen opens, so the
screen can name its shape.

**The match-over screen** says who won, how the session stands, and what the
ground ahead looks like, in the plain words of `describeArena`
("Long fire lanes. Broken ground. 14 chokepoints."). That is the pre-match
screen of Section 7.2, in the place where it is first needed.

**This is not the run of Section 7.15.** A run has opponent teams with
doctrines, an adaptation record, generated names, and an end. A session has none
of those. It is the loop that carries the game between matches until M11 gives
it a shape, and nothing here writes a save. When M11 lands, `newRun` should
replace `createSession` and keep its seeding rule.

### 7.3 Weapon generation (`weapons/`)

Purpose: generate readable procedural weapons with clear roles.

> **Section 7.20 changes this section.** A weapon now starts from a role trait
> and an attack type, and the archetype becomes a label that the generator
> derives at the end. Read Section 7.20 before you build M6.

Entry point: `generateWeaponSet(rng, count = 5): Weapon[]`

Steps:

1. Add the fixed baseline weapon(s).
2. Select archetypes for the remaining slots. Rule (TBD): guarantee some role coverage, or skew on purpose for special runs.
3. For each archetype, roll stats inside the archetype's ranges.
4. Apply 1–2 weapon traits (mutations).
5. Calculate the cost of all attributes. Scale the weapon to fit the power budget.
6. Calculate the DPS profile at close, mid, and long range.
7. Reject weapons that are too strong or too weak for their budget.

Rules:

- The baseline weapon must be a viable fallback.
- Hitscan accuracy decreases with distance and target movement.
- Crit chance depends on conditions (Section 6.3), not only on a random roll.
- Hazard and DoT weapons create entries in the influence map (Section 7.9).

### 7.4 Match and round loop (`sim/`)

**Match.** Entry point: `runMatch(arena, teamA, teamB, weapons, spawnTable, config, rng, getTactics): MatchResult`

1. Emit `MatchStart`.
2. For each round (maximum 3):
   1. Get the current tactics from `getTactics` (the player or the AI can change them between rounds).
   2. Run the round.
   3. Emit the round result.
   4. Stop when one team has 2 round wins.
3. Emit `MatchEnd`.

Rules:

- All rounds use the same arena and the same spawn table.
- At the start of each round, reset bot health, armor, weapons, ammo, pickups, hazards, and influence maps.
- Do not reset affinity counters. Events from all rounds count.
- In the browser, `getTactics` opens the between-round screen. In the batch harness, it returns fixed tactics or AI tactics.

**Round.** Entry point: `runRound(state, config, rng): RoundResult`

> **Section 7.20.7 changes the order of the bots inside a tick.** A bot acts in
> the order of its reaction speed, which is its own reaction attribute plus the
> reaction of its weapon at the current range.

Tick order (each tick):

1. Update timers (respawns, DoT, hazards, pickups).
2. Perception: update what each bot can see.
3. AI decision: only for bots whose decision timer is at zero (Section 7.8).
4. AI action: movement intent and fire intent for all bots.
5. Movement: apply movement. Resolve collisions.
6. Combat: resolve shots, projectiles, area damage, DoT.
7. Deaths and respawns.
8. Pickups.
9. Emit events.
10. Check the round end condition (score limit or time limit).

Starting values: 20 ticks per simulated second. AI decision every 5 ticks. (TBD)

For the browser, the round loop must also support step-by-step execution (`step(state)`), so the display can advance it at different speeds.

### 7.5 Movement (`sim/movement.ts`)

- Bots have sub-cell positions (`Vec2`). The display shows the nearest cell.
- Walls block movement. Low cover does not block movement (TBD).
- Evasion adds random lateral movement. Evasion decreases the bot's own accuracy.

### 7.6 Combat (`sim/combat.ts`)

> **Section 7.20.5 adds two rules:** a `precise` weapon crits a target that
> stands still, and a target that moves gets a dodge. Section 7.20.3 adds five
> attack types beside hitscan and projectile.

- Hitscan: check line of sight at fire time. Roll hit from accuracy, distance, and target movement.
- Projectile: move each tick at `projectileSpeed`. Check collision with walls and bots.
- Area damage: apply damage in `aoeRadius`. Walls block area damage.
- DoT: apply per tick to the target.
- Hazard: create hazard tiles for `hazardTicks`.
- Crit: roll only if a crit condition is true.
- Trait modifiers apply here (for example, `shellShocked` reduces area damage taken).

### 7.7 Perception (`ai/perception.ts`)

> **Section 7.20.6 changes this section.** Today a bot sees through 360
> degrees. It gets a facing, a narrow focus arc, and a wide peripheral arc, so
> that a flank works and the `awareness` attribute gets its first use.

- Use rot.js `FOV.PreciseShadowcasting`.
- Each bot has a list of visible enemies and a short memory of last-seen positions.
- "Target unaware" is true if the target cannot see the attacker.

### 7.8 Utility AI (`ai/utility.ts`)

Purpose: select actions from scores. Player parameters are weights on the scores.

Entry point: `decide(bot, worldView): Action`

Actions (starting set):

- `Engage(target)`
- `Chase(target)`
- `SeekPickup(pickup)`
- `HoldPosition(cell)`
- `Reposition(rangeBand)`
- `Follow(teammate)` (cohesion)

`SwitchWeapon` was in this list until M8. It is now a **rule**, applied at every
decision, and not an action: as an action it competed with `Engage` for the one
action of a tick and always lost, so a bot that ran a weapon dry never picked up
its refilled weapon again (Section 7.20.16).

Score formula (structure):

```
score(action) = baseConsideration(action, world)
              × tacticsWeight(action, bot.tactics)
              × roleModifier(action, bot.role)
              × traitModifiers(action, bot.traits)
              × teamModifier(action, team.tactics)
```

Rules:

- **Weapon selection uses the DPS profile.** The bot selects the weapon with the highest expected damage at the current range. Weapon role preference adds a bias. The AI must never refer to a specific weapon by id.
- **With no enemy in sight, a weapon is worth what it reaches.** `bestWeaponAt`
  answers "the best weapon at this distance" and is right only when a distance
  exists. With nobody in sight, `bestWeaponOverall` sums the DPS over every band
  inside the weapon's range, and `preferredRange` biases that sum. Choosing for
  one band alone put a short-range weapon in the hands of a bot that then could
  not fire at all, and it cost the aggressive preset 20 points of win rate
  (Section 7.20.13).
- **The band that a bot fights at comes from its weapon, not from its tactic.**
  `wantedBand` takes the band where the equipped weapon deals the most damage,
  with `preferredRange` as the tie-break, and `Reposition` scores the mismatch
  in lost damage, not in cells.
- **`HoldPosition` is a sightline action.** Its value is `positionValue`: a
  pickup point near the cell, the team's control of the ground, and the danger
  of the cell, all falling with the time since the last contact. A bot that
  holds an empty corner holds nothing, and two teams doing it run the round to
  the time limit (Section 7.20.13).
- **Tactics are orders. Traits are tendencies.** Tactics weights are the main factor. Trait modifiers are small multipliers.
- **Each tactic has a cost and a benefit.** Do not add a tactic that has only a benefit.
- **No tactic may be a trap.** A value that a player can set must not lose the
  match on its own. A one-tactic sweep in the batch is how you find one.
- A bot keeps its current action unless a new action scores higher by a margin (hysteresis). This stops fast changes of decision.

### 7.9 Influence maps (`ai/influence.ts`)

- `danger`: from enemy sightlines, hazard tiles, and recent deaths.
- `control`: which team holds each area.
- Update every N ticks (TBD).
- The hazard tolerance tactic controls how much a bot avoids `danger`.

**What M8 built.** `createInfluenceMaps`, `updateInfluence`, `dangerAt`,
`controlAt`, and `dangerFor`. An **area** means one cell until M7 gives the
arena its macro graph; a room value is then the mean of its cells. The maps
update every `influence.intervalTicks` ticks, not every tick, because a
sightline pass over the whole grid is the expensive part.

### 7.10 Navigation (`ai/navigation.ts`)

- Use rot.js `Path.AStar` on the tile grid.
- Path cost includes `danger × (1 − hazardTolerance)`. If rot.js A* cannot use weighted costs in the needed way, write a small A* with weights.
- Cache distance fields to pickups (Dijkstra maps) per arena.

### 7.11 Roles (`data/roles.json`)

Each role has a tactics preset and role behaviors.

| Role | Tactics preset | Role behaviors |
|---|---|---|
| Overwatch | Long range, hold position, precision preference | Holds a sightline over a contested pickup |
| Tank | High aggression, high hazard nerve, item control | Takes armor first. Leads pushes into rooms. Holds an area and its pickups (Anchor) |
| Skirmisher | Mid range, evasion, versatile preference, roam | Follows the team. Trades kills. Uses side routes to attack engaged enemies (Flanker) |

The player can change the tactics after the role applies its preset.

**What M8 built.** `data/roles.json` holds a tactics preset and a set of
behavior weights per role, and a team gets one of each role unless the plan
says otherwise. A behavior weight is a small factor on the base consideration
of one action, so a role bends the AI without replacing it.

The behaviors that read "an area", "a sightline over a contested pickup", and
"side routes" need the macro graph of M7. Until then `positionValue`
(Section 7.8) measures the same idea on the grid: a cell is worth holding when
a pickup point is near it, when the team holds the ground around it, and when
it is not itself dangerous. Read this table again after M7.

The batch reports a win rate per role composition (Section 7.16), which is what
says whether a role is worth taking.

### 7.12 Pickups (`sim/pickups.ts`)

- Each pickup point has a respawn timer.
- Entry point: `rollSpawnTable(arena, weapons, rng): SpawnTable`
- The game rolls one spawn table per match. The table does not change between rounds.
- The next match can have a new spawn table (the same arena or a different arena).
- The pre-match screen shows the spawn table.

**The items (M8).** `data/pickups.json` holds every number.

| Kind | Gives | Comes back |
|---|---|---|
| health | health, up to the maximum | often |
| armor | an armor pool that takes a share of every hit | often |
| ammo | rounds for every weapon that the bot holds, up to each maximum | often |
| weapon | the weapon of the slot, with a full magazine | less often |
| powerup | double damage for a time, a shield belt, or the Redeemer | rarely |

Rules:

- **A weapon point is the only way to a generated weapon.** A bot spawns with
  the baseline weapon alone and keeps what it finds for the round. Giving every
  bot every weapon at spawn made the prize weapon free, and it took 82.7 % of
  the kills (Section 7.20.15).
- **A pair of points that face each other holds the same item.** No weapon point
  of a symmetric arena is even, so one weapon per point hands the prize to one
  side (Section 7.20.16). The strongest weapon takes the most contested pair.
- **Ammo is universal.** One ammo point refills every weapon the bot holds, not
  one named weapon. The arena is small, so a weapon-by-weapon supply would send
  a bot across it for a magazine. `ammoPerPickup` and `ammoMax` are generated
  per weapon (Section 7.3), so the generator, not the arena, decides how long a
  weapon lasts between points.
- **A power-up is rare.** It comes back far less often than health or armor, so
  the point where it lands is worth a fight. That is what makes the ground of
  Section 7.9 contested at all. The cadence is about **three spawns in a round**:
  two points open it and one comes back.
- **A power-up can hand over a weapon.** The Redeemer of Section 7.20.18 arrives
  this way, with one round that no ammo point refills, and a bot loses it when
  it dies. A weapon that a power-up gives sits outside the power budget.
- **A point that gives nothing is not taken.** A bot at full health walks over a
  health point and leaves it for a teammate.
- **A point that is coming back soon is still worth walking to**
  (`ai.pickupAnticipationTicks`). Without that rule a bot with nothing to take
  stands still, and the two teams never meet (Section 7.20.13).
- **Reaction order decides a contested point.** Two enemies can reach one point
  in the same tick, and only the first takes it. The bots come in reaction
  order, as they do when they fire; the plain team order is a side bias
  (Section 7.20.14).

### 7.13 Progression (`progression/`)

Purpose: bots develop identities from their actions and experiences.

**Affinity.** Entry point: `applyMatchEvents(bots, events): ProgressionEvent[]`

- Events add affinity by their context. Examples:
  - `Kill` with a precision weapon at long range adds to `longRangePrecision`.
  - `Death` from area damage adds to `areaDamageVictim`.
  - `Kill` on an unaware target adds to `ambush`.
- Support roles get affinity from non-kill events:
  - Tank: damage absorbed, time on armor pickups.
  - Overwatch: time holding a sightline, enemies that retreated from the bot's fire.
- Affinity has diminishing returns.
- Affinity decays slowly between matches (TBD).
- Affinity collects during all rounds. The game applies it after the match. A bot's traits do not change during a match.

**Traits.** One mechanic. When an affinity reaches its threshold, the bot gets the linked trait.

- Every trait has a cost and a bonus. No trait is only positive or only negative.
- Traits differ only by their trigger affinity. Some affinities come from success (kills). Some come from bad experiences (deaths). The result is the same type of trait.
- Trait cap per bot: 3–4 (TBD).
- A trait changes AI weights (behavior shift) and adds a modifier.

Starting trait list (placeholders):

| Id | Trigger affinity | Cost | Bonus |
|---|---|---|---|
| eagleEye | precision kills at long range | −accuracy at close range | +crit at long range |
| ambusher | kills on unaware targets | less time holding position | +crit on unaware targets |
| shellShocked | deaths to area damage | avoids open rooms | −area damage taken |
| reckless | deaths at low health in fights | seeks health less often | +damage at low health |
| timid | deaths soon after engaging | seeks health more often | +evasion |
| tunnelVision | deaths from flanks | −awareness of flanks | +damage to current target |
| grudgeBearer | killed by the same rival N times | leaves position to hunt the rival | +damage against the rival |
| rivalHunter | kills on a rival N times | overconfident against the rival (less cover) | +accuracy against the rival |

**Nicknames.** A bot gets a nickname at a milestone (for example, its first trait). The name generator makes the nickname from the epithet table of that trait (Section 7.19).

### 7.14 Rivalry (`progression/rivalry.ts`)

Scope is limited. Implement only this:

1. **Start.** A rivalry starts when bot A kills bot B N times in one run (N TBD).
2. **Log.** Every kill between the two bots adds a `RivalryEvent` to the rivalry log.
3. **Progression effects.**
   - The bot that its rival kills gains affinity toward `grudgeBearer`.
   - The bot that kills its rival gains affinity toward `rivalHunter`.
4. **Limit.** Maximum 1–2 active rivalries per bot (TBD).

Do not implement: promotions, off-screen events, scouting intel, barks with memory, or betrayal.

### 7.15 Run and championship (`meta/`)

> **A first piece is built.** `meta/session.ts` chains matches so the browser
> never stops: a match ends, a new arena is generated, and the next match
> begins (Section 7.20.20). It is not a run — no opponent doctrines, no
> adaptation record, no names, no end — and `newRun` should replace it at M11
> and keep its seeding rule.

**Run.** Entry point: `newRun(teamName, seed): Run`

- A run has a set of arenas, a weapon set, and opponent teams with doctrines.
- The number of opponent teams and matches is open (Section 2.3).

**Adaptation record.** For each round, save the player's tactics and the arena metrics. Championship mode uses this record.

**Snapshot.** Entry point: `snapshotTeam(run): ChampionSnapshot`

A snapshot contains:

- `schemaVersion`
- Team name, theme, team tactics
- All bots: name, nickname, role, attributes, tactics, affinities, traits
- Rivalry logs
- Run context: arenas, weapons, opponents beaten
- Adaptation record

**Saves.**

- The browser saves the roster and the current run in `localStorage`.
- The player can export a team or the full roster as a JSON file.
- The player can import a JSON file.
- Wrap all `localStorage` access in try/catch. The game must work if storage is empty or not available.

**Versioning.** Every save has `schemaVersion`. Write a migration function for each schema change. If a migration is not possible, label the team "classic era".

**Championship mode.** Unlocks after the first successful run.

- Opponents come from the championship roster.
- Arenas and weapons are new procedural sets.
- Champion teams adapt: for each arena, the team uses the tactics from the most similar arena in its adaptation record (nearest neighbor on arena metrics).
- The player uses a new team or a previous champion team (TBD).

### 7.16 Batch harness (`cli/batch.ts`)

Purpose: balance testing with no display.

Entry point: `npm run batch -- --config batch.json`

Outputs (to the terminal and to CSV files):

- Win-rate matrix: doctrine × arena profile.
- Weapon usage and kills by archetype.
- Trait distribution in winning teams.
- Average round length and match length.
- Average kills per round, and the number of rounds that reach the time limit.
  A round with few kills or no kill is a defect of the AI or of the arena, not
  a close match (Section 7.2.1).
- Average run duration (for the open run-length decision).

Rule: if one doctrine wins in all arena profiles, report it as a balance failure.

**What M8 added.** A win rate per **role composition**, and a composition
matchup table. A batch names its compositions in `data/batch.json`, and every
pair of compositions plays every pair of presets, so the two are not confounded.

**Read `hits per shot`, not a hit rate.** One shot of an area weapon hits
several bots, so the number passes 1 and is not a share. The hit chance of a
single shot is a combat number, not a batch number.

**Check the mirror matchups in every batch.** A preset against itself must sit
near 50 %. A mirror that does not is a side bias, and Section 7.20.14 shows
that an arena can be symmetric to the cell and still give one side the better
start.

**What a round record holds.** One `RoundRecord` per round, from the events of
that round alone. Beside the result and the shot counts it holds:

| Field | What it measures |
|---|---|
| `killsByArchetype` | which weapon label made the kills |
| `shotsByWeapon` | which weapon id was fired, for the round's own set |
| `killsByBand`, `killDistanceSum` | at what distance the fighting happened |
| `killsByRole`, `deathsByRole` | which role of Section 7.11 killed and died |
| `pickupsByKind` | how much of the ground was taken |

A role count is only comparable against the **bot-rounds** of that role: a mix
can hold one role twice, and then a raw count favours it. Divide.

#### 7.16.1 The style harness (`cli/styles.ts`)

    npm run styles -- --rounds 2430 --arenas 3 --seed 20260924

The batch harness answers "is this preset balanced over the arenas that I gave
it". The style harness answers a different question: **does a style of ground
change what wins on it** (Section 7.20.19). It runs one batch per style, over
several arenas of that style, and puts the tactics, the weapons and the role
mixes of each style side by side.

Two rules hold for a run of it to mean anything:

1. **Several arenas per style, never one.** One arena is one roll of the
   generator. A result from one arena measures that arena, not the style.
2. **A round count that is a whole number of passes.** `planRounds` walks the
   cells of the plan in order and starts again at the top, so a count that is
   not a multiple of `arenas × presets² × compositions²` gives the first cells
   one round more than the last, and every table tilts by a little. The harness
   prints a warning when the count does not divide.

### 7.17 Reports and kill feed (`report/`)

- Kill feed lines from event templates (for example, "Vex killed Rook with a precision weapon at long range").
- Kill announcements from `data/announcements.json`: a multi-kill (Double Kill, Multi Kill, Mega Kill, Ultra Kill, Monster Kill), a killing spree (Killing Spree, Rampage, Dominating, Unstoppable, Godlike), and the end of a spree. The counts are lower than the classic ones, because a 3v3 round ends at 15 team kills.
- Round report (between rounds): score, kills, deaths, damage by archetype, death heatmap (ASCII).
- Match report: all round data, pickup control time, progression results.
- Bot stat card: role, traits, affinities, rivalries, nickname.
- Run history: when each trait arrived and why.

### 7.18 Display (`render/`)

The arena draws on **two canvases**, one on the other, at the same pixel size
and on the same cell grid:

| Canvas | What it holds | Class |
|---|---|---|
| grid (below) | walls, floor, hazards, pickups, shots in the air, bots | `NeonGrid` |
| vfx (above) | tracers, beams, blasts, sparks, gore | `VfxLayer` |

One animation frame drives both: the grid first, the effects on top. Only the
VFX canvas takes the shake of a blast. A shake of the grid too reads as a
broken display, not as a blast.

- Arena on one screen. 60×30 is the size that the generator makes (Section 7.7).
  The stage takes the largest cell that the container holds, so the same arena
  fills a desktop screen and a phone screen.
- Side panel: kill feed, score, round number, timer.
- A pickup point draws its glyph only while it holds its item. An empty point
  draws the floor, so a viewer can read the arena (Section 7.20.15).
- Speed controls: pause, 1×, 4×, skip to end of round.
- Touch-friendly controls for phones.
- Debug views (toggle): danger map, control map, bot decisions. TBD

#### 7.18.1 The one coordinate contract

    px = cellX * cellW + cellW / 2      // the centre of a glyph
    py = cellY * cellH + cellH / 2

`cellW` and `cellH` are in **device pixels** and both canvases take them from
`NeonStage`. The VFX layer takes **fractional** cell coordinates, so a shot can
sit between two cells.

The simulation puts the centre of cell `(x, y)` at `(x + 0.5, y + 0.5)`
(Section 7.5). `SimArenaView` takes the half cell off, because the display puts
a glyph at the centre of its own cell. That one conversion lives in
`render/arenaView.ts` and nowhere else.

#### 7.18.2 The adapters

The grid and the VFX layer import nothing from the simulation. They read two
narrow interfaces, and `render/arenaView.ts` is what fills them:

| Interface | What it gives |
|---|---|
| `ArenaView` | `width`, `height`, `tileAt(x, y)`, `pickups()`, `bots()`, `shots()`, `interp` |
| a position resolver | the cell of a bot id, or of a shot that is in the air |

`interp` is what makes the bots glide. The simulation steps 20 times a second
and the display draws at the rate of the screen. A bot that is drawn on its
cell alone steps and waits, and the eye reads a stall. `SimRunner.interp` gives
the share of the tick that has run, and the grid draws the bot between the cell
that it held at the start of the tick and its cell now. A jump of more than two
cells is a respawn, not a step, so the bot does not glide across the arena.

#### 7.18.3 Attack type to visual family

The effect of a shot comes from a table, with a **tracer fallback**, so a new
attack type draws something and does not throw:

| Attack type | Family | What a viewer sees |
|---|---|---|
| `hitscan`, `line` | beam | a line of `═` that snaps bright and decays slowly |
| `projectile`, `burst`, `ricochet` | tracer | a `•` head with three `:` behind it |
| `tile` | rocket | a `●` with a hot and cooled trail, then a blast and embers |
| `cone` | cone | pellets across the half angle, plus a wedge that fades out |
| anything else | tracer | the fallback |

A weapon with `aoeRadius` above 1.5 becomes a rocket, whatever its attack type
says. The four numbers that the visual reads — `projectileSpeed`, `aoeRadius`,
`coneHalfAngle`, `rangeMax` — ride on the `Shot` event as `visual`, because
events are the record (Section 4.6): the display must not read the weapon list
of the simulation to know what it just saw.

| Event | Call |
|---|---|
| `Shot` | `vfx.shot({ from, to, attackType, weapon, color })` |
| `Hit` | `vfx.spark(cellOfTarget, damage)` |
| `Death` | `vfx.death(cell, teamColor)` |
| `Spawn` | `vfx.spawnIn(cell, teamColor)` |

#### 7.18.4 The rules of the neon look

1. Glow is `shadowColor` plus `shadowBlur` on `fillText`. It is never a blur
   filter: a CSS blur over a full canvas is not cheap, and a canvas shadow on
   text is.
2. **Budget the glow.** Walls are most of the glyphs and get no glow at all.
   Only a wall cell with a neighbour that is not a wall is drawn lit
   (`wallLit`, alpha 0.95); the mass inside a block is `wall` at alpha 0.32.
   That one rule is what makes the map read as neon tube and not as a grey
   wash, and it holds the cost of a frame flat.
3. Bloom belongs to a thing that moves: a bot, a pickup, a hazard, a shot.
   Ground that does not move does not glow.
4. Two ambient passes end the grid draw: a radial haze from the palette over
   the centre, then a vignette at the corners. Scanlines go between them.
5. The floor grain is `·` at alpha 0.55. Below this the arena reads as empty;
   above it, the floor takes attention away from the bots.
6. One `intensity` scalar (`0.55` restrained, `1` punchy, `1.7` maximalist)
   multiplies the particle counts and the blur. Ship `1`.
7. Set `shadowBlur` back to 0 after each group that glows. A shadow that is
   left on for the bulk wall pass is the fastest way to lose the frame rate.
8. Never push into the effect list while the sweep reads it. A blast spawns its
   embers from inside the sweep that removes finished effects, so the layer
   buffers them. Without the buffer they are dropped, which looks like "a
   rocket sometimes does not explode".

#### 7.18.5 The palette of a match

`NEON_THEMES` holds six palettes, keyed by tile kind and team slot.
`pickRotation(seed)` gives five of them in an order that the seed fixes, and
`themeForMatch(seed, matchNumber)` picks the one for a match. A run has a look
of its own, and a replay of the run looks the same (Section 7.1).

The simulation must never read a value from the palette. A color is a display
decision, and the result of a match may not depend on it (Section 4.1).

**Twelve palettes, in three groups.** Six were there first. Three more put the
two teams on **opposed hues**, as far apart as the wheel allows, and three more
**clash** on purpose and are the stress case for reading a bot at its real
size.

**The contrast hue.** `NEON_CONTRAST` holds one hue per palette that opposes
the rest of it, and `contrastOf` gives it, falling back to the hazard hue of a
palette it does not know. Every palette takes its own at load, so nothing
downstream has to look it up.

**The contrast hue is for the ground and nothing else.** A bot, a shot or a
number in it would read as a hazard, and a hazard already takes the off-hue of
its palette on purpose. A team color is never taken from the hazard or the
contrast.

#### 7.18.5.1 The contrast fill

`NeonGrid` takes `wallFill`, one of `off`, `mass`, `pockets` or `both`. The
default is `mass`.

| Pass | What it paints | Fill | Glyph |
|---|---|---|---|
| `mass` | a wall cell whose four orthogonal neighbours are all walls | contrast, alpha 0.17 | `▓` in contrast, alpha 0.5 |
| `pockets` | floor that no bot can reach | contrast, alpha 0.13 | `▒` in contrast, alpha 0.55 |

A wall that touches open space is untouched: it keeps `wallBg` and its `#` in
`wallLit`, which is the edge lighting of Section 7.18.4 and the thing that makes
the map read as neon tube.

**The alpha is low on purpose.** The hue carries the read. A stronger fill
makes a bot hard to follow, which is the one thing the display may not do.

**The pocket mask costs one pass over the grid** and is held until the arena
changes; `NeonStage.setSize` clears it. A hazard tile does not need to clear it,
because a hazard is ground that a bot can walk on and belongs to the region it
already belonged to.

#### 7.18.6 The bot status panel (`ui/botStatus.ts`)

The kill feed says what already happened. The status panel says **what each bot
can do next**, which is what a player needs before the tactics screen opens:

    A0 tank   Needle Rifle   71/71  ▁▁▁▁  78  ◘18  ⚔

One row per bot, with the weapon in its hands, the rounds left in that weapon,
a health bar and number, the armour and shield together, and a glyph per
power-up. The fallback weapon never runs dry, so it shows `∞`. A bot that is
down shows when it comes back and nothing else, because its weapon and its
armour are gone until it does.

The rows are built one time and only their text changes, so the panel costs
almost nothing at the rate of the screen.

### 7.19 Name generator (`names/`)

Purpose: make team names, bot names, and nicknames with a clear style and good variety.

Method: a small grammar expander (similar to Tracery) plus weighted spark tables (similar to TTRPG oracle tables).

**Entry points:**

- `generateTeamName(rng, theme?): { name: string; theme: string }`
- `generateBotName(rng, teamTheme?): string`
- `generateNickname(rng, traitId, bot): string`

**Grammar rules:**

1. A grammar has named **symbols**. Each symbol has a list of **patterns** or a **spark table**.
2. A pattern is text with symbol references in braces, for example `"The {adjective} {beastPlural}"`.
3. The expander replaces each reference with an expansion of that symbol. Expansion is recursive.
4. Table entries can have a **weight**. The default weight is 1.
5. Entries can have **tags** (for example, `theme: "sponsor"`). A generator can filter by tag.
6. Modifiers apply after a symbol: `{name.upper}`, `{name.capitalize}` (starting set, TBD).
7. Maximum recursion depth: 8. If the expander reaches the limit, it throws an error.

**Team themes (starting set, TBD):**

| Theme | Example pattern | Example result |
|---|---|---|
| Beast | `The {adjective} {beastPlural}` | The Iron Jackals |
| Sponsor | `{corpPrefix} {corpSuffix} {color}` | Kessler Dynamics Red |
| Collective | `{material} {collective}` | Ash Collective |
| Place | `{place} {beastPlural}` | Harrow Vipers |

**Bot name styles (starting set, TBD):**

| Style | Example pattern | Example result |
|---|---|---|
| Callsign | `{callsign}` | Vex |
| Compound | `{hardWord}{bodyPart}` | Ironhand |
| Designation | `{letter}-{digit}` | K-7 |
| Syllables | `{syllable}{syllable}` | Doravek |

A team theme can bias the bot name style (for example, Sponsor teams prefer Designation names).

**Nicknames:**

- Each trait has an epithet table in `nicknames.json`.
- Pattern examples: `the {epithet}`, `{epithet}`.
- Display form: `Vex "the Hawk"`.

**Rules:**

- The generator uses the `names` RNG stream. One seed gives the same names.
- Bot names are unique inside a run. Team names are unique inside the championship roster.
- The generator rejects a result that matches the blocklist, then tries again (maximum 20 tries).
- All word lists are data. The expander has no words in code.
- The player can type a team name. The generator can suggest one.

#### 7.20.21 The neon stage: what the change to a canvas bought

The arena used to draw through the rot.js `Display`, which writes one glyph per
cell with a foreground and a background color. Two things were not possible
with it, and both of them are what a shooter needs a viewer to read.

**A shot had no shape.** Every weapon drew the same short trail, so a viewer
could not tell a beam from a rocket from a spread. The five attack types of
Section 7.20.3 now each have a look of their own (Section 7.18.3), and the four
numbers that set the look ride on the `Shot` event. A cone opens a wedge, a
blast throws embers, a beam snaps along the ray.

**A bot moved one cell at a time.** The simulation steps 20 times a second and
the screen draws 60 times, so a bot held its cell for three frames and then
jumped. `interp` (Section 7.18.2) draws the bot between the two cells, and the
same movement now reads as a run.

Two things the change also fixed, which were not the reason for it:

- A death leaves gore on the ground for some seconds, so a firefight leaves a
  mark on the arena and a viewer can see where the fighting was.
- A hazard pool animates, with a phase per cell, so a viewer reads it as ground
  to keep off and not as more wall.

**What it cost.** The grid repaints every cell every frame. At 60×30 with six
bots that holds 60 frames a second, because of the glow budget of
Section 7.18.4: the walls, which are most of the glyphs, carry no shadow at
all. Measured in Chromium at 1440×900 on a `bastion` arena: 60 frames a second
at 1× and at 4×.

**What is still open.** The count of live effects is capped at 400 and the
oldest go first. At 4× with three area weapons on the ground the cap is the
only thing that bounds the cost of a frame, and nothing measures how often it
is reached. A phone is not measured at all. TBD

#### 7.20.22 What a batch of every style found

`docs/arena-style-analysis.md` holds the measurement: 13770 rounds over the
three styles, from `npm run styles`. The short of it, and what each line asks
for:

| Finding | Where it lives |
|---|---|
| The ground moves the fight by 2.8 cells and the close-range share by 22 points | The generator works (Section 7.20.19) |
| `aggressive` owns `bastion` and loses 7.3 points on `openfield` | The styles pay for themselves |
| A close preference costs 9 to 11 points, and nothing on `cavern` | `aggressive` wins `bastion` in spite of it |
| Every `weaponRolePref` is level with or below no preference | `weaponRolePrefBonus` 0.6 is an order, not a bias |
| `rush` beats `turtle` by 7 to 14 points on every style | Holding ground pays nothing yet |
| `denial` makes 2.7 times the kills of `precision` | The price of a hazard tick (Section 7.3) |
| One `bandShare` constant serves three styles that differ by 22 points | Section 7.3 and Section 7.8 read it |
| The tactics block of `data/roles.json` never applies | Section 7.11 says merge; the code replaces |
| Team B wins 53.1 % of all rounds | An engine defect that `openfield` makes worse |

**The band share is the one to read first.** `data/weapon-roles.json` holds
`close 0.50, mid 0.48, long 0.02` for the whole game. The measured share is
56.8/41.8/1.4 on `bastion` and 34.7/60.0/5.3 on `openfield`. Both the power
budget and `bestWeaponOverall` read the constant, so a bot on an open field
values a close-range weapon as if half the fighting were close. That is why no
weapon in the batch answers the ground: the AI cannot see the ground. The
answer is a `bandShare` on the arena metrics of Section 7.7, measured by the
generator, that the budget and the AI both read.

It is the same pattern that M8 named: **a number that the budget charges for,
or the AI reads, that does not mean what its name says.** Six instances are now
on the list. The check has not changed: compare the modelled number against the
measured one, per weapon, per band, per style.

**Two rules that the batch itself taught.**

1. **A share of the kills does not measure a weapon.** `denial` took 8.6 % of
   the kills and `precision` 14.8 %, which reads as "precision is better". The
   same rounds say `denial` was in a fifth of the sets and made 2.7 times the
   kills of `precision` in a round that held it. Divide by the rounds that held
   the archetype (Section 7.16).
2. **One batch cannot name a defect.** The first batch read the side bias as an
   `openfield` defect. The second batch put `bastion` at 45.5 % and `cavern` at
   50.7 %, which moved with the presets in the pool, so the bias is in the
   engine and `openfield` only makes it worse. Replicate before naming.

#### 7.20.23 The side bias: what it was, and the test that found it

The arena-style batch measured team B winning 53.1 % of 13770 rounds
(`docs/arena-style-analysis.md`, Section 7). The ground was not the cause: the
tiles are symmetric to the cell, the field of view is symmetric under a half
turn, the pickup points are exact images of each other, and the two halves are
the same mean number of steps from a team spawn to every point.

**The test that found it.** An arena is symmetric under a half turn. Give the
two teams the same tactics and roles and a spawn table that is symmetric too,
take the randomness out of the simulation, and the round must stay a mirror
image of itself for ever. The first tick that breaks the mirror names the
asymmetry. `tests/fairness.test.ts` holds it, and it found three.

**1. The decision phase came from the index in the bot list.** A bot is given a
first decision tick so that the work spreads over the interval, and the phase
was `globalIndex % aiDecisionIntervalTicks`. With six bots and an interval of
five that is 0,1,2 for team A and 3,4,0 for team B: team A made its first
decision on the ticks 1, 2 and 3 and team B on 1, 4 and 5, and the phase held
for the whole round. The phase now comes from the slot inside the team.

**2. The path search broke a tie against the axes of the world.** Two routes of
the same length are both shortest, and A\* returns the one it met first, which
comes from the order that the neighbours are scanned in. The order was a fixed
list, `[1,0]` before `[-1,0]`, so a bot walking right and a bot walking left
broke the tie the other way round and crossed different ground. The order now
follows the way to the goal: the neighbour most in line with the goal first,
and a tie broken by the side it sits on. Both keys keep their value under a
half turn, so the order turns with the arena.

**3. The danger map did not know whose bots made the danger.** Section 7.9 says
that a live **enemy** makes danger. The code stamped every live bot into one
shared grid, so a bot feared the ground that its own team was watching. On
`openfield`, where a bot sees 301 cells against 97 on `bastion`, its own three
teammates painted its own half as the dangerous half, and both teams walked
away from their own ground. There is now one danger grid per team.

**What it bought, and what it did not.** Team A win rate, where 50 % is fair,
over 2700 rounds per column (±1.7):

| Style | Before | After |
|---|---:|---:|
| bastion | 42.5 % | **48.6 %** |
| openfield | 45.7 % | 45.1 % |
| cavern | 47.0 % | 45.9 % |

**`bastion` is fixed and the other two are not.** Six points came back on
`bastion`, which now sits within one standard error of fair. `openfield` and
`cavern` did not move, so a fourth cause holds about four points there, and the
three fixes above are not it.

What the swap test says about the rest: give team A the spawn block of team B
and the numbers move to 47.5 / 55.5 / 52.5 against 51.0 / 44.6 / 45.5. On
`openfield` the pair adds to 100.1, so its deficit is entirely a property of
the ground and the spawn table of that match. On `bastion` and `cavern` the
pairs add to 98.5 and 98.0, so about one point still follows the team letter
and is not yet explained.

**The fourth cause is the spawn table.** `placeWeapons` gives a contested point
its own weapon, by design (Section 7.12), so the two halves of a match hold
different weapons on their contested points. Team A win rate over 2700 rounds
per column (±1.7), against a table forced to mirror, where a point and the
point that faces it hold the same weapon:

| Style | Table as it is | Table mirrored |
|---|---:|---:|
| bastion | 48.6 % | 55.7 % |
| openfield | 45.1 % | **51.3 %** |
| cavern | 45.9 % | **51.9 %** |

The mirrored table is worth about six points to team A on every style.

That reads like a fix for `openfield` and `cavern`, and it is not one. The
column above forces the mirror at the call site, which is not the same change
as pairing the points in `placeWeapons`: pairing also halves the number of
groups, so a different weapon lands on each pair. Making the real change and
measuring it again gave **56.4 / 53.6 / 51.3 %**, a mean distance from fair of
3.8 points against 3.5 for the table as it is. It does not make the arena
fairer. It turns a lean toward team B on three styles into a larger lean toward
team A on one.

So the mirrored table is **not** shipped, and the lesson is about the probe and
not about the arena: **a variant that stands in for a change is not the
change.** Measure the code, not the stand-in.

**What is left, and what is not known.** About four points on `openfield` and
`cavern` come from the spawn table, because the swap test moves them. Every
answer tried so far overshoots the other way:

| Change | bastion | openfield | cavern | Mean distance from fair |
|---|---:|---:|---:|---:|
| none (shipped) | 48.6 % | 45.1 % | 45.9 % | **3.5** |
| pair every weapon point | 56.4 % | 53.6 % | 51.3 % | 3.8 |
| the same, plus a tie-break to the bot's own side | 59.0 % | 62.4 % | 57.8 % | 9.7 |

None is shipped. **No mechanism explains why a mirrored offer moves the win
rate toward team A at all**, which is the thing to find before the next
attempt. A first guess, that `pickupTarget` keeps the first point of the best
value and the points are listed in the order that the map was scanned in, does
not survive arithmetic: `nearness` is continuous, so a point and the point that
faces it tie only for a bot on the anti-diagonal of the pair, which is rare.
Count the ties before building on that guess.

**A note on the test.** `tests/fairness.test.ts` passes under every one of
these combinations, because it uses a mirrored table and a flat RNG, so it
cannot see this class at all. Only a win rate over hundreds of rounds can. TBD

**The rule that this leaves.** A number that depends on the index of a bot in
the list, on the order of the teams, or on an axis of the world is a side bias
waiting to happen. The mirror test is cheap; run it after any change to
movement, perception, the influence maps or the decision loop.

#### 7.20.24 The teams change ends after every round

About four points of win rate follow the **half of the arena** and not the
team. Section 7.20.26 names the cause and removes it, but this rule came first
and it stays: a match shares out what is left instead of handing it to one
team. The teams change ends after every round, as they do in most sports for
the same reason.

`teamSideIndex(teamId, roundNumber, sideOffset)` is the whole rule, and both the
start of a round and `respawn` read it, so a bot always comes back on the half
that its team holds **this** round. `sideOffset` is the half that team A starts
the match on and it comes from the seed of the match. Without it the change of
ends corrected in one direction only: a best of three gives one team the ends
of round 1 twice, and with a fixed start that team was always team A. The round
number and the offset both decide, so a round still replays from its own seed
and a test can ask for either side.

    round 1   A near, B far
    round 2   A far,  B near
    round 3   A near, B far

A match is best of 3 and runs 2.6 rounds on average, so a team holds each half
about as often as the other. Team A win rate over 400 matches a style, with
everything else held equal — the same arena, weapons, spawn table and round
seeds, and only the ends changing:

| Style | Ends fixed | Ends change |
|---|---:|---:|
| bastion | 51.7 % | **50.0 %** |
| openfield | 46.3 % | **51.2 %** |
| cavern | 47.8 % | **48.5 %** |

It moves every style toward fair, and `openfield`, which had the worst round
bias, gains five points.

**What it does not do.** It does not make a single round fair, and it cannot:
the first round of every match still runs on the ends that the arena gives.
A match that runs the full three rounds also gives one team the ends of round 1
twice, so the sharing is not exact. Nothing here replaces finding the cause. It
bounds the damage until then.

**Read a single round, not a match, when hunting the cause.** A match hides the
thing that Section 7.20.23 is looking for, which is the point of it.

**Where it shows.** The between-round screen says which end the team of the
player starts on, because the ground a team starts on decides the first fight.

#### 7.20.25 A hall in the middle of a bastion

`bastion` was a grid of rooms of one size, and a grid of rooms of one size
gives a fight with no middle: no room is worth more than the room beside it, so
a team that holds a room holds nothing. The style now carves one **hall** over
the centre of the grid, from `centreRoom` in the profile.

| Measure, mean of 10 arenas | Before | After |
|---|---:|---:|
| open area | 40.5 % | 44.9 % |
| mean sightline | 14.6 | 16.6 |
| chokepoints | 19 | 13 |

`bastion` is still the closed style by a wide margin: `cavern` is 59.6 % open
and `openfield` 72.3 %. The rule `maxOpenAreaRatio: 0.5` is unchanged and still
binds, so the hall cannot grow into an open field; over 24 arenas the open area
runs 37.3 % to 49.2 %.

The hall is carved **over** the rooms and not between them, so it keeps every
door that the grid already made, and `connectRegions` picks up anything left on
its own. Its pillars go in the first half only, because `symmetrise` copies
that half over the second.

#### 7.20.25.1 What the hall broke, and the rule it left

The mirror test of Section 7.20.23 started failing on `bastion` at tick 128.
The grid was still symmetric to the cell, and the two teams still mirrored to
about **1e-13** — and then one bot walked to a different pickup point from its
partner.

The cause is not a side bias. It is a knife edge. Floating point addition is
not the same at `x = 22` as it is at `x = 38`, so two mirrored bots drift apart
in the last bits of their position, and `pickupTarget` compared the value of
two points with a plain `>`. Two points are often worth almost the same, so the
13th decimal decided which one a bot walked to. Open ground gives more near
ties, which is why the hall brought it out.

**The rule:** a difference below `ai.pickupTieShare` of the value counts as a
tie, and a tie goes to the point nearer to the spawn ground of the team of the
bot. That rule turns with the arena, because the spawn cells of the two teams
are images of each other, so both teams answer a tie the same way.

**A decision that turns on the 13th decimal is a defect on its own**, whatever
it does to the win rate. Look for the same shape anywhere a float comparison
picks between two things that a symmetric arena offers to both teams.

#### 7.20.26 The side bias: the two causes, and the end of it

Section 7.20.23 found three side bias bugs with the mirror test and left the
rest without a cause. Section 7.20.24 shared the rest out instead of removing
it. This section names it. There were **three** causes. The first belongs to the
ground and the other two belong to the name of the team, and the first one hid
the other two: the old reading of "team B wins about four points more" was team
A always starting on the same half, with a team A advantage of about the same
size pulling the other way.

**The instrument.** One probe runs the same round twice and changes one thing:
which half team A stands on. The arena, the weapons, the spawn table and the
round seed are equal in both runs. A gap between the two answers is a bias that
belongs to the ground. A level away from 50 % that shows on **both** halves is
a bias that belongs to the name of the team. 400 rounds a cell, 9 arenas a
style, so a cell reads to about +-2.5 points.

##### Cause 1: the spawn table gave one half the stronger weapon

`placeWeapons` gave a **contested** point a weapon of its own, because both
teams reach it together and the point looked fair on its own. It is not. A
table probe, which rolls 60 tables for each of 6 arenas a style and runs no
rounds at all, reads this:

| Style | Power offered, 1st/2nd half | On the contested points | Strongest weapon lands 1st/2nd | Steps to it, A/B |
|---|---:|---:|---:|---:|
| bastion | 393.0 / 368.0 | 125.0 / 100.0 | 449 / 89 | 43.2 / 43.3 |
| openfield | 393.6 / 368.5 | 125.0 / 100.0 | 447 / 87 | 40.3 / 40.3 |
| cavern | 395.0 / 370.0 | 125.0 / 100.0 | 462 / 102 | 42.0 / 42.0 |

The whole 25 unit gap sits on one pair of points. Every arena that the
generator can make holds exactly one contested pair, `weapon:0` and
`weapon:1`. The two points are images of each other, so `pickupEvenness` gives
both the same number, 0. The sort in `placeWeapons` then falls through to its
last key, the slot id, and `weapon:0` comes first every time. Group 0 takes the
strongest weapon of the run and group 1 takes the runner-up, in every match, in
every arena. Nothing about it is random.

**It does not reach the teams through distance.** Both points are contested, so
the probe read the steps from **all three** spawns of each team, not only from
the nearest. The vectors match to the step:

    bastion #0   strong point   A = 38,39,40   B = 38,39,40
    cavern  #2   strong point   A = 40,41,42   B = 40,41,42

**It reaches them through the choice of target.** Both teams want the stronger
point, so both go to `weapon:0`. The mirror of "team A goes to `weapon:0`" is
"team B goes to `weapon:1`", and team B does not do that. The two teams stop
being images of each other, and the ground around that one point decides the
fight. A symmetric arena does not help, because the teams are no longer doing
symmetric things.

**The rule now:** every point holds the weapon of the point that it faces,
contested or not. The run offers one weapon fewer. That is the price.

##### Cause 2: a bot decides on a fixed parity, so the tie never changed hands

`botsInTickOrder` breaks a tie on reaction with the parity of the tick, and the
comment said that this does not favour a team. It does. A bot decides, waits
`aiDecisionIntervalTicks` ticks and decides again, so its period is 6, and 6 is
even. Every decision of a bot therefore lands on the same parity for the whole
round. Slot 0 and slot 2 decide on odd ticks and slot 1 on even ticks, so two
slots of three gave the same team the first decision in every fight, all round,
every round.

It only became visible after cause 1 was gone, because the ground bias was
larger and hid it.

**The rule now:** the tick goes through a hash, so the order changes on a
schedule that no cadence of the game can lock onto. It is a hash and not a
draw, so a round still replays from its seed.

##### The numbers

Team A win rate at round level, 400 rounds a cell, 9 arenas a style. A fair
engine reads 50 % in both columns.

| Style | Before, 1st/2nd | Cause 1 fixed | Causes 1 and 2 | All three |
|---|---:|---:|---:|---:|
| bastion | 44.5 / 53.8 | 54.5 / 55.0 | 52.5 / 51.7 | **51.4 / 50.6** |
| openfield | 45.3 / 56.0 | 54.9 / 54.6 | 56.0 / 55.0 | **50.4 / 49.4** |
| cavern | 48.0 / 55.0 | 52.5 / 54.0 | 53.8 / 55.5 | **49.1 / 51.1** |

The gap between the halves goes from 9.3, 10.7 and 7.0 points to 0.8, 1.0 and
2.0, and the level of each style sits at 51.0, 49.9 and 50.1. Every cell is
inside its own error. **Both kinds of side bias are gone.**

At match level, best of 3 over the same 9 arenas a style:

| Style | Matches | Ends fixed | Ends change |
|---|---:|---:|---:|
| bastion | 400 | 50.9 % | 51.4 % |
| openfield | 900 | 48.2 % | 48.6 % |
| cavern | 400 | 50.5 % | 52.4 % |

`openfield` read 46.8 % at 400 matches, which no round rate of 49.9 % can give,
so it went to 900 matches and came back at 48.6 %. **Read a cell against its
own error before you call it a bias:** 46.8 +-2.5 is 1.3 standard errors from
fair, and it was noise.

The two columns now agree on every style, which is what a fair engine looks
like: with nothing left for a change of ends to share out, changing ends stops
mattering. The rule of Section 7.20.24 stays, because it costs nothing and it
bounds any ground bias that a later change to arena generation brings back.

**The middle columns are the lesson.** Fixing the ground bias alone made a
match *worse*, not better: at match level `bastion` went from 48.8 % to 57.0 %.
The ground bias had been pulling against a team bias of about the same size,
and two large defects that cancel read as one small defect. A measurement that
reports only the total will call that healthy. The probe that changes one thing
and holds the rest equal is what tells them apart.

The middle column is the point of the whole section: pairing the table closes
the gap between the halves and leaves a level 5 points high on **both** halves.
That level is cause 2. Running the same arm with the parity of the tick
inverted reads 48.3 / 49.0 on `bastion`, which is the proof that the order of
the bot list held it.

##### Cause 3: both teams at the score limit on the same tick

`checkRoundEnd` walked `TEAM_IDS` in order to find a team at the score limit.
The limit is 15 kills, and a 3v3 round with respawns reaches it in most rounds.
Two teams can cross it on the **same tick**: one exchange takes a bot from each
team, or one shot of area damage takes two. The walk always found team A first,
so team A won every one of those rounds. Over 300 rounds a style:

| Style | Rounds with both teams at the limit | Went to team A |
|---|---:|---:|
| bastion | 10 (3.3 %) | 10 |
| openfield | 26 (8.7 %) | 26 |
| cavern | 19 (6.3 %) | 19 |

Half of each rate is the win rate that it carried: 1.7, 4.4 and 3.2 points. The
level that cause 1 and cause 2 left was 2.1, 5.5 and 4.7 — the same order of
size and the same order between the styles.

**The rule now:** one team over the limit wins, as before. Two teams over it,
and the higher score wins, because area damage can carry a team past the limit
by more than one point. An equal score asks the question that the time limit
asks, so it takes the same answer: **sudden death**, and the next kill wins it.
A round record still says `scoreLimit`, because the score limit outranks sudden
death, and the `Announcement` event records that sudden death started.

##### What the hunt ruled out

- **The engine does not read the team.** A full round mirror test, run to the
  time limit over 6 arenas a style, breaks at tick 1 to 8 and always at a size
  of 1e-15 cells. That is float addition not being associative
  (`w - q - s` against `w - (q + s)`), not a branch.
- **`clearLine` is not symmetric, and it does not matter.** It disagrees with
  its own mirror on 0.2 % of sight lines, and the disagreement does not favour
  a half: 185/159, 175/203 and 164/160.
- **The spawn geometry is fair.** See the step vectors above.

##### The lesson

Both causes have the shape that Section 7.20.18 named: **a number that does not
mean what its name says.** `isContested` says "fair on its own", and it is
fair only while both teams want the same thing from it. "The parity of the
tick" says "it changes hands", and it changes hands only while nothing in the
game runs on an even period.

**A probe that holds everything equal and changes one thing is worth more than
a large batch.** The batch of Section 7.20.22 ran thousands of matches and
could only say "about four points". Two arms of 400 rounds named both causes.

### 7.20 Design notes for M6: weapons, reaction order, and vision

These notes come from the first 1000-round batch (Milestone M5). They set the
direction of M6 and of the combat and perception changes that go with it.
Nothing here is built yet. Numbers are placeholders. TBD

#### 7.20.1 The problem to solve

The batch found one fault above all others: **a bot that holds a position wins**.
The `anchor` preset won 81.1 % of its rounds, and it beat the `aggressive`
preset 100 % of the time. The cause is simple. A bot that holds a sightline
sees the other bot first, fires first, and never crosses open ground. Team
deathmatch gives the moving team nothing in return.

Four changes answer this, and M6 is the milestone that carries them:

1. Weapons that punish a bot which does not move (Section 7.20.4).
2. A crit against a target that stands still, and a dodge for a target that
   moves (Section 7.20.5).
3. A field of view with a front and a side, so that a flank works
   (Section 7.20.6).
4. An order of fire that comes from a reaction speed, not from the order of a
   list (Section 7.20.7).

The `cautious` preset is removed from `data/batch.json`. It won 19.1 % and it
made rounds stall. The default presets are now `balanced`, `aggressive`, and
`anchor`.

#### 7.20.2 Weapon role traits

A generated weapon gets exactly one **role trait**. The trait sets the shape of
the weapon: its DPS across the range bands, its reaction speed, and how often it
takes a special attack type.

| Role trait | DPS | Reaction | Range | Special attack types |
|---|---|---|---|---|
| `precise` | Medium | Medium | Even | Low chance. It is the crit weapon: it uses the `targetStationary` crit condition. |
| `assault` | High at close range | Fast at close range | Penalty at long range | High chance |
| `sniper` | High at long range | Fast at long range | Penalty at close range | Low chance |
| `heavy` | Highest | Slow at every range | Even | High chance |

The role trait is not the same thing as `Weapon.traits` of Section 6.3. That
field holds the weapon mutations of Section 7.3, which are small changes on top
of a finished weapon. The mutations arrive later.

**Open question.** M6 gives one role trait per weapon, because the label of the
weapon must stay readable for the player. Two traits on one weapon (for example
a precise sniper) may be worth a later pass.

#### 7.20.3 Attack types

`Weapon.delivery` of Section 6.3 holds `hitscan` or `projectile`. It becomes
`Weapon.attackType` and holds one of seven values. **This changes Section 6.3.**

| Attack type | Behavior |
|---|---|
| `hitscan` | The shot arrives at once. Line of sight decides the hit. |
| `projectile` | The shot crosses the arena at `projectileSpeed`. A wall or a bot stops it. |
| `cone` | Area damage in a cone in front of the shooter. High damage at close range. It fades to nothing at long range. |
| `burst` | Area damage at the point of impact. |
| `line` | The shot passes through every bot on its line, up to `rangeMax`. |
| `ricochet` | A projectile that turns off a wall, or off the first bot that it hits. |
| `tile` | Damage, plus hazard tiles at the point of impact (Section 7.6). |

`cone`, `burst`, `line`, `ricochet`, and `tile` are the **special** types. The
role trait sets how often the generator takes one.

**Why this answers the camping problem.** Every special type hits an area or a
line, not one cell. A bot that holds one cell is the easiest target for all of
them. `tile` takes the cell away for a time, and `cone` and `burst` hit the bot
behind the cover as well.

#### 7.20.4 Archetypes become a label, not an input

Section 7.3 rolls an archetype first and then rolls stats inside the ranges of
that archetype. The new order is the opposite: the generator rolls a role trait
and an attack type, prices the result, and **then** labels it. The label is for
the player, for the reports, and for the `weaponRolePref` tactic. The AI still
reads only the DPS profile (Section 7.8).

Generation order:

1. Roll the role trait.
2. Roll the attack type, with the weights of that trait.
3. Roll the stats inside the ranges of the trait, shaped by the attack type.
4. Calculate the DPS profile at close, mid, and long range.
5. Price every attribute and scale the weapon to fit the power budget.
6. Derive the archetype label.

The label comes from the first rule that matches, from the top:

| Label | Rule |
|---|---|
| `baseline` | The fixed fallback weapon. |
| `denial` | Attack type `tile`. |
| `splash` | Attack type `cone` or `burst`. |
| `marksman` | Role trait `sniper`. |
| `assault` | Role trait `assault`. |
| `precision` | Role trait `precise`. |
| `versatile` | Nothing above matches. |

**This changes Section 6.3.** The archetype `burst` is gone, because `burst` is
now an attack type and the weapon that uses it is `splash`. The archetype
`assault` and the archetype `marksman` are new.

**The power budget must price the new attributes.** An attack type that hits an
area is worth more than one that hits a cell. A slow reaction is worth less. A
DPS profile that is high in every band is worth more than one with a hole in it.

#### 7.20.5 Combat: stand still and you get hit harder

Two changes to Section 7.6. Both push a bot to keep moving.

- **A crit against a target that stands still.** The crit condition
  `targetStationary` of Section 6.3 exists in the engine but no weapon uses it.
  A `precise` weapon uses it, and its crit chance against a target that stands
  still is high. A bot that holds a sightline is the target this is made for.
  The engine counts "stationary" as some number of ticks with no movement, not
  one tick, so that a step does not turn the crit off and on. TBD
- **A dodge for a target that moves.** `combat.movingTargetPenalty` already
  lowers the hit chance against a target that moved in the last tick. It
  becomes a dodge value that rises with how far the bot moved over the last few
  ticks, and the `evasion` tactic adds to it. The cost of evasion stays: it
  lowers the accuracy of the bot that evades.

Together these make the choice real. Stand still and shoot straight, and a
precise weapon crits you. Move and be hard to hit, and your own shots miss more.

#### 7.20.6 A field of view with a front and a side — built, and it changed nothing

**Today every bot sees through 360 degrees.** `ai/perception.ts` asks rot.js for
every cell inside the sight radius and asks no question about which way the bot
faces. A bot behind another bot is as visible as a bot in front of it, so a
flank gives nothing, and the `awareness` attribute of Section 6.4 has no work.

The change: a bot gets a **facing**, and its vision has two arcs.

| Arc | Width | What the bot gets |
|---|---|---|
| Focus | Narrow, in front | Full detection. The bot can fire. |
| Peripheral | Wide, to the sides | It knows that an enemy is there, after a delay, and its reaction is slower. |
| Behind | The rest | Nothing. |

Rules to settle when this is built:

- The `awareness` attribute sets the width of the peripheral arc, or the delay
  before a peripheral contact becomes a full one. This gives the attribute of
  Section 6.4 its first use.
- A bot faces the enemy that it aims at. With no target it faces the way it
  moves. A turn rate (a limit on how fast a bot turns) would make a flank
  stronger still, and is an open question.
- "Target unaware" of Section 6.8 becomes a real event: a bot behind another
  bot cannot be seen at all. Expect the crit rate to rise, and re-tune.

**Cost.** Low. The set of cells that a bot can see depends on its cell and on
the walls, not on its facing, so the cache of Section 7.7 stays valid. The arc
test is one angle comparison per enemy, and there are five enemies.

**Risk.** Fewer contacts means slower rounds, and the batch already reports
22.5 % of rounds reaching the time limit. Watch the mean kills per round
(Section 7.2.1) when this lands. The memory of a last seen position and the
`Chase` action are what keep a round moving.

**Result: it is built, it changed nothing, and it is switched off.** Section
7.20.10 holds the measurement and the cause. Read it before you plan any more
work on vision.

`perception.directionalVision` in `data/tuning.json` turns it on and off. It is
`false`. With it off a bot sees through 360 degrees, as in the milestones before
M5.5, and the simulation does not calculate a facing at all. Turn it on again
when the pickups of M8 give a reason to cross the arena, and measure it then
against a fresh baseline.

The rules as built:

| Rule | Value |
|---|---|
| Focus arc | 45 degrees each side of the facing. The bot fires only inside it. |
| Peripheral arc | 70 degrees each side, plus 40 more at full `awareness`. |
| Peripheral delay | 8 ticks of unbroken sight before the bot notices a contact. |
| Behind | Nothing. |
| Turn rate | 12 degrees per tick. A half turn takes 15 ticks. |
| Incoming fire | A bot that takes damage learns where the shot came from. |

A bot turns toward, in order: the enemy that it aims at, the nearest enemy that
it knows about, then the way that it moves.

#### 7.20.7 Reaction order: the tick order becomes a mechanic

Today the simulation walks the bots in a fixed list and turns that list around
on every second tick, so that no team fires first every time (Section 7.2.1).
The order carries no meaning.

The change: **a bot acts in the order of its reaction speed.**

```
effectiveReaction(bot) = bot.attributes.reactionTicks
                       + weapon.reactionByBand[band of the current target]
```

The bots of a tick sort by this value, lowest first. A bot with a fast reaction
and a light weapon fires before a bot with a slow reaction and a heavy weapon.
This is the cost of the highest damage: a `heavy` weapon hits hardest and acts
last.

`Weapon` gets `reactionByBand: { close, mid, long }`, which is also what gives
`assault` a fast reaction at close range and `sniper` a fast reaction at long
range (Section 7.20.2). The same value sets the aim delay before the first shot,
so one number covers both.

**Is it feasible? Yes.**

- **Cost.** A sort of six values per tick. It does not show against the cost of
  perception and pathfinding.
- **Determinism.** The order stays a function of the state, so one seed still
  gives one result. Two bots with the same reaction need a tie-break that does
  not favour one team: use the parity of the tick, as the current order does.
- **The guard is already in place.** A preset against itself must win 50 % of
  its rounds (Section 7.2.1). If the tie-break favours team A, the mirror
  matchup shows it at once. Do not remove that check.
- **It replaces `botsInTickOrder`**, and it is a better answer than the parity
  rule, because the order now means something in the game instead of only
  removing a fault.

#### 7.20.8 An advanced tactics layer

The eight fields of `Tactics` (Section 6.4) are the orders that every player
gives. An **advanced layer** holds the settings that a player who wants finer
control can set. It is optional: a team with no advanced settings plays as it
does today.

The first advanced setting is the **weapon priority of the run**. A run has five
weapons (Section 2.2), and the player knows them before the match. The priority
is an ordered list of the weapons of that run, and it biases the weapon choice
of a bot on top of the DPS profile.

**This does not break the rule of Section 7.8** that says the AI must never
refer to a weapon by id. The rule stops the AI code from knowing the weapons of
a run. A priority list is player data that the AI reads as a weight, in the same
way that it reads `aggression`. The AI still asks the DPS profile which weapon
does the most damage at this range, and the priority moves the answer.

Rules for the layer:

- Every advanced setting must have a cost and a benefit, the same as a tactic
  (Section 7.8). A weapon priority that ignores the DPS profile gives away
  damage.
- The layer must stay optional. The batch harness must be able to run with an
  empty advanced layer, so that its result measures the basic tactics.
- More settings belong here later: focus fire per target kind, the order of
  pickup points, the rule for when to break a hold.

#### 7.20.9 What to watch in the batch after M6

| Signal | Today | What to want |
|---|---|---|
| `anchor` win rate | 81.1 % | Near 50 % against the other presets |
| Rounds that reach the time limit | 22.5 % | Lower |
| Rounds with very few kills | 139 of 1000 | Near zero |
| Mirror matchup of every preset | 48–54 % | Stays at 50 % |
| Kills by archetype | One weapon | No archetype above about half the kills |

A weapon is not meant to be the equal of every other weapon. A run has tiers
(Section 7.20.12), and the player should build tactics around the best weapon
of the run. What the batch must show is that the strong weapon pays for its
power, and that every archetype still takes kills.

#### 7.20.10 Measurement: why a bot that holds a position wins

Section 7.20.6 was built first, on its own, so that the batch could say what it
changed. The answer is: **nothing**. Three configurations, 900 rounds each, the
same seed and the same three presets.

| Vision | `anchor` win rate | Kills from behind | Rounds at the time limit |
|---|---|---|---|
| 360 degrees (before) | 82.0 % ±1.6 | — | 11.3 % |
| Focus and peripheral, turn at once | 82.2 % ±1.6 | 11.3 % | 12.2 % |
| Focus and peripheral, turn 12°/tick | 82.6 % ±1.5 | 12.3 % | 11.6 % |

The three win rates are inside one standard error of each other. A flank does
happen — one kill in eight is on a target that cannot see its killer — but it
does not change who wins.

**Two sweeps then found the real cause.** Each one changes one tactic and
holds the other seven, over 320 rounds.

| `holdPosition` | 0.0 | 0.3 | 0.6 | 0.9 |
|---|---|---|---|---|
| Win rate | 30.0 % ±3.6 | 38.4 % ±3.8 | 61.9 % ±3.8 | 69.7 % ±3.6 |

| `itemControl` | 0.0 | 0.3 | 0.6 | 0.9 |
|---|---|---|---|---|
| Win rate | 45.6 % ±3.9 | 52.5 % ±3.9 | 56.3 % ±3.9 | 45.6 % ±3.9 |

`holdPosition` rises without a break. `itemControl` is flat: the sweep has no
trend, and the highest and the lowest setting give the same rate.

**The cause.** A pickup point does nothing. Armor, health, a power-up, and ammo
all arrive with M8 (Section 7.12). Until then the arena has no reward for
crossing it. `holdPosition` therefore trades away a benefit of zero and keeps a
cost of zero, and `itemControl` buys nothing at all. A bot that stands still
cannot lose ground that is worth nothing, and the bot that walks to a pickup
point pays in exposure and receives nothing.

**This is why the vision change could not help.** No rule about who sees whom
can fix a reward that does not exist. The same is true of any counter that
works by making movement safer.

**What follows from this:**

1. **Do not judge `holdPosition`, `itemControl`, or any preset built from them
   until the pickups of M8 work.** The current win rates measure a game with
   one half missing. Section 7.20.9 keeps its targets, but the `anchor` number
   cannot reach 50 % from weapons alone.
2. **M6 can still help, but not by itself.** A weapon that hits an area or
   takes a cell away (Section 7.20.3) raises the cost of standing still. That
   attacks one side of the trade. M8 raises the reward for moving, which is
   the other side. Expect the full answer only when both are in.
3. **Keep a one-tactic sweep in the toolbox.** Two sweeps of 320 rounds each
   found in two minutes what a matrix of full presets could not: a preset
   mixes eight tactics, so its win rate cannot say which one carries it.
4. **Keep the vision change, but switch it off.** It costs about 20 % of the
   round time (159 ms to 195 ms per round) and it buys nothing today.
   `perception.directionalVision` is `false`, so the code stays and the cost
   does not. Turn it on with the pickups of M8: "target unaware" is a real
   state under the arcs, which the crit rule of Section 7.20.5 wants, and a
   flank becomes worth something as soon as holding a position stops being
   free. Measure it again then, against a fresh baseline.

**Update after M8.** The pickups landed and they did give movement its reward:
`anchor` fell from 81 % to 41.9 % and the mean kills per round rose from 10.9
to 25.9 (Section 7.20.13). Point 4 is now ready to test. Directional vision is
still `false`, because M8 changed the baseline it must be measured against;
turn it on and run the 1080-round batch again before you keep or drop it. The
batch already reports `kills from behind`, which is the number to read: it sits
at 9.4 % with 360-degree sight.

---

## 7.21 The team axis (this fork)

**Why this fork exists.** The measured tactics layer did not earn its place.
Over 13770 rounds the per-bot tactics moved a win rate by about seven points at
best (Section 7.20.22), a weapon preference moved it by none, and the arena
side bias was worth about four (Section 7.20.23). A player turning a knob could
not tell their own choice from the noise of which half they started on. Seven
per-bot numbers and four team numbers were being measured at once, and none of
them was the thing that decides a 3v3 fight.

So this fork holds **every per-bot tactic at its default** and studies one new
thing at a time. The first is the team.

### 7.21.1 One axis, from independent to cohesive

`TeamTactics` is now one number, `teamplay`, from 0 to 1.

|  | 0 — independent | 1 — cohesive |
|---|---|---|
| the point a bot walks to | one that no teammate wants | the one a teammate wants |
| the enemy it fires at | one that no teammate fights | the one a teammate fights |
| where it stands | its own ground | beside its team |

`pull = teamplay * 2 - 1` is the whole shape: **-1** at 0, **0** at 0.5, **+1**
at 1. Every effect is that pull times a weight in `data/tuning.json`, so the
axis pulls both ways from the middle and 0.5 is the old behaviour.

It reaches three decisions, and reaching all three is the point:

1. **The objective.** `pickupTarget` multiplies the value of a point that a
   teammate already walks to by `1 + pull × objectiveWeight`. A cohesive team
   takes one point together; an independent team takes a point each.
2. **The target.** `aimCost` in `sim/combat.ts` multiplies the cost of an enemy
   that a teammate already fights by `1 - pull × focusFireWeight`.
3. **The ground.** `Follow` rises with the pull and `HoldPosition` falls, so a
   cohesive team moves as one and an independent team works its own ground.

**Target selection is where focus fire has to live.** The old `focusFire`
number only touched the utility score, which chooses the *action* and not the
*enemy*, so a team with focus fire at 1 still fired at three different bots.
That is why the old team tactics measured as nothing.

### 7.21.2 What the four old numbers were

`cohesion`, `focusFire`, `spacing` and `trading` all pulled on one idea, and a
batch could not say which of them did anything. `cohesion` and `spacing` were
the same axis with opposite signs. `trading` was a different idea — how much a
hurt bot presses on — and it belongs to the per-bot tactics if it comes back.

### 7.21.3 How to measure it

`data/batch-teamplay.json` sweeps the axis. A batch that names `teamPresets`
uses those names as its matchup axis and gives every bot the default tactics,
so the run measures the team decision and holds everything else still.

    npm run styles -- --config data/batch-teamplay.json --rounds 2250 --arenas 3

**The bar this has to clear.** The axis has to move a win rate by more than the
four points of side bias, or a player still cannot tell their own choice from
the ground they drew.

### 7.21.4 The first sweep: it clears the bar, and it is not a straight line

6750 rounds, 2250 a style, 3 arenas a style, every bot on the default tactics
and the standard role order. Win rate, ±1.7:

| `teamplay` | Preset | bastion | openfield | cavern |
|---:|---|---:|---:|---:|
| 0.00 | `solo` | 48.0 % | **45.7 %** | **43.7 %** |
| 0.25 | `loose` | **57.3 %** | **51.7 %** | **54.7 %** |
| 0.50 | `even` | 49.8 % | 48.7 % | 46.4 % |
| 0.75 | `close` | 47.2 % | 51.6 % | 51.3 % |
| 1.00 | `unit` | 47.7 % | 52.4 % | 53.9 % |
| | **spread** | **10.1** | **6.7** | **11.0** |

**It clears the bar.** The axis is worth 7 to 11 points and the side bias is
worth about 4, so the team decision now decides more than the ground does. That
is the first tactical number in the game of which that is true.

**It is not a straight line, and that is the finding.** A little independence
(0.25) is the best setting on all three styles. Total independence (0.00) is
the worst on two of them. And 0.50, which is the middle and does nothing at
all, sits **below both of its neighbours** on `openfield` and `cavern`.

A U about the middle says the three levers do not point the same way. The most
likely reading, not proved:

- **Splitting the objectives pays.** Three bots walking to one item is two bots
  wasted, so a pull toward independence gains ground and items.
- **Focus fire pays.** Bringing an enemy down before it trades is worth more
  than spreading the damage.
- **Those two want opposite ends of one axis**, so the middle gets neither and
  0.25 gets most of the first while giving up little of the second.
- **Total independence loses** because at 0.00 a point that a teammate wants is
  worth 0.4 of its value, which is strong enough to send a bot across the arena
  for a worse item, and the aim turns away from the enemy the team is fighting.

**So the next step is to take the axis apart**, not to tune it. One sweep per
lever — objective, target, ground — each with the other two held at the middle.
Bundling four numbers is what made the old team tactics unreadable, and one
number that bundles three levers has the same defect in a smaller box. TBD

### 7.21.5 What else the sweep shows

**The baseline weapon is a fallback now.** It took 24.2 % of the kills on
`bastion` before the weapon floor of Section 7.3 and takes **12.1 %** after,
and its kills in a round that held it went 5.99 to **2.94**, against 7.00 for
`marksman`. The generated weapons carry the fight.

**The fight moved out to mid range.** The close-range share on `bastion` went
56.8 % to 28.9 %, and the mean kill distance 8.5 to 11.3 cells. That follows
from the same change: the baseline was a 30-cell flat weapon that everyone
fired at every distance, and a `marksman` or `precision` weapon now replaces it.
Whether a 3v3 arena shooter wants 68 % of its kills at mid range is a design
question, and it is open. TBD

**`openfield` got slow.** It reaches the time limit in 19.6 % of rounds against
9.0 % before. A round that does not reach the score limit is the low-kill
defect of Section 7.2.1, and this is the style to watch while the fork
continues. TBD

## 7.22 Tempo: the rhythm of a round

Every other number in a round record is a **total**: kills, shots, pickups,
ticks. A total cannot tell a steady drip of kills from five short fights with
long walks between them. Those are opposite games, and they read the same. This
section adds the distribution over time.

### 7.22.1 Where tempo already lives

Nothing in the engine used the word before this section. Tempo is set anyway,
by four groups of constants at very different scales:

| Layer | Constants | Period |
|---|---|---|
| A bot's own loop | `aiDecisionIntervalTicks`, `reactionTicks`, `turnRateDegreesPerTick`, `influence.intervalTicks` | 0.3 to 0.5 s |
| An engagement | `weaponSwapTicks`, `dodgeRampTicks`, `stationaryTicksForCrit`, the cadence of a weapon | 0.4 to 1 s |
| Death and return | `respawnDelayTicks` 60, plus the walk back at `moveSpeedCellsPerSecond` 4 | 3 s and travel |
| The item economy | ammo 140, weapon 150, health 300, armor 550, power-up 1750 | 7 to 87.5 s |

Four things follow from those numbers alone, before any batch runs:

- **The clock does not push.** A round ends near 2200 of 3600 ticks, and 98.1 %
  of rounds end on the score limit (Section 7.20.13). In most arena shooters
  the clock makes a losing team attack. Here it does not.
- **Losing a weapon costs almost nothing.** A weapon point comes back in 150
  ticks, which is less than a death plus the walk back. Denial is not a lever.
- **A power-up cannot be played around.** 1750 ticks is 87.5 s against a round
  near 110 s, so a point yields about one time. There is no repeated contest.
- **One window holds every item clock.** `pickupAnticipationTicks` is 220, and
  `pickupValue` gives a point that is further away than that a value of exactly
  zero (`src/sim/pickups.ts`). The fight for a power-up starts 11 s before it
  lands, the same as the fight for ammo. The length of a clock decides **when**
  an item matters, not **how long** teams contest it.

### 7.22.2 What the engine counts, and what the log already holds

Only one part of tempo is not in the event log: what a bot can see. Perception
state is not an event, so `BotState` keeps two counters and `updatePerception`
sets them:

    aliveTicks      ticks that the bot was alive this round
    contactTicks    ticks that it was alive with an enemy in either arc

`contactTicks / aliveTicks` is the clearest single measure of tempo. It says
how much of a round a bot fights and how much of it the bot walks.

Everything else comes from `bus.log`, which already carries a tick on every
event, and already holds the ids that the measure needs: `Hit` carries the
shooter and the target, `Kill` carries both teams, `Death` and `Spawn` carry
the bot, and `PickupRespawned` and `PickupTaken` share a slot id. **No engine
change was needed for any of it.** `src/report/tempo.ts` is a reducer over the
log, and `runPlannedRound` already walked that log to build a round record.

### 7.22.3 The measures

`TempoRecord` holds only sums and counts, never a mean, because **a sum adds
over rounds and a mean does not.** `addTempo` adds the rounds of a batch and
`tempoView` takes the means at the end.

| Question | Fields | What the view reads |
|---|---|---|
| Is the round a drip or a set of fights? | `killGapSum`, `killGapSquareSum`, `killGaps` | Mean gap, its standard deviation, and **burstiness** = the two over each other |
| Do the teams trade, or does one team run over the other? | `burstKills`, `tradeKills` | Share of kills inside `multiKillWindowTicks` of another, and the share of those that the other team answered |
| How long is a fight? | `timeToKillSum`, `shotsToKillSum`, `engagements` | Ticks from the first hit on a life to the kill, and shots aimed in that time |
| What share of a round is not fighting? | `deadTicksSum`, `returnTicksSum`, `aliveTicksSum`, `contactTicksSum` | Dead time, the walk back from a spawn to the next shot, and the contact share |
| Does an advantage compound? | `leadChanges`, `maxLead`, `sameTeamPairs`, `killPairs` | Lead changes a round, the largest lead, and the chance that the next kill goes to the team that made the last one |
| Is the item economy played, or only walked into? | `pickupWaitCount`, `pickupWaitTicks` | Ticks that a point waited after it came back, by kind |

Two rules that the code holds and a reader should know:

- **A time to kill belongs to one life.** When a bot dies, every fight against
  it starts again. Without that rule the second life of a bot reads a time that
  covers the first life as well.
- **The first take of a round is not timed.** Every point starts ready, so
  there is no respawn to measure against.

`firstKillTick` and `openingTicks` are the two fields that hold a tick and not
a duration. A round with no kill holds -1, because tick 0 is a real tick. In a
total they hold a sum of the rounds that had one, and the view divides.

### 7.22.4 Where to read them

- `formatReport` prints three tempo tables and an item rhythm table.
- `roundsCsv` writes every field as its own column, one row per round, so a
  reader can take the means over any group of rounds.
- `summarize` adds the rounds into `BatchSummary.tempo`.

### 7.22.5 The question these numbers are for

Section 7.21 asks whether the team axis changes an outcome. A win rate answers
only with yes or no. If `teamplay` 0 and `teamplay` 1 give the same kill gap,
the same contact share and the same trade share, then the axis does not reach
tempo, whatever it does to the win rate. **That is a finding on its own, and it
does not need a difference in the win rate to be true.**

There is a matching worry to test. If a round is one long drip of kills with no
clock pressure, no respawn wave, no denial value on a weapon, and one 11 s item
window whatever the item, then the round has **one** rhythm, and a tactic can
only change how bots fight, never when. A slider cannot reach a "when" that the
round does not have. TBD

## 7.23 Replay: a ticket for one match

A batch writes totals. It never wrote an event log, and it still does not: the
log lives in memory for the length of a round and then goes. That was never a
problem, because the engine is deterministic and a seed rebuilds the round.

**A seed is half a key.** It rebuilds a round only against the same engine and
the same data, and both moved four times while the side bias of Section 7.20.26
was hunted. An old seed still runs. It gives a **different** round, and nothing
in an old `rounds.csv` says so. This section adds the other half.

### 7.23.1 Three seeds, not one

A match used to take one seed and give it to all three generators. That is
fine for a replay and useless for an experiment: a player who liked a layout
could not keep it and try a different loadout on it, because one number moved
all three.

The three seeds were already independent, because they come from three named
streams. `nextMatch` now says so:

    seed = deriveSeed(sessionSeed, `match:N`)
      seeds.arena      = deriveSeed(seed, "arena")
      seeds.weapons    = deriveSeed(seed, "weapons")
      seeds.spawnTable = deriveSeed(seed, "spawnTable")

`nextMatch(session, overrides)` replaces one of them and leaves the others
where they were. Keep the ground and reroll the weapons; keep both and reroll
the spawn table. The arena also reads **its own** seed now, not the seed of the
match, so a new arena seed gives a new name as well as new ground.

### 7.23.2 The ticket

A ticket names one match, as text, so it fits in an address, a note or a line
of a report:

    seed=1758800000&match=2&style=bastion&mode=test
    seed=1758800000&match=2&style=bastion&mode=test&weapons=91h4k

The second is the first with **one** field added, and that is the whole point
of the format. A field that is absent comes from the match seed as usual, so a
plain ticket stays short and a changed one says what changed. Seeds are base
36, because a 32-bit seed is 6 characters there and 10 in base 10. A bare
number reads as a seed, because that is what a person types.

`makeTicket` leaves out a seed that equals the one the match seed gives, so a
ticket carries only what a reader needs to know.

### 7.23.3 The build id

`build=<commit>.<data>` is what makes a seed a whole key.

- The commit comes from `vite.config.ts`, which reads git at build time,
  because a browser has no git. A tree with changes in it gets a trailing `+`:
  a working tree is not a version. vitest reads the same config, so a test sees
  the real commit.
- The data fingerprint is a hash of every data file a generator reads. They
  import as JSON, so the same code gives the same answer in the browser, in
  Node and in the tests, with no build step. Change one number in
  `data/tuning.json` and the same seed gives different weapons; this is what
  says so.

A ticket from another build is **not** an error. It runs. `ticketWarning` says
which of the two matches the reader is looking at, and the menu shows it.

**A bug worth remembering:** `buildId` cut the commit to 8 characters, and the
commit is already 8, so the `+` fell off. The one mark that says "this did not
come from a commit" was the one the cut removed. A test now holds it.

### 7.23.4 Where a ticket lives

- **The address.** Every match start writes its ticket into
  `location.hash` with `replaceState`, so the address bar **is** the ticket and
  a match is not a page in the history.
- **The menu.** A box takes a seed or a ticket. It describes what the ticket
  holds, or warns that its build is not this one.
- **`localStorage`.** A saved list, and the seed of the last session so a
  refresh keeps a run. It belongs to one browser, it can come back empty and it
  can throw, so every read and write is guarded and the game works with none of
  it. **The ticket text is the record; the store is a convenience.**

### 7.23.5 `run.json`

Each batch writes one beside its CSV files: the commit, the data fingerprint,
the seed, the round count, the config, and a line saying what it is for. It is
the half of the key that every seed already written in a `rounds.csv` is
missing.

`batch-out/` is in `.gitignore`, so a result set lives only on the disk that
made it. That is a decision, not an oversight: the guide holds the findings,
and a CSV that outlives the code that made it is a trap. `run.json` is what
tells a reader which of the two they have.

## 7.24 Reading a fight: what killed that bot, and when tactics are set

Two changes that a player asked for, and a measurement that changed one of
them.

### 7.24.1 A critical hit is not what drops a bot

The request was to announce a **head shot** on a critical hit, because a bot
dropping from near full health is hard to follow. The first half is now in.
The second half is not what a crit does.

A crit needs **both** a condition (`targetUnaware` or `targetStationary`) and a
roll of `critChance`. Six single rounds, two of each style:

| Style | Hits | Crits | Kills | Crit kills | Biggest single hit |
|---|---:|---:|---:|---:|---|
| bastion #0 | 126 | 0 | 28 | 0 | 170 (`sniper-hitscan-0`) |
| bastion #1 | 148 | 0 | 29 | 0 | 85 (`sniper-hitscan-2`) |
| openfield #0 | 763 | 1 | 29 | 0 | 194 (`sniper-hitscan-3`) |
| openfield #1 | 131 | 2 | 21 | 0 | 61 (`precise-hitscan-0`) |
| cavern #0 | 199 | 1 | 22 | 0 | 117 (`redeemer`, area) |
| cavern #1 | 208 | 0 | 26 | 0 | 26 (`heavy-cone-2`, area) |

**A round makes 0 to 2 crits, and not one of them killed.** What drops a bot
from near full health is a single sniper shot of 85 to 194 against a health
maximum of 100. Health also falls by 80 in 4 to 6 ticks, which is a fifth of a
second: at any speed above 1× the bar is full in one frame and empty in the
next.

So there are two announcements, not one:

- **`headShot`**, on a critical hit, as asked. It is the rarest line in the
  feed and it gets the loudest colour.
- **`heavyHit`**, when one hit takes at least `heavyHitShare` of full health.
  This was **not** asked for. It is the line that answers the question behind
  the request, and the browser check showed it doing exactly that: `B1 hit A0
  for 58` immediately above `B1 killed A0 with a marksman weapon at mid range`.

`heavyHitShare` is in `data/announcements.json` and defaults to 0.5. Set it to
1 to hear only the hits that take a whole bar, or raise it above 1 to turn the
line off without touching any code.

**The lesson is the one of Section 7.20.18 again.** The request named a cause,
the cause was wrong, and six rounds of measurement cost less than shipping a
feature that fires twice a round and explains nothing.

### 7.24.2 Round 1 of a match now asks for tactics

The tactics screen opened between two rounds and nowhere else, so round 1 of
every match ran on the tactics of the **previous match**, which a player had
set for different ground. The screen now opens before round 1 as well, and it
names the arena and describes it in plain words, because the ground is what the
player is planning for.

`openTactics(nextRound, ground)` serves both: the between-round screen leaves
the arena out, because the player has been looking at it for three minutes.

**A bug it uncovered.** The screen said which end a team starts on, and it
worked that out from `nextRoundNumber % 2`. That stopped being true when
Section 7.20.24 gave the starting half to the match seed, so the line was wrong
in about half of all matches. It now calls `teamSideIndex` with the real
offset. **A number that the display recomputes instead of reading is a number
that will drift away from the engine.**

## 7.25 The weapons of a tournament, the lobby, and a round that says what it did

Three changes that share one aim: **give the player something to learn, and
something to read.**

### 7.25.1 One weapon set for a tournament

Section 7.20.22 found that a weapon preference moved a win rate by none. That
is not surprising in hindsight: a new weapon set arrived with every arena, so a
preference never had two matches to act over, and a player never had two
matches to learn the guns.

A tournament now pins the **weapons** seed to the session. The set holds for
the whole tournament, and only the ground and the spawn table change. The same
five guns, on new ground, with the items in new places.

`Session.pinned` is the mechanism, and `nextMatch` reads three layers:

    the match seed  ->  what the session pinned  ->  what a ticket asked for

A ticket wins, because a ticket names one match exactly. A hand-edited
`weapons=` therefore applies to that one match, and the match after it goes
back to the pin. A plain replay of a session seed is unaffected, because the
pin is derived from that seed.

**The spawn table stays per match on purpose.** Same guns, different places:
the ground and the item layout are the variables, and the loadout is the
constant a player can learn. That is option B of the three that were weighed;
option A moved the spawn table too, and option C is a draft, which belongs with
the run structure of M11. TBD

### 7.25.2 The lobby, in test mode

A tournament gives no choice. Test mode is for asking a question, and a
question needs a control, so it gets a lobby before every match:

    ground        keep · reroll · a seed
    weapons       keep · reroll · a seed
    spawn table   keep · reroll · a seed

**Keep one and reroll another, and the lobby is an experiment.** Hold the
layout and change the guns, and the difference belongs to the guns. Hold both
and change where the items lie, and it belongs to the spawn table. It is the
instrument of Section 7.20.26 — change one thing and hold the rest equal — in
the hands of the player.

Three rules that the code holds:

- **It shows the answer before the player takes it.** Every change rebuilds the
  match and redraws all three parts, because the arena decides what the weapons
  lie on.
- **A reroll always moves.** Each part has a counter, and a reroll takes
  `lobby:<part>:<match>:<step>`, so pressing it twice never gives the same seed
  back.
- **The lobby answer holds.** What the player chose becomes `session.pinned`,
  so a kept layout stays kept until they change it.

The lobby opens **before** the tactics screen. A player sets tactics for ground
and guns they can see.

### 7.25.3 A round that says what it did

The tactics screen showed the score of the last round and nothing else. A score
says who won. It does not say why, and a tactic is a guess without that.

`roundBrief` reads one round out of the match log and gives the three things a
player can act on, each one tied to a control on the same screen:

| It shows | It decides |
|---|---|
| Kills by range band | `preferredRange`, and the weapon a bot reaches for |
| Kills per weapon, and the band most of them landed at | `weaponRolePref` |
| Seconds between kills, how long a fight lasts, the contact share | `aggression`, `holdPosition`, `itemControl` |

A real round read: `close 5 (19 %) · mid 18 (67 %) · long 4 (15 %) · kill every
5.7 s · a fight lasts 6.9 s · in contact 36 % · killed from behind 3`, above
`sniper-line-0 (marksman) — 16 kills, mostly at mid range`. Sixteen of
twenty-seven kills came from one marksman rifle at mid range. **That is a
tactics screen that answers itself.**

The tempo numbers are the ones of Section 7.22, and this is the first place a
player sees them. Before round 1 there is no round to read, so the ground takes
its place (Section 7.24).

## 7.26 The role owns the tactics

**The finding that started this.** `createSimState` read:

    const preset = options.tactics ? tacticsFor(teamId) : (roleData?.tactics ?? ...)

A caller that passed tactics **threw the role preset away**. The browser always
passed them, and so did the batch, so the role preset was used almost nowhere.
A `tank` and an `overwatch` differed only by their six `behavior` weights;
everything that makes a tank a tank — the band it wants, the weapon it reaches
for, how much it holds ground — came from one team-wide slider and was
identical for all three bots.

Two things follow. The composition table of Section 7.20.13 (`standard` 52.8 %,
`turtle` 48.8 %, `rush` 48.5 %) measured **only the behaviour weights**; four
points from six multipliers alone is more encouraging than it looked. And
"weapon priority moved a win rate by none" had an obvious cause: it was one
value for a whole team, over a weapon set that changed with every arena.

### 7.26.1 Why a template beats a slider

Seven continuous values over a team **cannot be swept**. A batch cannot walk a
seven-dimensional space, so the numbers read as noise no matter what they do. A
composition is one categorical choice with ten values (a multiset of three from
three roles), and ten against ten is a hundred cells, which one batch covers.

A preset can also carry a balance target that a person can state and a test can
check: "skirmisher beats overwatch, overwatch beats tank, tank beats
skirmisher". `aggression: 0.62` has no such target.

**And the tempo measures of Section 7.22 can check a role against its own
name**, with no win rate at all. A tank and an overwatch must differ in their
band distribution and their contact share. Two roles with the same tempo
signature are one role with two labels, and that is a finding on its own.

### 7.26.2 What changed

- **The role owns the tactics.** `roleData.tactics` is the base for every bot,
  always.
- **`tactics` became `tacticsOverride`.** It still throws the role presets away,
  for a batch or a test that wants one uniform team, and its name now says so.
  A batch that measures compositions sets `useRoleTactics` and leaves it out.
- **The team screen lost its seven sliders.** It picks a role for each of the
  three bots, shows the composition as counts (`2 tank · 1 skirmisher`), and
  prints what each role does, read from `data/roles.json` rather than repeated
  in the code.

A team-wide layer will come back as something more tactical than a slider. That
decision is open. TBD

### 7.26.3 Two rankings, not two favourites

| Field | Was | Is |
|---|---|---|
| `preferredRange` | one band | `rangePref`: all three bands, best first |
| `weaponRolePref` | one archetype, or null | `weaponPref`: archetypes, best first, may be partial |

**A range ranking, because a role has an opinion about all three bands.** A role
that likes close quarters also minds long range more than mid, and one
favourite band could not say that. The weights keep the old tuning honest: the
head of the list is worth `1 + bias`, exactly what one favourite band was worth;
the middle band is neutral; the last is worth `1 / (1 + bias)`, so a role walks
**away** from the band it likes least instead of merely preferring elsewhere.

| Role | Range, best first | Weapons, best first |
|---|---|---|
| tank | close > mid > long | heavy > splash > assault > versatile > denial |
| overwatch | long > mid > close | marksman > precision > denial > versatile > assault |
| skirmisher | mid > close > long | assault > versatile > precision > splash > marksman |

**A weapon ranking, because a run offers five weapons.** One favourite archetype
was silent about four of them. The head of the list takes the whole bonus and
each place after it takes less, down to one share for the last; an archetype
the list leaves out takes none, so a role can be silent about a weapon instead
of ranking every one. A list of one gives exactly the old weight, so nothing
about the tuning constant changed meaning.

`ai.preferredRangeBias` and `ai.weaponRolePrefBonus` are now `ai.rangePrefBias`
and `ai.weaponPrefBonus`. A name that describes a field which no longer exists
is the shape of defect this project keeps paying for (Section 7.20.18).

### 7.26.4 Not measured yet

Every composition number in this guide predates this change and was taken with
the role presets disabled. **They are history, not a baseline.** The first batch
after this should set `useRoleTactics`, sweep the ten compositions against each
other, and read two things: the win-rate matrix, and whether each role's tempo
signature matches its name. TBD

## 7.27 The round summary, by bot

The round view of Section 7.25 says **which weapon** did the work. It cannot
say **which bot** did it, so it cannot answer the question a player asks before
they change a composition: *does this role earn its place on this ground?*

A toggle on the same block switches between the two. One row a bot, team A
first, in slot order:

    A1 overwatch  2/3 (0.67)  c0 m2 l0 · in contact 13 %
                              baseline-rifle ×1 · heavy-tile-0 ×1
    B2 skirmisher 4/2 (2.00)  c0 m4 l0 · in contact 14 %, 1 from behind
                              heavy-tile-0 ×3 · sniper-hitscan-2 ×1

Both teams are on the list, not only the player's. A role that the enemy plays
better on this ground is the same finding, and reading it costs a row.

**Three decisions in the shape of it.**

- **Deaths come from the `Death` event, not from `Kill`.** They are one to one
  today, but a death is the thing being counted, and a kill is one way to
  reach it.
- **A bot that never died gets its kills as the ratio.** Dividing by zero reads
  as infinity, and a bot that never died is the best case, not an undefined
  one. A bot with no kills and no deaths reads `—`.
- **Every bot gets a row, including one that did nothing.** `A0 tank 0/1 · no
  kill` is an answer, and leaving it out would hide it.

The role and the team are not in the event log, so `roundBrief` takes the bots
as an option. `state.bots` fits it: the same object already carries the contact
counters of Section 7.22, so one option replaced two.

## 7.28 The first composition sweep: bastion

3000 rounds, 3 generated `bastion` arenas, every multiset of three roles from
three — ten compositions, the whole decision space. `useRoleTactics` is set, so
the roles own the tactics and the table measures what a player actually
chooses. Commit `8225b209`, data `1injtqz`, seed 20260928.

### 7.28.1 Compositions matter now, and by a lot

| Composition | Win rate | | Composition | Win rate |
|---|---:|---|---|---:|
| 1T2S | **68.0 ±2.0** | | 2T1O | 48.8 ±2.0 |
| 2T1S | 66.8 ±1.9 | | 1O2S | 46.5 ±2.0 |
| 3T | 65.7 ±1.9 | | 1T2O | 38.7 ±2.0 |
| 3S | 61.2 ±2.0 | | 2O1S | 33.2 ±1.9 |
| 1T1O1S | 53.8 ±2.0 | | 3O | **17.3 ±1.5** |

**A spread of 50.7 points.** The old table of Section 7.20.13 read 52.8 / 48.8 /
48.5 — a spread of 4.3 — because it measured the six behaviour weights alone
(Section 7.26). Giving the roles their tactics back turned a rounding error
into the main decision of the game.

### 7.28.2 It is a dominance order, not a cycle

The matchup matrix has no rock-paper-scissors in it. The top four are inside
noise of each other and beat everything below them:

    against      3T  2T1S  1T2S    3S  1T1O1S  2T1O  1O2S  1T2O  2O1S    3O
    3T           50    48    47    55      70    68    62    87    80    90
    2T1S         52    50    53    53      60    67    72    80    90    92
    3S           45    47    43    50      65    58    65    80    73    85
    3O           10     8     8    15       8    12    13    25    23    50

One number explains the whole table:

| Overwatch in the team | Win rate |
|---|---:|
| 0 | 65.4 ±1.0 |
| 1 | 49.7 ±1.2 |
| 2 | 35.9 ±1.4 |
| 3 | 17.3 ±1.5 |

**About sixteen points for each overwatch, in a straight line.** Nothing else
in the table needs reading.

### 7.28.3 The reason is legible, and it is the map

`bastion` takes **5.7 % of its kills at long range** and 36.7 % at close.
`overwatch` ranks `long > mid > close` and reaches for marksman weapons. It is
playing for a band that this ground barely has.

The role is not broken — it plays a coherent game and loses it. The tempo
signatures of the mirror matchups say so, and they are the acceptance test of
Section 7.26 passing:

| Both teams | ticks | kills | close | mid | long | contact | kill gap |
|---|---:|---:|---:|---:|---:|---:|---:|
| 3T | 2692 | 27.6 | **58 %** | 39 % | 2 % | 39 % | 4.4 s |
| 3S | 2811 | 27.5 | 17 % | **81 %** | 2 % | 39 % | 4.6 s |
| 1T1O1S | 2793 | 24.5 | 33 % | 62 % | 5 % | 35 % | 5.2 s |
| 3O | 3208 | 23.2 | 1 % | 52 % | **46 %** | **69 %** | 5.5 s |

Three roles, three different games. An overwatch team holds sightlines — 69 %
of its living ticks are spent with an enemy in view, against 39 % for a tank
team — and it still kills the least and takes the longest. **A role that two
teams can play is not a label.**

### 7.28.4 What this table is not

- **One map.** `bastion` is the close-quarters style. An overwatch *should* be
  weak here. The question this sweep cannot answer is whether it is strong on
  `openfield`, which takes five times the long-range share. Until that runs, we
  know one half of a specialisation and cannot tell it from a weak role. **TBD**
- **The matchup cells are thin.** 60 rounds a cell, ±6.5. Read the structure,
  not a cell.
- **A 2-point side bias remains.** Team A won 47.9 ±0.9 over the batch. Every
  composition played 300 rounds as A and 300 as B, so it cancels in the column
  above, but it is 2.3 standard errors from fair and it is not gone.

### 7.28.5 The balance judgement

A choice that loses five rounds in six is not a choice, it is a trap. Even if
`openfield` reverses it exactly, 17.3 % against 68.0 % is too wide for a player
to be asked to pick blind.

**Do not tune it from this table alone.** Run the same sweep on `openfield`
first. If `overwatch` tops that one, the roles are specialised correctly and
only the magnitude needs narrowing; if it loses there too, the role is weak and
its weapon and range rankings are the thing to change. Tuning now would be
fitting one map. TBD

## 7.29 Three grounds: the long band does not exist

`cavern` and `openfield` ran the same sweep as Section 7.28: 3000 rounds, 3
generated arenas, all ten compositions, `useRoleTactics` set. Commit
`8225b209`, data `1injtqz`.

### 7.29.1 Overwatch loses on every ground, by the same amount

| Overwatch in the team | bastion | cavern | openfield |
|---|---:|---:|---:|
| 0 | 65.4 ±1.0 | 64.5 ±1.0 | 63.5 ±1.0 |
| 1 | 49.7 ±1.2 | 50.2 ±1.2 | 50.4 ±1.2 |
| 2 | 35.9 ±1.4 | 33.7 ±1.4 | 36.2 ±1.4 |
| 3 | 17.3 ±1.5 | 24.2 ±1.7 | 22.2 ±1.7 |

Section 7.28 asked whether `overwatch` is weak or merely specialised for ground
that `bastion` does not have. **`openfield` answers it: the role is weak.** The
penalty is the same on the open map as on the closed one.

### 7.29.2 Because the long band is 6 %, 1 % and 7 %

| Style | close | mid | **long** |
|---|---:|---:|---:|
| bastion | 37 % | 58 % | **6 %** |
| cavern | 44 % | 55 % | **1 %** |
| openfield | 34 % | 60 % | **7 %** |

`openfield` was supposed to be the long-range map. It takes **7 %** of its
kills past 20 cells. There is no ground in this game where the long band is a
real place to fight.

**Three numbers explain it, and two of them are the same number:**

    perception.sightRadiusCells   20
    combat.rangeBandMidMax        20     <- the long band starts here
    budget.rangeValueCapCells     20

**The long band begins exactly where a bot stops being able to see.** A bot
cannot acquire a target it cannot see, so the band above 20 cells is reachable
only by a shot already in the air, by area damage, or by a target that walks
out of a fight. That is the 1 to 7 %.

The weapon budget already knows this. `bandShare` reads `close 0.50, mid 0.48,
long 0.02`, and `fixedCost` caps the value of reach at the same 20 cells, with
a comment that says "the long band is 1 % of shots". **The data has known since
the weapon work that the long band is 2 % of the game.**

`overwatch` was then written to rank that band **first**, and to reach for
`marksman` weapons, whose base reach is 38 to 58 cells — nearly three times the
sight radius. The role is not mis-tuned against one map. It is aimed at a band
that the engine gives 2 % of.

This is the defect of Section 7.20.18 once more: **a number that does not mean
what its name says.** "Long range" names a band that vision cannot reach.

### 7.29.3 The other two roles do adapt to the ground

| Style | 3T | 3S | 3T − 3S |
|---|---:|---:|---:|
| bastion | 65.7 | 61.2 | **+4.5** |
| cavern | 63.3 | 62.2 | +1.1 |
| openfield | 58.8 | 68.7 | **−9.9** |

A 14.4-point swing between the closed map and the open one, in the direction
the names promise: the tank is best in corridors, the skirmisher on open
ground. **The design works for the two roles that play bands the game actually
has.** `1T2S` also leads `bastion` and `cavern` while `3S` leads `openfield`,
so the best answer changes with the ground.

### 7.29.4 The side bias, watched on purpose

| Measure | bastion | cavern | openfield |
|---|---:|---:|---:|
| Team A, every round | 47.9 ±0.9 | 50.1 ±0.9 | 50.5 ±0.9 |
| Team A, mirror matchups only | 48.2 ±2.9 | 47.3 ±2.9 | 47.3 ±2.9 |

The second row is the cleaner instrument: both teams play the **same**
composition, so nothing but the side can move it. Every composition also played
exactly 300 rounds as A and 300 as B, so a side bias cancels in the tables
above whatever it is.

Over three styles the whole-batch figure is 49.5 ±0.5, which is fair. `bastion`
alone reads 2.3 standard errors low and no other style does; with three styles
that is weak evidence, and it is **not** enough to act on. Watch it, do not
chase it.

### 7.29.5 What to change, and what not to

The composition table is not the thing to tune. **The band structure is.**
Three ways to give the long band a reason to exist, none of them measured yet:

1. **Move the boundary below the sight radius.** `rangeBandMidMax` under 20
   makes the long band ground a bot can see and shoot.
2. **Let a bot see further than it shoots comfortably.** A larger
   `sightRadiusCells` with the boundary where it is.
3. **Accept that there are two bands, not three**, and rewrite `overwatch`
   around holding a mid-range sightline instead of a long one.

Whichever, `bandShare`, `rangeValueCapCells` and every weapon tier were tuned
against a 2 % long band and would all need re-measuring.

Section 7.30 does option 1 and option 2 together, from a measurement of the
ground rather than by hand. Section 7.31 records why option 3 is the wrong
reading: Overwatch loses for a second reason, which is that no bot can choose
where to stand.

`tools/analyse-compositions.py` reads the round CSVs and prints every table in
this section.

## 7.30 The range bands, derived from the ground

Section 7.29.5 listed three ways to give the long band a reason to exist and
measured none of them. This measures the ground first, and then sets the
boundaries from what the measurement says.

### 7.30.1 The method

`tools/measure-sightlines.ts` runs no rounds. For each arena style it generates
a sample of arenas, takes an even spread of floor cells from each, and asks of
every pair of them: does a straight line between the two cell centres reach,
with only a wall as a blocker? That is the rule `blocksSight` and `clearLine`
use, so what the tool counts as visible is what a weapon can shoot along.

It then reports the distribution of those distances. The question the bands
must answer is "how far apart are two bots that can see each other", and this
is that number, measured on the real ground instead of assumed.

```
npx tsx tools/measure-sightlines.ts [arenas-per-style]
```

### 7.30.2 What the ground says

Six arenas a style, 260 cells an arena, 202 020 pairs a style:

| style | visible pairs | p50 | p75 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|
| bastion | 10.6 % | 7.1 | 11.4 | 17.0 | 21.4 | 31.1 | 56.5 |
| openfield | 21.5 % | 11.0 | 17.1 | 24.2 | 29.4 | 41.3 | 57.1 |
| cavern | 19.7 % | 9.2 | 14.3 | 20.2 | 24.1 | 32.9 | 54.1 |
| **all three** | | **9.4** | **15.0** | **21.5** | **26.0** | **37.1** | **57.1** |

Two numbers decide everything:

- **The upper quartile of real sight lines is 15.0 cells.** One quarter of the
  pairs that can see each other are further apart than that.
- **p95 is 26.0 cells.** Beyond that, a pair that can see each other is rare
  on every ground.

The old `rangeBandMidMax` of 20 sat at about the 88th percentile. It was also
exactly `sightRadiusCells`, so the long band began at the same cell where
vision ended. That is the defect of Section 7.29.2, stated in one line.

### 7.30.3 What changed

| number | was | now | why |
|---|---|---|---|
| `perception.sightRadiusCells` | 20 | 26 | p95 of visible pairs. A bot sees as far as the ground allows, not less. |
| `combat.rangeBandMidMax` | 20 | 15 | The upper quartile. The long band now holds the top quarter of sight lines instead of the top eighth. |
| `budget.rangeValueCapCells` | 20 | 26 | The budget must price reach up to the distance a bot can now see. Below the sight radius it charges nothing for the reach a marksman actually uses. |
| `value.bandShare` | close .50, mid .48, long .02 | close .41, mid .34, long .25 | Set from the geometry above, as a prior. |

`rangeBandCloseMax` stays at 8. p50 is 9.4, so the close band already holds
about half of every sight line, which is what it should hold.

The three numbers moved together on purpose. `sightRadiusCells`,
`rangeBandMidMax` and `rangeValueCapCells` were all 20, and each one meant
something different by it. They are now three separate facts: how far a bot
sees, where the long band begins, and how far the budget pays for reach.

### 7.30.4 What is still a prior, not a measurement

`bandShare` was set from **geometry** — the share of visible pairs that fall
in each band. That is not the same as the share of **kills** in each band,
because a bot chooses its range. The geometric figure is the right starting
point and the wrong finishing point. Re-measure `bandShare` from the kill
bands of a batch once the boundaries settle, and re-run the weapon tier
measurement of Section 7.14 against it. **TBD**

The test "weighs a band by how often the arena fires in it" in
`tests/utility.test.ts` used to encode the old world — it asserted that the
long band was 1 % of shots. It now derives the crossover point from
`bandShare` and `rangePrefBias` at run time, so it tests the mechanism and
cannot go stale when the numbers move again.

### 7.30.5 The bands moved. The win rate did not.

Two batches of 1200 rounds over 3 arenas, `data/batch-roles.json`, seed 20260928.

**The band moved exactly as the derivation said it would:**

| kills by band | openfield before | openfield after | cavern before | cavern after |
|---|---|---|---|---|
| close | 45 % | 36.7 % | 56 % | 47.0 % |
| mid | 48 % | 37.8 % | 43 % | 39.6 % |
| long | **7 %** | **25.5 %** | **1 %** | **13.4 %** |

**The Overwatch penalty did not move at all:**

| overwatch in the team | openfield before | openfield after | cavern before | cavern after |
|---|---|---|---|---|
| 0 | 64 % | 66.4 % | 65 % | 64.3 % |
| 1 | 50 % | 48.1 % | 50 % | 51.2 % |
| 2 | 36 % | 33.9 % | 34 % | 34.6 % |
| 3 | 22 % | 22.7 % | 24 % | 20.0 % |

The mirror rows say the role changed its behaviour and not its result. A 3O
team on openfield now takes 82 % of its kills at long range, against 3 % at
close range, which is the role working as designed. It still makes only 16.6
kills in 3905 ticks, where 3T makes 37.8 in 3303. And its contact share is
**higher** than 3T's, 34 % against 29 %. So an Overwatch bot sees the enemy
more of the time, fights at the range it wants, and kills at 37 % of the rate.

Side bias stayed inside the noise: pooled mirror A 46.7 % openfield and 47.5 %
cavern, each ±4.6.

### 7.30.6 The cause: the budget took back what the band gave

The power budget is zero-sum at a fixed tier. Both changes of Section 7.30.3
raised the price of reach, so the generator granted less damage to pay for it.
400 weapon sets, same seeds, old data files against new:

| archetype | mean rangeMax | DPS before | DPS after | change |
|---|---|---|---|---|
| marksman | 47.1 | 63.2 | 54.3 | **−14 %** |
| precision | 32.8 | 53.3 | 53.1 | 0 % |
| assault | 18.3 | 48.6 | 56.4 | **+16 %** |
| splash | 14.9 | 37.0 | 42.8 | **+16 %** |
| heavy | 23.7 | 44.3 | 48.1 | +9 % |
| denial | 17.5 | 35.1 | 37.2 | +6 % |

Marksman and precision are the two weapons an Overwatch bot reaches for first.
Assault and splash are the Skirmisher's and the Tank's. So the change cut 14 %
from the role's own weapon and gave its rivals 6 % to 16 %. The band gain and
the budget loss cancelled, which is what the batch measured.

Two mechanisms, both in the same direction:

- `bandShare` long .02 → .25 makes a long DPS profile count as valuable, so
  `costOf` charges more for it and `generateWeapon` grants less raw damage.
- `rangeValueCapCells` 20 → 26 charges full price for reach out to 26 cells,
  where 6 of those cells used to cost `rangeValueTailShare`, 45 % of full.

This does not mean the bands were wrong. It means `bandShare` and the tier
targets are one system and were re-measured only half way, exactly as
Section 7.30.4 warned.

### 7.30.7 The reach nobody can use

The same table holds a second finding, larger than the first.

**A marksman has a mean `rangeMax` of 47.1 cells, and a bot sees 26.** Twenty
one cells of its reach cannot be used on any ground, because no target is ever
visible there. The tail past the cap is charged at `rangeValueTailShare`, so
the marksman still pays about 9.5 cells of full-price reach for ground that
does not exist. Precision, at 32.8, pays about 3.

So the generator sells the role a number that the perception system cannot
honour. Raising `rangeValueCapCells` did not create this; it made the bill
larger.

**The fix is to stop generating the dead reach, not to price it.** Clamp the
generated `rangeMax` at or just above `perception.sightRadiusCells`, and the
budget that the tail consumed returns as damage — to marksman and precision
first, which are the two weapons Overwatch ranks highest. That is one change,
it needs no new system, and it is the next thing to measure. **TBD**

## 7.31 What the arena tells the bots: nothing

Section 7.30 fixed a number. This records a structural gap found while looking
for the next one, because the gap explains the Overwatch result of
Section 7.29.1 better than the bands do.

### 7.31.1 The arena is measured, and the measurement stops at the report

`measureArena` runs one time after generation and produces 13 numbers. They
have exactly two readers: `validateArena`, the acceptance rule, and the report
tables. **A grep of `src/ai/` for `metrics` returns nothing.** `chokepoints`,
`meanSightline` and `coverDensity` never reach a bot.

Two defects in the measurement itself, which matter if it ever does reach one:

- `sightlineThrough` tests the east–west and north–south runs only. A diagonal
  sight line does not count. The centre room of a bastion arena is the exact
  place where the diagonal decides the fight.
- `countChokepoints` counts **cells**, not doorways: it asks whether removing
  a cell splits the floor, and above 1200 floor cells it samples and
  extrapolates. A three-cell doorway counts three times. Hence bastion 13,
  cavern 17, openfield 0. The figure names no place a bot can stand.

### 7.31.2 A bot has no concept of good ground

At run time a bot knows its own FOV, the pickup list, and the two influence
maps. `positionValue` is the only function that asks whether a cell is worth
holding:

```
0.2 + nearestPickup + max(0, friendly) * 0.1 − min(0.4, danger * 0.05)
```

Good ground means **near a pickup**. No sight line enters it.

Worse, of the seven actions — `Engage`, `Chase`, `SeekPickup`,
`HoldPosition`, `Reposition`, `Follow`, `Idle` — **not one moves a bot to
chosen ground.** `HoldPosition` scores a single cell, the one the bot already
stands on. `Reposition` needs a visible enemy and only corrects the band.
Every other move goes to a pickup, an enemy or a teammate.

So an Overwatch bot cannot select a sight line. A high `holdPosition` only
makes it refuse to leave wherever the last pickup run left it. That is the
static, out-of-position behaviour seen in play, and no change to the bands
repairs it.

The fix needs two parts, and the second is the work:

1. A **conflict-zone measure** on the map, computed at generation and attached
   beside `metrics`: for each floor cell, how many contested cells it sees, by
   the true line-of-sight rule. `pickupEvenness` in `src/arena/contested.ts`
   already marks which points are contested.
2. A **`TakePosition` action** that scores candidate cells inside move range,
   not only the current cell. Overwatch then weights a cell by contested-tile
   coverage at long range. Tank and Skirmisher weight the **route** by conflict
   exposure, which routes them to a safer pickup.

Part 1 without part 2 changes no behaviour, because nothing would read it.
**TBD**

### 7.31.3 Cover is decorative

`isInCover` has one reader in the whole codebase: `killerInCover` in the `Kill`
event payload. It changes no hit chance, no damage and no movement cost.
`blocksSight` treats low cover as clear ground, on purpose. `src/ai/` never
mentions cover.

So low cover is a glyph and one kill-feed field, and `coverDensity` separates
the three styles in the report while giving the player nothing.

This is the cheaper of the two levers. Give cover a real effect — a hit-chance
penalty against a bot in cover, larger at long range than at close range — and
`positionValue` gains a reason to prefer one cell over another. The arena shape
then decides where a bot stands, and bastion 11.6 %, cavern 9.8 % and
openfield 6.8 % cover become three different fights instead of three different
pictures.

Section 7.32 does this. Cover is directional there, not a proximity bonus: only
a tile between the two bots counts, so a move around an enemy takes its cover
away.

## 7.32 Cover, and the reach a bot can use

Section 7.31 found two things that were not mechanics: the reach a weapon sold
past the sight radius, and cover. This makes both of them real.

### 7.32.1 A weapon cannot reach past what a bot can see

A marksman was generated with a mean `rangeMax` of 47.1 cells while a bot saw
26. Twenty one cells of that reach could never hold a visible target, and the
budget still charged about 9.5 cells of full-price reach for them
(Section 7.30.7).

`budget.rangeHeadroomShare` now caps the generated reach at
`perception.sightRadiusCells` times 1.15. The headroom is for a shot already in
the air when the target steps out of sight; past it the reach is ground that
does not exist.

**A cap the roll always hits is not a cap, it is a constant.** The sniper role
rolled `rangeMax` over [38, 58] and every draw landed above the cap, so every
sniper came out with the same reach and the roll meant nothing. The four role
ranges moved into the world the sight radius defines:

| role | was | now |
|---|---|---|
| sniper | [38, 58] | [23, 29] |
| precise | [26, 40] | [17, 26] |
| heavy | [18, 32] | [18, 29] |
| assault | [14, 24] | unchanged |

What the two changes together did to 400 weapon sets on the same seeds:

| archetype | rangeMax before | after | DPS before | after |
|---|---|---|---|---|
| marksman | 47.1 | **25.3** | 54.3 | **56.6** |
| precision | 32.8 | 21.3 | 53.1 | 54.9 |
| heavy | 23.7 | 22.2 | 48.1 | 48.3 |
| assault | 18.3 | 18.3 | 56.4 | 56.3 |
| splash | 14.9 | 12.7 | 42.8 | 43.2 |
| denial | 17.5 | 16.7 | 37.2 | 37.4 |

A marksman now carries the DPS of an assault weapon and 7 more cells of reach,
where before it carried less DPS and 21 cells of reach it could not use.

### 7.32.2 `rangeMax` also sets the accuracy curve, and that is a problem

`hitChance` charges `1 - (distance / weapon.rangeMax) * distanceFalloff`. The
divisor is the weapon's own reach, so **a weapon is rewarded for claiming reach
it cannot use**: the inflated `rangeMax` bought a flat accuracy curve inside the
range it really fought at.

| distance | old marksman, reach 47.1 | new marksman, reach 25.3 |
|---|---|---|
| 10 cells | 0.873 | 0.763 |
| 15 cells | 0.809 | 0.644 |
| 20 cells | 0.745 | **0.526** |
| 25 cells | 0.682 | **0.407** |

So the cap gave the marksman 4 % more DPS and took 29 % of its hit chance at 20
cells. This is the same defect as the bands of Section 7.30: one number carrying
two meanings, and the name declaring only one of them.

Section 7.33 fixes this, and not by dividing by a common scale. The deeper fault
was that the accuracy curve fell from the **muzzle** rather than from the
distance a weapon is built for, so every weapon was at its best at point-blank
range. Effective range is bounded at both ends there.

### 7.32.3 Cover is what lies between you and the shooter

One rule decides everything:

> **The tile a bot stands on shields it from nothing. Only a cover tile on the
> line of fire counts.**

`coverAgainst` walks the line of fire out of the target toward the shooter and
reads the first `cover.depthCells` cells of it. A nearer tile is worth more than
a further one, by `cover.stepFalloff`. A wall ends the walk, because a wall
already stopped the shot.

This is what makes a move around an enemy pay for itself: the same tile that
stops most of the shots from the south stops none from the east. It also keeps
the rule `blocksSight` already stated — a cover tile a bot stands on is a
shooting position, not a screen.

`cover.bandFactor` then scales the shield by the range band, because a shooter
far away has little angle over a low wall and a shooter at arm's length has all
of it:

| band | what one full screen stops |
|---|---|
| close | 15 % |
| mid | 40 % |
| long | 70 % |

There is no separate ceiling. `coverAgainst` answers at most 1, so `bandFactor`
is itself the ceiling, and a second number under it only hid the difference
between the mid band and the long one.

**The roll lives in `damageBot`, and nowhere else.** Every source of damage
funnels through that one function, so one roll there covers the hitscan, line,
cone, projectile and area families alike. A roll in `hitChance` would have
reached the first two and missed the rest, and a roll in both would have charged
twice. Three consequences follow from the placement:

- `noteIncomingFire` runs **before** the roll. A shot that hits the wall in
  front of you still tells you that somebody is shooting at you.
- A hazard tile and a burn are not shielded. They are already on the bot, so
  cover has nothing to stand between.
- `damageBot` answers whether the damage landed, and every caller that adds a
  side effect of its own now reads that answer. A shot cover stopped leaves no
  burn behind it.

`isInCover` keeps its one job, the `killerInCover` field of the kill feed, and
its comment now says that it is a report field and not the mechanic. The `Kill`
event gained `targetCover`, and a `CoverSave` event records every shot that
cover stopped, with its band, so a batch can measure whether the mechanic does
anything at all.

### 7.32.4 What the bots do about it

Cover with no bot playing around it is a tax on both teams and a tactic for
neither. Two decisions read it:

- **`positionValue` adds the cover a cell has from the enemies in sight**, times
  `cover.aiWeight`. It takes the **worst** of them and not the mean, because the
  enemy you are open to is the one that shoots you. With no enemy in sight it is
  worth nothing, by the same rule `contactFactor` uses: cover against nobody is
  not cover. This is what lets an Overwatch bot hold a shielded line instead of
  the cell a pickup run left it on.
- **`firingCell` chooses a bearing, not just a distance.** What used to be
  `cellAtRange` returned one cell: the point at the wanted distance along the
  line the two bots already stood on. It now compares seven bearings — that line
  and three turns of 30 degrees to each side — and scores each one by what the
  target keeps (`ai.flankWeight`), what the bot gains (`cover.aiWeight`), and
  what the walk costs (`ai.flankTurnCost`, per turn, so a bot flanks for a
  reason and not out of habit). A bearing with no clear shot scores nothing,
  because a firing position that cannot fire is not one.

The two AI tests both fail with `ai.flankWeight` and `cover.aiWeight` at zero,
which is the check that they test the feature and not the scaffolding.

**A turn is a rotation of the vector, never an angle added to a bearing.** The
first version took `Math.atan2` of the line and added the offset, and the mirror
test of Section 7.20.23 rejected it: `Math.cos(bearing + Math.PI)` is not
exactly `-Math.cos(bearing)`. A rotation applies `cos` and `sin` as constants, so
a mirrored input gives an exactly mirrored output — negation, multiplication and
addition are all sign-symmetric in IEEE 754. A probe over 8 000 mirrored cell
pairs on the three styles reports `coverAgainst` bit-identical on every one.

### 7.32.5 The mirror test was too strict, and it took a data change to show it

With the new role ranges the mirror test failed on cavern: slot 2 health
2.478950292254808 against 2.4789502922552913, a gap of 4.8e-13 at tick 244.

It is not an asymmetry. The probe says the position gap at that tick is 2.7e-14
cells, and the damage that diverged came from `source=area`:

```
Hit source=area weapon=redeemer damage=97.52104970774519 target=A2
Hit source=area weapon=redeemer damage=97.52104970774471 target=B2
```

`applyAreaDamage` charges `1 - (distance / radius) * 0.5`, and that distance
comes from the positions. A mirrored position is exact only to rounding, so any
damage that scales with a distance **cannot** be bit-identical, and health
inherits the error. The assertion passed until now only because no area weapon
had landed inside the sampled ticks of those seeds.

So the test changed, not the simulation: `health` and `armor` are compared
within 1e-9, and everything discrete — `alive`, `action.kind`, the weapon count,
the position within a tenth of a cell — stays as it was. A real asymmetry moves
health by whole points, and the widest gap rounding produced over 260 ticks was
4.8e-13, so the instrument keeps its teeth.

### 7.32.7 A blast goes over a low wall

Cover that stops everything equally is not a choice, it is a tax. So the answer
to a bot holding cover at long range is a **splash weapon**: a cone or a burst
counts as **close range against cover, whatever the real distance**.

| what the shot is | one full screen stops |
|---|---|
| a bullet at long range | 70 % |
| a bullet at mid range | 40 % |
| a bullet at close range | 15 % |
| **a blast, at any range** | **15 %** |

The reason is the shape of the shot. A blast does not need a clear line to the
bot, only to the ground beside it, so the wall it goes over is not a screen.
Cover still counts for something — a bot pressed against a wall is harder to
reach even with a blast — but only at the close-range rate.

`SPLASH_ATTACK_TYPES` holds `cone` and `burst`, which is exactly the `splash`
archetype: `archetypeOf` maps those two to it and nothing else to it. The set is
keyed on the **attack type** and not the archetype, because the mechanic is the
shape of the shot rather than the name of the weapon. `tile` is absent because a
hazard damages through the `hazard` source, which cover never shields at all.

Two places read the same rule, so that no bot plays against a mechanic that does
not exist:

- `coverFromVisible` prices each visible enemy by the weapon **that enemy
  holds**. A bot facing a grenadier does not value a screen the grenade ignores.
- `firingCell` prices the target's cover by the weapon **the bot holds**, and its
  own cover by the weapon the target holds. A bot carrying a blast has nothing to
  flank, so it walks straight in. This is what makes `ai.flankWeight` mean "how
  much the bot values removing the cover penalty it actually suffers", rather
  than a penalty somebody else suffers.

The `CoverSave` event carries both bands: `rangeBand` is the real distance and
`coverBand` is what the save was priced at, so a batch can tell the two apart.

### 7.32.8 A 30-degree turn clears nothing

The first turn set was three steps of 30 degrees to each side. It did not work,
and the probe says why. Against a target with cover on the straight line, every
30-degree candidate read the **same shield as the straight line**:

```
steps  0 cell (21,15)  theirs 0.700  score 0.180
steps  1 cell (24, 3)  theirs 0.700  score 0.060
steps -1 cell (24,21)  theirs 0.700  score 0.060
```

Cover that shields a bot sits within `cover.depthCells` of it, which in practice
means **the cell next to it**, and a cell next to a bot subtends about 45 degrees
seen from that bot. A 30-degree turn moves the far end of the line of fire a long
way and still enters the target through the same neighbour. So it read the same
cover tile, gained nothing, and paid `ai.flankTurnCost` for the walk — which is
why the straight line kept winning.

At 45 degrees the line enters through the diagonal neighbour instead:

```
steps  0 cell (21,15)  theirs 0.700  score 0.180
steps  1 cell (27, 2)  theirs 0.000  score 0.480
steps -1 cell (27,28)  theirs 0.000  score 0.480
```

`FLANK_TURNS` is now 45, 90 and 135 degrees to each side. 135 is a long walk and
it costs three steps, but it is still worth taking when it is the only bearing
with a clear shot.

The lesson is the one this section keeps repeating: **the resolution of a choice
has to match the resolution of the thing it acts on.** A turn finer than the grid
the cover sits on cannot change what the cover does.

### 7.32.6 What is not measured yet

Cover, the reach cap and the role ranges all landed together and none of them
has a batch behind it. The three questions for the next sweep:

1. Does the Overwatch penalty of Section 7.30.5 move? It should: an Overwatch
   bot holds still, so it can hold cover, and the Tank and Skirmisher walking at
   it cross open ground.
2. Does `CoverSave` fire often enough to matter? `coverDensity` is 11.6 %, 9.8 %
   and 6.8 % on the three styles, so cover is scattered and not everywhere.
3. Does a bot flank, or orbit? `ai.flankTurnCost` is the number to watch, and a
   bot that walks around an enemy without ever firing means it is too low.
4. Does the splash archetype rise? Section 7.29 measured it losing, and
   Section 7.32.7 gives it the one job nothing else can do. `CoverSave` carries
   `coverBand` so the sweep can count the saves a blast was charged close range
   for.

`bandShare` is still the geometric prior of Section 7.30.4, and the accuracy
curve of Section 7.32.2 is still coupled to `rangeMax`. Both wait on the same
sweep. **TBD**

## 7.33 Effective range: one curve, read by everything

Section 7.32.2 found that `rangeMax` carried three jobs and its name declared
one. Fixing that one number alone would have been a patch. The whole of the
range machinery needed to become one system, and this is it.

### 7.33.1 There were three range models, and the simulation obeyed the wrong one

| where | what it said | who read it |
|---|---|---|
| `roles[*].bandMultiplier` | sniper `{ close 0.5, mid 0.95, long 1.35 }` — worst near, best far | the budget, and the AI through `dpsProfile` |
| `roles[*].reactionByBand` | sniper `{ close 7-10, mid 4-6, long 1-3 }` — slow to bring to bear near | `effectiveReaction` |
| `distance / weapon.rangeMax` in `hitChance` | a plain decline from the muzzle — **best** at point-blank range | the simulation |

The first two agreed with each other. The third contradicted them, and the third
was the only one the simulation obeyed.

So a marksman was priced as a long-range weapon, sent to long range by the AI,
and handed its **worst** hit chance when it arrived. The role lost by 44 points
of win rate (Section 7.30.5) and no amount of band tuning could have repaired it,
because the defect was not in the bands.

### 7.33.2 One statement of where a weapon works

Two numbers on a weapon replace all three models:

- **`optimalRange`** — the distance it is built for, in cells.
- **`rangeTolerance`** — how far from that distance it stays useful, in cells.

```
deviation = |distance - optimalRange|
kept      = 1 - distanceFalloff * (deviation / rangeTolerance)
accuracy  = clamp(kept, rangeFloorShare, 1)
```

`src/weapons/range.ts` owns it and holds nothing else. `hitChance` reads it, the
generator reads it to derive `dpsProfile`, and the budget prices the two numbers
that produce it. There is no longer a place for two of them to disagree.

`roles[*].bandMultiplier` is **gone**. Four roles times three bands was twelve
hand-written numbers saying what two numbers now say, and the simulation did not
read any of the twelve.

`attackTypes[*].bandMultiplier` **stays**, because it says something the curve
does not: how the **travel** of the shot fares by band. A projectile is easier to
step out of the way of at long range. That is not "where the weapon works", so
the two do not overlap.

### 7.33.3 Where each role now works, and the numbers behind it

The role tables name the peak and the width. The attack type moves both by its
`rangeFactor`, so a cone is built for a short distance **and** is unforgiving
about it, which is what a cone is.

| role | optimalRange | rangeTolerance |
|---|---|---|
| assault | 4 – 9 | 6 – 10 |
| heavy | 5 – 10 | 5 – 8 |
| precise | 11 – 16 | 9 – 13 |
| sniper | 17 – 22 | 6 – 9 |

The sniper's peak sits at 17–22 and not 23–29 because of the measurement of
Section 7.30.2: the median visible pair of cells is 9.4 apart and p90 is 21.5. A
weapon built for 26 cells is built for the 92nd percentile of sight lines, which
is a fight that almost never happens.

`rangeMax` is now **derived, never rolled**: `rangeGateOf` puts it at
`optimalRange + rangeTolerance * budget.rangeGateTolerances`, floored at the
close band so nothing is unusable and capped at what a bot can see. A weapon can
no longer be allowed to fire where its own curve says it cannot hit.

Over 400 weapon sets, what the curve keeps at each distance:

| archetype | 2c | 4c | 8c | 12c | 16c | 20c | 24c | built for |
|---|---|---|---|---|---|---|---|---|
| assault | 0.67 | 0.82 | **0.85** | 0.55 | 0.28 | 0.16 | 0.15 | close 80 % |
| heavy | 0.53 | 0.72 | **0.86** | 0.51 | 0.21 | 0.15 | 0.15 | close 68 % |
| splash | 0.57 | **0.68** | 0.65 | 0.42 | 0.29 | 0.23 | 0.17 | close 80 % |
| precision | 0.37 | 0.49 | 0.71 | **0.91** | 0.85 | 0.62 | 0.40 | mid 87 % |
| marksman | 0.15 | 0.15 | 0.22 | 0.49 | 0.81 | **0.84** | 0.54 | long 100 % |
| baseline | 0.63 | 0.70 | 0.85 | **1.00** | 0.85 | 0.70 | 0.55 | mid |

Three things to read in that table:

1. **A marksman is at its floor at 2 and 4 cells.** The old rule gave it its best
   chance there.
2. **Effective range is bounded at both ends.** Every row rises and then falls.
3. **The mid-range weapon is the versatile one, and no number says so.**
   Precision's worst value over 1 to 26 cells is 0.37, where assault's and
   marksman's both bottom out at the 0.15 floor. Versatility is not a stat: it
   falls out of the geometry, because a peak in the middle of the distances an
   arena produces has the smallest worst deviation. The baseline is the most
   forgiving of all, which is right for the weapon every bot starts with.

And `dpsProfile` now follows: marksman reads `{ close 17.9, mid 33.9, long 55.3 }`
where the simulation used to pay out the reverse.

### 7.33.4 What the budget charges now

`fixedCost` prices the two numbers that describe the curve:

- `optimalRange * budget.optimalRangeWeight` — far ground is safer ground.
- `rangeTolerance * budget.rangeToleranceWeight` — a wide sweet spot is good in
  every fight with no downside at all, so it costs more per cell than the optimal
  range does. **This is a new charge.** Nothing used to pay for versatility.

`rangeValueCapCells` and `rangeValueTailShare` are **deleted**. They existed to
stop the budget paying for reach past the sight radius, and an optimal range
bounded by the sight radius has no tail to price. Keeping them would have left
two more numbers that do nothing, which is the defect this section is about.

Raw DPS rose sharply across every archetype, and that is not a buff. The curve
makes a weapon miss more outside its band, `bandMean` of the profile fell, and
the budget solved for more damage to reach the same 100 points. The number to
compare across this change is `dpsProfile` at the weapon's own best band, not
damage over the fire interval.

### 7.33.5 A weapon built for half the distance is not half as fussy

Scaling `rangeTolerance` by the attack type's full `rangeFactor` gave a cone an
optimal range of 1.5 cells and a tolerance of 1.5 cells. At 4 cells — inside the
close band a cone is supposed to own — it was already 1.7 tolerances off and
sitting at its accuracy **floor**.

`shape.toleranceReachExponent` fixes it at 0.5, a square root. Only the cone is
materially affected, because it is the only attack type whose reach factor is far
from 1 (0.55 × 0.45 = 0.2475, whose square root is 0.497).
`shape.rangeToleranceMinCells` is the safety net under it.

### 7.33.6 A band a weapon cannot fire in earns nothing, the burn included

A cone is gated at about 8 cells. `bandDistanceOf("mid")` is 11.5. So its mid and
long DPS were a fiction, and `bandMean` still charged 59 % of the budget weight
for them — the dead-reach defect of Section 7.30.7 arriving from the other end.

`bandReach` is 1 or 0 per band and gates **both** terms of the profile. The
second term matters as much as the first: damage over time and a hazard tile
arrive through `flatDps`, which is the same in every band, and a burn needs a
shot that landed. A weapon that cannot fire at a distance cannot set anything
alight there either. Before this gate, a cone with a burn read
`{ close 46.3, mid 31.5, long 31.5 }` and was charged for all of it.

### 7.33.7 The mirror test was asserting something the engine cannot promise

The new role ranges made the mirror test fail on bastion, and this time by a
whole number: slot 1 health **0 against 11.4** at tick 176.

The probe says the engine is not at fault. The position gap at that tick is
1.55e-13 cells and every comparable hit chance is **bit-identical**. What broke
is a threshold. The engine holds several — the band boundaries in `rangeBandOf`,
the `rangeMax` gate in `selectTarget`, `targetSwitchMargin` — and a distance
sitting within 1e-15 of one puts the two sides on opposite sides of it. One bot
then fires a tick earlier than its image, and 1e-15 becomes a whole hit.

The two teams' positions diverge at **tick 2**, by 7.1e-15 cells, so there is no
window in which they are bit-identical. A sweep of 3 styles by 8 seeds over 600
ticks put the earliest whole-number break at **tick 165**, and 8 of the 24 runs
never broke at all:

```
style           s0     s1     s2     s3     s4     s5     s6     s7
bastion        176    492   none    357   none    165   none    419
openfield      529    260    189   none   none    288    242    266
cavern        none    512   none    265    239    452    371   none
```

So `TICKS` drops from 260 to **120**, inside that margin. This is not a
weakening: asserting an exact mirror at tick 260 was asserting something the
engine cannot promise, and it passed by luck. Every asymmetry this test has ever
caught was systematic and appeared in the first few ticks — a decision phase
taken from the index in the bot list, a path search that broke a tie against the
axes of the world, a danger map that did not know whose bots made the danger.
A 120-tick window catches all three.

Health and armor keep the 1e-9 tolerance of Section 7.32.5, for the separate
reason given there.

### 7.33.8 `rangePref` is a bias, not a command

One test had to change its claim rather than its setup. "The head of `rangePref`
sets the band of Reposition" passed only because the baseline weapon's DPS
profile used to be flat at 12.8 in all three bands, so the tactic was the only
signal in `wantedBand`. With the profile derived from the curve, a bot that
prefers the close band and carries a mid-range weapon now fights at mid.

That is correct, and it is the documented contract: `rangePref` is a **bias on
the weapon in the hands of the bot**. A preference that overrides the weapon you
are holding is a preference for missing. The test now states both halves — with a
neutral weapon the tactic decides, and with a strong weapon the weapon decides.

### 7.33.9 What is not measured yet

Nothing in Sections 7.32 or 7.33 has a batch behind it. The questions stack up
now, and they want one sweep, not four:

1. Does the Overwatch penalty of Section 7.30.5 move? Its weapon now works where
   the role stands, and cover now protects the ground it holds.
   **Measured on cavern: no.** 3O went 20.0 % to 17.5 %, and Section 7.34 says
   why: the weapon is now a true specialist in a fight that is 16 % of the round.
2. Is `rangeFloorShare` at 0.15 too generous or too harsh? It decides how badly a
   weapon out of its band is punished, and it is pure guesswork today.
3. Does the new `rangeToleranceWeight` price versatility correctly? If precision
   weapons dominate, it is too cheap.
4. `bandShare` is still the geometric prior of Section 7.30.4, and it now feeds a
   profile derived from the curve rather than a hand-written table, so its error
   propagates further than it did.

**TBD**

## 7.34 The cavern sweep: the curve worked, and Overwatch still lost

1200 rounds over 3 cavern arenas, `data/batch-roles.json`, seed 20260928 — the
same shape as the band sweep of Section 7.30.5, so the two compare directly.

### 7.34.1 The composition table did not move

| overwatch in the team | before the bands | after the bands | after the curve |
|---|---|---|---|
| 0 | 65 % | 64.3 % | **65.7 %** |
| 1 | 50 % | 51.2 % | **50.4 %** |
| 2 | 34 % | 34.6 % | **34.2 %** |
| 3 | 24 % | 20.0 % | **17.5 %** |

Three reworks in a row — the bands, the reach cap, the range curve — each of
which did exactly what it was built to do, and the table is where it started.
3O is **worse**, at 17.5 % against 20.0 %.

Side bias stayed clean: pooled mirror A 55.4 ± 4.5 (1.2 standard errors from
even, which is nothing) and 49.8 ± 1.4 over every round.

### 7.34.2 What did move

| measure | before | after |
|---|---|---|
| kills at long range | 13.4 % | 16.3 % |
| mean kill distance | 9.53 cells | 9.89 cells |
| hits per shot | 1.016 | 1.171 |
| mean ticks in a round | 2852 | 2624 |

And the archetypes moved a great deal:

| archetype | share of kills before | after | change |
|---|---|---|---|
| **splash** | 10.0 % | **19.5 %** | **+9.5** |
| assault | 15.3 % | 16.8 % | +1.5 |
| heavy | 12.5 % | 12.4 % | 0.0 |
| precision | 15.2 % | 15.0 % | −0.2 |
| baseline | 16.1 % | 13.9 % | −2.2 |
| denial | 7.2 % | 4.7 % | −2.5 |
| **marksman** | 20.9 % | **15.0 %** | **−5.9** |

Splash nearly doubled and took the crown from the marksman. Section 7.32.7 gave
it the one job nothing else can do, and its optimal range sits where the fighting
is. The marksman lost nearly six points of the kills.

### 7.34.3 The cause: the marksman is built for a fight that rarely happens

The curve read at the distances this arena actually fights at:

| archetype | optimal | at 5.5c | **at 9.9c** | at 11.5c | at 17.5c |
|---|---|---|---|---|---|
| baseline | 12.0 | 0.76 | **0.92** | 0.98 | 0.79 |
| precision | 13.2 | 0.57 | **0.82** | 0.90 | 0.76 |
| assault | 6.3 | 0.90 | **0.72** | 0.60 | 0.21 |
| heavy | 7.0 | 0.84 | **0.72** | 0.57 | 0.17 |
| splash | 7.2 | 0.67 | **0.49** | 0.42 | 0.30 |
| **marksman** | 18.3 | 0.16 | **0.33** | 0.45 | 0.89 |

9.9 cells is the mean kill distance in cavern. **At that distance the marksman is
the worst weapon in the game**, and it is the best only at 17.5 cells, where
16.3 % of the kills happen.

This is not a fault in the curve. The curve did precisely what Section 7.33 built
it to do: it turned the marksman into a real specialist, bounded at both ends.
The trouble is what it specialises in. 83.7 % of the kills land inside 15 cells,
and a specialist for the other 16 % loses.

The peak is not misplaced either. Working back from the band shares and the mean,
a long-band kill lands around 17.5 to 20 cells, which is where the marksman's
peak sits. The band is correctly served. It is simply small.

### 7.34.4 The conclusion: the blocker is not the weapon

Three separate weapon-side reworks have now been measured and none moved the
composition table:

| change | what it fixed | Overwatch, 3O |
|---|---|---|
| the bands (7.30) | the long band held 1 % of kills, now 13 % | 24 % → 20 % |
| the reach cap (7.32.1) | 21 cells of unusable reach, priced and sold | — |
| the range curve (7.33) | the simulation contradicted the weapon's own profile | 20 % → 17.5 % |

Each one was a real defect and each is now fixed. None of them was the binding
constraint.

**The binding constraint is Section 7.31.2: a bot has no concept of good ground.**
Of the seven actions, not one moves a bot to chosen ground. `HoldPosition` scores
only the cell it already stands on, `Reposition` needs a visible enemy and only
corrects the band, and every other move goes to a pickup, an enemy or a teammate.
So an Overwatch bot cannot select a sight line. It cannot create the long-range
fight its weapon is built for, and the arena will not hand it one: the ground
offers sight lines past 20 cells (p90 is 20.2 in cavern) and the bots close to
9.9 before they kill.

Giving a specialist a better weapon does not help when nothing puts it where the
weapon works. The next change is the one Section 7.31.2 describes — a
conflict-zone measure on the map, and a `TakePosition` action that scores
candidate cells rather than the current one — and it should be measured before
any further weapon tuning. **TBD**

### 7.34.5 Two things to watch, not yet established

- **Splash at 19.5 % of kills may now be too strong.** It is the largest
  archetype, and it gained from two changes at once: Section 7.32.7 and an
  optimal range that happens to sit on the modal kill distance. One sweep cannot
  separate the two.
- **Overwatch may have found a partner.** Inside the one-overwatch group the mean
  is unchanged at 50.4 %, but the spread inside it opened up: 2T1O went 54.2 % →
  **61.7 %** while 1T1O1S went 50.4 % → **42.5 %**. Each difference is about 1.7
  standard errors on its own, so neither is established, but together they hint
  that an Overwatch bot works when two Tanks hold the close band in front of it
  and fails in any other mix. A sweep aimed at that question would settle it.

## 7.35 The conflict zone, and an action that walks to it

Section 7.34.4 said the blocker was not the weapon. Three weapon reworks, each
fixing a real defect, and the Overwatch composition did not move once. The
constraint was Section 7.31.2: **no action moves a bot to chosen ground.** This
builds the measurement and the action together, because either alone changes
nothing.

### 7.35.1 What the arena now tells a bot

`src/arena/conflict.ts` measures two fields per cell, once, when the arena is
built:

- **`contested`** — how evenly the two teams reach the cell. It is
  `1 - |stepsA - stepsB| / conflict.contestedSpanSteps`, floored at 0, from the
  two breadth-first walks that `pickupEvenness` already used. Both teams
  arriving together means the ground is fought over. This is the conflict zone.
- **`coverage`** — how much of that contested ground the cell can see, by the
  same rule a weapon shoots along, out to `perception.sightRadiusCells`.
  Normalised so the best cell of the arena reads 1.

`coverage` is the number an Overwatch bot wants. On the three styles the
conflict zone is 8 % to 12 % of the floor, and the centre of the map scores 0.85
to 0.92 against 1.00 at the best cell — which is the bastion centre room saying
what it is.

The field hangs off `ArenaMap.conflict`, and `parseArenaText` fills it too, so a
hand-drawn test arena behaves like a generated one. It is a walk of the grid with
no RNG, so the same arena always gives the same field.

### 7.35.2 The float line walk was not mirror-exact, and it was worth 0.059

The first version of `cellSeesCell` sampled the line with floats and took
`Math.floor`. The conflict field came out **asymmetric**: 90 cells on bastion,
340 on openfield, 150 on cavern, differing from their own mirror image by as much
as **0.059**. An arena is symmetric by construction, so a field that is not is a
side bias with extra steps.

A first probe of 20 000 random cell pairs found no disagreement, which was
misleading — the geometry that breaks it is specific. Testing one asymmetric cell
against every other cell found it at once:

```
from (31,3)->(27,14) = true    mirror (28,26)->(32,15) = false
from (31,3)->(26,17) = true    mirror (28,26)->(33,12) = false
```

The cause is exact: a sample sits at `p = from.x + 0.5 + dx * i / steps`. Its
mirror sits at `W - p`. And `floor(W - p)` equals `W - 1 - floor(p)` **only when
`p` is not an integer**. For dx = −4 and steps = 24, `p` is an integer at
i = 3, 9, 15 and 21, and there the mirrored walk reads a different column.

So the walk is now integer arithmetic. The sample at step `i` is the exact
rational `((2 * from + 1) * steps + 2 * d * i) / (2 * steps)`, every term an
integer, so mirroring negates the numerator exactly. A sample that lands exactly
on a cell boundary touches **both** neighbours and the line counts as blocked if
either is a wall — a rule that is symmetric, because the pair of cells either
side of a boundary maps to the pair either side of the mirrored boundary.

The field is now exactly symmetric on all three styles, and a test holds it.

### 7.35.3 `TakePosition`

The seventh action, and the first that moves a bot to ground it chose:

```
groundValue(cell) = coverage(cell) * ai.conflictWeight      what it overlooks
                  + coverFromVisible(cell) * cover.aiWeight  what shields it
                  - min(0.4, danger(cell) * 0.05)            what threatens it
```

`bestGround` scans 24 candidates — eight bearings at three distances out to
`ai.takePositionRadiusCells` — plus the cell the bot stands on. The bearings are
rotations of a unit vector rather than angles, for the reason of Section 7.32.8.

Two guards keep it honest:

- **It runs every `ai.takePositionIntervalTicks`, not every tick.** A bot decides
  every tick and the scan costs 24 candidate cells; the answer is kept on the bot
  between searches.
- **A candidate must beat the current cell by `ai.takePositionMargin`.** Without a
  margin a bot walks for a rounding difference, arrives, finds the cell it left is
  now better by the same rounding, and walks back.

It answers to `holdPosition`, the same tactic as `HoldPosition`, because the two
are halves of one idea: that tactic says how much a bot values ground at all. An
Overwatch bot carries 0.75 of it and a Tank 0.3, so the role that needs a
sightline goes looking for one and the role that needs a fight does not. The role
`behavior` weights sharpen it further: Overwatch 1.6, Skirmisher 0.9, Tank 0.6.

Four of the tests fail with `ai.conflictWeight` at zero, which is the check that
they test the feature and not the scaffolding.

### 7.35.4 What this does not do yet

- **Tank and Skirmisher do not route around the conflict zone.** Section 7.31.2
  wanted conflict exposure on the **path** to a pickup, so the two roles that
  cross the map take the safer way. `groundValue` scores a destination, not a
  route. **TBD**
- **`contested` is unused by any bot.** Only `coverage` reaches a decision. A bot
  that wanted to avoid the zone, rather than overlook it, would read the other
  field. **TBD**
- **Nothing is measured.** The next sweep is openfield, where the sight lines are
  longest (p75 is 17.1 cells against 14.3 in cavern) and the long band should pay
  the most. **Measured in Section 7.36: the long band shrank.** `coverage` counts
  contested cells seen without caring at what range, so the best ground is in the
  middle of the fight and `TakePosition` walked Overwatch into it.

## 7.36 The openfield sweep: the zone sent Overwatch the wrong way

1200 rounds over 3 openfield arenas, same config and seed as before.

**A caution about what this compares.** The last openfield sweep ran before both
the range curve of Section 7.33 and the conflict zone of Section 7.35, so the two
changes arrive together here and this batch cannot separate them. Cavern measured
the curve alone (Section 7.34).

### 7.36.1 The numbers

| overwatch in the team | openfield before | openfield after |
|---|---|---|
| 0 | 66.4 % | 65.8 % |
| 1 | 48.1 % | 51.5 % |
| 2 | 33.9 % | 31.9 % |
| 3 | 22.7 % | **18.3 %** |

| measure | before | after |
|---|---|---|
| kills at long range | 25.5 % | **21.9 %** |
| mean kill distance | 11.5 cells | **11.0 cells** |
| mean ticks in a round | 2773 | 2421 |
| mean kills in a round | 23.8 | 24.4 |
| hits per shot | 1.07 | 1.15 |

Openfield has the longest sight lines of the three styles, so it was where the
long band should have paid the most. **The long band shrank.** Rounds got faster,
closer and bloodier, and 3O fell again.

### 7.36.2 The cause: coverage rewards standing in the fight, not overlooking it

`coverage` counts how many contested cells a cell can see. The cell that sees the
most contested ground is a cell in the **middle** of it. Measuring the mean
distance from the best-scoring cells to the contested ground they actually see:

| style | best cell | coverage | contested there | mean distance to the zone it sees |
|---|---|---|---|---|
| bastion | (39,10) | 1.00 | 0.33 | **9.8** |
| openfield | (24,4) | 1.00 | 0.00 | **9.3** |
| cavern | (29,10) | 1.00 | 0.33 | **8.0** |

The best ground in every arena overlooks the conflict zone from **8 to 10
cells** — the close and mid bands — and several of those cells sit **inside** the
zone. So `TakePosition` walked an Overwatch bot into a knife fight and called it
good ground. Every number in 7.36.1 follows: bots converge on one place, the
distances shorten, the rounds run faster, and the role built for 18 cells is the
one that suffers.

Three specific asymmetries were ruled out before looking further, because a side
bias would have explained the same numbers differently:

- The conflict field is exactly mirror-symmetric on all three styles.
- `bestGround` is mirror-symmetric: 0 of 386 start cells disagree with their
  mirror image.
- The mirror-break sweep is unchanged, earliest break still tick 165.

Team A won 53.2 % ± 1.4 of every round here against 48.5 % ± 1.4 last time, which
is 2.4 standard errors apart and worth watching, but nothing in the engine
explains it and the three checks above came back clean.

### 7.36.3 The fix: coverage has to know the range it is measured at

The measure asks "how much of the fight can this cell see". It should ask **"how
much of the fight can this cell see at a distance my weapon is good at"**.

The curve of Section 7.33 already answers that. Weight each visible contested
cell by `rangeAccuracy(weapon, distance)` instead of counting it flat, and the
same ground scores differently for different roles: an Overwatch bot prefers a
cell that overlooks the zone from 18 cells, a Tank one that overlooks it from 6.

That cannot stay a single number per cell, because it now depends on who is
asking. The cheap form is **three fields instead of one** — coverage at close, at
mid and at long, each computed once when the arena is built — and a bot reads the
one its weapon is built for, or blends the three by its own band profile. The
cost of building an arena roughly triples and nothing in a round gets slower.

This also gives the Overwatch role a real answer to the question Section 7.34.4
left open. It had the weapon and it had somewhere to stand; it did not have a
reason to stand **back**.

Section 7.37 does it.

## 7.37 Coverage, split by the band it is seen at

Section 7.36.3 said the measure had to know the range it was measured at. This
does that.

### 7.37.1 Three fields, one normaliser

`ConflictField.coverage` is no longer one number a cell. It is three:
`close`, `mid` and `long`, each holding the share of the conflict zone that cell
sees **at that band's distance**.

Splitting costs nothing. Every visible pair was already tested once; it now lands
in one bucket instead of a flat total. The arena build is the same work.

The three share **one** normaliser, the largest total of any cell, so they stay
comparable and sum to at most 1. Normalising each band to its own maximum would
have been wrong: an arena with almost no long view of its conflict zone would
report a perfect `long` somewhere, when the true answer is that a marksman has
nowhere good to stand there.

### 7.37.2 A bot reads the band its own weapon is good at

```
overlook = Σ over bands  coverage[band] * rangeAccuracy(weapon, bandDistance(band))
```

The range curve of Section 7.33 supplies the second factor, so the two systems
finally meet: the arena says what a cell overlooks and at what range, and the
weapon says what that range is worth to the bot holding it.

A marksman reads about 0.15 at the close band and 0.89 at the long one. An
assault weapon reads the same two the other way round. The same arena hands each
role different ground, and no per-role table says so.

What that does to a real arena:

| style | best **long** cell | long | mid | close | best **total** cell | long | mid | close |
|---|---|---|---|---|---|---|---|---|
| bastion | (41,10) | 0.29 | 0.43 | 0.20 | (40,10) | 0.24 | 0.42 | 0.34 |
| openfield | (45,7) | **0.52** | 0.01 | 0.00 | (25,6) | 0.09 | 0.38 | **0.53** |
| cavern | (46,10) | **0.33** | 0.00 | 0.00 | (29,10) | 0.17 | 0.20 | **0.63** |

On openfield the flat count sent every role to (25,6), which watches the fight
from the close band. A marksman now goes to (45,7) instead, which watches it from
the long band and sees nothing at all up close. That is the whole change, in one
row.

Bastion stays mixed, with 0.29 as its best long cell against openfield's 0.52.
That is the ground being honest: a bastion has short sight lines, so it has less
sniper ground to offer, and the measure says so instead of inventing some.

### 7.37.3 The tests

Two new tests, and both fail if the bands are collapsed back to a flat count:

- **A marksman and a shotgun choose different ground** from the same cell in the
  same arena.
- **The ordering flips.** Given the most close-heavy cell and the most long-heavy
  cell of an arena, a shotgun values the first above the second and a marksman
  values them the other way round.

`groundValue` is exported for the second one. It is the function the whole of
Sections 7.35 to 7.37 exists to get right, so it is worth testing directly rather
than through the action that calls it.

## 7.38 The band-split sweep: the range came back, the role did not

1200 rounds over 3 openfield arenas, same config and seed. Three runs now compare
on this ground: before the conflict zone, with the flat coverage of Section 7.35,
and with the band split of Section 7.37.

### 7.38.1 The mechanism worked

| measure | pre-zone | flat zone | **band zone** |
|---|---|---|---|
| kills at long range | 25.5 % | 21.9 % | **26.4 %** |
| kills at close range | 36.7 % | 36.7 % | **33.6 %** |
| mean kill distance | 11.53 | 10.98 | **11.59** cells |

The range compression of Section 7.36.2 is not merely undone, it is reversed:
the long band now holds more of the kills than it did before the conflict zone
existed, and the fight happens further apart than in either earlier run. The
band split does exactly what it was built to do.

Side bias came back to even as well: pooled mirror A **50.0 ± 4.6** and
51.3 ± 1.4 over every round, against 57.1 and 53.2 last time. The 53.2 of
Section 7.36.2 was noise, as the three symmetry checks there suggested.

### 7.38.2 The composition table moved, half way

| overwatch in the team | pre-zone | flat zone | **band zone** |
|---|---|---|---|
| 0 | 66.4 % | 65.8 % | **64.7 %** |
| 1 | 48.1 % | 51.5 % | **49.7 %** |
| 2 | 33.9 % | 31.9 % | **36.9 %** |
| 3 | 22.7 % | 18.3 % | **18.3 %** |

Two overwatch is the best it has ever been: 36.9 %, up 5.0 points on the flat
zone and 3.0 on the pre-zone baseline. Zero overwatch came down a little. But
**3O did not move at all**, and the gap is still about 15 points of win rate for
every Overwatch bot a team fields.

### 7.38.3 The real size of the problem, measured at last

Per-role production tells the story the composition table only hints at:

| run | Tank K/D | Skirmisher K/D | **Overwatch K/D** | Overwatch kills a seat |
|---|---|---|---|---|
| pre-zone | 1.08 | 1.14 | 0.75 | 2.62 |
| flat zone | 1.21 | 1.21 | 0.60 | 2.50 |
| **band zone** | 1.18 | 1.17 | **0.65** | **2.67** |

An Overwatch bot makes **2.67 kills a seat against 4.97 and 4.69** for the other
two roles, and it dies more often than it kills. It is about 55 % as productive
as a Tank, and that is the 15 points a seat, stated as a mechanism.

Sections 7.35 to 7.37 moved it from 2.50 to 2.67 kills a seat and its K/D from
0.60 to 0.65 — a real gain of about 7 %, against a deficit of 45 %. **The
positioning was a genuine defect and it was not the main one.**

### 7.38.4 What to measure next, before changing anything

Four candidate causes, and the round record cannot currently separate them:

1. **It shoots less.** `holdPosition` 0.75 and `aggression` 0.4 are both the
   lowest of the three roles, so an Overwatch bot may spend its ticks holding
   rather than firing.
2. **It misses more.** Even with the curve of Section 7.33, a long shot faces the
   full dodge of a moving target where a close shot does not.
3. **It is outnumbered where it stands.** A bot alone on a ridge meets two
   enemies at once, and `focusFireWeight` rewards them for it.
4. **Its weapon trades rate for damage.** A marksman fires slowly, so a missed
   shot costs more than a missed assault burst.

One cheap instrument separates the first two from the rest: add `shots_role_*`
and `hits_role_*` to the round record beside the kills and deaths that are
already there. Shots a seat answers "does it shoot less", and hits over shots
answers "does it miss more". Neither needs a new system and both come from events
the bus already carries.

Measure before tuning. Three weapon reworks and two positioning reworks have each
fixed a real defect without moving this number, and the reason each time was that
the defect found was not the binding one.

Section 7.39 adds the instrument and answers it: causes 1 and 2 are refuted, and
so is the obvious third theory that Overwatch does the work and a teammate takes
the credit. The deficit is damage.

## 7.39 Shots, hits and damage by role

Section 7.38.4 listed four candidate causes for the Overwatch deficit and said
the round record could not separate them. This adds the instrument, and the
instrument answers more than it was asked.

### 7.39.1 Three counters

`RoundRecord` gains `shotsByRole`, `hitsByRole` and `damageByRole`, beside the
`killsByRole` and `deathsByRole` already there. All three come from events the
bus already carries — `Shot` and `Hit` both name their shooter — so nothing new
is emitted and no system is added. The rounds CSV carries a column a role for
each.

### 7.39.2 The first version counted burns as hits

`hitsByRole` first counted every `Hit` event. But `damageBot` emits a `Hit` for
**every** source, a tick of a burn and a tick of a hazard tile included, so
`hitsByRole / shotsByRole` read 0.696 for Overwatch and **1.622** for Tank — a
"hit rate" above 1, and a weapon with a long burn reading as accurate.

It now counts only the `shot` and `area` sources: the damage a shot delivered.
The same measurement then read 0.375 and 0.372, which is a different conclusion
from the same data. `damageByRole` still counts every source, because a burn a
shot left behind is work the role did.

This is the defect of this whole area of the guide, in the instrument built to
find it: a number that does not mean what its name says.

### 7.39.3 What it says: not accuracy, not credit, just damage

40 rounds on one cavern arena. A small sample, but the effects are large and
consistent.

| role | shots a seat | landed a shot | damage a seat | kills a seat | damage a kill | K/D |
|---|---|---|---|---|---|---|
| tank | 43.0 | 0.422 | 606.7 | 4.51 | 134.4 | 1.00 |
| skirmisher | 45.3 | 0.357 | 608.7 | 4.80 | 126.8 | 1.30 |
| **overwatch** | **38.4** | **0.371** | **340.9** | **2.41** | 141.3 | **0.66** |

Two of the four candidates of Section 7.38.4 are **refuted**:

- **It does not miss more.** Overwatch lands 0.371 of its shots against the
  Tank's 0.422 and the Skirmisher's 0.357. It is the middle of the three, and
  better than the role with the best K/D.
- **It is not doing the work and missing the credit.** That was the obvious next
  theory: kills go to whoever lands the last blow, so a role that softens targets
  scores nothing. But damage a seat is 0.56 of a Tank's and kills a seat is 0.53
  of one. They track. And damage a kill is level across the three roles, 134,
  127 and 141, so no role wastes what it deals.

**The deficit is damage, and nothing else.** It decomposes into three compounding
factors, none of them large on its own:

| factor | Overwatch against Tank |
|---|---|
| shots a seat, 38.4 against 43.0 | 0.89 |
| landed a shot, 0.371 against 0.422 | 0.88 |
| **damage a landed hit, 23.9 against 33.4** | **0.71** |
| product | **0.56** |

The largest term is the surprising one. A marksman is meant to hit hard, and an
Overwatch bot delivers **29 % less damage per landed hit** than a Tank. Where
that goes is the next question, and this sample cannot answer it: the role ranks
`precision` and `denial` above `versatile` and `assault`, so it may rarely hold a
marksman at all, and a `denial` weapon spreads its damage over time into small
ticks.

Confirm it on a full sweep before acting. Every batch from here carries the three
columns, so the next one answers it for free.

Section 7.40 does, over 3600 rounds, and the answer is not the weapon design: an
Overwatch bot never picks a weapon up, and fights the round with the starting
rifle.

## 7.40 Overwatch fights with the starting rifle

1200 rounds on each of the three styles, 3600 in all, with the instrument of
Section 7.39. The anemic-damage finding carries through on every ground, the
decomposition of it changes, and the cause turns out to be none of the four
candidates of Section 7.38.4.

### 7.40.1 The deficit is the same everywhere

| style | damage a seat | kills a seat | damage a kill | K/D |
|---|---|---|---|---|
| bastion | **0.64** | 0.60 | 1.06 | 0.48 |
| cavern | **0.56** | 0.53 | 1.05 | 0.51 |
| openfield | **0.55** | 0.54 | 1.03 | 0.55 |

All ratios are Overwatch against Tank. Damage and kills track each other on all
three grounds, and damage a kill is level, so the role wastes nothing it deals
and is credited with everything it earns. **It simply deals 36 % to 45 % less.**

### 7.40.2 The decomposition, corrected

The 40-round sample of Section 7.39.3 said Overwatch shoots 11 % less. Over 3600
rounds that is **wrong**:

| style | shots a seat | landed a shot | damage a landed hit | product | measured |
|---|---|---|---|---|---|
| bastion | **1.26** | 0.88 | **0.57** | 0.64 | 0.64 |
| cavern | 0.99 | 0.85 | **0.66** | 0.56 | 0.56 |
| openfield | **1.22** | 0.78 | **0.58** | 0.55 | 0.55 |

On two of the three grounds an Overwatch bot **fires more shots than a Tank**, not
fewer. It does not miss much either: against the Skirmisher, whose weapons hit
one bot at a time as its own do, it lands 0.358 against 0.337 on bastion and
0.369 against 0.358 on cavern.

Nearly the whole deficit is one term. **An Overwatch bot deals 19 to 21 damage a
landed hit where a Tank deals 33.** The product of the three factors matches the
measured ratio to two decimals on every style, so the arithmetic is not a story.

### 7.40.3 The cause: it never arms itself

A weapon that fires often and hits softly is the **baseline rifle**: 14 damage
every 12 ticks, the fallback every bot starts with.

Kills by archetype, in rounds with no Overwatch seat against rounds with six:

| archetype | bastion | cavern | openfield |
|---|---|---|---|
| **baseline** | 10.1 % → **77.7 %** | 7.5 % → **60.8 %** | 8.5 % → **54.8 %** |
| marksman | 19.1 % → 6.7 % | 15.4 % → 13.8 % | 18.8 % → 8.8 % |
| splash | 22.5 % → 5.4 % | 24.2 % → 1.5 % | 27.2 % → 6.1 % |
| heavy | 11.0 % → 0.6 % | 14.6 % → 2.3 % | 10.8 % → 3.5 % |

**An all-Overwatch team takes 55 % to 78 % of its kills with the starting rifle.**
The role that ranks `marksman` first in its `weaponPref` almost never holds one.

The pickups confirm it directly:

| taken a round | bastion | cavern | openfield |
|---|---|---|---|
| weapon points, 0 Overwatch seats → 6 | 15.31 → **5.42** | 17.49 → **7.50** | 15.04 → **9.75** |
| ammo points, 0 → 6 | 12.19 → **0.33** | 12.68 → **0.33** | 15.89 → **1.67** |

Ammunition falls by about 97 %, which is the same fact said twice: the baseline
weapon is `bot.weapons[0]`, `hasUnlimitedAmmo` is true for it, so a bot that
never takes a weapon never needs a round.

The chain is complete and every link is measured:

```
itemControl 0.4 and seekPickup 0.8, both the lowest of the three roles
  -> it rarely walks to a weapon point        (5.4 pickups against 15.3)
  -> it keeps the baseline rifle              (78 % of its kills)
  -> 14 damage a hit instead of 33            (damage a hit 0.57)
  -> 45 % less damage a seat                  (0.55 to 0.64)
  -> half the kills, and it loses             (K/D 0.48 to 0.55)
```

Section 7.35 made this worse rather than better. `TakePosition` carries a role
weight of **1.6** for Overwatch against `seekPickup` at **0.8**, so the action
that competes hardest with fetching a weapon is the one the role wants most. That
is why 3O went 20.0 % to 18.3 % across the zone work.

### 7.40.4 What this means for the five reworks

The bands, the reach cap, the range curve, the conflict zone and the band split
were each a real defect and each is fixed. **None of them could have moved this
number, because an Overwatch bot was not carrying the weapon any of them tuned.**

Five sweeps looked at the weapon and the ground. The bot had neither.

### 7.40.5 The fix, and the better fix

The narrow fix is two numbers in `data/roles.json`: raise the Overwatch
`itemControl` from 0.4 and its `seekPickup` behaviour from 0.8. That would be
tuning one role out of a hole the others are not in.

The better fix is in `pickupValue`. **A weapon point is worth what it adds, and
nothing values it that way today.** A bot still holding the baseline should want
a weapon far more than a bot already carrying a good one, whatever its role or
its `itemControl`. Scale the worth of a weapon point by the gap between what lies
on it and what the bot holds, and the problem disappears for every role at once —
including any future role that inherits a low `itemControl`.

Measure both. The instrument of Section 7.39 is in every batch now, so the
baseline share of kills is the number to watch: it should fall from 55–78 % to
near the 8–10 % that a Tank team already shows.

Section 7.41 does the better one.

## 7.41 One ranking of weapons

Section 7.40 found that an Overwatch bot fights the round with the starting rifle
and named two fixes. This is the better one.

### 7.41.1 The walk and the choice were priced differently

Two functions ranked weapons, and they disagreed.

`bestWeaponOverall` decided **what to hold**:

```
Σ over bands  dpsProfile[band] * bandShare[band] * rangeWeight(tactics, band)
              * weaponWeight(tactics, archetype)
```

`readyValue` decided **what is worth walking to**, through `meanDps`:

```
Σ over bands  dpsProfile[band] * bandShare[band]
```

The second is the first with the role taken out. So a bot crossed the map for the
weapon **the arena** liked and then equipped the weapon **its role** liked, and
the role whose ideal weapon was furthest from the arena's average — Overwatch,
which wants a marksman where the arena fights 41 % of the time inside 8 cells —
was the role whose pickup score said so least.

`weaponWorth` in `src/sim/pickups.ts` is now the one ranking. `bestWeaponOverall`
calls it and `readyValue` calls it. They cannot drift apart again, because there
is only one of them.

What it answers, for the five weapons of one run, to three roles:

| weapon | Overwatch | Tank | Skirmisher |
|---|---|---|---|
| baseline | 10.2 | 10.8 | 10.9 |
| assault | 42.4 | **64.9** | **72.2** |
| splash | 29.4 | 57.6 | 45.5 |
| precision | 37.2 | 25.6 | 35.8 |
| **marksman** | **49.7** | 27.3 | 32.9 |

The marksman tops the Overwatch column and the assault tops the other two, from
the same five weapons and the same arena. That is the sentence the old pricing
could not say.

### 7.41.2 The ceiling erased the case that mattered

`readyValue` capped a weapon point at **1.6**, and the formula reached it easily:
a bot holding only the baseline scored a gain of 3.2 against a marksman and 1.9
against a merely good weapon, and **both came out at 1.6**. The one bot that
needed the loudest signal — the one with nothing but the starting rifle — was the
one the cap silenced.

The three numbers are now in `data/pickups.json` where the guide says tunable
numbers belong, and the ceiling is `weaponGainMax` at 4.0. For an Overwatch bot
24 cells from a weapon point the SeekPickup score goes from 0.24 to 0.59.

`bestHeldWorth` also now skips a weapon with an empty magazine, which `meanDps`
did not: a bot whose good weapon is dry was valuing the ground by a weapon it
could not fire. And a bot holding nothing firable at all takes the ceiling
directly, because a ratio against zero says nothing.

### 7.41.3 A note on what carries the role

Writing the tests turned up a number worth recording. **`rangePref` alone does
not overcome raw DPS.** `rangePrefBias` is 0.25, so the head of the ranking is
worth 1.25 and the tail 0.8, against a `bandShare` that already puts 0.41 on the
close band. A shotgun with six times the close-band DPS of a sniper still wins
for a long-preferring bot on range preference alone: 34.3 against 31.1.

It is `weaponPref` that carries the role's identity, at `weaponPrefBonus` 0.6.
Both rankings together give the table of Section 7.41.1; either alone does not.
A test holds this so it cannot rot quietly, and whether `rangePrefBias` should be
larger is a separate question that wants its own measurement. **TBD**

## 7.42 The pickup sweep: the biggest move of the whole search

1200 rounds on 3 openfield arenas, same config and seed. The "before" column is
the three-style sweep of Section 7.40, which is the first run to carry the
per-role instrument.

### 7.42.1 The mechanism did what it was built to do

| openfield, by Overwatch seats in the round | baseline share of kills before | after |
|---|---|---|
| 0 seats | 8.5 % | **5.0 %** |
| 3 seats | 20.0 % | **8.7 %** |
| 6 seats | **54.8 %** | **31.6 %** |

| weapon points taken a round | before | after |
|---|---|---|
| 0 Overwatch seats | 15.04 | **21.62** |
| 3 seats | 11.73 | **18.78** |
| 6 seats | 9.75 | **14.67** |

An all-Overwatch team now takes half again as many weapons and fights with the
starting rifle for 31.6 % of its kills instead of 54.8 %. Every seat count
improved, which is what a fix to `pickupValue` should do rather than a fix to one
role's numbers.

### 7.42.2 And the deficit it was aimed at closed

| openfield, Overwatch against Tank | before | after |
|---|---|---|
| shots a seat | 1.22 | 1.10 |
| landed a shot | 0.78 | 0.72 |
| **damage a landed hit** | **0.58** | **0.89** |
| damage a seat | 0.55 | **0.70** |
| kills a seat | 0.54 | **0.72** |
| **K/D** | **0.55** | **0.94** |

Damage a landed hit was the whole of the deficit in Section 7.40.2, and it moved
from 0.58 to 0.89 — 19.6 damage a hit to 31.8, against the Tank's 35.5. In raw
terms an Overwatch bot's K/D is **0.946** where a Tank's is 1.001 and a
Skirmisher's is 1.045. The role is at parity for the first time.

Its shots a seat **fell**, 55.2 to 42.3, which is the same fact from the other
side: it has stopped spamming a rifle that fires every 12 ticks and started
carrying weapons that hit.

### 7.42.3 The composition table, finally flat

| Overwatch in the team | before | after |
|---|---|---|
| 0 | 64.7 % | **56.4 %** |
| 1 | 49.7 % | **49.3 %** |
| 2 | 36.9 % | **44.0 %** |
| 3 | **18.3 %** | **38.8 %** |

**3O went from 18.3 % to 38.8 %**, and the cost of an Overwatch seat fell from
about 15 points of win rate to about 6. The spread from the best composition to
the worst narrowed from 50 points (18.3 to 68.8) to 20 (38.8 to 59.2).

Side bias stayed clean: pooled mirror A 47.5 ± 4.6. The `1O2S` cell reads
12.5 ± 9.5, which is 24 rounds and noise; the pooled figure is the one to read.

### 7.42.4 What this says about the five reworks before it

One change to how a weapon point is priced moved the composition table further
than the bands, the reach cap, the range curve, the conflict zone and the band
split put together. Those five were each a real defect, and each is still worth
having. But none of them was the binding constraint, and this was.

The pattern is worth naming, because it repeated five times: **every one of those
reworks tuned a number the bot was not using.** The bands priced a weapon the bot
never picked up. The curve set the accuracy of a weapon the bot never held. The
conflict zone sent the bot to good ground with the starting rifle in its hands.
The instrument of Section 7.39 is what broke the run, and it broke it in one
sweep, because it measured what the bot **did** rather than what it was given.

### 7.42.5 What is left

- **Overwatch still costs about 6 points a seat**, and 0 Overwatch still wins
  56.4 %. Flat is not level.
- **31.6 % of an all-Overwatch team's kills are still the baseline rifle**,
  against 5.0 % for a team with none. There is more in the same place: the
  ceiling at 4.0, `itemControl` 0.4, and `TakePosition` at role weight 1.6
  against `seekPickup` at 0.8 all still pull a holding role away from the ground
  it needs to visit.
- **Confirm on bastion and cavern.** This is one style, chosen because its long
  sight lines favour the role under test, so it is the friendliest ground for the
  change and the result should be read as an upper bound until the other two
  agree.

Section 7.43 does, and openfield was indeed an upper bound: the gain there is
three times bastion's.

## 7.43 Bastion and cavern: the fix holds, and the ground sets the size

1200 rounds on 3 arenas of each style, against the instrumented sweep of
Section 7.40. Openfield was measured first in Section 7.42 and is repeated here so
the three read together.

### 7.43.1 The mechanism holds on every ground

Baseline share of kills, by the Overwatch seats in the round:

| style | 0 seats | 3 seats | 6 seats |
|---|---|---|---|
| bastion | 10.1 → **4.7 %** | 20.9 → **9.7 %** | 77.7 → **35.7 %** |
| cavern | 7.5 → **3.8 %** | 15.9 → **6.7 %** | 60.8 → **14.3 %** |
| openfield | 8.5 → **5.0 %** | 20.0 → **8.7 %** | 54.8 → **31.6 %** |

Weapon points taken a round:

| style | 0 seats | 3 seats | 6 seats |
|---|---|---|---|
| bastion | 15.31 → **20.51** | 11.69 → **18.65** | 5.42 → **17.42** |
| cavern | 17.49 → **21.97** | 13.00 → **20.11** | 7.50 → **16.83** |
| openfield | 15.04 → **21.62** | 11.73 → **18.78** | 9.75 → **14.67** |

An all-Overwatch team on bastion went from 5.42 weapon points a round to 17.42, a
**3.2-fold rise**, and cavern's baseline share fell from 60.8 % to 14.3 % — within
sight of the 3.8 % that a team with no Overwatch shows. The change was aimed at
every role and it landed on every role.

### 7.43.2 The deficit closed everywhere, by the same term

Overwatch against Tank, damage a landed hit — the whole of the deficit in
Section 7.40.2:

| style | before | after |
|---|---|---|
| bastion | 18.96 (0.57) | **29.22 (0.86)** |
| cavern | 21.47 (0.66) | **32.12 (0.94)** |
| openfield | 19.64 (0.58) | **31.76 (0.89)** |

And K/D:

| style | before | after |
|---|---|---|
| bastion | 0.613 | **0.867** |
| cavern | 0.612 | **0.804** |
| openfield | 0.647 | **0.946** |

One change, one term, three grounds. The diagnosis of Section 7.40 was right and
the fix addressed it.

Tank K/D fell in step — 1.274 to 1.113 on bastion, 1.200 to 1.105 on cavern —
because the kills did not appear from nowhere. The table is flattening, not
inflating.

### 7.43.3 The composition table, and why openfield flattered it

| 3O win rate | before | after | gain |
|---|---|---|---|
| bastion | 18.8 % | **26.7 %** | +7.9 |
| cavern | 15.4 % | **29.0 %** | +13.6 |
| openfield | 18.3 % | **38.8 %** | +20.5 |

The cost of an Overwatch seat, in points of win rate:

| style | before | after |
|---|---|---|
| bastion | 14.3 | **11.1** |
| cavern | 16.0 | **10.6** |
| openfield | 15.5 | **5.9** |

**Openfield was an upper bound, as Section 7.42.5 warned.** Its long sight lines
are the role's best ground, and the gain there is three times bastion's. The
honest figure for the change is the middle of these: the cost of an Overwatch seat
fell from about 15 points to about 9.

Side bias: every-round A rates are 49.7 ± 1.4 on bastion and 50.9 ± 1.4 on
cavern, which is even. The same-composition mirror subset reads 39.2 ± 4.5 on
bastion, 2.4 standard errors low, against 46.7 before. That subset is a tenth of
the rounds and the full set disagrees with it, so it reads as noise rather than a
finding — but it is the one number here worth watching on the next sweep.

### 7.43.4 The remaining gap sits where the remaining baseline does

Ranking the three styles by what is left tells its own story:

| style | baseline share at 6 seats | cost a seat |
|---|---|---|
| cavern | 14.3 % | 10.6 |
| openfield | 31.6 % | 5.9 |
| bastion | 35.7 % | 11.1 |

Cavern has nearly cleared the baseline problem and still charges 10.6 points a
seat, so something other than the weapon is holding Overwatch back there. Bastion
has both the most baseline left and the highest cost. Openfield has middling
baseline and the lowest cost, which says the ground matters as much as the weapon.

So there are two jobs left and they are separable:

1. **Finish the weapon.** Bastion at 35.7 % baseline has the most to give from the
   same lever — the `weaponGainMax` ceiling at 4.0, `itemControl` at 0.4, and
   `TakePosition` at role weight 1.6 against `seekPickup` at 0.8.
2. **Find what cavern is missing.** It is armed and still losing, so its remainder
   is not the rifle. The per-role instrument now reports shots, hits and damage a
   seat, and cavern's Overwatch shots a seat is **37.5 against the Tank's 38.5** —
   the only style where it does not out-shoot a Tank. That is the thread to pull.

**TBD**

## 7.44 Support: joining a fight a teammate is already in

Observed in live play: bots walk between pickup points while an engagement is
happening somewhere else. The action set had nothing for it. Of the eight actions,
`Engage` and `Chase` both need a target of the bot's own, and `Follow` keys on the
**distance** to the nearest teammate rather than on whether that teammate is
fighting — and it answers to `1 - holdPosition`, so the role that holds ground
followed the least.

### 7.44.1 The action

`Support` is offered only when the bot has no visible enemy **and** a living
teammate does. It picks the teammate in the hardest fight, by two things a bot can
read about a teammate without any shared knowledge of the enemy:

```
urgency = min(1, enemies it sees / teamSize) * (1 - supportHurtShare)
        + (health it has lost)              * supportHurtShare
value   = actionBase.support * urgency * nearness(bot -> teammate)
weight  = 0.5 + aggression
```

`aggression` is the tactic, not `holdPosition`: this is the action that means "go
where the fighting is". A tie between two teammates goes to the lower slot, which
is the same slot for both teams, so the choice stays a mirror image.

**It stops short rather than piling in.** `approachCell` walks the line toward the
teammate and halts at the bot's own preferred engagement distance, from
`bandDistance(wantedBand(bot))`. And it is not offered at all when the bot is
already inside that distance, because then there is no ground to cover and
`HoldPosition` and `TakePosition` should decide.

That distance follows **the weapon in hand**, not the role, which is the rule of
Section 7.33.8 and worth stating because it is easy to assume otherwise:

| weapon held | approach halts |
|---|---|
| assault, denial | 4.0 cells short |
| baseline, precision | 11.5 cells short |
| marksman | 18.8 cells short |

The role enters through the score, not the distance. The request asked that a bot
weighted toward covering a zone not displace to a distant fight, and it does not:
at 37 cells from a teammate facing two enemies at 40 health, Support scores

| role | score | what the bot does instead |
|---|---|---|
| tank | 0.296 | **Support wins** |
| skirmisher | 0.281 | Follow, 0.50 |
| overwatch | 0.094 | TakePosition, 1.23 |

`behavior.support` is 1.2 for Tank, 1.35 for Skirmisher and 0.55 for Overwatch.

### 7.44.2 What the measurement said about the observation

The action mix, over 3 rounds a style, as a share of living bot-ticks:

| style | Engage | SeekPickup | Support | TakePosition | Follow |
|---|---|---|---|---|---|
| bastion | 22.9 % | **55.7 %** | 3.2 % | 6.5 % | 6.2 % |
| cavern | 20.5 % | **63.4 %** | 2.5 % | 6.2 % | 4.1 % |
| openfield | 23.5 % | **48.7 %** | 3.0 % | 8.0 % | 8.5 % |

**A bot spends half to two thirds of every round walking to a pickup point, and a
fifth of it fighting.** That is the observation, quantified.

Two things this rules out. It is **not** a consequence of Section 7.41: at the old
`weaponGainMax` of 1.6 the same measurement read 58.9 %, 64.9 % and 48.3 %, so
pickup-chasing predates that change and was not caused by it. And `Support` alone
does **not** fix it: at first it reached 1.6 % to 2.3 % of ticks and what it
displaced was `Follow` and `HoldPosition`, not `SeekPickup`, because it has to
outbid a weapon point that Section 7.41 now values up to 4.0.

### 7.44.3 So a fight suppresses a far pickup run

`SeekPickup` already carries a suppression term for `holdPosition`: a run across
the arena is discouraged, an item at the bot's feet is not. A fight now enters the
same term:

```
suppression *= 1 - fightSuppressesPickup * urgency * (1 - nearness(pickup))
```

**It never applies to a bot still holding only the starting rifle.** An unarmed
bot joining a fight is a gift to the other team, and arming itself is the whole
finding of Section 7.40. The `isArmed` gate means this change cannot undo that
one, and a test holds it.

With the suppression in, Support runs at 2.5 % to 3.2 % of ticks and `SeekPickup`
falls by one to four points. That is a real change and a modest one. Both numbers
are data — `actionBase.support`, the three `behavior.support` weights, and
`fightSuppressesPickup` — so the size of the effect is a dial, not a rewrite.

### 7.44.4 The regression sweep

1200 rounds on 3 openfield arenas, against the same style in Section 7.42.

| Overwatch in the team | before Support | after |
|---|---|---|
| 0 | 56.4 % | 56.1 % |
| 1 | 49.3 % | 48.9 % |
| 2 | 44.0 % | 42.5 % |
| 3 | **38.8 %** | **43.8 %** |

Nothing regressed, and 3O rose 5.0 points. That is about 1.1 standard errors on
its own, so it is **suggestive and not established** — but it sits beside three
other things that agree with it. The spread from best composition to worst
narrowed again, 17.6 points to 13.6. The cost of an Overwatch seat fell from 5.9
points to 4.1. And 3O at 43.8 now reads slightly **above** two Overwatch at 42.5,
which breaks the monotonic "more Overwatch is worse" order for the first time in
the whole search, though the two overlap inside their error.

Side bias held: 51.0 ± 1.4 over every round, pooled mirror A 44.6 ± 4.5.

**The gain is coordination, not production.** Per-role numbers barely moved —
Overwatch K/D 0.946 to 0.944, damage a seat 440 to 443, kills a seat 3.37 to
3.42 — and the round is the same shape, 2654 ticks to 2676 and 25.0 kills to
24.7 with the band shares unchanged. Three Overwatch bots that converge on a
fight win more rounds without any of them killing more, which is what a
reinforcement action should do and is the one thing none of the earlier reworks
could have produced.

### 7.44.5 What is not settled

- **Whether 50 % to 63 % on pickups is wrong at all.** An arena shooter is partly
  a game of item control, and 20 % of ticks in contact against 25 kills a round is
  about 6 seconds of engagement per kill, which is not obviously broken. The
  measurement says what the bots do; it does not say what they should do. Raising
  `fightSuppressesPickup` further is easy and its cost would be the balance of
  Section 7.43, which took five reworks to reach.
- **`Reposition` reads 0.0 % on every style.** It is offered only with a visible
  enemy and a band mismatch, and `Engage` appears to cover that case already. A
  branch that never fires is the defect this guide keeps finding, and it wants its
  own look. **TBD**

## 7.45 Is cover working? Four questions and one real bug

### 7.45.1 A shooter's own tile shielded its target

`coverAgainst` walks from the target toward the shooter and reads the first
`cover.depthCells` cells. It excluded the **target's** own tile, on the rule that
a cover tile you stand on is a shooting position and not a screen. It did not
exclude the **shooter's**.

At two cells' range the walk reached the shooter's cell. At one cell it passed it.
So a bot standing on cover, firing at a bot in the open:

| gap | the target's shield, from the shooter's own cover |
|---|---|
| 1 cell | **1.000** |
| 2 cells | **0.500** |
| 3 cells and out | 0 |

And the reverse read 0 at every gap, correctly. **The tile protected the wrong
bot.** Standing on cover at point-blank range was strictly bad: it gave the enemy
a full screen and the bot holding it nothing.

The walk now stops one cell short of the shooter, and two bots with nothing
between them get no cover at all:

```
if (distance < 2) return 0;
const depth = Math.min(cover.depthCells, distance - 1);
```

Five tests hold it, and two of them fail against the old walk.

### 7.45.2 Cover is symmetric, and that was never in doubt

`coverAgainst(a, b)` equals `coverAgainst(b, a)` to ten decimal places at every
range tested, and `coverSave` reads the same from both ends of a tile: 0.075 and
0.075 at four cells apart, 0.150 and 0.150 at two. Cover is a fact about the
ground, so it reads the same to both bots. A test holds it.

### 7.45.3 Bots do use cover

`tools/measure-cover-use.ts` asks a real round rather than the arithmetic. While a
bot is in contact, how much cover does it hold against the enemy it sees, against
how much the cells around it were offering?

| style | cover held | on offer nearby | difference |
|---|---|---|---|
| bastion | 0.1045 | 0.0797 | **+31 %** |
| cavern | 0.0959 | 0.0681 | **+41 %** |
| openfield | 0.0605 | 0.0486 | **+24 %** |

A bot in a fight holds a quarter to two fifths more cover than the ground around
it offers on average. `cover.aiWeight` at 0.35 is doing real work.

### 7.45.4 Flanking works where there is somewhere to flank to

When a bot dies, how much cover did it have from the bearing it was shot from,
against its mean over every bearing an attacker could really have fired from?
Lower means the attacker came round the cover.

| style | cover at the kill | mean over shootable bearings | reading |
|---|---|---|---|
| openfield | 0.0264 | 0.0503 | **−47 %, flanked** |
| bastion | 0.0556 | 0.0581 | −4 %, neutral |
| cavern | 0.0545 | 0.0396 | **+38 %, the reverse** |

So flanking shows clearly on open ground and not on the two walled styles.

**The bearing filter is what makes this measurable at all.** A first attempt
counted all sixteen bearings, including those facing a wall, which score no cover
and drag the mean down — and it invented a flanking result on exactly the styles
with the most walls. Restricted to bearings that are walkable with a clear line,
a victim exposes only **3.9 to 5.3 of 16**.

That is the likely reason, and it is only part of one: openfield offers the most
shootable bearings and flanks best, which fits, but cavern offers more than
bastion and flanks worse, which does not. `FLANK_TURNS` offers seven bearings and
skips any that is unwalkable or has no clear shot, so in a walled arena the search
is starved — but starvation does not explain a **reversal**. Cavern wants its own
look. **TBD**

## 8. Match flow (sequence)

1. Load the arena and the weapon set for the match.
2. Roll the spawn table for this match.
3. Show the pre-match screen: arena metrics, spawn table, scouting report.
4. The player sets tactics and roles.
5. Run round 1 (displayed or headless).
6. Save tactics and arena metrics to the adaptation record.
7. Show the round report. The player can change tactics.
8. Run round 2. Save to the adaptation record. Show the round report.
9. If the score is 1–1, run round 3. Save to the adaptation record.
10. Build the match report from events.
11. Apply progression: affinity, traits, nicknames, rivalries.
12. Show the progression results.
13. Advance the run.

---

## 9. Data file examples

### 9.1 Weapon archetype (`data/archetypes/precision.json`)

```json
{
  "id": "precision",
  "delivery": ["hitscan"],
  "damage": [60, 90],
  "fireIntervalTicks": [20, 30],
  "rangeMax": [40, 80],
  "aoeRadius": [0, 0],
  "critChance": [0.15, 0.30],
  "critConditions": ["targetStationary", "targetUnaware"],
  "ammoMax": [10, 20],
  "allowedTraits": ["piercing", "scoped", "overcharge"]
}
```

All values are TBD.

### 9.2 Bot trait (`data/bot-traits.json`)

```json
{
  "shellShocked": {
    "affinity": "areaDamageVictim",
    "threshold": 4,
    "behavior": { "avoidOpenRooms": 0.3 },
    "modifiers": { "areaDamageTaken": -0.20 }
  }
}
```

### 9.3 Arena profile (`data/arena-profiles/corridors.json`)

```json
{
  "id": "corridors",
  "fillMethod": "roomsAndCorridors",
  "roomCount": [8, 12],
  "roomSize": [5, 10],
  "corridorLength": [6, 14],
  "loopCountMin": 3,
  "coverDensity": [0.05, 0.10]
}
```

### 9.4 Team name grammar (`data/names/team-grammar.json`)

```json
{
  "patterns": {
    "team": [
      { "text": "The {adjective} {beastPlural}", "weight": 3, "theme": "beast" },
      { "text": "{corpPrefix} {corpSuffix} {color}", "weight": 2, "theme": "sponsor" },
      { "text": "{material} {collective}", "weight": 1, "theme": "collective" }
    ]
  },
  "tables": {
    "adjective":   ["Iron", "Hollow", "Crimson", "Silent", { "text": "Feral", "weight": 2 }],
    "beastPlural": ["Jackals", "Vipers", "Rooks", "Hounds"],
    "corpPrefix":  ["Kessler", "Vantor", "Orrin"],
    "corpSuffix":  ["Dynamics", "Industries", "Works"],
    "color":       ["Red", "Blue", "Black", "Gold"],
    "material":    ["Ash", "Slate", "Cinder"],
    "collective":  ["Collective", "Syndicate", "Chapter"]
  }
}
```

---

## 10. Testing and determinism

1. Write unit tests with `vitest` for each module with its milestone.
2. Add a determinism test: run the same match with the same seed two times. The event streams must be equal.
3. Add a round replay test: replay one round from its sub-seed. The events must be equal to the original round.
4. Add arena validation tests: generate 500 arenas per profile. All must pass validation or be rejected cleanly.
5. Add weapon budget tests: every generated weapon is inside the budget range.
6. Add a save round-trip test: save a snapshot, load it, compare.
7. Add name generator tests: generate 1,000 names per generator with a fixed seed. Check determinism, uniqueness, and blocklist rejection.
8. Add a boundary test: simulation modules do not import `render/`, `ui/`, or DOM types. (Use an ESLint import rule.)

---

## 11. Milestones

Each milestone has a goal and acceptance criteria. Complete one milestone before you start the next.

### M0 — Scaffolding and deployment

- Create the project with Vite and TypeScript (strict mode).
- Add `rot-js`, `zod`, `vitest`, `tsx`, and ESLint.
- Implement `core/rng.ts`, data loading with zod schemas, and the event bus.
- Add the GitHub Actions workflow that deploys to GitHub Pages.
- Accept: `npm test` passes. A test loads `tuning.json`. The GitHub Pages URL shows a placeholder page.

**M0 result (done).** Interfaces of this milestone:

| Module | Entry points |
|---|---|
| `core/rng.ts` | `createRngStreams(seed)`, `createRng(seed, label)`, `deriveSeed(seed, label)`, `RNG_STREAM_NAMES`. An `Rng` gives `next`, `int`, `float`, `bool`, `pick`, `shuffle`, `fork`, `getState`, `setState`. |
| `core/events.ts` | `EventBus` with `emit`, `on`, `onAny`, `off`, `filter`, `log`, `clearLog`, `reset`. `GAME_EVENT_TYPES` holds the types of Section 6.8. |
| `core/schemas.ts` | `TuningSchema`, type `Tuning`. |
| `core/data.ts` | `loadTuning()`, `parseData(file, schema, value)`, `clearDataCache()`, `DataValidationError`. |
| `core/types.ts` | `Cell`, `Vec2`. |

Notes:

- The `data` field of `GameEvent` is an open record. Each system sets the shape
  of its own event data at its milestone. The `Kill` context of Section 6.8
  arrives with M3.
- `eslint.config.js` and `tests/boundary.test.ts` check Section 4.1 (no browser
  API and no `render/`, `ui/`, or `main.ts` import in simulation code) and
  Section 3 (no `Math.random()`, no global `ROT.RNG`).
- The deploy workflow sets `BASE_PATH` to `/<repository name>/`, because GitHub
  Pages serves the project from a sub-path.

### M1 — Static arena and display

- Load a hand-made test arena from a text file.
- Show it with the rot.js display.
- Accept: the arena shows in the browser on desktop and on a phone.

**M1 result (done).** Interfaces of this milestone:

| Module | Entry points |
|---|---|
| `arena/types.ts` | `Tile`, `PickupPoint`, `PickupKind`, `ArenaMap`, and the helpers `cellIndex`, `inBounds`, `tileAt`, `isWalkable`. |
| `arena/textArena.ts` | `parseArenaText(text, options)`, `ArenaParseError`. |
| `arena/index.ts` | `loadTestArena()`, `clearArenaCache()`. |
| `render/display.ts` | `ArenaDisplay` with `draw`, `fit`, `setMap`, `destroy`. Browser only. **Replaced after M8 by the two-canvas stage of Section 7.18.** |
| `render/theme.ts` | `TILE_STYLES`, `PICKUP_STYLES`, `DISPLAY_BG`. All values TBD. **The colors moved to `render/neonThemes.ts`; only the facing glyphs are left.** |

Notes:

- `ArenaMap` holds the parts of `Arena` (Section 6.2) that a map file gives:
  `width`, `height`, `tiles`, `spawns`, and `pickups`, plus `name` and
  `source`. The generator of M7 adds `seed`, `profile`, `rooms`, `links`, and
  `metrics` on top of this type. The structure of Section 6.2 does not change.
- The test arena has 180-degree rotational symmetry (Section 7.2.1). The first
  version was not symmetric, and the batch results of M4 showed the fault.
- Map file format: an optional `key: value` header (`name`, `notes`), then a
  line with `---`, then the map. Glyphs: `#` wall, `.` floor, `,` low cover,
  `^` hazard, `S` spawn, and `W` `A` `H` `U` `M` for a weapon, armor, health,
  powerup, or ammo pickup. The parser gives each pickup a `slotId` of
  `<kind>:<index>` in row-major order.
- `PickupPoint.respawnTicks` is 0 for a map file. The respawn times arrive with
  M8 (Section 7.12). TBD
- The display calculates its font size from the size of its container, so one
  arena fits a desktop screen and a phone screen. The target grid size per
  device (Section 7.18) stays open until M7.

### M2 — Movement and navigation

- Add 6 bots (3v3) that move to random pickup points with A*.
- Add the fixed tick loop, `step(state)`, and speed controls.
- Accept: bots move without passing through walls. Speed controls work.

**M2 result (done).** Interfaces of this milestone:

| Module | Entry points |
|---|---|
| `ai/navigation.ts` | `findPath(map, from, to, options)`, `isStepLegal(map, a, b)`. |
| `sim/state.ts` | `SimState`, `BotState`, `SimConfig`, `createSimState(options)`, `simConfigFromTuning()`, `cellCenter`, `posCell`, `botCell`, `TEAM_IDS`. |
| `sim/movement.ts` | `advanceBot(state, bot)`. M3 changed the first parameter from the map to the state, because an enemy bot blocks movement. |
| `sim/round.ts` | `step(state)`, `stepMany(state, ticks)`. |
| `render/runner.ts` | `SimRunner` with `start`, `stop`, `setSpeed`, `stepOnce`. `SPEEDS`. Browser only. |
| `render/display.ts` | `setEntities(entities)` draws bots on top of the tiles. **Replaced after M8; `SimArenaView.bots()` gives the same list to the canvas stage.** |
| `ui/speedControls.ts` | `createSpeedControls(options)`. Browser only. |

Notes:

- A diagonal step needs both of its shared neighbours to be free. Without this
  rule A* cuts the corner of a wall. M2 repaired a corner cut after the search;
  M5 replaced the A* of rot.js with this project's own, which holds the rule
  inside the neighbour step.
- `BotState` holds only what movement needs: `id`, `teamId`, `pos`,
  `moveSpeedPerTick`, `path`, and `goalSlotId`. Health, weapons, and the score
  arrive with M3. The `Attributes` and `Tactics` of Sections 6.4 arrive with
  M3 and M4, and `BotState` then points at the `Bot` that holds them.
- Spawn rule of M2: the first `teamSize` spawn cells of the arena file belong
  to team A, and the next `teamSize` cells belong to team B. A fair split by
  distance arrives with the arena generator (M7).
- The goal of a bot in M2 is a random pickup point. This is a placeholder for
  the utility AI of M4. The bot selects it with the `sim` stream, so a seed
  gives the same movement every time.
- Speed controls: pause, 1×, 4×, and one step. "Skip to end of round" needs the
  round end condition of M3.
- The runner uses an accumulator, so the frame rate does not change the result
  of the simulation (Section 4.4).

### M3 — Perception and baseline combat

- Add FOV, one baseline hitscan weapon, damage, death, respawn.
- Add kill events and a simple kill feed.
- Add the round end condition.
- Accept: bots see and shoot each other. A round ends at a score limit. The determinism test passes.

**M3 result (done).** Interfaces of this milestone:

| Module | Entry points |
|---|---|
| `ai/perception.ts` | `updatePerception(state)`, `canSee(state, viewer, other)`, `isUnaware(state, attacker, target)`, `blocksSight(map, x, y)`. |
| `sim/combat.ts` | `tryFire(state, bot)`, `respawn(state, bot)`, `selectTarget(state, bot)`, `hitChance(state, shooter, target)`, `rangeBandOf(state, distance)`, `isInCover(state, bot)`. |
| `sim/round.ts` | `runRound(state)`, `checkRoundEnd(state)`, `RoundResult`. |
| `sim/state.ts` | `Attributes`, `RoundOutcome`, `defaultAttributes()`, `distanceBetween`, `enemyAt`, `teamSpawns`, `findBot`. |
| `weapons/types.ts` | `Weapon`, `Archetype`, `Delivery`, `RangeBand`, `DpsProfile`. |
| `core/data.ts` | `loadBaselineWeapon()`. |
| `core/cellSet.ts` | `CellSet`, a set of cell indices with no allocation. |
| `report/killFeed.ts` | `killFeedLine(event)`, `killFeedLines(events, limit)`. |
| `ui/speedControls.ts` | The options now hold `onSkip`, and the control gives `setEnabled`. |

Notes:

- **Perception cost.** The visible cell set depends only on the cell of the bot
  and on the walls, so perception calculates it again only after the bot
  changes cell. This made a round 4.9 times faster (1698 ms to 348 ms), and the
  results did not change. A system that makes a wall during a round must set
  `fovCell` of every bot to `null`.
- **Ammo.** M3 does not count ammo. The baseline weapon must stay a viable
  fallback (Section 7.3), and the ammo pickups arrive with M8.
- **"In cover"** in a `Kill` event means that the killer stands on a low cover
  tile. TBD
- **A draw.** `RoundOutcome.winnerTeamId` is `null` when the time limit ends a
  round with an equal score. Section 6.6 gives `winnerTeamId` the type
  `string`; the type is now `TeamId | null`.
- Low cover does not block sight. TBD
- The AI of M3 still moves to a random pickup point. It fires at the nearest
  visible enemy inside the weapon range, after its reaction time. The utility
  AI of M4 replaces this behavior.

### M4 — Utility AI and tactics

- Implement the utility AI with the starting action set.
- Connect the `Tactics` fields to action weights.
- Accept: a headless test shows different results for high and low aggression.

**M4 result (done).** Interfaces of this milestone:

| Module | Entry points |
|---|---|
| `ai/utility.ts` | `decide(state, bot)`, `scoreActions(state, bot)`, `applyAction(state, bot, action)`, `actionLabel(action)`, `bestWeaponAt(state, bot, distance)`, `bandDistance`, `healthFraction`, `noteReachedPickup`. Types `Action`, `ScoredAction`. |
| `ai/navigation.ts` | `findPath` takes `avoidHazard`. |
| `sim/round.ts` | `enterSuddenDeathIfNeeded(state)`. |
| `sim/state.ts` | `BotState` holds `tactics`, `action`, `actionScore`, `decisionCooldownTicks`, `weapons`, `spreeCount`, `visitedSlotIds`. `SimState` holds `suddenDeath` and `suddenDeathStartTick`. |
| `core/data.ts` | `loadDefaultTactics()`, `loadAnnouncements()`. |
| `report/killFeed.ts` | `announcementLine(event)`, `feedLines(events, limit)`, type `FeedLine`. |

Notes:

- `SimState` is the world view of `decide`. A narrower view can replace it when
  a system needs the AI without the full state.
- The role modifier (M8), the trait modifiers (M10), and the team modifier (M8)
  are hooks in `ai/utility.ts`. Each one gives 1 until its milestone.
- **What each tactic does, and what it costs:**

  | Tactic | Benefit | Cost |
  |---|---|---|
  | `aggression` | Raises `Engage` and `Chase`, and shortens the aim delay | The bot presses instead of walking to its best band, and it cannot heal in a fight |
  | `preferredRange` | `Reposition` holds the band of the weapon | The bot moves instead of firing |
  | `weaponRolePref` | A bias in the weapon choice, and a swap costs firing ticks, so the choice sticks | It can take a weapon with a lower DPS |
  | `itemControl` | Raises `SeekPickup` | The bot crosses the open arena |
  | `holdPosition` | Raises `HoldPosition`, lowers a `SeekPickup` that is far away | The bot takes no distant items |
  | `evasion` | The bot is harder to hit | It lowers the accuracy of the bot itself |
  | `hazardTolerance` | A short path through a hazard | A long path around it |
- `hazardTolerance` is a yes-or-no rule in M4: a bot below the threshold treats
  a hazard tile as a wall. The path cost `danger × (1 − hazardTolerance)` of
  Section 7.10 needs the influence maps of M8.
- `equipBestWeapon` reads the DPS profile of `bot.weapons`. It is a rule, not an
  action. A swap out of a fight is free, and a swap inside one costs
  `combat.weaponSwapTicks` of firing, so it must pay for itself
  (Section 7.20.17).
- `visitedSlotIds` makes a bot work a route over the pickup points. Without it
  the bot stops on the first point beside its spawn and the two teams never
  meet. M8 replaces the memory with the real respawn timers of Section 7.12.
- **Finding for M5 and M7 (now fixed):** with the same tactics on both teams,
  the south-east spawn group of the first test arena won 68 % of 60 rounds. The
  arena is now symmetric, and two faults of the simulation are fixed with it.
  Section 7.2.1 holds the full record and the rules that follow from it.
- **Finding for the tuning:** the classic spree counts (5, 10, 15, 20, 25) never
  happen in a 3v3 round that ends at 15 team kills. The counts are now 3, 5, 7,
  9, and 12, and the classic words stay. Over 15 rounds the game now announces
  43 multi-kills, 33 sprees, and 30 ends of a spree.

### M5 — Headless batch harness

- Run rounds in Node with no display.
- Output a simple win-rate table and a CSV file.
- Accept: 1,000 rounds run headless. The table shows in the terminal.

**M5 result (done).** Interfaces of this milestone:

| Module | Entry points |
|---|---|
| `cli/batch.ts` | `npm run batch -- [--config file] [--rounds n] [--seed n] [--out dir] [--quiet]`. Node only. |
| `report/batchRunner.ts` | `planRounds(options)`, `runPlannedRound(round, presets, config)`, `runBatch(options)`. |
| `report/batchStats.ts` | `summarize(records, options)`, `winRate(record)`, `standardError(record)`. Types `RoundRecord`, `BatchSummary`, `WinRecord`. |
| `report/batchTables.ts` | `formatReport(summary)`, `roundsCsv(records)`, `matchupsCsv(summary)`, `presetsCsv(summary)`. |
| `core/schemas.ts` | `BatchConfigSchema`, type `BatchConfig`. |
| `ai/navigation.ts` | The A* is now this project's own. The public interface did not change. |

Notes:

- **A stand-in for a doctrine and for an arena profile.** A doctrine
  (Section 6.5) arrives with M11, and an arena profile (Section 7.2) arrives
  with M7. The harness uses a named tactics preset and the name of an arena
  file in their place. The matrix and the CSV columns keep the same shape, so
  M7 and M11 only change what fills them.
- **Every matchup runs in both directions.** Each preset plays as team A and as
  team B against every preset, itself included. This cancels any side advantage
  that is left over, and the mirror matchup (a preset against itself) must give
  50 %, which is a check on the arena and on the simulation.
- **The seed of a round** comes from the batch seed and the name of the
  matchup, so the result of a round does not depend on the order of the rounds.
  A test runs a batch forwards and backwards and compares the records.
- **Every win rate carries its standard error**, per Section 7.2.1.
- The batch writes `rounds.csv` (one row per round), `matchups.csv`, and
  `presets.csv` into the output folder.
- The report names what it cannot measure yet: the trait distribution (M10),
  the match length (M8), and the run duration (M11).
- With `--fail-on-balance` the CLI ends with a non-zero exit code when it finds
  a balance failure, so a workflow can use it as a gate. The report is the
  product, so the gate is off by default.

**Speed.** The harness must run thousands of rounds, so two changes came with
this milestone:

| Change | Effect |
|---|---|
| This project's own A* with a binary heap, typed arrays, and a generation stamp, in place of the A* of rot.js | One path across the test arena: 1.83 ms to 0.19 ms |
| A bot keeps its path when its goal cell did not change | One round: 496 ms to about 200 ms |

The A* of rot.js keeps its open list in a plain array and searches it in a
straight line. The new one also holds the diagonal corner rule inside the
neighbour step, so the repair step of M2 is gone, and it takes a cost per cell,
which the influence maps of M8 need. A test compares its result with an
independent search, so the path stays the shortest one.

**The first batch: 1000 rounds, 4 presets, 1 arena, 192 s.**

| Preset | Win rate | `holdPosition` | `aggression` |
|---|---|---|---|
| anchor | 81.1 % ±1.7 | 0.8 | 0.5 |
| aggressive | 55.4 % ±2.2 | 0.1 | 0.9 |
| balanced | 44.2 % ±2.2 | 0.2 | 0.5 |
| cautious | 19.1 % ±1.8 | 0.3 | 0.2 |

What the first batch says:

1. **The mirror matchups are even.** A preset against itself gives 54.0 %,
   50.0 %, 48.4 %, and 49.2 %, each with a standard error of 6.3 %. The arena
   and the tick order are therefore fair, and the win rates above measure the
   tactics. Keep this check in every batch.
2. **`holdPosition` is too strong.** The `anchor` preset beats `aggressive`
   100 % of the time and `balanced` 98.4 % of the time. A bot that holds a
   sightline shoots a bot that crosses open ground. Team deathmatch gives the
   moving team nothing in return. This is a balance failure under the rule of
   this section. It is a tuning question for the AI weights (M4) and for the
   counters that arrive with the influence maps and the roles (M8), not a
   fault of the harness.
3. **A passive preset stalls the round.** 22.5 % of rounds reached the time
   limit, and 139 rounds made fewer than half the score limit in kills. A bot
   that retreats does not fire, and no bot can heal before the pickups of M8,
   so a damaged bot leaves the round. Read this together with point 2: the
   same rule that makes holding strong makes a round slow.

Do not tune these numbers before M6 and M8 change them again. The value of the
batch here is the method and the numbers to compare against later.

**M8 answered both.** The pickups gave the moving team something to win, and
`anchor` fell from 81.1 % to 41.9 %, with 98.1 % of rounds reaching the score
limit. Section 7.20.13 holds the numbers.

**After this batch** the `cautious` preset was removed from `data/batch.json`.
It won 19.1 % and it stalled rounds. The default presets are `balanced`,
`aggressive`, and `anchor`. Section 7.20 holds the design that answers the two
failures above.

### M5.5 — Directional vision (done)

Built on its own, before M6, so that the batch could say what it changed.

- A facing, a focus arc, a peripheral arc with a delay, and a turn rate
  (Section 7.20.6). The `awareness` attribute of Section 6.4 sets the width of
  the peripheral arc, and it has its first use.
- A bot that takes damage learns where the shot came from.
- The display shows the facing of a bot with an arrow.
- The batch harness now reports the share of kills on a target that could not
  see its killer, which measures a flank.
- `perception.directionalVision` turns the whole change on and off. It is off,
  because the measurement says that it moves nothing today.
- Accept: the batch runs and the measurement is recorded. **The measurement
  says that the change moved nothing** (Section 7.20.10).

### M6 — Weapon generation

Section 7.20 holds the design of this milestone. Read it first, and read
Section 7.20.10: the batch shows that weapons alone cannot bring the `anchor`
preset to 50 %, because a pickup point gives nothing until M8.

- Implement the role traits, the seven attack types, the power budget, and the
  DPS profiles. Derive the archetype label (Section 7.20.2 to 7.20.4).
- Add projectile, area damage, DoT, hazard, and crit conditions.
- Add the crit against a target that stands still and the dodge for a target
  that moves (Section 7.20.5).
- Give each weapon a reaction per range band, and make the bots act in the
  order of their reaction speed (Section 7.20.7).
- Connect AI weapon selection to DPS profiles.
- Accept: weapon budget tests pass. Bots switch weapons by range. The mirror
  matchups stay at 50 %, and the `anchor` win rate falls (Section 7.20.9). It
  cannot reach 50 % before the pickups of M8.

**M6 result (done).** Interfaces of this milestone:

| Module | Entry points |
|---|---|
| `weapons/types.ts` | `RoleTrait`, `AttackType`, `Archetype`, `BandValues`, `Weapon`, `isProjectileType`, `bandOfDistance`. |
| `weapons/generate.ts` | `generateWeaponSet(rng, count, options)`, `generateWeapon(rng, role, index, options)`, `archetypeOf(role, attackType)`, `costOf`, `fixedCost`, `dpsProfileOf`. |
| `sim/damage.ts` | `damageBot(state, attacker, target, amount, context)`, `applyDot`, `rangeBandOf`, `isInCover`. Every source of damage ends here. |
| `sim/attacks.ts` | `applyAreaDamage`, `applyConeDamage`, `applyLineDamage`, `spawnProjectile`, `updateProjectiles`, `createHazard`, `applyHazards`, `applyDots`, `clearLine`. |
| `sim/combat.ts` | `effectiveReaction(bot, band)`, `currentBand`, `dodgeOf`, `critConditionMet`, plus the earlier entry points. |
| `sim/state.ts` | `botsInTickOrder` now sorts by reaction speed. `Projectile`, `HazardCell`, `DotEffect`. |
| `core/data.ts` | `loadWeaponRoles()`. |

Notes:

- **Section 6.3 changed.** `delivery` is now `attackType` with seven values.
  The weapon carries `role`, `reactionByBand`, `coneHalfAngle`,
  `ricochetBounces`, `hazardRadius`, and `hazardDamagePerTick`. The archetype
  list lost `burst` (it is an attack type now) and gained `assault`,
  `marksman`, and `heavy`.
- **Section 7.3 changed.** The generator rolls a role trait and an attack type
  and derives the archetype at the end (Section 7.20.4). The damage is solved,
  not rolled: the generator picks the damage that puts the cost on the budget
  target, and it rejects a draft whose damage would fall outside the range of
  its role.
- **The DPS profile is the expected damage.** It holds the area, the pierce of
  a line, the damage over time, the hazard tiles, and how often the attack type
  lands. The budget prices the same number, so the budget and the AI agree.
  Section 7.20.11 says what happens when they do not.
- **Every bot holds every weapon of the run.** This is a stand-in so that the
  AI can select by DPS profile at all. The pickups of M8 decide who holds what.
- **Ammo is counted** (Section 7.20.12). A shot spends a round, and an empty
  weapon drops the bot back to the baseline, which never runs dry. The ammo
  pickups of M8 refill the rest.
- **A weapon has a tier.** A run holds one `prize`, one `strong`, and the rest
  `standard`, so it has a clear ranking.
- The measurement is in Sections 7.20.11 and 7.20.12. `anchor` fell from
  82.0 % to 69.1 %, and the highest archetype kill share fell from 80 % to 22 %
  once the budget traded range, magazine, and cadence and not damage alone.

The advanced tactics layer (Section 7.20.8) is designed but not scheduled. The
field of view (Section 7.20.6) is built and switched off; see M5.5.

### M7 — Arena generation

- Decide the arena size for desktop and phone.
- Implement the macro graph, both fill methods, loop addition, metrics, validation, and pickup placement.
- Accept: arena validation tests pass. The pre-match screen shows metrics.
- Accept: **every generated arena passes `checkArenaFairness`** (Section 7.2.1
  and Section 7.20.17). A power-up point and at least one weapon point sit in a
  conflict zone, and every pickup point has a partner of its own kind. An arena
  that breaks these gives one team a free run at the items that decide the
  round, and every measurement taken on it carries that bias.
- Watch: the band shares of `data/weapon-roles.json` are measured on one
  hand-made arena. A larger generated arena fires at other distances, and the
  power budget reads those shares, so measure them again and re-tune
  `value.bandShare` and `budget.rangeValueCapCells`.

**Result: the first pass is built.** Three styles generate, each with its own
algorithm and its own shape of fight: `bastion` fights at 8.4 cells, `cavern` at
10.6, `openfield` at 11.4 with five times the long-range share of the hand-made
arena. Every style passes `checkArenaFairness` and the metric rules, and the
side bias stays near even. Section 7.20.19 holds the measurements.

New files: `arena/generate.ts`, `arena/metrics.ts`, `data/arena-profiles.json`,
`cli/arena.ts` (`npm run arena`). The batch harness takes `gen:<style>:<seed>`
as an arena, so a style can be measured in play and not only on paper.

**What is left of M7.** The macro graph of step 1 is not built: only `bastion`
has rooms, and `ArenaMap` carries no `rooms` or `links`. The generator uses the
distance from the two spawn groups in place of betweenness centrality for step
5, and Sections 7.9 and 7.11 still treat one cell as one area. The pre-match
screen does not show the metrics yet, though `describeArena` writes them in
plain words and the CLI prints them.

### M8 — Teams, roles, matches, and pickups

- Add TDM rules, team tactics, and the three roles.
- Add best-of-3 matches with round resets and the between-round tactics screen.
- Add pickups with respawn timers and one spawn table per match.
- Add influence maps.
- Accept: a full best-of-3 match plays in the browser. The batch harness shows different results by role composition.

**Result: done.** `npm run dev` plays a best-of-3 match: the tactics screen
opens between the rounds and sets the tactics and the roles of team A. The
batch reports a win rate per role composition, and `standard` beats `turtle`
60.8 % ±4.5 in their matchup.

New files: `sim/pickups.ts`, `sim/match.ts`, `ai/influence.ts`,
`arena/spawnOrder.ts`, `ui/tacticsScreen.ts`, `data/pickups.json`,
`data/roles.json`.

Section 7.20.13 holds the measurement and the two AI faults that the pickups
found. Section 7.20.14 holds the spawn order fault: a symmetric arena is not a
fair match, and an M7 generator must pair the slots of the teams, not only the
shape of the halves.

**What M8 takes from M7, and what stands in for it.** `ArenaMap` has no rooms,
no links, and no metrics until M7, so three parts of M8 work on the raw grid
instead of the macro graph:

- Section 7.2 step 5 places pickups on contested cells by betweenness
  centrality. The test arena places them by hand, symmetrically.
- Section 7.9 says that `control` is "which team holds each area". An area is a
  cell here. When M7 gives the arena its rooms, a room value is the mean of its
  cells.
- Section 7.11 describes the roles in terms of areas, of "a sightline over a
  contested pickup", and of side routes. `positionValue` measures the same idea
  on the grid: a cell is worth holding when a pickup point is near it, when the
  team holds the ground around it, and when it is not itself dangerous.

None of these blocks M8. Each one is a place to read again after M7.

### M9 — Reports

- Add the round report, match report, death heatmap, and bot stat cards.
- Accept: a player can see why a team lost a round (deaths by area, damage by archetype).

### M10 — Progression and rivalry

- Add affinity, traits, and nicknames (with a simple placeholder nickname table).
- Add the rivalry log and rivalry progression effects.
- Accept: over a full run of batch matches, bots gain traits that match their events. The batch harness reports trait distribution.

### M11 — Run structure and names

- Add the team name input, run generation, opponent doctrines, pre-match screen, and run flow.
- Add the adaptation record.
- Add the name generator (Section 7.19) for teams, bots, and nicknames.
- Add run duration to the batch harness output.
- Accept: a full run plays from start to end. All teams and bots have generated names.

### M12 — Saves and championship roster

- Add snapshots, schema versioning, `localStorage` saves, and JSON export and import.
- Add the roster and championship mode.
- Add champion adaptation by nearest arena.
- Accept: the save round-trip test passes. An exported team imports on a different device. A championship match runs against a saved champion team.

---

## 12. Future work (not in scope)

- CTF and Domination modes.
- Meta-progression.
- Weapon alt-fire.
- Verticality substitutes.
- Extended rivalry features: scouting intel, off-screen tournament events, barks with memory.
- Shared teams between players.
- Bot transfers between teams.
- Procedural soundtrack with Strudel (low priority). See Section 12.1.

### 12.1 Procedural soundtrack (future, low priority)

Start this work only after the base engine is complete (after Milestone M12).

**Purpose.** Generate the soundtrack with Strudel (`@strudel/web`). The music responds partly to match events.

**Architecture rules:**

1. The music system is a browser-only module (`src/audio/`). It reads the event stream. It never changes the simulation.
2. The simulation, the batch harness, and the tests must work with no audio module.
3. Events do not control the music directly. A **music state** collects events and changes slowly. This stops the music from reacting to every shot.

**Music state (starting set, TBD):**

| Value | Inputs | Musical effect (example) |
|---|---|---|
| Intensity | Kills, damage, and fights in a recent time window | Density of drums and patterns |
| Tension | Score difference, round number, time remaining | Filter, harmony, tempo changes |
| Momentum | Which team leads, and recent kill streaks | Major or minor mode, brighter or darker sounds |
| Phase | Pre-match, round, between rounds, match point, match end | Selects a pattern set |

**Pattern generation:**

- Generate a base pattern per run or per arena from the `audio` RNG stream (add it to Section 7.1).
- The music state changes pattern parameters, not the full pattern.
- Arena profile can select the style (for example, closed arenas use darker sounds).

**Risks to check before implementation:**

- **License.** Strudel uses the AGPL-3.0 license. If the game includes Strudel, the game code must use a compatible license, and the source code must be available to players. Check this before you start.
- **Browser audio rules.** Browsers do not start audio before a user action. Start audio from a button (for example, "Start match" or a sound toggle).
- **Samples.** Strudel can load sample packs from remote URLs. For reliable play, use synthesized sounds, or include the samples with the game.
- **Simulation speed.** At 4× speed or "skip", the music must not speed up. The music follows the music state, not the tick rate.
- **Performance on phones.** Test on a phone. Add a setting to turn music off.

---

## 13. Instructions for Claude Code

1. Follow the milestone order in Section 11.
2. Before each milestone, list the files that you will create or change.
3. Write tests with the code, not after.
4. Keep simulation modules free of browser APIs, `render/`, and `ui/` imports.
5. Use the RNG streams. Do not use `Math.random()` or the global `ROT.RNG`.
6. Put tunable numbers in `data/`. Mark placeholder values with `// TBD`.
7. Do not implement features from Section 2.3 or Section 12.
8. If a design question is not answered in this document, stop and ask. Do not guess.
9. After each milestone, update this document if a structure or interface changed.
