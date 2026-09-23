import { describe, expect, it } from "vitest";
import { findPath, isStepLegal } from "../src/ai/navigation.js";
import { isWalkable, loadTestArena, parseArenaText, tileAt } from "../src/arena/index.js";
import type { Cell } from "../src/core/types.js";

/** A small map with a diagonal gap between two walls. */
const CORNER = ["#####", "#S..#", "#.###", "#..S#", "#####"].join("\n");

function assertPathIsLegal(map: ReturnType<typeof loadTestArena>, path: Cell[]): void {
  for (const [index, cell] of path.entries()) {
    expect(isWalkable(tileAt(map, cell.x, cell.y)), `cell ${index} is a wall`).toBe(true);
    if (index === 0) continue;
    const previous = path[index - 1] as Cell;
    expect(isStepLegal(map, previous, cell), `step ${index} is not legal`).toBe(true);
  }
}

describe("isStepLegal", () => {
  const map = parseArenaText(["#####", "#S.##", "#..S#", "#####"].join("\n"), { source: "t" });

  it("accepts a cardinal step to a free cell", () => {
    expect(isStepLegal(map, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
  });

  it("rejects a step into a wall", () => {
    expect(isStepLegal(map, { x: 2, y: 1 }, { x: 3, y: 1 })).toBe(false);
  });

  it("rejects a step of more than one cell", () => {
    expect(isStepLegal(map, { x: 1, y: 1 }, { x: 3, y: 1 })).toBe(false);
  });

  it("rejects a step to the same cell", () => {
    expect(isStepLegal(map, { x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
  });

  it("accepts a diagonal step with two free neighbours", () => {
    expect(isStepLegal(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
  });

  it("rejects a diagonal step around the corner of a wall", () => {
    // (2,1) -> (3,2) shares the wall (3,1) and the free cell (2,2).
    expect(isStepLegal(map, { x: 2, y: 1 }, { x: 3, y: 2 })).toBe(false);
  });
});

/**
 * An independent reference: Dijkstra with a plain list. It is slow, but it is
 * simple enough to trust, so it can check the cost of the A* result.
 */
function referenceCost(map: ReturnType<typeof loadTestArena>, from: Cell, to: Cell): number {
  const width = map.width;
  const best = new Map<number, number>();
  const index = (c: Cell): number => c.y * width + c.x;
  best.set(index(from), 0);
  const open = [from];
  while (open.length > 0) {
    // Take the cell with the lowest cost.
    let pick = 0;
    for (let i = 1; i < open.length; i += 1) {
      if ((best.get(index(open[i]!)) ?? Infinity) < (best.get(index(open[pick]!)) ?? Infinity)) pick = i;
    }
    const cell = open.splice(pick, 1)[0] as Cell;
    const cost = best.get(index(cell)) ?? Infinity;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const next = { x: cell.x + dx, y: cell.y + dy };
        if (!isStepLegal(map, cell, next)) continue;
        const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
        const candidate = cost + step;
        if (candidate < (best.get(index(next)) ?? Infinity) - 1e-9) {
          best.set(index(next), candidate);
          open.push(next);
        }
      }
    }
  }
  return best.get(index(to)) ?? Infinity;
}

/** The cost of a path, with a diagonal step at the square root of two. */
function pathCost(path: Cell[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as Cell;
    const b = path[i] as Cell;
    total += a.x !== b.x && a.y !== b.y ? Math.SQRT2 : 1;
  }
  return total;
}

describe("findPath", () => {
  const map = loadTestArena();

  it("gives a path of the lowest cost", () => {
    // The A* is hand-written, so an independent search checks its result.
    const targets = [
      [map.spawns[0]!, map.spawns[5]!],
      [map.spawns[0]!, map.pickups[0]!.cell],
      [map.spawns[3]!, map.pickups[6]!.cell],
      [map.pickups[1]!.cell, map.pickups[9]!.cell],
    ] as [Cell, Cell][];
    for (const [from, to] of targets) {
      const path = findPath(map, from, to);
      expect(path, `no path from ${from.x},${from.y}`).not.toBeNull();
      expect(pathCost(path as Cell[])).toBeCloseTo(referenceCost(map, from, to), 6);
    }
  });

  it("finds a path between two pickup points", () => {
    const [first, second] = map.pickups;
    const path = findPath(map, first!.cell, second!.cell);
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual(first!.cell);
    expect(path?.[path.length - 1]).toEqual(second!.cell);
  });

  it("gives only legal steps between every pair of pickup points", () => {
    for (const from of map.pickups) {
      for (const to of map.pickups) {
        if (from === to) continue;
        const path = findPath(map, from.cell, to.cell);
        expect(path, `no path from ${from.slotId} to ${to.slotId}`).not.toBeNull();
        assertPathIsLegal(map, path as Cell[]);
      }
    }
  });

  it("gives only legal steps from every spawn to every pickup point", () => {
    for (const spawn of map.spawns) {
      for (const pickup of map.pickups) {
        const path = findPath(map, spawn, pickup.cell);
        expect(path).not.toBeNull();
        assertPathIsLegal(map, path as Cell[]);
      }
    }
  });

  it("gives a path of one cell when the start is the goal", () => {
    const cell = map.spawns[0] as Cell;
    expect(findPath(map, cell, cell)).toEqual([cell]);
  });

  it("returns null for a start or a goal inside a wall", () => {
    const pickup = map.pickups[0] as { cell: Cell };
    expect(findPath(map, { x: 0, y: 0 }, pickup.cell)).toBeNull();
    expect(findPath(map, pickup.cell, { x: 0, y: 0 })).toBeNull();
  });

  it("gives the same path every time", () => {
    const [a, b] = map.pickups;
    expect(findPath(map, a!.cell, b!.cell)).toEqual(findPath(map, a!.cell, b!.cell));
  });

  it("uses cardinal steps only with topology 4", () => {
    const [a, b] = map.pickups;
    const path = findPath(map, a!.cell, b!.cell, { topology: 4 }) as Cell[];
    for (let i = 1; i < path.length; i += 1) {
      const previous = path[i - 1] as Cell;
      const cell = path[i] as Cell;
      expect(Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y)).toBe(1);
    }
  });

  it("goes around a diagonal gap between two walls", () => {
    const corner = parseArenaText(CORNER, { source: "corner" });
    const path = findPath(corner, { x: 1, y: 1 }, { x: 3, y: 3 }) as Cell[];
    expect(path).not.toBeNull();
    assertPathIsLegal(corner, path);
  });

  it("gives a path that is not longer than the cardinal path", () => {
    const [a, b] = map.pickups;
    const diagonal = findPath(map, a!.cell, b!.cell) as Cell[];
    const cardinal = findPath(map, a!.cell, b!.cell, { topology: 4 }) as Cell[];
    expect(diagonal.length).toBeLessThanOrEqual(cardinal.length);
  });
});
