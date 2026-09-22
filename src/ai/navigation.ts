/**
 * Navigation (dev-guide Section 7.10).
 *
 * Milestone M2 gives plain shortest paths. The danger cost of the influence
 * map (`danger × (1 − hazardTolerance)`) and the cached Dijkstra distance
 * fields arrive with their own milestones.
 */
import { Path } from "rot-js";
import type { Cell } from "../core/types.js";
import { Tile, isWalkable, tileAt, type ArenaMap } from "../arena/types.js";

/** 4 = cardinal steps only. 8 = cardinal and diagonal steps. */
export type Topology = 4 | 8;

export interface FindPathOptions {
  topology?: Topology;
  /**
   * Treat a hazard tile as a wall.
   *
   * The `hazardTolerance` tactic controls this value. It is the simple form of
   * the path cost `danger × (1 − hazardTolerance)` of Section 7.10. The full
   * cost needs the influence maps of Section 7.9, which arrive with M8.
   */
  avoidHazard?: boolean;
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

/** True if a bot with these options can cross the cell. */
function passable(map: ArenaMap, x: number, y: number, avoidHazard: boolean): boolean {
  const tile = tileAt(map, x, y);
  if (!isWalkable(tile)) return false;
  return !(avoidHazard && tile === Tile.Hazard);
}

/** Compute the raw rot.js path. The result holds `from` first and `to` last. */
function computeRaw(
  map: ArenaMap,
  from: Cell,
  to: Cell,
  topology: Topology,
  avoidHazard: boolean,
): Cell[] {
  const astar = new Path.AStar(
    to.x,
    to.y,
    (x, y) => passable(map, x, y, avoidHazard),
    { topology },
  );
  const path: Cell[] = [];
  astar.compute(from.x, from.y, (x, y) => path.push({ x, y }));
  return path;
}

/**
 * Repair the corner cuts of a diagonal path.
 *
 * A diagonal step with one free neighbour becomes two cardinal steps. A
 * diagonal step with no free neighbour cannot be repaired, and the function
 * reports the failure.
 */
function repairCorners(map: ArenaMap, path: Cell[]): Cell[] | null {
  const repaired: Cell[] = [];
  for (const [index, cell] of path.entries()) {
    if (index === 0) {
      repaired.push(cell);
      continue;
    }
    const previous = repaired[repaired.length - 1] as Cell;
    if (isStepLegal(map, previous, cell)) {
      repaired.push(cell);
      continue;
    }
    const sideA = { x: cell.x, y: previous.y };
    const sideB = { x: previous.x, y: cell.y };
    const detour = isWalkable(tileAt(map, sideA.x, sideA.y))
      ? sideA
      : isWalkable(tileAt(map, sideB.x, sideB.y))
        ? sideB
        : null;
    if (detour === null) return null;
    repaired.push(detour, cell);
  }
  return repaired;
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
  if (!isWalkable(tileAt(map, from.x, from.y))) return null;
  if (!isWalkable(tileAt(map, to.x, to.y))) return null;
  // A bot that stands on a hazard tile, or that must reach one, still needs a
  // path. The avoidance applies only when it can help.
  if (avoidHazard && (tileAt(map, from.x, from.y) === Tile.Hazard || tileAt(map, to.x, to.y) === Tile.Hazard)) {
    avoidHazard = false;
  }

  let raw = computeRaw(map, from, to, topology, avoidHazard);
  if (raw.length === 0 && avoidHazard) {
    // The hazard tiles cut the arena in two. Cross them.
    avoidHazard = false;
    raw = computeRaw(map, from, to, topology, avoidHazard);
  }
  if (raw.length === 0) return null;
  if (topology === 4) return raw;

  const repaired = repairCorners(map, raw);
  if (repaired !== null) return repaired;

  // A diagonal gap between two walls. Cardinal steps always avoid it.
  const cardinal = computeRaw(map, from, to, 4, avoidHazard);
  return cardinal.length === 0 ? null : cardinal;
}
