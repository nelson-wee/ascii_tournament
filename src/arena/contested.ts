/**
 * How contested a cell of an arena is (dev-guide Sections 7.2 and 7.12).
 *
 * A point is contested when both teams reach it at the same cost. A point that
 * one team reaches first is that team's point, and an item on it is not a
 * fight but a gift.
 *
 * The measure here walks the floor, not the straight line, so a wall between a
 * spawn and a point counts. Section 7.2 step 5 wants betweenness centrality on
 * the macro graph of M7; until the arena has rooms, the distance from the two
 * spawn groups is the honest substitute.
 */
import { Tile, cellIndex, isWalkable, tileAt, type ArenaMap } from "./types.js";
import type { Cell } from "../core/types.js";

/** The cost in steps from the nearest of `sources` to each cell, or -1. */
export function distanceField(map: ArenaMap, sources: readonly Cell[]): Int32Array {
  const field = new Int32Array(map.width * map.height).fill(-1);
  const queue: number[] = [];
  for (const cell of sources) {
    if (!isWalkable(tileAt(map, cell.x, cell.y))) continue;
    const index = cellIndex(map, cell.x, cell.y);
    if (field[index] !== -1) continue;
    field[index] = 0;
    queue.push(index);
  }

  // A plain breadth-first walk: every step costs the same, so a queue is enough.
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head] as number;
    const x = index % map.width;
    const y = (index - x) / map.width;
    const cost = (field[index] as number) + 1;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const tile = tileAt(map, nx, ny);
      if (tile === Tile.Wall) continue;
      const next = cellIndex(map, nx, ny);
      if (field[next] !== -1) continue;
      field[next] = cost;
      queue.push(next);
    }
  }
  return field;
}

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * How even each pickup point is, by slot id. 0 means the two teams reach it in
 * the same number of steps, and a higher number means one team owns it. A
 * point that one team cannot reach at all gets `Infinity`.
 *
 * Section 2.2 locks the team size at 3, so that is the default.
 */
export function pickupEvenness(map: ArenaMap, teamSize = 3): Map<string, number> {
  const first = distanceField(map, map.spawns.slice(0, teamSize));
  const second = distanceField(map, map.spawns.slice(teamSize, teamSize * 2));
  const evenness = new Map<string, number>();
  for (const point of map.pickups) {
    const index = cellIndex(map, point.cell.x, point.cell.y);
    const a = first[index] ?? -1;
    const b = second[index] ?? -1;
    evenness.set(point.slotId, a < 0 || b < 0 ? Infinity : Math.abs(a - b));
  }
  return evenness;
}

/**
 * How near to even a point must be to count as contested, in steps.
 *
 * A point inside this is a **conflict zone**: both teams arrive at about the
 * same moment, so the item on it is fought over instead of collected. A point
 * outside it belongs to whichever team is nearer. TBD
 */
export const CONTESTED_STEPS = 2;

/** True if both teams reach the point at about the same moment. */
export function isContested(
  evenness: ReadonlyMap<string, number>,
  slotId: string,
  steps = CONTESTED_STEPS,
): boolean {
  const value = evenness.get(slotId);
  return value !== undefined && Number.isFinite(value) && value <= steps;
}

/** What `checkArenaFairness` found. */
export interface ArenaFairness {
  /** The evenness of every pickup point, by slot id. */
  evenness: Map<string, number>;
  /** The slot ids that sit in a conflict zone. */
  contested: string[];
  /** One line per rule that the arena breaks. Empty means it passes. */
  failures: string[];
}

/**
 * Check the fairness rules that an arena must pass (Sections 7.2 and 7.2.1).
 *
 * These are acceptance criteria for the generator of M7, and a hand-made arena
 * should pass them too:
 *
 * 1. **A power-up point is in a conflict zone.** A power-up is the item worth
 *    a fight, so it must not belong to one team. An arena that hides its
 *    power-ups in a corner gives the near team a free run and turns item
 *    control into a chore instead of a contest.
 * 2. **At least one weapon point per team-pair is in a conflict zone**, so the
 *    prize weapon of a run has fair ground to stand on. Without one, the
 *    strongest weapon of the run is a head start for whoever is nearer.
 * 3. **Every pickup point has a partner** under the half turn of Section 7.2.1,
 *    so the two teams face the same arena.
 */
export function checkArenaFairness(map: ArenaMap, teamSize = 3): ArenaFairness {
  const evenness = pickupEvenness(map, teamSize);
  const contested = [...evenness.entries()]
    .filter(([slotId]) => isContested(evenness, slotId))
    .map(([slotId]) => slotId)
    .sort();
  const failures: string[] = [];

  const powerups = map.pickups.filter((point) => point.kind === "powerup");
  if (powerups.length > 0 && !powerups.some((point) => isContested(evenness, point.slotId))) {
    failures.push("no power-up point is in a conflict zone");
  }

  const weapons = map.pickups.filter((point) => point.kind === "weapon");
  if (weapons.length > 0 && !weapons.some((point) => isContested(evenness, point.slotId))) {
    failures.push("no weapon point is in a conflict zone, so the prize weapon has no fair ground");
  }

  for (const point of map.pickups) {
    const image = { x: map.width - 1 - point.cell.x, y: map.height - 1 - point.cell.y };
    const partner = map.pickups.find(
      (other) => other.cell.x === image.x && other.cell.y === image.y,
    );
    if (!partner || partner.kind !== point.kind) {
      failures.push(`the point ${point.slotId} has no partner of its own kind`);
    }
  }

  return { evenness, contested, failures };
}
