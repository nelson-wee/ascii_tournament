/**
 * The numbers the conflict measure runs with (dev-guide Section 7.35).
 *
 * It sits apart from `conflict.ts` so that the measure itself stays a pure
 * function of a map and its options: a test can hand it whatever numbers it
 * likes, and everything that builds a real arena reads the same tuning.
 */
import { loadTuning } from "../core/data.js";
import type { ConflictOptions } from "./conflict.js";

export function conflictOptions(): ConflictOptions {
  const tuning = loadTuning();
  return {
    teamSize: tuning.match.teamSize,
    sightRadiusCells: tuning.perception.sightRadiusCells,
    contestedSpanSteps: tuning.conflict.contestedSpanSteps,
    sampleCells: tuning.conflict.sampleCells,
    bestCount: tuning.conflict.bestCount,
  };
}
