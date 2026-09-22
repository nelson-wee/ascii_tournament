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
│   ├── archetypes/*.json          # weapon archetypes
│   ├── weapons/*.json             # fixed weapons (the M3 baseline weapon)
│   ├── tactics.json               # tactics presets
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
│   ├── render/                    # rot.js display, speed control (browser only)
│   ├── ui/                        # screens and menus (browser only)
│   ├── main.ts                    # browser entry point
│   └── cli/
│       └── batch.ts               # Node entry point for the batch harness
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
  retreatThreshold: number;
  preferredRange: "close" | "mid" | "long";
  weaponRolePref: Archetype | null;
  itemControl: number;
  holdPosition: number;       // 0 = roam, 1 = hold
  evasion: number;
  hazardTolerance: number;
}

type Role = "overwatch" | "tank" | "skirmisher";

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

### 7.3 Weapon generation (`weapons/`)

Purpose: generate readable procedural weapons with clear roles.

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

- Hitscan: check line of sight at fire time. Roll hit from accuracy, distance, and target movement.
- Projectile: move each tick at `projectileSpeed`. Check collision with walls and bots.
- Area damage: apply damage in `aoeRadius`. Walls block area damage.
- DoT: apply per tick to the target.
- Hazard: create hazard tiles for `hazardTicks`.
- Crit: roll only if a crit condition is true.
- Trait modifiers apply here (for example, `shellShocked` reduces area damage taken).

### 7.7 Perception (`ai/perception.ts`)

- Use rot.js `FOV.PreciseShadowcasting`.
- Each bot has a list of visible enemies and a short memory of last-seen positions.
- "Target unaware" is true if the target cannot see the attacker.

### 7.8 Utility AI (`ai/utility.ts`)

Purpose: select actions from scores. Player parameters are weights on the scores.

Entry point: `decide(bot, worldView): Action`

Actions (starting set):

- `Engage(target)`
- `Chase(target)`
- `Retreat`
- `SeekPickup(pickup)`
- `HoldPosition(cell)`
- `Reposition(rangeBand)`
- `SwitchWeapon(weapon)`
- `Follow(teammate)` (cohesion)

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
- **Tactics are orders. Traits are tendencies.** Tactics weights are the main factor. Trait modifiers are small multipliers.
- **Each tactic has a cost and a benefit.** Do not add a tactic that has only a benefit.
- A bot keeps its current action unless a new action scores higher by a margin (hysteresis). This stops fast changes of decision.

### 7.9 Influence maps (`ai/influence.ts`)

- `danger`: from enemy sightlines, hazard tiles, and recent deaths.
- `control`: which team holds each area.
- Update every N ticks (TBD).
- The hazard tolerance tactic controls how much a bot avoids `danger`.

### 7.10 Navigation (`ai/navigation.ts`)

- Use rot.js `Path.AStar` on the tile grid.
- Path cost includes `danger × (1 − hazardTolerance)`. If rot.js A* cannot use weighted costs in the needed way, write a small A* with weights.
- Cache distance fields to pickups (Dijkstra maps) per arena.

### 7.11 Roles (`data/roles.json`)

Each role has a tactics preset and role behaviors.

| Role | Tactics preset | Role behaviors |
|---|---|---|
| Overwatch | Long range, hold position, precision preference | Holds a sightline over a contested pickup |
| Tank | High aggression, high retreat threshold, item control | Takes armor first. Leads pushes into rooms. Holds an area and its pickups (Anchor) |
| Skirmisher | Mid range, evasion, versatile preference, roam | Follows the team. Trades kills. Uses side routes to attack engaged enemies (Flanker) |

The player can change the tactics after the role applies its preset.

### 7.12 Pickups (`sim/pickups.ts`)

- Each pickup point has a respawn timer.
- Entry point: `rollSpawnTable(arena, weapons, rng): SpawnTable`
- The game rolls one spawn table per match. The table does not change between rounds.
- The next match can have a new spawn table (the same arena or a different arena).
- The pre-match screen shows the spawn table.

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
| reckless | deaths at low health in fights | ignores retreat threshold | +damage at low health |
| timid | deaths soon after engaging | retreats early | +evasion |
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

### 7.17 Reports and kill feed (`report/`)

- Kill feed lines from event templates (for example, "Vex killed Rook with a precision weapon at long range").
- Kill announcements from `data/announcements.json`: a multi-kill (Double Kill, Multi Kill, Mega Kill, Ultra Kill, Monster Kill), a killing spree (Killing Spree, Rampage, Dominating, Unstoppable, Godlike), and the end of a spree. The counts are lower than the classic ones, because a 3v3 round ends at 15 team kills.
- Round report (between rounds): score, kills, deaths, damage by archetype, death heatmap (ASCII).
- Match report: all round data, pickup control time, progression results.
- Bot stat card: role, traits, affinities, rivalries, nickname.
- Run history: when each trait arrived and why.

### 7.18 Display (`render/`)

- rot.js `Display` on a canvas.
- Arena on one screen. Target size TBD: approximately 100×40 for desktop, approximately 60×30 for phones in landscape. Decide before Milestone M7.
- Team colors. Short projectile trails. Flash on the hitscan target cell.
- Side panel: kill feed, score, round number, timer.
- Speed controls: pause, 1×, 4×, skip to end of round.
- Touch-friendly controls for phones.
- Debug views (toggle): danger map, control map, bot decisions.

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

---

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
| `render/display.ts` | `ArenaDisplay` with `draw`, `fit`, `setMap`, `destroy`. Browser only. |
| `render/theme.ts` | `TILE_STYLES`, `PICKUP_STYLES`, `DISPLAY_BG`. All values TBD. |

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
| `render/display.ts` | `setEntities(entities)` draws bots on top of the tiles. |
| `ui/speedControls.ts` | `createSpeedControls(options)`. Browser only. |

Notes:

- A diagonal step needs both of its shared neighbours to be free. Without this
  rule A* cuts the corner of a wall. `findPath` repairs a corner cut with one
  cardinal detour cell, and it falls back to a cardinal path (topology 4) if a
  diagonal gap has no free neighbour.
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
  | `aggression` | Raises `Engage` and `Chase` | Lowers `Retreat`, so the bot fights at low health |
  | `retreatThreshold` | The bot leaves a lost fight | It gives ground and makes no kills |
  | `preferredRange` | `Reposition` holds the band of the weapon | The bot moves instead of firing |
  | `weaponRolePref` | A bias in the weapon choice | It can take a weapon with a lower DPS |
  | `itemControl` | Raises `SeekPickup` | The bot crosses the open arena |
  | `holdPosition` | Raises `HoldPosition`, lowers `SeekPickup` and `Follow` | The bot takes no items |
  | `evasion` | The bot is harder to hit | It lowers the accuracy of the bot itself |
  | `hazardTolerance` | A short path through a hazard | A long path around it |

- A bot that retreats does not fire. This gives the aggression tactic a real
  cost. TBD
- `hazardTolerance` is a yes-or-no rule in M4: a bot below the threshold treats
  a hazard tile as a wall. The path cost `danger × (1 − hazardTolerance)` of
  Section 7.10 needs the influence maps of M8.
- `SwitchWeapon` reads the DPS profile of `bot.weapons`. M4 gives every bot one
  baseline weapon, so the action never wins. M6 and M8 fill the list.
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

### M6 — Weapon generation

- Implement archetypes, budget, weapon traits, and DPS profiles.
- Add projectile, area damage, DoT, hazard, and crit conditions.
- Connect AI weapon selection to DPS profiles.
- Accept: weapon budget tests pass. Bots switch weapons by range.

### M7 — Arena generation

- Decide the arena size for desktop and phone.
- Implement the macro graph, both fill methods, loop addition, metrics, validation, and pickup placement.
- Accept: arena validation tests pass. The pre-match screen shows metrics.

### M8 — Teams, roles, matches, and pickups

- Add TDM rules, team tactics, and the three roles.
- Add best-of-3 matches with round resets and the between-round tactics screen.
- Add pickups with respawn timers and one spawn table per match.
- Add influence maps.
- Accept: a full best-of-3 match plays in the browser. The batch harness shows different results by role composition.

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
