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

describe("findPath", () => {
  const map = loadTestArena();

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
