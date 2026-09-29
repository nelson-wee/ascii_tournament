/**
 * Zod schemas for the data files (dev-guide Sections 3 and 9).
 * Validation at load time finds data errors early.
 * A schema of a later system arrives with that system's milestone.
 */
import { z } from "zod";

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const positiveNumber = z.number().positive();
const unitRange = z.number().min(0).max(1);

/**
 * `data/tuning.json`: global numbers.
 *
 * `tbd` lists the keys that hold a placeholder value. JSON has no comments,
 * so this list replaces the `// TBD` comment of the dev guide.
 */
export const TuningSchema = z
  .object({
    schemaVersion: z.literal(1),
    tbd: z.array(z.string()),
    simulation: z
      .object({
        /** Ticks of the simulation per simulated second. TBD */
        ticksPerSecond: positiveInt,
        /** Ticks between two AI decisions of one bot. TBD */
        aiDecisionIntervalTicks: positiveInt,
      })
      .strict(),
    movement: z
      .object({
        /** Cells that a bot crosses in one simulated second. TBD */
        moveSpeedCellsPerSecond: positiveNumber,
        /** Ticks that a bot waits behind an enemy before it takes a new path. TBD */
        repathAfterBlockedTicks: positiveInt,
        /** How far evasion moves a bot sideways, as a part of its speed. TBD */
        evasionLateralFactor: unitRange,
      })
      .strict(),
    perception: z
      .object({
        /**
         * false: a bot sees through 360 degrees, as before Milestone M5.5.
         * true: a bot has a facing, a focus arc, and a peripheral arc
         * (Section 7.20.6). The measurement of Section 7.20.10 says that the
         * arcs change nothing while a pickup point gives nothing, so this is
         * off until the pickups of M8 work.
         */
        directionalVision: z.boolean(),
        /** The sight radius of a bot, in cells. TBD */
        sightRadiusCells: positiveNumber,
        /** Ticks that a bot remembers the last seen position of an enemy. TBD */
        memoryTicks: positiveInt,
        /**
         * Half the width of the focus arc, in degrees. A bot fires only at an
         * enemy inside this arc. TBD
         */
        focusHalfAngleDegrees: z.number().min(1).max(180),
        /** Half the width of the peripheral arc at awareness 0, in degrees. TBD */
        peripheralHalfAngleBaseDegrees: z.number().min(1).max(180),
        /** How many degrees the awareness attribute adds to the arc. TBD */
        peripheralHalfAngleAwarenessDegrees: z.number().min(0).max(180),
        /** Ticks of sight before a peripheral contact counts. TBD */
        peripheralDelayTicks: nonNegativeInt,
        /**
         * How far a bot turns in one tick, in degrees. It sets the value of a
         * flank: a bot that is caught from the side needs time to turn. 180
         * turns the bot at once. TBD
         */
        turnRateDegreesPerTick: z.number().min(1).max(180),
      })
      .strict(),
    combat: z
      .object({
        /** The health of a bot at spawn. TBD */
        healthMax: positiveNumber,
        /** Ticks between a death and the respawn. TBD */
        respawnDelayTicks: positiveInt,
        /** The highest distance of the "close" range band, in cells. TBD */
        rangeBandCloseMax: positiveNumber,
        /** The highest distance of the "mid" range band, in cells. TBD */
        rangeBandMidMax: positiveNumber,
        /** The window that counts two kills of one bot as a multi-kill. TBD */
        multiKillWindowTicks: positiveInt,
        /** The damage factor of a critical hit. TBD */
        critMultiplier: positiveNumber,
        /** Ticks with no movement before a target counts as stationary. TBD */
        stationaryTicksForCrit: positiveInt,
        /** Ticks of movement before a bot gets its full dodge. TBD */
        dodgeRampTicks: positiveInt,
        /**
         * How much of its accuracy a weapon loses at one full `rangeTolerance`
         * of deviation from its optimal range (Section 7.33). It used to mean
         * "across the full range of a weapon", measured from the muzzle, which
         * said every weapon was at its best at point-blank range. TBD
         */
        distanceFalloff: unitRange,
        /**
         * The least a weapon keeps from range alone, however far off its band.
         * A shot at a hopeless distance is still a shot, and `minHitChance`
         * floors the whole chance after the dodge and the evasion. TBD
         */
        rangeFloorShare: unitRange,
        /** How much a moving target lowers the hit chance. TBD */
        movingTargetPenalty: unitRange,
        /** The lowest hit chance, whatever the distance. TBD */
        minHitChance: unitRange,
        /** How much the evasion of a bot lowers its own accuracy. TBD */
        evasionAccuracyPenalty: unitRange,
        /**
         * Ticks that a bot cannot fire after it changes weapon. A swap that
         * costs nothing makes the choice of weapon free, so a bot always holds
         * the best one and the tactics that pick a weapon mean nothing. With a
         * cost, firing a weapon that is merely good is sometimes right
         * (Section 7.20.17). TBD
         */
        weaponSwapTicks: nonNegativeInt,
        /**
         * How long a bot expects an engagement to last, in ticks. It decides
         * whether a swap pays for itself: a long fight is worth changing for,
         * a short one is not. TBD
         */
        weaponSwapPayoffTicks: positiveInt,
        /**
         * A new target must be this much nearer than the current one, as a
         * part of the current distance. 0.8 means 20 % nearer. TBD
         */
        targetSwitchMargin: unitRange,
      })
      .strict(),
    conflict: z
      .object({
        _notes: z.string().optional(),
        /**
         * How many steps of difference between the two teams still counts as
         * contested ground (Section 7.35). The score falls to nothing over this
         * span, so the conflict zone has an edge rather than a wall. TBD
         */
        contestedSpanSteps: positiveNumber,
        /**
         * How many contested cells the coverage measure tests against. Every
         * floor cell is tested against this many, so it sets the cost of
         * building an arena. An even spread, so the answer does not move with
         * the number. TBD
         */
        sampleCells: positiveInt,
        /** How many of the best cells the field keeps, for the report. TBD */
        bestCount: positiveInt,
      })
      .strict(),
    cover: z
      .object({
        _notes: z.string().optional(),
        /**
         * How far along the line of fire, in cells, a cover tile still shields
         * the target. The cell the target stands on never counts: cover is what
         * is BETWEEN the two bots (Section 7.32). TBD
         */
        depthCells: positiveNumber,
        /**
         * What the second cell of the line is worth against the first, and the
         * third against the second. Cover at arm's length screens more than
         * cover halfway to the shooter. TBD
         */
        stepFalloff: unitRange,
        /**
         * What cover is worth in each band. It rises with the range because a
         * shooter far away has little angle over a low wall and a shooter at
         * arm's length has all of it. TBD
         */
        bandFactor: z
          .object({ close: unitRange, mid: unitRange, long: unitRange })
          .strict(),
        /**
         * How much cover moves `positionValue`. It is the only reason a bot
         * prefers a shielded cell, so at 0 the mechanic exists and no bot
         * plays around it. TBD
         */
        aiWeight: z.number().nonnegative(),
      })
      .strict(),
    ai: z
      .object({
        /**
         * How much a bot values a bearing where the target has no cover
         * (Section 7.32). It is what makes a move around an enemy pay for
         * itself, so at 0 cover exists and no bot flanks it. TBD
         */
        flankWeight: z.number().nonnegative(),
        /**
         * What each 30-degree step around the target costs, against the bearing
         * the bot already holds. Without a cost a bot orbits instead of
         * fighting. TBD
         */
        flankTurnCost: z.number().nonnegative(),
        /**
         * How much a bot values ground that overlooks the conflict zone
         * (Section 7.35). At 0 the measurement exists and no bot reads it,
         * which is the state Section 7.31 described. TBD
         */
        conflictWeight: z.number().nonnegative(),
        /**
         * How often a bot looks for better ground, in ticks. The search costs
         * about 25 candidate cells, so it does not belong on every tick of
         * every bot. TBD
         */
        takePositionIntervalTicks: positiveInt,
        /**
         * How much better a candidate cell must be than the one the bot stands
         * on. Without a margin a bot walks for a rounding difference and never
         * arrives. TBD
         */
        takePositionMargin: z.number().min(1),
        /** How far a bot will look for better ground, in cells. TBD */
        takePositionRadiusCells: positiveNumber,
        /** A new action must score this much more than the current one. TBD */
        hysteresisMargin: z.number().min(1),
        /** A bot with a lower hazard tolerance walks around a hazard tile. TBD */
        hazardAvoidBelowTolerance: unitRange,
        /** The distance that makes a bot follow a teammate, in cells. TBD */
        teamSpacingCells: positiveNumber,
        /**
         * How early a bot walks toward a pickup point that is coming back, in
         * ticks, and how much of its full value it is worth on the way. A bot
         * with nothing to take stands still, and then the teams never meet. TBD
         */
        pickupAnticipationTicks: positiveInt,
        pickupAnticipationShare: unitRange,
        /**
         * How long a sightline stays worth holding after the last contact, in
         * ticks, and what share of its value it keeps once that time is spent.
         * Holding ground is a sightline action: with no enemy in sight and
         * none seen for a while, the ground is worth little and the bot takes
         * items or new ground instead. TBD
         */
        holdContactTicks: positiveInt,
        holdBlindShare: unitRange,
        /**
         * How much the `holdPosition` tactic lowers `SeekPickup`. 1 means a
         * bot at `holdPosition` 1 takes no item at all. The items of M8 decide
         * fights, so a full suppression makes the anchor preset unplayable
         * (Section 7.20.12). TBD
         */
        holdSuppressesPickup: unitRange,
        /**
         * How much the `preferredRange` tactic outweighs the band where the
         * equipped weapon deals the most damage. 0 makes the weapon decide
         * alone. TBD
         */
        rangePrefBias: z.number().min(0),
        /**
         * How much the `weaponRolePref` tactic raises the weapon it names. It
         * is the tournament weapon priority of Section 7.20.8, and it is what a
         * player sets to give a role its own weapon. A swap costs firing ticks
         * (`combat.weaponSwapTicks`), so a bot armed by its doctrine out of the
         * fight keeps that weapon in it (Section 7.20.17). TBD
         */
        weaponPrefBonus: z.number().min(0),
        /**
         * How much the danger of a pickup point lowers its worth. Item control
         * won 19 points of win rate and never turned over, because a run
         * across the arena cost nothing (Section 4 of the M8 weapon analysis).
         * A tactic with only a benefit breaks the rule of Section 7.8. TBD
         */
        pickupRiskWeight: z.number().nonnegative(),
        /**
         * Two pickup points whose value differs by less than this share of the
         * value count as a tie, and the tie goes to the point nearer to the
         * spawn ground of the team (Section 7.20.25). Without it the 13th
         * decimal of a float decided, and the two halves stopped matching. TBD
         */
        pickupTieShare: unitRange,
        /**
         * How much the aggression tactic shortens the aim delay. A bold bot
         * shoots first; it also fights at low health and does not walk to the
         * band where its weapon is strongest. Letting aggression discount the
         * danger map instead was measured and reverted (Section 7.20.16). TBD
         */
        aggressionReactionDiscount: unitRange,
        /**
         * How much aggression lowers `Reposition`. A bold bot presses the
         * fight where it stands instead of walking to a better band. TBD
         */
        aggressionRepositionDiscount: unitRange,
        /** The base consideration of each action, before the tactics weights. TBD */
        actionBase: z
          .object({
            engage: positiveNumber,
            chase: positiveNumber,
            seekPickup: positiveNumber,
            holdPosition: positiveNumber,
            reposition: positiveNumber,
            follow: positiveNumber,
            /** Move to ground that overlooks the conflict zone (Section 7.35). */
            takePosition: positiveNumber,
          })
          .strict(),
      })
      .strict(),
    /** The one team axis of Section 7.21. */
    team: z
      .object({
        _notes: z.string().optional(),
        /** How far teamplay pulls `Follow` away from the middle. */
        followWeight: z.number().nonnegative(),
        /** How far it pulls `HoldPosition`, the other way. */
        holdWeight: z.number().nonnegative(),
        /** How far it pulls a pickup point that a teammate already goes to. */
        objectiveWeight: unitRange,
        /** How far it pulls the aim toward an enemy a teammate is fighting. */
        focusFireWeight: unitRange,
      })
      .strict(),
    influence: z
      .object({
        /** Ticks between two updates of the influence maps (Section 7.9). TBD */
        intervalTicks: positiveInt,
        controlRadius: positiveNumber,
        dangerRadius: positiveNumber,
        botDanger: z.number().nonnegative(),
        sightDanger: z.number().nonnegative(),
        hazardDanger: z.number().nonnegative(),
        deathRadius: positiveNumber,
        deathDanger: z.number().nonnegative(),
        deathMemoryTicks: positiveInt,
      })
      .strict(),
    botDefaults: z
      .object({
        /** The base hit chance of a bot. TBD */
        accuracy: unitRange,
        /** Ticks between the first sight of a target and the first shot. TBD */
        reactionTicks: nonNegativeInt,
        /** No system reads this value yet. Section 6.4 names it. TBD */
        awareness: unitRange,
      })
      .strict(),
    match: z
      .object({
        /** Bots per team. Locked at 3 (Section 2.2). */
        teamSize: positiveInt,
        /** Rounds per match. Locked at 3 (best of 3, Section 2.2). */
        maxRounds: positiveInt,
        /** Weapons in a run. Locked at 5 (Section 2.2). */
        weaponsPerRun: positiveInt,
        /** Round wins that win the match. */
        roundWinsToWinMatch: positiveInt,
      })
      .strict(),
    round: z
      .object({
        /** Kills by one team that end a round. */
        scoreLimit: positiveInt,
        /** Ticks that end a round. 3600 ticks = 3 simulated minutes at 20 ticks/s. */
        timeLimitTicks: positiveInt,
        /**
         * The longest sudden death, in ticks. A round with an equal score at
         * the time limit goes to sudden death, and the next kill wins. This
         * limit only stops a round that never ends. TBD
         */
        suddenDeathMaxTicks: positiveInt,
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) => value.match.roundWinsToWinMatch <= value.match.maxRounds,
    "match.roundWinsToWinMatch must not be more than match.maxRounds",
  );

export type Tuning = z.infer<typeof TuningSchema>;

const RANGE_BANDS = ["close", "mid", "long"] as const;

/** The archetypes that a role can rank. `redeemer` is a power-up, not a pick. */
export const PREFERABLE_ARCHETYPES = [
  "precision",
  "assault",
  "marksman",
  "heavy",
  "splash",
  "denial",
  "versatile",
  "baseline",
] as const;

/**
 * `data/tactics.json`: the tactics of a role (Section 6.4, Section 7.26).
 *
 * Two of these are **rankings**, not single picks:
 *
 * - `rangePref` names all three bands, best first. A role that likes close
 *   quarters also has an opinion about which of mid and long it minds less,
 *   and one favourite band could not say that.
 * - `weaponPref` names archetypes, best first, and may leave some out. A run
 *   offers five weapons, so a single favourite archetype is silent about four
 *   of them; a ranking gives an opinion on every one it names.
 */
export const TacticsSchema = z
  .object({
    aggression: unitRange,
    /** All three bands, best first, each one time. */
    rangePref: z
      .array(z.enum(RANGE_BANDS))
      .length(3)
      .refine((value) => new Set(value).size === 3, "rangePref names each band one time"),
    /** Archetypes, best first. An archetype that is absent gets no bonus. */
    weaponPref: z
      .array(z.enum(PREFERABLE_ARCHETYPES))
      .refine((value) => new Set(value).size === value.length, "weaponPref has no repeat"),
    itemControl: unitRange,
    holdPosition: unitRange,
    evasion: unitRange,
    hazardTolerance: unitRange,
  })
  .strict();

export type Tactics = z.infer<typeof TacticsSchema>;

export const TacticsFileSchema = z
  .object({ _notes: z.string().optional(), default: TacticsSchema })
  .strict();

/**
 * `data/batch.json`: the configuration of the batch harness (Section 7.16).
 *
 * `presets` stands in for the doctrines of M11, and `arenas` stands in for the
 * arena profiles of M7.
 */
/**
 * What the player tells the TEAM (Section 6.5).
 *
 * One axis, from 0 to 1. It used to be four — `cohesion`, `focusFire`,
 * `spacing` and `trading` — and four knobs that all pull on the same idea
 * cannot be read: a batch could not say which of them did anything, and none
 * of them moved a win rate more than the side bias did (Section 7.21).
 *
 *     0.0   independent   the bots split up. Each takes its own pickup point,
 *                         picks its own target, and works its own ground.
 *     0.5   loose         neither pull.
 *     1.0   cohesive      the bots move as one. They take the same point, they
 *                         fire at the same enemy, and they stay together.
 *
 * Every other team number is derived from it, so a run has one team decision
 * and a batch can measure it.
 */
export const TeamTacticsSchema = z
  .object({
    teamplay: unitRange,
  })
  .strict();

export type TeamTactics = z.infer<typeof TeamTacticsSchema>;

/** One of the three roles of Section 7.11. */
export const RoleSchema = z.enum(["overwatch", "tank", "skirmisher"]);

export const BatchConfigSchema = z
  .object({
    _notes: z.string().optional(),
    rounds: positiveInt,
    seed: z.number().int(),
    arenas: z.array(z.string().min(1)).min(1),
    presets: z.record(z.string().min(1), TacticsSchema),
    /**
     * One named role order per team, for the acceptance test of M8: the batch
     * shows a different result by role composition. Left out, every team plays
     * the standard one role of each.
     */
    compositions: z.record(z.string().min(1), z.array(RoleSchema).min(1)).optional(),
    /**
     * One named team axis per team (Section 7.21). When it is here it is the
     * matchup axis of the batch, and every bot plays the default tactics, so
     * the batch measures the team decision and nothing else. A name that is
     * also in `presets` takes those tactics instead of the default.
     */
    teamPresets: z.record(z.string().min(1), TeamTacticsSchema).optional(),
    /**
     * Let the roles own the tactics (Section 7.26).
     *
     * A preset is a **team-wide override**: it throws the role presets away, so
     * a batch that measures compositions must set this, or a tank and an
     * overwatch differ only by their six action weights and the table says
     * nothing. A batch that measures presets must leave it out.
     */
    useRoleTactics: z.boolean().optional(),
    outDir: z.string().min(1),
  })
  .strict()
  .refine((value) => Object.keys(value.presets).length > 0, "batch.json needs one preset minimum");

export type BatchConfig = z.infer<typeof BatchConfigSchema>;

/** `data/roles.json`: the role presets and their behavior weights (Section 7.11). */

export const RolesSchema = z
  .object({
    _notes: z.string().optional(),
    roles: z.record(
      z.enum(["overwatch", "tank", "skirmisher"]),
      z
        .object({
          tactics: TacticsSchema,
          /** A small factor on the base consideration of an action (Section 7.8). */
          behavior: z.record(z.string().min(1), positiveNumber),
        })
        .strict(),
    ),
    teamTacticsDefault: TeamTacticsSchema,
  })
  .strict();

export type Roles = z.infer<typeof RolesSchema>;

/** `data/pickups.json`: what a pickup point gives (Section 7.12). */
export const PickupsSchema = z
  .object({
    _notes: z.string().optional(),
    armorMax: positiveNumber,
    /** The share of damage that armor takes while the bot has any. TBD */
    armorAbsorb: unitRange,
    shieldMax: positiveNumber,
    kinds: z.record(
      z.enum(["weapon", "armor", "health", "powerup", "ammo"]),
      z
        .object({ respawnTicks: positiveInt, amount: z.number().nonnegative() })
        .strict(),
    ),
    powerups: z.record(
      z.string().min(1),
      z
        .object({
          durationTicks: nonNegativeInt,
          damageMultiplier: positiveNumber.optional(),
          shield: z.number().nonnegative().optional(),
          /**
           * The id of a weapon file that the point hands over, with one
           * magazine. The Redeemer of Section 7.20.18 arrives this way: it is
           * a power-up, so the power budget of Section 7.3 never prices it.
           */
          weapon: z.string().min(1).optional(),
          weight: z.number().positive(),
        })
        .strict(),
    ),
  })
  .strict();

export type Pickups = z.infer<typeof PickupsSchema>;

/** One entry of an announcement table. */
const AnnouncementTierSchema = z
  .object({ count: positiveInt, text: z.string().min(1) })
  .strict();

/** `data/announcements.json`: the kill announcements of the kill feed. */
export const AnnouncementsSchema = z
  .object({
    _notes: z.string().optional(),
    /** Kills of one bot inside the multi-kill window. */
    multiKill: z.array(AnnouncementTierSchema).min(1),
    /** Kills of one bot with no death between them. */
    spree: z.array(AnnouncementTierSchema).min(1),
    multiKillTemplate: z.string().min(1),
    spreeTemplate: z.string().min(1),
    spreeEndedTemplate: z.string().min(1),
    /** A critical hit (Section 7.24). */
    headShotTemplate: z.string().min(1),
    /** One hit that took a large share of full health (Section 7.24). */
    heavyHitTemplate: z.string().min(1),
    /** How much of full health one hit must take to be called out. */
    heavyHitShare: z.number().gt(0).lte(1),
  })
  .strict()
  .refine(
    (value) =>
      [value.multiKill, value.spree].every((table) =>
        table.every((tier, index) => index === 0 || tier.count > (table[index - 1]?.count ?? 0)),
      ),
    "each announcement table must rise by count",
  );

export type Announcements = z.infer<typeof AnnouncementsSchema>;

const range = z.tuple([z.number(), z.number()]);
const bandValues = z
  .object({ close: z.number(), mid: z.number(), long: z.number() })
  .strict();
const bandRanges = z
  .object({ close: range, mid: range, long: range })
  .strict();

const ATTACK_TYPE_NAMES = [
  "hitscan",
  "projectile",
  "cone",
  "burst",
  "line",
  "ricochet",
  "tile",
] as const;

/** `data/weapon-roles.json`: the role traits and the attack types (7.20.2, 7.20.3). */
export const WeaponRolesSchema = z
  .object({
    _notes: z.string().optional(),
    roles: z.record(
      z.enum(["precise", "assault", "sniper", "heavy"]),
      z
        .object({
          damage: range,
          fireIntervalTicks: range,
          /**
           * The distance the role is built for, in cells (Section 7.33).
           * Accuracy peaks here and falls away on both sides, so this is what
           * makes a sniper miss in your face and a shotgun miss across a hall.
           * The attack type shifts it by `rangeFactor`. TBD
           */
          optimalRange: range,
          /**
           * How far from `optimalRange` the role stays useful, in cells. At one
           * full tolerance of deviation it has lost `combat.distanceFalloff` of
           * its accuracy. A wide tolerance is a versatile weapon, and the budget
           * charges for it. TBD
           */
          rangeTolerance: range,
          ammoMax: range,
          critChance: range,
          critConditions: z.array(z.string()),
          reactionByBand: bandRanges,
          attackTypeWeights: z.record(z.enum(ATTACK_TYPE_NAMES), z.number().nonnegative()),
          nameWords: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    attackTypes: z.record(
      z.enum(ATTACK_TYPE_NAMES),
      z
        .object({
          /**
           * How the **travel** of this shot fares in each band, not where the
           * weapon works: a projectile is easier to step out of the way of at
           * long range. The range curve of Section 7.33 carries where the
           * weapon works, and the two do not overlap. TBD
           */
          bandMultiplier: bandValues,
          reactionAdd: z.number().nonnegative(),
          /**
           * How often a shot of this type lands. An area type does not roll to
           * hit, so it is near 1. A hitscan shot rolls against the accuracy of
           * the bot and the dodge of the target, so it is lower. TBD
           */
          accuracyFactor: unitRange,
          /**
           * How the attack type shifts the range, the magazine, and the ticks
           * between two shots of a weapon. An area type reaches less far, holds
           * fewer shots, and fires more slowly. Without these, the budget pays
           * for an area with damage alone. TBD
           */
          rangeFactor: positiveNumber,
          ammoFactor: positiveNumber,
          intervalFactor: positiveNumber,
          word: z.string().min(1),
        })
        .strict(),
    ),
    shape: z
      .object({
        projectileSpeed: range,
        aoeRadius: range,
        coneHalfAngleDegrees: range,
        coneRangeFactor: unitRange,
        /**
         * The narrowest range tolerance any weapon may have, in cells
         * (Section 7.33). A cone scales its tolerance down with its reach,
         * and without a floor a short cone becomes a pinpoint weapon that
         * misses everything half a cell off its best distance. TBD
         */
        rangeToleranceMinCells: positiveNumber,
        /**
         * How hard the attack type's `rangeFactor` pulls the range
         * tolerance down, as an exponent. 1 scales it in full, 0 leaves it
         * alone, 0.5 is a square root.
         *
         * A weapon built for half the distance is not half as fussy about
         * it. At 1 a cone came out with an optimal range of 1.5 cells and a
         * tolerance of 1.5, so it sat at its accuracy floor at 4 cells --
         * inside the close band it is meant to own (Section 7.33.5). TBD
         */
        toleranceReachExponent: unitRange,
        ricochetBounces: range,
        hazardTicks: range,
        hazardRadius: range,
        hazardDamagePerTick: range,
        dotChance: unitRange,
        dotDamage: range,
        dotTicks: range,
        ammoPickupShare: range,
      })
      .strict(),
    value: z
      .object({
        _notes: z.string().optional(),
        aoeTargetsPerRadius: z.number().nonnegative(),
        aoeTargetsMax: z.number().nonnegative(),
        coneTargetsPerRadian: z.number().nonnegative(),
        coneTargetsMax: z.number().nonnegative(),
        lineTargets: z.number().nonnegative(),
        dotStackCap: positiveNumber,
        hazardOccupancy: unitRange,
        /**
         * The share of the damage of a cone that lands, after the fade from
         * its mouth to its reach (Section 7.20.15). TBD
         */
        coneFadeShare: unitRange,
        /**
         * How often the arena fires in each band. The power budget and the AI
         * both weigh a DPS profile with it, so a weapon is worth what the
         * arena lets it do. Measure it again after M7 changes the arena. TBD
         */
        bandShare: z
          .object({ close: unitRange, mid: unitRange, long: unitRange })
          .strict(),
      })
      .strict(),
    tiers: z
      .object({
        _notes: z.string().optional(),
        list: z
          .array(
            z
              .object({
                name: z.string().min(1),
                budgetFactor: positiveNumber,
                weight: z.number().positive(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    budget: z
      .object({
        target: positiveNumber,
        tolerance: positiveNumber,
        dpsWeight: z.number().nonnegative(),
        /** What a cell of optimal range costs. Far ground is safer ground. TBD */
        optimalRangeWeight: z.number().nonnegative(),
        /**
         * What a cell of range tolerance costs. A wide sweet spot is good in
         * every fight, so it is the one range number with no downside and it
         * must be paid for. TBD
         */
        rangeToleranceWeight: z.number().nonnegative(),
        /**
         * How many tolerances past the optimal range a bot still takes the shot.
         * It derives `rangeMax`, so a weapon can never fire where its own curve
         * says it cannot hit (Section 7.33.3). TBD
         */
        rangeGateTolerances: z.number().nonnegative(),
        critWeight: z.number().nonnegative(),
        lineWeight: z.number().nonnegative(),
        ricochetWeight: z.number().nonnegative(),
        reactionDiscount: z.number().nonnegative(),
        ammoWeight: z.number().nonnegative(),
        /**
         * How far past `perception.sightRadiusCells` an optimal range or a range
         * gate may reach, as a share of it. 1.15 gives a little headroom for a
         * shot that is already in the air when the target steps out of sight.
         *
         * Before this, a marksman was generated with a mean `rangeMax` of 47.1
         * cells while a bot saw 26. Twenty one cells of that reach could never
         * hold a visible target, and the weapon paid about 9.5 cells of
         * full-price reach for them (Section 7.30.7). The cap and the tail share
         * that used to sit here are gone: an optimal range bounded by the sight
         * radius has no tail to price (Section 7.33.4). TBD
         */
        rangeHeadroomShare: z.number().min(1),
      })
      .strict(),
    /**
     * What a generated weapon must beat to be worth taking (Section 7.3).
     *
     * The baseline is the fallback that every bot carries. It reaches every
     * band and it never runs dry, and it pays for that with a lower level. A
     * weapon from the ground that does not clear these lines is not a prize,
     * so the generator throws it away and rolls again.
     */
    floor: z
      .object({
        _notes: z.string().optional(),
        /** The band-weighted DPS, over the DPS of the baseline. */
        meanDpsMargin: positiveNumber,
        /** An assault weapon, in its best band, over the DPS of the baseline. */
        assaultBestBandMargin: positiveNumber,
        /** A precise weapon fires in this share of the baseline interval. */
        preciseFireIntervalShare: unitRange,
        /** A precise weapon answers in this share of the baseline reaction. */
        preciseReactionShare: unitRange,
      })
      .strict(),
  })
  .strict();

export type WeaponRoles = z.infer<typeof WeaponRolesSchema>;

/** `data/weapons/*.json`: one weapon (Section 6.3). */
export const WeaponSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    archetype: z.enum([
      "precision",
      "assault",
      "marksman",
      "heavy",
      "splash",
      "denial",
      "versatile",
      "baseline",
      "redeemer",
    ]),
    role: z.enum(["precise", "assault", "sniper", "heavy"]).nullable(),
    tier: z.string().min(1),
    attackType: z.enum(ATTACK_TYPE_NAMES),
    damage: positiveNumber,
    fireIntervalTicks: positiveInt,
    /** The furthest a bot fires this weapon, in cells. Derived (Section 7.33). */
    rangeMax: positiveNumber,
    /** The distance the weapon is built for. Accuracy peaks here. */
    optimalRange: positiveNumber,
    /** How far from `optimalRange` it stays useful, in cells. */
    rangeTolerance: positiveNumber,
    projectileSpeed: positiveNumber.nullable(),
    aoeRadius: z.number().nonnegative(),
    coneHalfAngle: z.number().nonnegative(),
    ricochetBounces: nonNegativeInt,
    dotDamage: z.number().nonnegative(),
    dotTicks: nonNegativeInt,
    hazardTicks: nonNegativeInt,
    hazardRadius: z.number().nonnegative(),
    hazardDamagePerTick: z.number().nonnegative(),
    /** Rounds that one universal ammo pickup gives this weapon. */
    /**
     * Rounds that one universal ammo pickup gives this weapon. 0 means an ammo
     * point does not refill it, which is what makes the Redeemer one shot
     * (Section 7.20.18).
     */
    ammoPerPickup: nonNegativeInt,
    critChance: unitRange,
    critConditions: z.array(z.string()),
    ammoMax: positiveInt,
    traits: z.array(z.string()),
    reactionByBand: bandValues,
    dpsProfile: bandValues,
    budgetUsed: z.number().nonnegative(),
    /** Radians of turn per tick toward the target. Only the Redeemer uses it. */
    homingTurnRate: z.number().nonnegative().optional(),
    /** Damage that the shot itself takes before it detonates early. */
    projectileHealth: z.number().nonnegative().optional(),
  })
  .strict();

/** `data/arena-profiles.json`: the generator profiles of Section 7.2. */
export const ArenaRulesSchema = z
  .object({
    minFloorCycles: nonNegativeInt,
    maxSpawnFairness: z.number().nonnegative(),
    minLongSightline: positiveNumber,
    maxCloseSightline: positiveNumber,
    minOpenAreaRatio: unitRange,
    maxOpenAreaRatio: unitRange,
    minFloorCells: positiveInt,
  })
  .strict();


export const ArenaProfileSchema = z
  .object({
    id: z.string().min(1),
    style: z.enum(["bastion", "openfield", "cavern"]),
    width: positiveInt,
    height: positiveInt,
    coverDensity: unitRange,
    hazardDensity: unitRange,
    roomsAcross: positiveInt.optional(),
    roomsDown: positiveInt.optional(),
    extraDoorChance: unitRange.optional(),
    /**
     * A hall in the middle of the arena, over the grid of rooms
     * (Section 7.20.25). It gives the style one open space to fight over.
     * Leave it out and the style builds rooms alone.
     */
    centreRoom: z
      .object({
        width: range,
        height: range,
        /** Pillars inside the hall, so it is not a bare floor. */
        pillars: range,
      })
      .strict()
      .optional(),
    obstacleDensity: unitRange.optional(),
    obstacleSize: z.tuple([positiveInt, positiveInt]).optional(),
    noiseDensity: unitRange.optional(),
    smoothPasses: nonNegativeInt.optional(),
    /** Rules that this style replaces (Section 7.20.19). */
    rules: ArenaRulesSchema.partial().optional(),
  })
  .strict();

export const ArenaProfilesSchema = z
  .object({
    _notes: z.string().optional(),
    schemaVersion: z.literal(1),
    tbd: z.array(z.string()),
    rules: ArenaRulesSchema,
    profiles: z.record(z.string().min(1), ArenaProfileSchema),
  })
  .strict();

export type ArenaProfiles = z.infer<typeof ArenaProfilesSchema>;
