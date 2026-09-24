# What the ground changes: a batch of every arena style

This is a measurement, not a design. It reports what the engine does now, on
**7290 rounds** over the three arena styles of dev-guide Section 7.20.19, and
it names the defects that the numbers show. It changes no game value.

A second batch of **6480 rounds** sweeps one tactic at a time, so the
measurements below rest on 13770 rounds in all.

## The short answer

| Question | What 13770 rounds say |
|---|---|
| Does the ground change the fight? | Yes. 2.8 cells of kill distance and 22 points of close-range share. |
| Does it change which tactic wins? | Yes, by about 7 points. `aggressive` owns `bastion`; `balanced` owns the other two. |
| Which tactic is the strongest? | A mid-range preference, on every style. A close preference costs 9 to 11 points, and nothing on `cavern`. |
| Does naming a weapon help? | No. Every weapon preference is level with or below no preference, on every style. |
| Does the role mix matter? | More than the ground. `rush` beats `turtle` by 7 to 14 points on every style. |
| Which weapon is the best? | `denial`, by 2.7 times, and its share of the kills hides it. |
| Does any weapon answer the ground? | Only `splash`. The rest are flat, and Section 8.1 says why. |
| Is the engine fair to both sides? | No. Team B wins 53.1 % of all rounds. |

## 0. How to run it again

```
npm run styles -- --rounds 2430 --arenas 3 --seed 20260924 --out batch-out/styles
npm run styles -- --config data/batch-tactics.json --rounds 2160 --arenas 3 \
                  --seed 20260924 --out batch-out/tactics
```

| Setting | Value |
|---|---|
| Rounds per style | 2430 (main batch), 2160 (tactics sweep) |
| Rounds in all | 7290 + 6480 = 13770 |
| Arenas per style | 3, from sub-seeds of the batch seed |
| Seed | 20260924 |
| Presets, main batch | `balanced`, `aggressive`, `anchor` of `data/batch.json` |
| Presets, sweep | six of `data/batch-tactics.json`, one tactic moved at a time |
| Role mixes, main batch | `standard`, `rush`, `turtle` of `data/batch.json` |
| Role mixes, sweep | `standard` alone |
| Weapons | A new set of 5 per round, from the weapons stream |

Every preset plays every other preset, and every role mix plays every other
role mix, on each arena, as team A and as team B. A win rate in this document
is therefore free of any side bias, because a preset holds both sides equally
often. Section 7 is the exception: it measures the side bias itself.

**One arena is one roll of the generator**, so each style is measured over
three arenas. The round count is a whole number of passes over the plan, or the
first cells of the plan would get one round more than the last.

The standard error of a win rate is 50/√n, so a preset over 1620 rounds is
±1.2 points, a preset of the sweep over 720 rounds is ±1.9, and a preset with a
role mix over 540 rounds is ±2.2. A difference between two cells carries about
1.4 times the error of one cell, so two cells of the sweep have to differ by
more than about 5 points before the difference is real.

---

## 1. The ground that the generator built

| Style | Floor | Cover | Chokepoints | Mean sightline | 90th sightline |
|---|---:|---:|---:|---:|---:|
| bastion | 40.5 % | 11.6 % | 19 | 14.6 | 38.7 |
| openfield | 73.0 % | 6.8 % | 0 | 26.8 | 41.7 |
| cavern | 57.2 % | 9.8 % | 17 | 14.2 | 21.3 |

The three styles are three different problems, and the numbers say so:

- **bastion** is tight ground with long lanes in it. Its mean sightline is the
  same as `cavern`, but its 90th percentile is 38.7, almost the 41.7 of
  `openfield`. A corridor of a bastion is as long as a lane of an open field.
- **openfield** has no chokepoint at all. Nothing in it can be held.
- **cavern** is the only style with no long lane: its 90th percentile is 21.3.
  It is tight ground everywhere, not tight ground with lanes.

## 2. The fight that each style makes

| Style | Mean ticks | Kills | Kill distance | Close | Mid | Long | From behind | Hits per shot |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bastion | 2812 | 24.8 | 8.5 | 56.8 % | 41.8 % | 1.4 % | 9.7 % | 1.25 |
| openfield | 2416 | 24.5 | 11.3 | 34.7 % | 60.0 % | 5.3 % | 8.5 % | 1.13 |
| cavern | 2423 | 25.2 | 9.6 | 46.2 % | 52.7 % | 1.1 % | 6.6 % | 1.19 |

The ground moves the fight by **2.8 cells**, from 8.5 on `bastion` to 11.3 on
`openfield`. It moves the close-range share by **22 points**. That is the
generator doing its job.

Two other numbers follow from the shape of the ground:

- **`bastion` is the slowest style** (2812 ticks against 2416) and it reaches
  the time limit in 12.8 % of rounds, against 3.4 % on `cavern`. Its 19
  chokepoints are what make it slow: a bot that wants a fight has to find a
  door.
- **`bastion` gives the most kills from behind** (9.7 % against 6.6 %). A
  corner is what a flank needs.

**How a round ends**

| Style | Score limit | Time limit | Sudden death |
|---|---:|---:|---:|
| bastion | 85.2 % | 12.8 % | 2.1 % |
| openfield | 89.4 % | 9.0 % | 1.6 % |
| cavern | 96.1 % | 3.4 % | 0.5 % |

## 3. Tactics

| Preset | bastion | openfield | cavern |
|---|---:|---:|---:|
| `aggressive` | **54.6** ±1.2 | 47.3 ±1.2 | 49.3 ±1.2 |
| `balanced` | 52.4 ±1.2 | **58.0** ±1.2 | **57.4** ±1.2 |
| `anchor` | 43.0 ±1.2 | 44.7 ±1.2 | 43.3 ±1.2 |

**The ground changes which tactic wins.** `aggressive` is the best preset on
`bastion` and it loses **7.3 points** when the ground opens. `balanced` does
the opposite and gains 5.6 points. The two cross over between the styles, which
is what a set of arena styles is for: no preset is the answer to every arena.

A preset moves seven tactics at once, so this table cannot say which of the
seven did it. Section 3.1 takes them one at a time, and the answer is not the
one that the vector suggests.

**`anchor` is not a tactic, it is a handicap.** It wins 43.0, 44.7 and 43.3 on
the three styles: it is the worst preset everywhere, and the ground does not
change that. It is not a style-dependent preset with a home arena; it has no
home arena. See Section 8.

### 3.1 One tactic at a time

A preset moves seven tactics at once, so it cannot say which one did the work.
The second batch (`data/batch-tactics.json`) holds every tactic at the
`balanced` value and moves one. `rangeMid` **is** `balanced`, so it is the
control of both groups. One role mix only, so nothing is confounded with
Section 4.

| Preset | What it moves | bastion | openfield | cavern |
|---|---|---:|---:|---:|
| `rangeMid` | control | **53.9** ±1.9 | **52.4** ±1.9 | 51.0 ±1.9 |
| `rangeLong` | `preferredRange: long` | 50.8 ±1.9 | 49.9 ±1.9 | 51.1 ±1.9 |
| `rangeClose` | `preferredRange: close` | **45.1** ±1.9 | **41.5** ±1.8 | 51.1 ±1.9 |
| `prefMarksman` | `weaponRolePref: marksman` | 51.8 ±1.9 | 51.9 ±1.9 | 48.8 ±1.9 |
| `prefHeavy` | `weaponRolePref: heavy` | 49.2 ±1.9 | 54.2 ±1.9 | 47.9 ±1.9 |
| `prefAssault` | `weaponRolePref: assault` | 49.2 ±1.9 | 50.1 ±1.9 | 50.1 ±1.9 |

**A close preference is a cost, and `cavern` is the one place it is free.** It
loses 8.8 points against the control on `bastion` and 10.9 on `openfield`, and
nothing on `cavern` (51.1 against 51.0). Those are the only two differences in
the whole sweep that pass the error. `cavern` is the style with no long lane at
all (Section 1), so a bot that walks in never crosses open ground to do it; the
three range preferences sit within a point of each other there.

This corrects the easy reading of Section 3. `aggressive` wins `bastion`
**in spite of** its close preference, not because of it: hold everything else
at the `balanced` value and the close preference alone costs 8.8 points there.
What `aggressive` wins with is the rest of its vector — `aggression: 0.9`,
which buys a shorter reaction, and `holdPosition: 0.1`.

**Naming a weapon pays nothing.** No weapon preference beats the control on any
style. Six of the nine cells sit below it, and the three preferences pool to
50.3 % against 52.4 % for the control, a cost of 2.1 points ±1.2. That is 1.7
standard errors: it is a lean, not a proof. What the sweep does show is that
naming a weapon **does not help on any style**, and a player who names one is
not buying anything. Section 8.5 says what `weaponRolePrefBonus` may be doing.

**The sweep is its own check on Section 2.** It holds fewer close-preferring
bots than the main batch, and the fight moves the way it should: the
close-range share falls from 56.8 % to 53.3 % on `bastion` and from 34.7 % to
28.3 % on `openfield`, and the mean kill distance rises from 11.3 to 11.9 cells
on `openfield`. The tactics move the fight in the same direction as the ground,
and by less.

## 4. The mix of roles

| Role mix | Bots | bastion | openfield | cavern |
|---|---|---:|---:|---:|
| `rush` | skirmisher, skirmisher, tank | **53.4** ±1.2 | **54.0** ±1.2 | **57.4** ±1.2 |
| `standard` | tank, overwatch, skirmisher | 50.4 ±1.2 | 50.5 ±1.2 | 49.0 ±1.2 |
| `turtle` | overwatch, overwatch, tank | 46.2 ±1.2 | 45.6 ±1.2 | 43.6 ±1.2 |

**The role mix matters more than the ground does.** `rush` beats `turtle` by
7.2, 8.4 and 13.8 points on the three styles, and the order never changes. The
mix that holds two Overwatch bots loses on every style, and the mix that holds
none wins on every style.

The per-bot numbers say the same thing, and they say it is the role and not the
mix. A mix can hold one role twice, so the count is divided by the bot-rounds
of that role:

| Role | bastion kills/bot | k/d | openfield kills/bot | k/d | cavern kills/bot | k/d |
|---|---:|---:|---:|---:|---:|---:|
| tank | 4.37 | 1.05 | 4.36 | 1.05 | 4.33 | 1.01 |
| skirmisher | 4.19 | 1.02 | 4.22 | 1.03 | 4.34 | 1.05 |
| overwatch | 3.82 | 0.93 | 3.69 | 0.91 | 3.95 | 0.94 |

Overwatch is the only role that dies more often than it kills, on every style,
and it is the only role below 4 kills per bot-round on two of the three. It is
not a long-range role that needs long ground: it is worst on `openfield`,
which is the style with the longest lanes.

**Tactics and role mix, together**

| Preset + mix | bastion | openfield | cavern |
|---|---:|---:|---:|
| `balanced` + `rush` | 52.0 ±2.1 | 59.3 ±2.1 | **66.3** ±2.0 |
| `balanced` + `standard` | 53.3 ±2.1 | 60.4 ±2.1 | 53.9 ±2.1 |
| `anchor` + `rush` | 54.4 ±2.1 | 55.9 ±2.1 | 56.9 ±2.1 |
| `aggressive` + `standard` | 55.0 ±2.1 | 45.6 ±2.1 | 51.7 ±2.2 |
| `aggressive` + `turtle` | 55.0 ±2.1 | 49.6 ±2.2 | 47.0 ±2.1 |
| `aggressive` + `rush` | 53.7 ±2.1 | 46.7 ±2.1 | 49.1 ±2.2 |
| `balanced` + `turtle` | 51.9 ±2.2 | 54.4 ±2.1 | 52.0 ±2.1 |
| `anchor` + `standard` | 42.8 ±2.1 | 45.6 ±2.1 | 41.5 ±2.1 |
| `anchor` + `turtle` | **31.9** ±2.0 | **32.6** ±2.0 | **31.7** ±2.0 |

Two things stand out.

1. **What holds position, loses.** `anchor` carries `holdPosition: 0.65` and
   `turtle` carries two Overwatch bots, whose behavior weight for the same
   action is 1.35. Put them together and the team wins 32 % on every style. The
   two multiply: the pair is 12 points below `anchor` alone and 13 below
   `turtle` alone.
2. **A weak preset is repaired by a fast mix.** `anchor` + `rush` wins 54.4,
   55.9 and 56.9, which is 11 to 15 points above `anchor` with any other mix.
   The role behavior weights are stronger than the tactic here.

## 5. Weapons

A share of the kills does not measure a weapon. The generator makes one weapon
of each role trait per set, and the archetype that a weapon ends with depends
on the numbers that it rolled, so some archetypes are made far more often than
others. Divide the kills by the rounds that held the archetype, and the two
readings come apart.

| Archetype | In a set | bastion kills/round | openfield | cavern |
|---|---:|---:|---:|---:|
| `denial` | 21 % | **9.93** | **8.89** | **9.09** |
| `baseline` | 100 % | 5.99 | 6.85 | 7.51 |
| `marksman` | 94 % | 5.49 | 5.56 | 5.46 |
| `heavy` | 50 % | 5.45 | 5.35 | 5.48 |
| `splash` | 48 % | 4.30 | 3.67 | 3.96 |
| `precision` | 100 % | 3.66 | 3.36 | 3.17 |
| `assault` | 76 % | 3.23 | 2.90 | 3.11 |
| `redeemer` | not in a set | 0.52 | 0.62 | 0.52 |

Read against the share of the kills, which is the older reading:

| Archetype | Share of kills (bastion) | Kills per round that held it |
|---|---:|---:|
| `precision` | 14.8 % | 3.66 |
| `denial` | 8.6 % | 9.93 |

The share says that `precision` does almost twice the work of `denial`. The
rounds say that `denial` is **2.7 times the weapon**. The share was measuring how often the
generator makes the archetype, not how good it is.

**The ground barely moves a weapon.** Only two archetypes answer the style at
all: `splash` is best on `bastion` (4.30) and worst on `openfield` (3.67), which
is what area damage should do, and `baseline` gains as the ground opens. Every
other archetype is flat to within its own noise. `marksman` is 5.49 on the
tightest style and 5.56 on the most open one — the long-range weapon does not
care whether the arena has long lanes. Section 8 says why.

**The fallback weapon is not a fallback.** `baseline` makes 6.0 to 7.5 kills in
a round, above five of the six generated archetypes on every style, and it climbs as the
ground opens. It has `rangeMax: 30` on a 60×30 arena and a **flat DPS profile
of 17.4 at every band**, so it has no distance at which it is weak. A generated
weapon has to beat 17.4 at every band to be worth swapping to, and most do not.
The baseline also never runs dry, while a weapon from the ground needs ammo.

## 6. Items

Items taken in one round:

| Style | Weapon | Ammo | Armor | Health | Power-up |
|---|---:|---:|---:|---:|---:|
| bastion | 13.5 | 11.0 | 7.9 | 4.3 | 3.8 |
| openfield | 12.2 | 10.3 | 7.0 | 3.1 | 3.4 |
| cavern | 13.8 | 8.5 | 7.3 | 3.2 | 3.3 |

`cavern` takes the most weapons and the least ammo. That is the likely reason
for the `baseline` share in Section 5: a weapon from the ground runs dry, the
ammo to refill it is not taken, and the bot falls back on a weapon that never
runs dry. The link is not proved here; it needs a count of the shots that each
weapon fired after it ran empty.

`bastion` takes the most health (4.3 against 3.1) and the most power-ups. Its
rounds are the longest, so there is more time to take them.

---

## 7. A defect that this batch found: team B wins more than team A

Section 7.16 says to check the mirror matchups of every batch. A preset against
itself must sit near 50 %, and one that does not shows a side bias. The two
batches are independent, so each one measures it on its own.

Team A win rate, where 50 % is fair:

| Style | Main batch (2430) | Tactics sweep (2160) |
|---|---:|---:|
| bastion | 48.6 % ±1.0 | 45.5 % ±1.1 |
| cavern | 48.4 % ±1.0 | 50.7 % ±1.1 |
| openfield | **44.6 % ±1.0** | **43.8 % ±1.1** |

Over all 13770 rounds team A wins **46.9 % ±0.4**, which is 7.2 standard errors
below fair. **The engine gives team B an advantage of about 3 points.**

Two things follow, and the second one is why both batches were needed:

1. **`openfield` shows it most.** It is 44.6 % and 43.8 % in two batches that
   share no preset but one, and all three of its arenas show it in the main
   batch (43.7 %, 43.3 %, 46.8 %). It is the style and not one roll of the
   generator.
2. **The size is not a property of the arena alone.** `bastion` reads 48.6 % in
   one batch and 45.5 % in the other, and `cavern` reads 48.4 % and 50.7 %.
   Those gaps are larger than their standard errors, so the bias moves with the
   presets in the pool. A single batch would have called this an `openfield`
   defect. It is an engine defect that `openfield` makes worse.

**What it is not.** The distance from a team spawn to the pickup points is
exactly equal for the two teams on every arena of every style (38.44 steps
against 38.44 on `bastion-0`, and so on), which is the rule that
`pickupEvenness` holds. Fourteen of the eighteen points are uneven on their own,
but they are uneven in mirrored pairs, so the totals match. The bias is not in
the distance to the ground.

**What it may be.** Not measured. The next things to look at are the order in
which bots act inside a tick (Section 7.20.7), the order of the spawn cells that
`orderSpawnsForFairness` gives each team, and which side of a facing pair holds
the better weapon.

**What it does to this document.** Nothing in Sections 1 to 6, because every
preset and every role mix plays as team A and as team B equally often, so the
bias cancels in a win rate. It would matter in a single match.

---

## 8. What the numbers say to do next

These are findings, not changes. Nothing here is applied.

### 8.1 The AI reads one band share for every arena

`data/weapon-roles.json` holds one `bandShare` for the whole game:

```
close 0.50   mid 0.48   long 0.02
```

Both the power budget (Section 7.3) and `bestWeaponOverall` (Section 7.8) read
it. The measured share is not one number:

| Style | Close | Mid | Long |
|---|---:|---:|---:|
| Constant | 50 % | 48 % | 2 % |
| bastion | 56.8 % | 41.8 % | 1.4 % |
| cavern | 46.2 % | 52.7 % | 1.1 % |
| openfield | **34.7 %** | **60.0 %** | 5.3 % |

The constant is near `bastion` and `cavern` and wrong for `openfield` by 15
points. This is why no weapon in Section 5 answers the ground: a bot on an open
field weighs a close-range weapon as if half the fighting were close, when only
a third of it is. The fix is to measure the band share from the arena, not from
a file, and to give the arena metrics of Section 7.7 a `bandShare` field that
both the budget and the AI read.

This is the pattern that the M8 weapon analysis named: **a number that the AI
reads, that does not mean what its name says.**

### 8.2 `denial` is mispriced

`denial` makes 2.7 times the kills of `precision` in a round that holds it. The
power budget is supposed to make them equal. `denial` is the label for a weapon
that came out with damage over time or a hazard, so the price of a hazard tick
is the number to look at. The M8 analysis marked "DoT cost" as an open item;
this batch puts a size on it.

That `denial` is rare (21 % of sets) is what hid it. A share of the kills cannot
find a defect like this, and that is why the harness now reports both numbers.

### 8.3 The baseline weapon has no weak band

`baseline` has one DPS number, 17.4, for every band, and `rangeMax: 30` on a
60×30 arena. A weapon with no weak band is not a fallback; it is the safe
choice. Giving it a real profile (strong at mid, weak at close and long) would
make a weapon from the ground worth crossing the arena for, which is what
Section 7.12 wants the ground to be for.

### 8.4 A role's tactics preset never applies

`data/roles.json` gives every role a tactics preset: Overwatch is "long range,
precision preference", Tank is "heavy preference". `src/sim/state.ts` reads it
like this:

```ts
const preset = options.tactics ? tacticsFor(teamId) : (roleData?.tactics ?? tacticsFor(teamId));
```

The team tactics win outright. The batch always passes tactics, and so does the
browser, so **the tactics block of `data/roles.json` is dead in every run.** A
role contributes its behavior weights alone.

Section 7.11 says "the player can change the tactics after the role applies its
preset", which reads as a merge, and this is a replace. The Overwatch result of
Section 4 must be read with this in mind: it measures `holdPosition: 1.35`,
`seekPickup: 0.8` and `chase: 0.7`, and not a long-range role.

The decision is a design one, and this document does not take it. Either:

- **merge**, so a role sets the tactics that the player did not set, or
- **drop the tactics block from the roles file**, so nothing in the data says
  something that the engine does not do.

### 8.5 `weaponRolePrefBonus` is too strong to be a bias

Section 7.20.8 calls the weapon preference a bias and not a rule, and the
number is 0.6: a named archetype is worth 60 % more to the bot that names it.
Section 3.1 measures what that buys, and it is nothing. No preference beats no
preference on any style, and the three pool to 2.1 points ±1.2 below the
control.

A likely reason: a 60 % bonus is larger than the gap between most pairs of
weapons in a set, so the preference stops being a tie-break and becomes an
order. The bot then carries the weapon that the player named instead of the
weapon that is worth more. That reading is not proved here. It would be, by a
sweep of `weaponRolePrefBonus` itself: if the cost falls away as the number
falls, the number is the cause.

### 8.6 `anchor` and `turtle` need a job

`anchor` wins 43 % on every style and `turtle` wins 46 %, 46 % and 44 %. Put
them together and the team wins 32 %. Holding ground pays nothing at all now,
on any style, because:

- every style respawns a dead bot near its own spawn, so a held room does not
  cut the other team off from anything;
- `openfield` has no chokepoint to hold, and the other two have 17 to 19, which
  is too many to be worth holding one.

Holding will not pay until something is worth standing on. The nearest
candidates are the contested power-up points of Section 7.20.17 and a longer
respawn.

---

## 9. What is still not measured

- **A match, not a round.** Every number here is one round. The two teams keep
  one set of tactics, so the between-round change of Section 7.4 is not
  measured.
- **Why a weapon was fired.** The record holds the kills of a weapon, not the
  shots that it fired after it ran empty, so Section 6 cannot prove the ammo
  link that it proposes.
- **The side bias of Section 7.** Found, sized, replicated, not explained.
- **Traits and progression** (M10) and a real doctrine (M11). A tactics preset
  stands in for a doctrine, as Section 7.16 says.
