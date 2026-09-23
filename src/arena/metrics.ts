/**
 * Arena metrics and validation (dev-guide Section 7.2, steps 6 and 7).
 *
 * The metrics describe the shape of an arena in numbers, so that a generator
 * can reject a bad one and the pre-match screen can describe a good one in
 * plain words. They read the grid alone: no macro graph is needed, because two
 * of the three styles of Section 7.20.19 do not build one.
 */
import { Tile, cellIndex, isWalkable, tileAt, type ArenaMap } from "./types.js";
import { distanceField, pickupEvenness } from "./contested.js";
import type { Cell } from "../core/types.js";

/** What the shape of an arena measures (Section 7.2). */
export interface ArenaMetrics {
  /** True if every floor cell reaches every other floor cell. */
  connected: boolean;
  /** Floor cells that the arena has. */
  floorCells: number;
  /** Floor cells as a part of the whole grid. */
  openAreaRatio: number;
  /** Low cover cells as a part of the floor. */
  coverDensity: number;
  /**
   * Independent cycles of the floor graph: `edges - cells + 1`.
   *
   * It is a crude measure. An open field has thousands of cycles and a maze has
   * few, so it separates a tree-like arena from every other kind and little
   * else. The route count that Section 7.2 asks for needs the macro graph,
   * which only the `bastion` style could build (Section 7.20.19).
   */
  floorCycles: number;
  /** Floor cells with one walkable neighbour. */
  deadEnds: number;
  /** Floor cells whose removal splits the arena in two. */
  chokepoints: number;
  /** The mean longest straight open run through a floor cell, in cells. */
  meanSightline: number;
  /** The 10th percentile of the same measure: how tight the tight ground is. */
  sightline10: number;
  /** The 90th percentile of the same measure. */
  sightline90: number;
  /** The longest straight open run in the arena. */
  longestSightline: number;
  /**
   * How even the best power-up point is, in steps. 0 means both teams reach a
   * power-up together (Section 7.2.1).
   *
   * It reads the power-up points alone, and the best of them, because not every
   * point is meant to be even: a health point near a team is that team's, and
   * that is the trade a player makes. The **key** points are the ones that
   * decide a round (Section 7.2 step 5).
   */
  spawnFairness: number;
  /** The share of pickup points that both teams reach together. */
  contestedShare: number;
}

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Every cell that a bot can stand on. */
function walkableCells(map: ArenaMap): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (isWalkable(tileAt(map, x, y))) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * The longest straight open run through a cell, over the four directions.
 *
 * A sightline is what decides the range band that a fight happens at
 * (Section 7.20.15), so it is the metric that separates one style of arena from
 * another. Only a wall ends a run, because only a wall blocks sight in the
 * simulation (`blocksSight` of Section 7.7). Low cover is a shooting position,
 * not a screen.
 */
function sightlineThrough(map: ArenaMap, cell: Cell): number {
  let longest = 0;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ] as const) {
    let run = 1;
    for (const sign of [1, -1]) {
      let x = cell.x + dx * sign;
      let y = cell.y + dy * sign;
      while (tileAt(map, x, y) !== Tile.Wall) {
        run += 1;
        x += dx * sign;
        y += dy * sign;
      }
    }
    if (run > longest) longest = run;
  }
  return longest;
}

/** Measure the shape of an arena (Section 7.2 step 6). */
export function measureArena(map: ArenaMap, teamSize = 3): ArenaMetrics {
  const cells = walkableCells(map);
  const total = map.width * map.height;
  const index = new Set(cells.map((cell) => cellIndex(map, cell.x, cell.y)));

  // Connectivity and the loop count, from the floor graph.
  let edges = 0;
  let deadEnds = 0;
  for (const cell of cells) {
    let neighbours = 0;
    for (const [dx, dy] of STEPS) {
      if (!index.has(cellIndex(map, cell.x + dx, cell.y + dy))) continue;
      neighbours += 1;
      // Count each edge one time.
      if (dx > 0 || dy > 0) edges += 1;
    }
    if (neighbours <= 1) deadEnds += 1;
  }

  const reached = cells.length === 0 ? 0 : floodSize(map, cells[0] as Cell, index);
  const connected = reached === cells.length;
  const loopCount = Math.max(0, edges - cells.length + 1);

  let cover = 0;
  for (const cell of cells) if (tileAt(map, cell.x, cell.y) === Tile.CoverLow) cover += 1;

  const sightlines = cells.map((cell) => sightlineThrough(map, cell)).sort((a, b) => a - b);
  const mean =
    sightlines.length === 0 ? 0 : sightlines.reduce((sum, run) => sum + run, 0) / sightlines.length;
  const at90 = sightlines[Math.floor(sightlines.length * 0.9)] ?? 0;
  const at10 = sightlines[Math.floor(sightlines.length * 0.1)] ?? 0;

  const evenness = pickupEvenness(map, teamSize);
  const powerupPoints = map.pickups.filter((point) => point.kind === "powerup");
  const keyGaps = powerupPoints
    .map((point) => evenness.get(point.slotId) ?? Infinity)
    .filter((value) => Number.isFinite(value));
  let contested = 0;
  for (const value of evenness.values()) if (Number.isFinite(value) && value <= 2) contested += 1;

  return {
    connected,
    floorCells: cells.length,
    openAreaRatio: total === 0 ? 0 : cells.length / total,
    coverDensity: cells.length === 0 ? 0 : cover / cells.length,
    floorCycles: loopCount,
    deadEnds,
    chokepoints: countChokepoints(map, cells, index),
    meanSightline: mean,
    sightline10: at10,
    sightline90: at90,
    longestSightline: sightlines[sightlines.length - 1] ?? 0,
    spawnFairness: keyGaps.length === 0 ? 0 : Math.min(...keyGaps),
    contestedShare: evenness.size === 0 ? 0 : contested / evenness.size,
  };
}

/** How many cells one flood fill from a cell reaches. */
function floodSize(map: ArenaMap, start: Cell, index: ReadonlySet<number>): number {
  const seen = new Set<number>([cellIndex(map, start.x, start.y)]);
  const queue: Cell[] = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head] as Cell;
    for (const [dx, dy] of STEPS) {
      const next = cellIndex(map, cell.x + dx, cell.y + dy);
      if (!index.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push({ x: cell.x + dx, y: cell.y + dy });
    }
  }
  return seen.size;
}

/**
 * Cells whose removal splits the arena. They are the chokepoints of
 * Section 7.2: the ground that a team holds to shut a route.
 *
 * The count uses a sample on a large arena, because the exact answer costs one
 * flood fill per cell.
 */
function countChokepoints(map: ArenaMap, cells: readonly Cell[], index: ReadonlySet<number>): number {
  if (cells.length === 0) return 0;
  const step = cells.length > 1200 ? Math.ceil(cells.length / 1200) : 1;
  let found = 0;
  let tested = 0;

  for (let i = 0; i < cells.length; i += step) {
    const cell = cells[i] as Cell;
    // A cell with fewer than two walkable neighbours cannot split anything.
    let neighbours = 0;
    for (const [dx, dy] of STEPS) {
      if (index.has(cellIndex(map, cell.x + dx, cell.y + dy))) neighbours += 1;
    }
    tested += 1;
    if (neighbours < 2) continue;

    const without = new Set(index);
    without.delete(cellIndex(map, cell.x, cell.y));
    const start = neighbourOf(map, cell, without);
    if (!start) continue;
    if (floodSize(map, start, without) !== without.size) found += 1;
  }
  return step === 1 ? found : Math.round((found / Math.max(1, tested)) * cells.length);
}

function neighbourOf(map: ArenaMap, cell: Cell, index: ReadonlySet<number>): Cell | null {
  for (const [dx, dy] of STEPS) {
    if (index.has(cellIndex(map, cell.x + dx, cell.y + dy))) {
      return { x: cell.x + dx, y: cell.y + dy };
    }
  }
  return null;
}

/** The rules that an arena must pass (Section 7.2 step 7). Values are TBD. */
export interface ArenaRules {
  minFloorCycles: number;
  maxSpawnFairness: number;
  minLongSightline: number;
  /** Section 7.2: an arena needs a close-quarters area as well as a fire lane. */
  maxCloseSightline: number;
  minOpenAreaRatio: number;
  maxOpenAreaRatio: number;
  minFloorCells: number;
}

/** Check an arena against the rules. An empty list means it passes. */
export function validateArena(metrics: ArenaMetrics, rules: ArenaRules): string[] {
  const failures: string[] = [];
  if (!metrics.connected) failures.push("the arena is not connected");
  if (metrics.floorCycles < rules.minFloorCycles) {
    failures.push(
      `the arena has ${metrics.floorCycles} cycles, and the rule asks for ${rules.minFloorCycles}`,
    );
  }
  if (metrics.sightline10 > rules.maxCloseSightline) {
    failures.push(
      `the tightest ground still sees ${metrics.sightline10} cells, and the rule asks for ${rules.maxCloseSightline} or less`,
    );
  }
  if (metrics.spawnFairness > rules.maxSpawnFairness) {
    failures.push(
      `the best power-up point is ${metrics.spawnFairness} steps nearer to one team, and the rule allows ${rules.maxSpawnFairness}`,
    );
  }
  if (metrics.longestSightline < rules.minLongSightline) {
    failures.push(
      `the longest sightline is ${metrics.longestSightline} cells, and the rule asks for ${rules.minLongSightline}`,
    );
  }
  if (metrics.openAreaRatio < rules.minOpenAreaRatio || metrics.openAreaRatio > rules.maxOpenAreaRatio) {
    failures.push(`the open area is ${(metrics.openAreaRatio * 100).toFixed(0)} % of the grid`);
  }
  if (metrics.floorCells < rules.minFloorCells) {
    failures.push(`the arena has ${metrics.floorCells} floor cells`);
  }
  return failures;
}

/** Describe an arena in plain words, for the pre-match screen (Section 7.2). */
export function describeArena(metrics: ArenaMetrics): string[] {
  const lines: string[] = [];
  lines.push(
    metrics.sightline90 >= 24
      ? "Long fire lanes."
      : metrics.sightline90 >= 14
        ? "Mixed sightlines."
        : "Short sightlines.",
  );
  lines.push(
    metrics.openAreaRatio >= 0.6
      ? "Open ground."
      : metrics.openAreaRatio >= 0.4
        ? "Broken ground."
        : "Tight ground.",
  );
  if (metrics.chokepoints > 0) lines.push(`${metrics.chokepoints} chokepoints.`);
  if (metrics.coverDensity >= 0.08) lines.push("Plenty of cover.");
  lines.push(metrics.floorCycles >= 300 ? "Many ways around." : "Few ways around.");
  return lines;
}

/** The distance from each spawn group to a cell. Exported for the generator. */
export function spawnDistances(map: ArenaMap, teamSize = 3): { a: Int32Array; b: Int32Array } {
  return {
    a: distanceField(map, map.spawns.slice(0, teamSize)),
    b: distanceField(map, map.spawns.slice(teamSize, teamSize * 2)),
  };
}
