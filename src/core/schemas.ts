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
      })
      .strict(),
    perception: z
      .object({
        /** The sight radius of a bot, in cells. TBD */
        sightRadiusCells: positiveNumber,
        /** Ticks that a bot remembers the last seen position of an enemy. TBD */
        memoryTicks: positiveInt,
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
        /** How much the hit chance falls across the full range of a weapon. TBD */
        distanceFalloff: unitRange,
        /** How much a moving target lowers the hit chance. TBD */
        movingTargetPenalty: unitRange,
        /** The lowest hit chance, whatever the distance. TBD */
        minHitChance: unitRange,
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
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) => value.match.roundWinsToWinMatch <= value.match.maxRounds,
    "match.roundWinsToWinMatch must not be more than match.maxRounds",
  );

export type Tuning = z.infer<typeof TuningSchema>;

/** `data/weapons/*.json`: one weapon (Section 6.3). */
export const WeaponSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    archetype: z.enum(["precision", "splash", "burst", "denial", "versatile", "baseline"]),
    delivery: z.enum(["hitscan", "projectile"]),
    damage: positiveNumber,
    fireIntervalTicks: positiveInt,
    rangeMax: positiveNumber,
    projectileSpeed: positiveNumber.nullable(),
    aoeRadius: z.number().nonnegative(),
    dotDamage: z.number().nonnegative(),
    dotTicks: nonNegativeInt,
    hazardTicks: nonNegativeInt,
    critChance: unitRange,
    critConditions: z.array(z.string()),
    ammoMax: positiveInt,
    traits: z.array(z.string()),
    dpsProfile: z
      .object({
        close: z.number().nonnegative(),
        mid: z.number().nonnegative(),
        long: z.number().nonnegative(),
      })
      .strict(),
    budgetUsed: z.number().nonnegative(),
  })
  .strict()
  .refine(
    (weapon) => (weapon.delivery === "projectile") === (weapon.projectileSpeed !== null),
    "a projectile weapon needs a projectileSpeed, and a hitscan weapon needs null",
  );
