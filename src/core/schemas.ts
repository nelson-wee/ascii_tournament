/**
 * Zod schemas for the data files (dev-guide Sections 3 and 9).
 * Validation at load time finds data errors early.
 * A schema of a later system arrives with that system's milestone.
 */
import { z } from "zod";

const positiveInt = z.number().int().positive();
const positiveNumber = z.number().positive();

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
        /** Kills that end a round. TBD */
        scoreLimit: positiveInt,
        /** Ticks that end a round. TBD */
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
