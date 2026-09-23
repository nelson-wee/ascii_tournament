# M8 weapon and balance analysis

Measured after the M8 build (commit `1ef9416`). Every number here comes from a
run of the simulation, not from a reading of the code. No code changed while
this was written.

Read this with Section 7.20 of [`dev-guide.md`](dev-guide.md). It follows the
same method: measure, find the number that does not mean what its name says,
and write down what the measurement cost.

**Batch used:** `data/batch.json` — one arena, three tactics presets, three role
compositions, 1080 rounds unless a section says otherwise. A win rate from `n`
rounds carries a standard error of about `50/√n` percent (Section 7.2.1).

---

## 0. Four questions, answered first

### 0.1 Does a weapon spawn only at its weapon point?

**No. Every bot starts with every weapon and a full magazine for each.**

`makeBot` in `src/sim/state.ts` gives each bot the whole run set:

```ts
weapons: [...options.weapons],
weapon: options.weapons[0] as Weapon,
ammo: new Map(options.weapons.map((weapon) => [weapon.id, weapon.ammoMax])),
```

A weapon point therefore only refills the ammo of a weapon the bot already
holds. `takePickup` has a branch for "the bot does not hold this weapon", and
`pickupValue` returns 0.8 for it, but **that branch cannot run today**.

This changes the reading of the tier result in Section 3.3. The prize weapon
does not win a fight over a pickup point; it is in all six hands at tick 0.
An 82.7 % kill share is what happens when the strongest weapon is free.

Two more faults sit in the same place:

- The test arena has **4 weapon points and 4 generated weapons**, and
  `rollSpawnTable` draws with replacement. A run can put the same weapon on two
  points and leave another weapon off the map completely.
- Nothing places the prize weapon on contested ground. The tier is not even an
  input to placement.

**The fix has three parts, and they must land together:**

1. A bot spawns with the baseline weapon only. A weapon point is the only way
   to get a generated weapon.
2. `rollSpawnTable` places each generated weapon once, without replacement, and
   places the prize weapon on the point that is most equal for both teams. On
   the hand-made arena that means the pair of points nearest the centre of
   rotation. On an M7 arena it means the highest betweenness centrality
   (Section 7.2 step 5), which needs the macro graph.
3. `pickupValue` must price a weapon the bot does not hold against the weapon it
   does hold, by DPS. Today it returns a flat 0.8, which is a guess that no
   measurement supports.

Until step 1 lands, no reading of "which weapon is strong" is trustworthy,
because reach across the arena costs nothing.

### 0.2 Is projectile travel implemented?

**Yes, and it is real.** `spawnProjectile` and `updateProjectiles` in
`src/sim/attacks.ts` move a shot across the map:

- Speed is `projectileSpeed`, rolled at 1.2 to 2.6 cells per tick.
- Each tick sub-steps at 0.34 cells, so a shot cannot pass through a thin wall.
- A shot stops at a wall, at an enemy (hit radius 0.5 cells), or when its range
  runs out. A `ricochet` turns off the wall while it has a bounce left.

Four attack types fly: `projectile`, `burst`, `ricochet`, `tile`. Three resolve
in the tick they are fired: `hitscan`, `cone`, `line`.

The to-hit rule differs with the type, and this is by design:

| attack type | to-hit |
|---|---|
| hitscan, line | roll `hitChance` — distance, target movement, evasion |
| cone | no roll; it is geometry |
| projectile, burst, ricochet, tile | no roll; the target dodges by moving |

**Two gaps found while checking this.**

- **No aim lead.** `releaseShot` aims at the target's position at the moment of
  firing. At 10.4 cells (the mean kill distance) a projectile flies 4 to 9
  ticks, and a bot crosses 1 to 2 cells in that time against a hit radius of
  0.5. A moving target is missed by default, not by chance. This is most of the
  gap between the modelled 0.80 hits per shot for a projectile and the measured
  0.41 (Section 3.4).
- **The projectile family can never land a critical hit.** `releaseShot`
  computes `crit`, then drops it on every path except `hitscan` and `line`:
  `spawnProjectile` does not carry it, and `onImpact` calls `damageBot` with the
  default context, where `crit` is false. The budget still charges
  `critChance × 22` for those weapons. A `precise` weapon that rolls
  `projectile` pays up to 8.8 points of a 100-point budget for an effect it
  cannot produce.

### 0.3 Does the area model over-estimate, and is the AI part of the problem?

**Both are true. Your first point is real but small; your second is real and
larger; and a third cause is larger than either.**

One shot at a time, counting only the enemies it touched:

| attack type | shots | shots that landed | 1 enemy | 2 | 3 | enemies per landing | modelled |
|---|---|---|---|---|---|---|---|
| cone | 3932 | 17.5 % | 586 | 85 | 18 | 1.18 | 1.49 |
| burst | 3185 | 55.9 % | 1133 | 438 | 210 | 1.48 | 1.71 |
| line | 10 364 | 19.1 % | 1379 | 369 | 233 | 1.42 | 1.40 |

- **The 3-opponent cap costs less than expected.** Burst delivers 1.48 enemies
  per landing against a model of 1.71, which is 13 % high. Cone is 21 % high.
  Line is exact. The model is not badly wrong about how many bots an area holds.
- **The AI does not aim for a multi-hit, and you are right that it should.**
  `selectTarget` picks one enemy and `releaseShot` aims at that enemy. Nothing
  in the code asks whether a second enemy stands behind it or beside it. Every
  multi-hit measured above is an accident — and accidents still make up **36.4 %
  of burst landings and 30.4 % of line landings**. An AI that lines up a shot
  would raise those, so the headroom is real.
- **The bigger cause is the landing rate, not the target count.** Cone lands on
  17.5 % of its shots while the generator models it as never missing
  (`accuracyFactor` 1.00). That is a 5.7× error. The target-count error is
  1.26×. The reach fault of Section 3.5 is 4.5 times more expensive than the
  over-count.

So the order to fix is: reach first, then AI aiming, then the target model.

### 0.4 Do the spawn timers work?

**Yes.** One successful pickup empties the point and starts its timer.
`takePickup` sets `ready = false` and `readyAtTick = tick + respawnTicks`, and
`updatePickups` brings the point back and emits `PickupRespawned`. A point that
would give nothing — a health point under a bot at full health — is **not**
consumed and its timer does not start. `tests/pickups.test.ts` covers both.

The timers, at 20 ticks per second, against a mean round of 2035 ticks:

| kind | respawn | times per round | points on the test arena |
|---|---|---|---|
| ammo | 200 ticks (10 s) | ~10 | 2 |
| weapon | 220 ticks (11 s) | ~9 | 4 |
| health | 300 ticks (15 s) | ~7 | 2 |
| armor | 550 ticks (27.5 s) | ~4 | 2 |
| powerup | 1400 ticks (70 s) | ~1.5 | 2 |

**But the display is wrong, and you are right to call it out.** `ArenaDisplay`
draws a pickup glyph from the static map tile (`Tile.Pickup`), so `†`, `◘`, `+`,
`★` and `•` show whether or not the item is there. A viewer cannot tell a live
power-up from an empty pad. The glyph must come from `state.pickups[i].ready`,
and an empty point should fall back to the floor glyph — or to a dim version of
its own glyph, which also teaches the player where to wait. This is on the fix
list as item 6.

---

## 1. How weapon generation works

`src/weapons/generate.ts`, 398 lines. Six steps.

**Step 1 — roll the role trait.** `generateWeaponSet` shuffles the four traits
and fills slots 1 to 4 in that order, so a run always covers the roles. Slot 0
is the fixed baseline: damage 25, interval 12, range 30, ammo 30, and a flat
22.9 DPS at every band.

**Step 2 — roll the attack type** from a weighted table that belongs to the
trait. `precise` never rolls cone, burst or tile. `heavy` rolls tile most often.

**Step 3 — roll the stats** inside the role's range, then apply the shape of the
attack type:

```
fireIntervalTicks = roleRoll × intervalFactor
rangeMax          = roleRoll × rangeFactor
ammoMax           = roleRoll × ammoFactor
reactionByBand    = roleRoll + reactionAdd
```

| attack type | close | mid | long | accuracy | range | ammo | interval |
|---|---|---|---|---|---|---|---|
| hitscan | 1.00 | 1.00 | 1.00 | 0.55 | 1.00 | 1.00 | 1.00 |
| projectile | 1.00 | 0.95 | 0.85 | 0.80 | 0.95 | 0.90 | 1.05 |
| cone | 1.15 | 0.45 | 0.05 | 1.00 | 0.55 | 0.65 | 1.15 |
| burst | 0.90 | 0.90 | 0.80 | 0.90 | 0.80 | 0.45 | 1.30 |
| line | 1.00 | 1.00 | 1.00 | 0.55 | 0.90 | 0.60 | 1.25 |
| ricochet | 0.95 | 1.00 | 0.90 | 0.75 | 0.90 | 0.80 | 1.10 |
| tile | 0.85 | 0.85 | 0.85 | 0.85 | 0.75 | 0.40 | 1.35 |

**Step 4 — build the DPS profile.**

```
perDamageDps[band] = (ticksPerSecond / fireIntervalTicks)
                   × roleBandMultiplier[band] × attackBandMultiplier[band]
                   × expectedTargets × accuracyFactor
flatDps            = damage over time + hazard tiles   (it does not scale with damage)
dpsProfile[band]   = perDamageDps[band] × damage + flatDps
```

`expectedTargets` is the multi-hit model: `burst` = 1 + min(1.0, radius × 0.3),
`cone` = 1 + min(0.8, halfAngle × 0.9), `line` = 1.4, everything else = 1.0.
This is the one number that the AI and the budget share, which is why it sits
inside the profile and not beside it (Section 7.20.12 of the dev guide).

**Step 5 — price it, then solve for the damage.**

```
fixedCost = rangeMax×0.35 + critChance×22 + (line ? 9 : 0) + bounces×4
          + ammoMax×0.025 − meanReaction×1.6 + flatDps×2.7
cost      = fixedCost + meanPerDamageDps × damage × 2.7
damage    = (100 × tierFactor − fixedCost) / (meanPerDamageDps × 2.7)
```

Tiers: `prize` ×1.25, `strong` ×1.0, `standard` ×0.85. A run takes one prize,
one strong, and the rest standard, so a run has a ranking.

**Step 6 — reject, or label.** A draft is rejected when the solved damage falls
outside the damage range of its role, or when the cost misses the target by more
than ±12. It tries up to 24 drafts. Acceptance on the first draft, measured over
400 tries each:

| role | standard | strong | prize |
|---|---|---|---|
| precise | 77.5 % | 82.0 % | 88.5 % |
| assault | 72.5 % | 75.8 % | 84.5 % |
| sniper | 91.5 % | 96.0 % | 98.3 % |
| heavy | 90.0 % | 97.3 % | 97.3 % |

The archetype is derived last: `tile` → denial, `cone` or `burst` → splash, else
the role trait. The AI never reads it.

### 1.1 What the generator builds — 4800 weapons from 1200 sets

| role | damage | interval | range | ammo | close | mid | long | mean DPS | reaction |
|---|---|---|---|---|---|---|---|---|---|
| precise | 28.9 | 11.7 | 32.3 | 55 | 31.5 | 31.4 | 29.4 | 30.8 | 3.6 |
| assault | 13.0 | 4.9 | 16.9 | 105 | 55.9 | 34.3 | 15.6 | 35.3 | 5.0 |
| sniper | 57.2 | 24.3 | 45.9 | 22 | 18.4 | 32.4 | 43.7 | 31.5 | 5.6 |
| heavy | 41.9 | 20.3 | 20.5 | 26 | 50.1 | 38.3 | 25.0 | 37.8 | 8.9 |

The four traits separate cleanly and their mean DPS sits inside 30.8 to 37.8.
**The budget works on the role axis.** Every fault below is on another axis.

---

## 2. Results by engagement distance

540 rounds. Bands: close ≤ 8 cells, mid ≤ 20 cells, long above 20.

| band | shots | share | kills | share | kills per shot | kills from behind |
|---|---|---|---|---|---|---|
| close | 72 665 | 50.6 % | 5 812 | 41.6 % | 0.080 | 6.7 % |
| mid | 69 447 | 48.4 % | 7 890 | 56.5 % | 0.114 | 11.8 % |
| **long** | **1 423** | **1.0 %** | **268** | **1.9 %** | 0.188 | 29.1 % |

**The mean kill distance is 10.4 cells. The long band is 1 % of shots.**

Kills per shot rise with distance, because the weapons that reach that far are
the slow, high-damage ones. Kills from behind rise sharply at long range: a bot
that dies past 20 cells rarely saw the shooter.

### 2.1 By archetype

| archetype | kills | close | mid | long | mean kill distance |
|---|---|---|---|---|---|
| assault | 2 291 | 80.7 % | 19.3 % | 0.0 % | 7.0 |
| splash | 1 333 | 48.1 % | 50.7 % | 1.2 % | 9.4 |
| denial | 930 | 47.8 % | 50.8 % | 1.4 % | 9.6 |
| heavy | 1 991 | 38.3 % | 61.4 % | 0.3 % | 10.3 |
| precision | 3 516 | 35.5 % | 64.4 % | 0.1 % | 10.4 |
| marksman | 3 353 | 18.9 % | 74.3 % | 6.8 % | 13.3 |

The archetypes do hold different distances, from 7.0 to 13.3 cells, so the
design intent survives. **But a marksman kills at 13.3 cells and pays for 46.4.**

---

## 3. Five faults, with their cost

### 3.1 Every bot starts with every weapon

See Section 0.1. This is the largest single fault, because it makes the weapon
points and the whole tier ranking almost decorative.

### 3.2 The budget pays for reach the arena never uses

| archetype | flat DPS (what the budget prices) | arena-weighted DPS | error | range paid | range usable | budget wasted |
|---|---|---|---|---|---|---|
| precision | 30.8 | 31.4 | +2 % | 32.3 | 20.0 | 4.3 |
| assault | 34.7 | 43.2 | **+25 %** | 18.4 | 17.8 | 0.2 |
| marksman | 31.4 | 25.3 | **−19 %** | 46.4 | 20.0 | **9.2** |
| heavy | 36.7 | 41.2 | +12 % | 23.3 | 19.6 | 1.3 |
| splash | 37.7 | 48.3 | +28 % | 17.4 | 15.3 | 0.7 |
| denial | 39.0 | 42.9 | +10 % | 17.7 | 17.2 | 0.2 |

The budget averages the three bands equally. The arena fires 51 / 48 / 1. A
marksman therefore pays 9.2 points of a 100-point budget for cells it never
shoots through, and its priced DPS sits 19 % above what it can deliver.

This couples to M7: a larger generated arena would make the long band real
again. The band weights belong in `data/`, not in the code.

### 3.3 The prize weapon takes everything

| tier | weapons | mean DPS | shots | kills | kills per weapon |
|---|---|---|---|---|---|
| prize | 540 (25 %) | 43.5 | **82.9 %** | **82.7 %** | 21.40 |
| strong | 540 (25 %) | 34.2 | 8.9 % | 9.2 % | 2.39 |
| standard | 1080 (50 %) | 28.8 | 4.2 % | 4.1 % | 0.52 |
| baseline | 540 | 22.9 | 4.0 % | 4.0 % | 1.03 |

The prize is the top weapon in **98.3 %** of sets, and it out-damages the second
weapon by only **1.26×**. A 26 % edge in DPS becomes a 9× edge in kills, because
`bestWeaponAt` and `bestWeaponOverall` both take an argmax and every bot carries
every weapon. Three of the five weapons in a run are nearly decoration.

The role that wins the prize slot is even — sniper 25.8 %, heavy 26.5 %, assault
25.7 %, precise 22.0 % — so no trait holds the slot.

A tier ranking was the intent (Section 7.20.12 of the dev guide). This much
concentration was not. Read it together with Section 0.1: the concentration is
so high partly because the prize weapon is free.

### 3.4 Each attack type lands less than the model says, and not by the same amount

Targets touched per shot, direct damage only. A burn tick and a hazard tick are
excluded, because they fire many times per shot and would flatter the slow
weapons.

| attack type | modelled | measured | ratio | value per budget point, against hitscan |
|---|---|---|---|---|
| hitscan | 0.550 | 0.381 | 0.69× | 1.00 |
| tile | 0.850 | 0.557 | 0.66× | 0.96 |
| ricochet | 0.750 | 0.440 | 0.59× | 0.86 |
| burst | 1.535 | 0.878 | 0.57× | 0.83 |
| projectile | 0.800 | 0.409 | 0.51× | 0.74 |
| line | 0.770 | 0.280 | 0.36× | 0.52 |
| **cone** | **1.487** | **0.191** | **0.13×** | **0.19** |

Every type lands less than modelled, by a common factor of about 1.4×. A common
error is harmless, because it applies to all. **The spread from 0.69× to 0.13×
is the fault.**

### 3.5 A cone declares 2.2 times the range it has

`src/sim/attacks.ts:88`:

```ts
const reach = weapon.rangeMax * state.config.coneRangeFactor;   // 0.45
```

A cone already took `rangeFactor` 0.55 at generation, so its declared `rangeMax`
averages 12.3 cells. The damage code then cuts it again to **5.5 cells**, and
fades the damage to nothing across that reach.

The AI reads the declared 12.3 to decide "can I fire", and reads
`dpsProfile.close` of 83.9 to decide "is this my best weapon". Mean damage
delivered per cone shot: **1.5**.

This is the pattern of Section 7.20.13 of the dev guide, for the third time: a
number that the AI reads, that does not mean what its name says.

### 3.6 What each archetype does once it is the best weapon of the run

This separates "how often it is the best" from "how good it is when it is".

| archetype | share of runs where it is best | shots per round | kills per round | kills per shot | round ticks |
|---|---|---|---|---|---|
| precision | 24.4 % | 240.5 | 23.6 | 0.098 | 1902 |
| marksman | 21.7 % | 136.3 | 23.4 | 0.172 | 2248 |
| assault | 18.1 % | 373.7 | 20.5 | 0.055 | 1878 |
| **splash** | 16.3 % | 208.7 | **13.1** | 0.063 | 2192 |
| heavy | 12.2 % | 174.8 | 23.5 | 0.135 | 2103 |
| denial | 7.2 % | 67.1 | 19.7 | 0.293 | 1810 |

Five archetypes deliver 19.7 to 23.6 kills of a round's 25.9 when they hold the
top slot. Splash delivers 13.1. It fires 209 times a round for almost nothing,
which is Section 3.5 shown in the outcome column.

Kill share divided by population share, per weapon generated: denial 1.12,
precision 1.02, marksman 1.01, assault 0.95, heavy 0.94, **splash 0.74**. Splash
is now as far below its price as it was above it at M6.

---

## 4. Tactics selection and the win rate

Two one-tactic sweeps around the `balanced` preset. 700 rounds each, 12 presets
each, so ±4.6 per cell. The method is the one-tactic sweep of Section 7.20.10:
a preset mixes eight tactics, so its win rate cannot say which one carries it.

| tactic | value → win rate | spread | verdict |
|---|---|---|---|
| **itemControl** | 0.1→44.9, 0.3→43.2, **0.5→55.1**, 0.7→57.3, **0.9→62.3** | **19 pts** | dominant, and it rises all the way |
| **holdPosition** | **0.0→50.8, 0.2→55.1**, 0.4→47.5, **0.8→33.9** | **21 pts** | a cost with no benefit above 0.2 |
| **evasion** | **0.0→33.6**, 0.3→50.4, 0.6→47.1, 0.9→40.3 | 17 pts | a real trade, with a peak near 0.3 |
| retreatThreshold | **0.0→59.3**, 0.15→58.5, 0.3→50.4, 0.45→52.7, 0.6→54.7 | 9 pts | never retreating is best |
| preferredRange | close→50.0, mid→50.4, **long→44.1** | 6 pts | close equals mid; long is a trap |
| aggression | 0.1→52.9, 0.3→48.7, 0.5→55.1, 0.7→51.3, 0.9→53.8 | 6 pts | flat, inside the noise |
| hazardTolerance | 0.0→55.1, 0.3→50.4, 0.7→55.1 | 5 pts | flat, no signal |

Against the rule of Section 7.8 — each tactic has a cost and a benefit:

- **One tactic decides the match.** `itemControl` is worth 19 points and it does
  not turn over, even at 0.9. M8 made items the only reward for moving, and
  nothing is priced against taking them.
- **Two tactics are pure penalties.** `holdPosition` above 0.2, and
  `retreatThreshold` above 0. Each has a cost and no measurable benefit. This is
  also why `anchor` sits at 41.9 %: its preset carries both.
- **Two tactics are dead.** `aggression` and `hazardTolerance` move nothing
  outside the noise. A dead `aggression` matters most, because it is the tactic
  a player reaches for first.
- **One tactic is healthy.** `evasion` has a genuine peak: 0 is the worst
  (−17 points), 0.9 is bad (−10), and the middle wins. Dodge against a bot's own
  accuracy is a real trade. Build the others to look like this one.
- **`preferredRange` is half fixed.** Close and mid are now level, so the M8
  fault is gone. `long` still costs 6 points, because it biases weapon choice
  toward a band that is 1 % of shots.

---

## 5. The fix list, in order

**1. Give a bot the baseline weapon only at spawn (Section 0.1).** Then place
each generated weapon once, without replacement, and put the prize weapon on the
most contested pair of points. Re-measure everything below afterwards: this
changes the meaning of every weapon number in this file.

**2. Fix the cone reach (Section 3.5).** Either drop `coneRangeFactor` and let
`rangeFactor` carry the whole penalty, or fold both factors and the linear fade
into the declared `rangeMax` and into `dpsProfile.close`. The AI and the budget
must read the real reach. This is a bug, not a balance dial.

**3. Price the DPS profile the way the arena fires it (Section 3.2).** Weight
the bands about 0.5 / 0.48 / 0.02 instead of one third each, or cap the priced
`rangeMax` at `rangeBandMidMax`. Put the weights in `data/`, because M7 will
change them.

**4. Stop charging for an effect a weapon cannot produce (Section 0.2).** Either
let the projectile family land a critical hit, or take `critChance` out of its
cost. Add an aim lead for a projectile, or lower `accuracyFactor` for the flying
types to what they measure.

**5. Break the prize monopoly (Section 3.3).** After fix 1, measure again. If it
holds, narrow the tier factors from 1.25 / 1.0 / 0.85 to about 1.10 / 1.0 / 0.92,
or make weapon choice softer than an argmax, so a 26 % edge in DPS stops
becoming a 9× edge in kills.

**6. Draw a pickup glyph only when the item is there (Section 0.4).** Take the
glyph from `state.pickups[i].ready`, not from the map tile. An empty point falls
back to the floor glyph, or to a dim version of its own glyph so that a player
can still learn where to wait. Add a test that a taken point stops drawing.

**7. Teach the AI to aim an area weapon (Section 0.3).** Multi-hits happen by
accident on 36 % of burst landings and 30 % of line landings. Score a shot that
lines up two enemies above one that does not.

**8. Give `itemControl` a counter, and give `aggression` a job (Section 4).**
These are balance questions, not bugs, and they decide whether the tactics
screen is a real choice.

Items 1 to 5 are one failure: **the budget charges for something the simulation
does not deliver, or the AI reads a number that does not mean what its name
says.** The measurement that finds them is always the same — compare the
modelled number against the measured one, per weapon, per band, per shot.
