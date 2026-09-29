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
import type { RangeBand } from "../weapons/types.js";

/** One value per range band. `BandValues` of `weapons/types.ts` in field form. */
export interface BandFields {
  close: Float32Array;
  mid: Float32Array;
  long: Float32Array;
}

export interface ConflictField {
  /**
   * How contested each cell is, 0 to 1. 1 means the two teams reach it in the
   * same number of steps; 0 means one team owns it, or nobody reaches it.
   */
  contested: Float32Array;
  /**
   * How much of the contested ground each cell sees **at each range band**.
   *
   * One flat count was the defect of Section 7.36.2. The cell that sees the most
   * contested ground is a cell in the middle of it, so a flat count named the
   * knife fight as the best ground in the arena and `TakePosition` walked an
   * Overwatch bot into it. Splitting by band lets a bot ask the question its own
   * weapon cares about: not "how much of the fight can I see" but "how much of
   * the fight can I see **at a distance I am good at**".
   *
   * The three share one normaliser, the largest total of any cell, so they stay
   * comparable and they sum to at most 1. An arena that offers no long view of
   * its conflict zone gives a low `long` everywhere, which is the true answer:
   * there is nowhere good for a marksman to stand.
   */
  coverage: BandFields;
  /** The cells with the highest total, best first. The report reads them. */
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
  /** The highest distance of the close band, in cells. */
  closeMax: number;
  /** The highest distance of the mid band, in cells. */
  midMax: number;
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
  const coverage: BandFields = {
    close: new Float32Array(size),
    mid: new Float32Array(size),
    long: new Float32Array(size),
  };

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

  // How much of the conflict zone each cell of the floor can see, split by the
  // band it sees it at. The sample is an even spread of the contested cells,
  // weighted by how contested each is, so a cell that overlooks the heart of the
  // zone beats one that clips its edge.
  //
  // Splitting by band costs no extra line checks: every visible pair is counted
  // once, into one bucket instead of a flat total.
  const sample = spread(hot, options.sampleCells);
  const reach = options.sightRadiusCells;
  const closeMaxSq = options.closeMax * options.closeMax;
  const midMaxSq = options.midMax * options.midMax;
  let most = 0;
  for (const cell of floor) {
    const index = cellIndex(map, cell.x, cell.y);
    let near = 0;
    let middle = 0;
    let far = 0;
    for (const target of sample) {
      const dx = target.x - cell.x;
      const dy = target.y - cell.y;
      const square = dx * dx + dy * dy;
      if (square > reach * reach) continue;
      if (!cellSeesCell(map, cell, target)) continue;
      const worth = contested[cellIndex(map, target.x, target.y)] as number;
      if (square <= closeMaxSq) near += worth;
      else if (square <= midMaxSq) middle += worth;
      else far += worth;
    }
    coverage.close[index] = near;
    coverage.mid[index] = middle;
    coverage.long[index] = far;
    const total = near + middle + far;
    if (total > most) most = total;
  }

  // One normaliser for all three, so the bands stay comparable and an arena with
  // no long view of its zone says so rather than inflating its best long cell.
  if (most > 0) {
    for (const band of ["close", "mid", "long"] as const) {
      const field = coverage[band];
      for (let i = 0; i < size; i += 1) field[i] = (field[i] as number) / most;
    }
  }

  // The best ground of the arena by total coverage, for the report and the
  // pre-match screen. Ties break by cell index, so the list never moves with the
  // order of the walk.
  const totalAt = (cell: Cell): number => {
    const i = cellIndex(map, cell.x, cell.y);
    return (
      (coverage.close[i] as number) + (coverage.mid[i] as number) + (coverage.long[i] as number)
    );
  };
  const best = floor
    .slice()
    .sort((one, two) => {
      const a = totalAt(one);
      const b = totalAt(two);
      if (b !== a) return b - a;
      return cellIndex(map, one.x, one.y) - cellIndex(map, two.x, two.y);
    })
    .slice(0, options.bestCount);

  return { contested, coverage, best };
}

/**
 * How much of the conflict zone a cell sees at one band, 0 to 1.
 * 0 when nothing measured the map.
 */
export function coverageAt(map: ArenaMap, x: number, y: number, band: RangeBand): number {
  const field = map.conflict;
  if (!field) return 0;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  return field.coverage[band][cellIndex(map, x, y)] ?? 0;
}

/**
 * How much of the conflict zone a cell sees at any band, 0 to 1.
 *
 * The report and the pre-match screen read this; a bot does not, because a bot
 * cares at what range it sees the fight (Section 7.36.3).
 */
export function coverageTotalAt(map: ArenaMap, x: number, y: number): number {
  return (
    coverageAt(map, x, y, "close") + coverageAt(map, x, y, "mid") + coverageAt(map, x, y, "long")
  );
}

/** How contested a cell is, 0 to 1. 0 when nothing measured it. */
export function contestedAt(map: ArenaMap, x: number, y: number): number {
  const field = map.conflict;
  if (!field) return 0;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  return field.contested[cellIndex(map, x, y)] ?? 0;
}
