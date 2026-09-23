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
