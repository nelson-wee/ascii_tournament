/** Arena module (dev-guide Section 7.2). Milestone M1 loads a static map. */
import testArenaText from "../../data/arenas/test-arena.txt?raw";
import { parseArenaText } from "./textArena.js";
import type { ArenaMap } from "./types.js";

export * from "./types.js";
export { parseArenaText, ArenaParseError } from "./textArena.js";
export type { ParseArenaOptions } from "./textArena.js";
export { orderSpawnsForFairness } from "./spawnOrder.js";
export { distanceField, pickupEvenness } from "./contested.js";

let testArenaCache: ArenaMap | null = null;

/** The hand-made test arena of Milestone M1. The result is cached. */
export function loadTestArena(): ArenaMap {
  testArenaCache ??= parseArenaText(testArenaText, { source: "data/arenas/test-arena.txt" });
  return testArenaCache;
}

/** Forget the cached arena. The tests use this. */
export function clearArenaCache(): void {
  testArenaCache = null;
}
