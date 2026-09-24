/**
 * Navigation (dev-guide Section 7.10).
 *
 * The A* of rot.js keeps its open list in a plain array and searches it in a
 * straight line, so one path across the test arena costs about 1.8 ms. The
 * batch harness of M5 runs millions of paths, so this module has its own A*:
 *
 * - A binary heap for the open list.
 * - Typed arrays for the scores, with a generation stamp instead of a clear.
 * - The diagonal corner rule inside the neighbour step, so a path never cuts
 *   the corner of a wall and no repair step is necessary.
 * - A cost per cell, which the influence maps of Section 7.9 need at M8.
 *
 * Milestone M4 gives plain shortest paths plus a yes-or-no rule for hazard
 * tiles. The danger cost `danger × (1 − hazardTolerance)` arrives with M8.
 */
import { Tile, isWalkable, tileAt, type ArenaMap } from "../arena/types.js";
import type { Cell } from "../core/types.js";

/** 4 = cardinal steps only. 8 = cardinal and diagonal steps. */
export type Topology = 4 | 8;

export interface FindPathOptions {
  topology?: Topology;
  /**
   * Treat a hazard tile as a wall.
   *
   * The `hazardTolerance` tactic controls this value. It is the simple form of
   * the path cost `danger × (1 − hazardTolerance)` of Section 7.10.
   */
  avoidHazard?: boolean;
}

const SQRT2 = Math.SQRT2;

/** The eight steps, cardinal first. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * The scan order of the neighbours (dev-guide Section 7.20.23).
 *
 * Two routes of the same length are both shortest, and the search returns the
 * one that it met first. Which one that is comes from the order that the
 * neighbours are scanned in. A fixed order, written against the axes of the
 * world, is not the same order after a half turn: `[1, 0]` comes before
 * `[-1, 0]`, so a bot that walks to the right and a bot that walks to the left
 * break a tie the other way round.
 *
 * An arena is symmetric under a half turn, so the two teams walk mirrored
 * routes to mirrored goals. With an axis order they got routes of the same
 * length but of a different shape, and one team crossed more open ground than
 * the other. Measured over 1800 rounds, the half of the arena that team B
 * starts in was worth about 3 points of win rate.
 *
 * So the order is written against the **way to the goal**, not against the
 * axes: the neighbour most in line with the goal first, and a tie broken by
 * the side that the neighbour sits on. A half turn turns the way to the goal
 * and the neighbours together, so the order turns with them and the two teams
 * get mirrored routes.
 *
 * `ORDERS[k]` is the order for a goal in octant `k`. Everything is integer
 * arithmetic, so `ORDERS[k + 4]` holds the exact negation of `ORDERS[k]`.
 */
const OCTANTS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function orderFor(way: readonly [number, number], steps: number): (readonly [number, number])[] {
  const [gx, gy] = way;
  return DIRECTIONS.slice(0, steps)
    .map((step) => step)
    .sort((a, b) => {
      // In line with the goal first. Both keys keep their value under a half
      // turn, because the goal and the step turn together.
      const dot = (b[0] * gx + b[1] * gy) - (a[0] * gx + a[1] * gy);
      if (dot !== 0) return dot;
      return (gx * b[1] - gy * b[0]) - (gx * a[1] - gy * a[0]);
    });
}

/** The eight steps, in the order to scan them for a goal in each octant. */
const ORDERS: readonly (readonly (readonly [number, number])[])[] = OCTANTS.map((way) =>
  orderFor(way, DIRECTIONS.length),
);

/** The same, for a four-way topology. The cardinals are the first four steps. */
const CARDINAL_ORDERS: readonly (readonly (readonly [number, number])[])[] = OCTANTS.map((way) =>
  orderFor(way, 4),
);

/**
 * Which of the eight octants the way to the goal points at.
 *
 * Integer comparisons only. The octant of the turned-around way is exactly
 * this one plus four, which is what makes the scan order turn with the arena.
 */
function octantOf(dx: number, dy: number): number {
  if (dx === 0) return dy > 0 ? 2 : dy < 0 ? 6 : 0;
  if (dy === 0) return dx > 0 ? 0 : 4;
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  if (dx > 0 && dy > 0) return ax > ay ? 0 : ay > ax ? 2 : 1;
  if (dx > 0) return ax > ay ? 0 : ay > ax ? 6 : 7;
  if (dy > 0) return ax > ay ? 4 : ay > ax ? 2 : 3;
  return ax > ay ? 4 : ay > ax ? 6 : 5;
}

/**
 * True if a bot can step from `a` to `b`.
 *
 * A diagonal step needs both of its shared neighbours to be free. Without this
 * rule a bot cuts the corner of a wall, and the display shows the bot inside
 * the wall for part of the step.
 */
export function isStepLegal(map: ArenaMap, a: Cell, b: Cell): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
  if (!isWalkable(tileAt(map, b.x, b.y))) return false;
  if (dx === 0 || dy === 0) return true;
  return isWalkable(tileAt(map, b.x, a.y)) && isWalkable(tileAt(map, a.x, b.y));
}

/** Work memory of one arena. The search reuses it, so it allocates nothing. */
class PathScratch {
  readonly gScore: Float64Array;
  readonly cameFrom: Int32Array;
  readonly seen: Uint32Array;
  readonly closed: Uint32Array;
  /** The heap holds cell indices. A cell can enter it more than one time. */
  readonly heapCell: Int32Array;
  readonly heapCost: Float64Array;
  heapSize = 0;
  generation = 0;

  constructor(cells: number) {
    this.gScore = new Float64Array(cells);
    this.cameFrom = new Int32Array(cells);
    this.seen = new Uint32Array(cells);
    this.closed = new Uint32Array(cells);
    this.heapCell = new Int32Array(cells * DIRECTIONS.length + 1);
    this.heapCost = new Float64Array(cells * DIRECTIONS.length + 1);
  }

  start(): void {
    this.heapSize = 0;
    this.generation += 1;
    if (this.generation === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.generation = 1;
    }
  }

  push(cell: number, cost: number): void {
    let index = this.heapSize;
    this.heapSize += 1;
    this.heapCell[index] = cell;
    this.heapCost[index] = cost;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if ((this.heapCost[parent] as number) <= cost) break;
      this.heapCell[index] = this.heapCell[parent] as number;
      this.heapCost[index] = this.heapCost[parent] as number;
      this.heapCell[parent] = cell;
      this.heapCost[parent] = cost;
      index = parent;
    }
  }

  /** The cell with the lowest cost, or -1 if the heap is empty. */
  pop(): number {
    if (this.heapSize === 0) return -1;
    const top = this.heapCell[0] as number;
    this.heapSize -= 1;
    if (this.heapSize === 0) return top;

    const cell = this.heapCell[this.heapSize] as number;
    const cost = this.heapCost[this.heapSize] as number;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= this.heapSize) break;
      const right = left + 1;
      const child =
        right < this.heapSize && (this.heapCost[right] as number) < (this.heapCost[left] as number)
          ? right
          : left;
      if ((this.heapCost[child] as number) >= cost) break;
      this.heapCell[index] = this.heapCell[child] as number;
      this.heapCost[index] = this.heapCost[child] as number;
      index = child;
    }
    this.heapCell[index] = cell;
    this.heapCost[index] = cost;
    return top;
  }
}

const scratchByMap = new WeakMap<ArenaMap, PathScratch>();

function scratchFor(map: ArenaMap): PathScratch {
  let scratch = scratchByMap.get(map);
  if (scratch === undefined) {
    scratch = new PathScratch(map.width * map.height);
    scratchByMap.set(map, scratch);
  }
  return scratch;
}

/** True if a bot with these options can cross the cell. */
function passable(map: ArenaMap, x: number, y: number, avoidHazard: boolean): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const tile = (map.tiles[y * map.width + x] ?? Tile.Wall) as Tile;
  if (!isWalkable(tile)) return false;
  return !(avoidHazard && tile === Tile.Hazard);
}

/** The octile distance. It is the exact cost over an empty grid. */
function heuristic(dx: number, dy: number, topology: Topology): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (topology === 4) return ax + ay;
  return ax + ay + (SQRT2 - 2) * Math.min(ax, ay);
}

/** The shortest path, or `null`. The result holds `from` first and `to` last. */
function search(
  map: ArenaMap,
  from: Cell,
  to: Cell,
  topology: Topology,
  avoidHazard: boolean,
): Cell[] | null {
  const { width } = map;
  const scratch = scratchFor(map);
  scratch.start();

  const startIndex = from.y * width + from.x;
  const goalIndex = to.y * width + to.x;
  const generation = scratch.generation;
  const orders = topology === 4 ? CARDINAL_ORDERS : ORDERS;

  scratch.gScore[startIndex] = 0;
  scratch.cameFrom[startIndex] = -1;
  scratch.seen[startIndex] = generation;
  scratch.push(startIndex, heuristic(to.x - from.x, to.y - from.y, topology));

  for (;;) {
    const current = scratch.pop();
    if (current < 0) return null;
    if (scratch.closed[current] === generation) continue;
    scratch.closed[current] = generation;
    if (current === goalIndex) break;

    const x = current % width;
    const y = (current - x) / width;
    const g = scratch.gScore[current] as number;

    // The scan order follows the way to the goal, so it turns with the arena.
    const order = orders[octantOf(to.x - x, to.y - y)] as readonly (readonly [number, number])[];
    for (let i = 0; i < order.length; i += 1) {
      const [dx, dy] = order[i] as readonly [number, number];
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(map, nx, ny, avoidHazard)) continue;
      // The corner rule: a diagonal step needs both shared neighbours.
      if (dx !== 0 && dy !== 0) {
        if (!passable(map, nx, y, avoidHazard) || !passable(map, x, ny, avoidHazard)) continue;
      }
      const next = ny * width + nx;
      if (scratch.closed[next] === generation) continue;

      const cost = g + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      if (scratch.seen[next] === generation && cost >= (scratch.gScore[next] as number)) continue;
      scratch.seen[next] = generation;
      scratch.gScore[next] = cost;
      scratch.cameFrom[next] = current;
      scratch.push(next, cost + heuristic(to.x - nx, to.y - ny, topology));
    }
  }

  const path: Cell[] = [];
  for (let cell = goalIndex; cell >= 0; cell = scratch.cameFrom[cell] as number) {
    const x = cell % width;
    path.push({ x, y: (cell - x) / width });
  }
  path.reverse();
  return path;
}

/**
 * The shortest path from `from` to `to`, including both cells.
 * Returns `null` if no path exists.
 */
export function findPath(
  map: ArenaMap,
  from: Cell,
  to: Cell,
  options: FindPathOptions = {},
): Cell[] | null {
  const topology = options.topology ?? 8;
  let avoidHazard = options.avoidHazard ?? false;
  if (!passable(map, from.x, from.y, false)) return null;
  if (!passable(map, to.x, to.y, false)) return null;
  if (from.x === to.x && from.y === to.y) return [{ x: from.x, y: from.y }];

  // A bot that stands on a hazard tile, or that must reach one, still needs a
  // path. The avoidance applies only when it can help.
  if (
    avoidHazard &&
    (tileAt(map, from.x, from.y) === Tile.Hazard || tileAt(map, to.x, to.y) === Tile.Hazard)
  ) {
    avoidHazard = false;
  }

  const path = search(map, from, to, topology, avoidHazard);
  if (path !== null) return path;
  // The hazard tiles cut the arena in two. Cross them.
  return avoidHazard ? search(map, from, to, topology, false) : null;
}
