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
        /** The base consideration of each action, before the tactics weights. TBD */
        actionBase: z
          .object({
            engage: positiveNumber,
            chase: positiveNumber,
            retreat: positiveNumber,
            seekPickup: positiveNumber,
            holdPosition: positiveNumber,
            reposition: positiveNumber,
            switchWeapon: positiveNumber,
            follow: positiveNumber,
          })
          .strict(),
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
      .enum(["precision", "splash", "burst", "denial", "versatile", "baseline"])
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
export const BatchConfigSchema = z
  .object({
    _notes: z.string().optional(),
    rounds: positiveInt,
    seed: z.number().int(),
    arenas: z.array(z.string().min(1)).min(1),
    presets: z.record(z.string().min(1), TacticsSchema),
    outDir: z.string().min(1),
  })
  .strict()
  .refine((value) => Object.keys(value.presets).length > 0, "batch.json needs one preset minimum");

export type BatchConfig = z.infer<typeof BatchConfigSchema>;

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
    critChance: unitRange,
    critConditions: z.array(z.string()),
    ammoMax: positiveInt,
    traits: z.array(z.string()),
    reactionByBand: bandValues,
    dpsProfile: bandValues,
    budgetUsed: z.number().nonnegative(),
  })
  .strict();
