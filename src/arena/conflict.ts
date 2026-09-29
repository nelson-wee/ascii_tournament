/**
 * Where the fight happens, and which ground overlooks it (dev-guide Section 7.35).
 *
 * Section 7.31 found that the arena measurement never reaches a bot: `chokepoints`,
 * `meanSightline` and the rest feed the acceptance rule and the report and
 * nothing else. A bot's whole spatial model was its own field of view, the pickup
 * list and two influence maps, and `positionValue` called a cell good when a
 * pickup was near it. No bot had any idea where a fight was likely.
 *
 * Three sweeps then showed why that matters more than any weapon number. The
 * bands, the reach cap and the range curve each fixed a real defect, and the
 * Overwatch composition did not move once (Section 7.34.4). An Overwatch bot
 * cannot select a sight line, so it cannot create the long-range fight its
 * weapon is built for.
 *
 * This measures two things per cell, once, when the arena is built:
 *
 * - **`contested`** — how evenly the two teams reach it. Both arriving together
 *   means the ground is fought over. This is the "conflict zone".
 * - **`coverage`** — how much of that contested ground the cell can see. A cell
 *   that overlooks the whole middle of a bastion scores high; a corner behind a
 *   spawn scores zero.
 *
 * `coverage` is what an Overwatch bot wants and what `TakePosition` reads.
 *
 * It holds no RNG and no browser API: it is a walk over the grid, so the same
 * arena always gives the same field.
 */
import { cellSeesCell } from "./sight.js";
import { distanceField } from "./contested.js";
import { cellIndex, isWalkable, tileAt, type ArenaMap } from "./types.js";
import type { Cell } from "../core/types.js";

export interface ConflictField {
  /**
   * How contested each cell is, 0 to 1. 1 means the two teams reach it in the
   * same number of steps; 0 means one team owns it, or nobody reaches it.
   */
  contested: Float32Array;
  /**
   * How much of the contested ground each cell sees, 0 to 1, with 1 at the best
   * cell of the arena. A cell no bot can stand on scores 0.
   */
  coverage: Float32Array;
  /** The cells that scored highest, best first. The report reads them. */
  best: Cell[];
}

export interface ConflictOptions {
  /** Bots a team. The first `teamSize` spawns are team A's. */
  teamSize: number;
  /** How far a bot sees, in cells. Coverage past this is not coverage. */
  sightRadiusCells: number;
  /**
   * How many steps of difference still counts as contested. A cell the two
   * teams reach 4 steps apart is most of a conflict zone; one they reach 20
   * steps apart belongs to the nearer team.
   */
  contestedSpanSteps: number;
  /**
   * The most contested cells to test visibility against. Every floor cell is
   * tested against this many, so the cost is `floor * sample`. An even spread
   * of the contested set, so the answer does not move with the sample size.
   */
  sampleCells: number;
  /** How many cells `best` holds. */
  bestCount: number;
}

/** Take at most `count` cells, spread evenly, so the answer is repeatable. */
function spread(cells: readonly Cell[], count: number): Cell[] {
  if (cells.length <= count) return [...cells];
  const stride = cells.length / count;
  const out: Cell[] = [];
  for (let i = 0; i < count; i += 1) out.push(cells[Math.floor(i * stride)] as Cell);
  return out;
}

/**
 * Measure the conflict zone of an arena and what overlooks it.
 *
 * The cost is one breadth-first walk a team, plus `floor * sampleCells` line
 * checks. It runs once when the arena is built, never in a round.
 */
export function measureConflict(map: ArenaMap, options: ConflictOptions): ConflictField {
  const size = map.width * map.height;
  const contested = new Float32Array(size);
  const coverage = new Float32Array(size);

  const first = distanceField(map, map.spawns.slice(0, options.teamSize));
  const second = distanceField(map, map.spawns.slice(options.teamSize, options.teamSize * 2));

  // A cell is contested when both teams reach it and reach it together. The
  // score falls to nothing over `contestedSpanSteps`, so the zone has an edge
  // rather than a wall.
  const span = Math.max(1, options.contestedSpanSteps);
  const hot: Cell[] = [];
  const floor: Cell[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (!isWalkable(tileAt(map, x, y))) continue;
      const index = cellIndex(map, x, y);
      floor.push({ x, y });
      const a = first[index] ?? -1;
      const b = second[index] ?? -1;
      if (a < 0 || b < 0) continue;
      const score = Math.max(0, 1 - Math.abs(a - b) / span);
      contested[index] = score;
      if (score > 0) hot.push({ x, y });
    }
  }

  // How much of the conflict zone each cell of the floor can see. The sample is
  // an even spread of the contested cells, weighted by how contested each is, so
  // a cell that overlooks the heart of the zone beats one that clips its edge.
  const sample = spread(hot, options.sampleCells);
  const reach = options.sightRadiusCells;
  let most = 0;
  for (const cell of floor) {
    const index = cellIndex(map, cell.x, cell.y);
    let seen = 0;
    for (const target of sample) {
      const dx = target.x - cell.x;
      const dy = target.y - cell.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (!cellSeesCell(map, cell, target)) continue;
      seen += contested[cellIndex(map, target.x, target.y)] as number;
    }
    coverage[index] = seen;
    if (seen > most) most = seen;
  }

  if (most > 0) {
    for (let i = 0; i < size; i += 1) coverage[i] = (coverage[i] as number) / most;
  }

  // The best ground of the arena, for the report and the pre-match screen. Ties
  // break by cell index, so the list never moves with the order of the walk.
  const best = floor
    .slice()
    .sort((one, two) => {
      const a = coverage[cellIndex(map, one.x, one.y)] as number;
      const b = coverage[cellIndex(map, two.x, two.y)] as number;
      if (b !== a) return b - a;
      return cellIndex(map, one.x, one.y) - cellIndex(map, two.x, two.y);
    })
    .slice(0, options.bestCount);

  return { contested, coverage, best };
}

/** How much of the conflict zone a cell sees, 0 to 1. 0 when nothing measured it. */
export function coverageAt(map: ArenaMap, x: number, y: number): number {
  const field = map.conflict;
  if (!field) return 0;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  return field.coverage[cellIndex(map, x, y)] ?? 0;
}

/** How contested a cell is, 0 to 1. 0 when nothing measured it. */
export function contestedAt(map: ArenaMap, x: number, y: number): number {
  const field = map.conflict;
  if (!field) return 0;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  return field.contested[cellIndex(map, x, y)] ?? 0;
}
