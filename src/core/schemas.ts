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
        /** How much the hit chance falls across the full range of a weapon. TBD */
        distanceFalloff: unitRange,
        /** How much a moving target lowers the hit chance. TBD */
        movingTargetPenalty: unitRange,
        /** The lowest hit chance, whatever the distance. TBD */
        minHitChance: unitRange,
        /** How much the evasion of a bot lowers its own accuracy. TBD */
        evasionAccuracyPenalty: unitRange,
        /**
         * A new target must be this much nearer than the current one, as a
         * part of the current distance. 0.8 means 20 % nearer. TBD
         */
        targetSwitchMargin: unitRange,
      })
      .strict(),
    ai: z
      .object({
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
        preferredRangeBias: z.number().min(0),
        /**
         * How much the danger of a pickup point lowers its worth. Item control
         * won 19 points of win rate and never turned over, because a run
         * across the arena cost nothing (Section 4 of the M8 weapon analysis).
         * A tactic with only a benefit breaks the rule of Section 7.8. TBD
         */
        pickupRiskWeight: z.number().nonnegative(),
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
            retreat: positiveNumber,
            seekPickup: positiveNumber,
            holdPosition: positiveNumber,
            reposition: positiveNumber,
            follow: positiveNumber,
          })
          .strict(),
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

/** `data/tactics.json`: the tactics presets (Section 6.4). */
export const TacticsSchema = z
  .object({
    aggression: unitRange,
    retreatThreshold: unitRange,
    preferredRange: z.enum(["close", "mid", "long"]),
    weaponRolePref: z
      .enum([
        "precision",
        "assault",
        "marksman",
        "heavy",
        "splash",
        "denial",
        "versatile",
        "baseline",
      ])
      .nullable(),
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
    outDir: z.string().min(1),
  })
  .strict()
  .refine((value) => Object.keys(value.presets).length > 0, "batch.json needs one preset minimum");

export type BatchConfig = z.infer<typeof BatchConfigSchema>;

/** `data/roles.json`: the role presets and their behavior weights (Section 7.11). */
export const TeamTacticsSchema = z
  .object({
    cohesion: unitRange,
    focusFire: unitRange,
    spacing: unitRange,
    trading: unitRange,
  })
  .strict();

export type TeamTactics = z.infer<typeof TeamTacticsSchema>;

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
          rangeMax: range,
          ammoMax: range,
          critChance: range,
          critConditions: z.array(z.string()),
          bandMultiplier: bandValues,
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
        rangeWeight: z.number().nonnegative(),
        critWeight: z.number().nonnegative(),
        lineWeight: z.number().nonnegative(),
        ricochetWeight: z.number().nonnegative(),
        reactionDiscount: z.number().nonnegative(),
        ammoWeight: z.number().nonnegative(),
        /**
         * The budget stops paying for reach past this distance, in cells. The
         * arena fires 1 % of its shots past the mid band, so a weapon that
         * reaches 46 cells paid 9 points of 100 for nothing (Section 3.2 of
         * the M8 weapon analysis). Keep it near `combat.rangeBandMidMax`. TBD
         */
        rangeValueCapCells: positiveNumber,
        /**
         * What a cell of reach past the cap is worth, against a cell inside it.
         * A hard cut gave the sniper role 9 points of budget back and it took
         * 29 % of the kills, so the tail has a price, not a wall. TBD
         */
        rangeValueTailShare: unitRange,
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
    ]),
    role: z.enum(["precise", "assault", "sniper", "heavy"]).nullable(),
    tier: z.string().min(1),
    attackType: z.enum(ATTACK_TYPE_NAMES),
    damage: positiveNumber,
    fireIntervalTicks: positiveInt,
    rangeMax: positiveNumber,
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
    ammoPerPickup: positiveInt,
    critChance: unitRange,
    critConditions: z.array(z.string()),
    ammoMax: positiveInt,
    traits: z.array(z.string()),
    reactionByBand: bandValues,
    dpsProfile: bandValues,
    budgetUsed: z.number().nonnegative(),
  })
  .strict();
