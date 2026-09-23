import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaParseError,
  Tile,
  cellIndex,
  checkArenaFairness,
  clearArenaCache,
  inBounds,
  isWalkable,
  loadTestArena,
  orderSpawnsForFairness,
  parseArenaText,
  tileAt,
  type ArenaMap,
} from "../src/arena/index.js";

const SMALL = ["#####", "#S.W#", "#.,.#", "#^.S#", "#####"].join("\n");

/** All walkable cells that a flood fill reaches from the first walkable cell. */
function reachableCount(map: ArenaMap): number {
  const walkable: number[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (isWalkable(tileAt(map, x, y))) walkable.push(cellIndex(map, x, y));
    }
  }
  const first = walkable[0];
  if (first === undefined) return 0;
  const seen = new Set<number>([first]);
  const stack = [first];
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % map.width;
    const y = Math.floor(index / map.width);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as [number, number][]) {
      if (!inBounds(map, nx, ny)) continue;
      const next = cellIndex(map, nx, ny);
      if (seen.has(next) || !isWalkable(tileAt(map, nx, ny))) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen.size;
}

function walkableCount(map: ArenaMap): number {
  let count = 0;
  for (const value of map.tiles) if (isWalkable(value as Tile)) count += 1;
  return count;
}

describe("parseArenaText", () => {
  it("reads the grid, the spawns, and the pickups", () => {
    const map = parseArenaText(SMALL, { source: "small" });
    expect(map.width).toBe(5);
    expect(map.height).toBe(5);
    expect(map.tiles).toHaveLength(25);
    expect(map.spawns).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 3 },
    ]);
    expect(map.pickups).toEqual([
      { cell: { x: 3, y: 1 }, kind: "weapon", slotId: "weapon:0", respawnTicks: 0 },
    ]);
  });

  it("maps every glyph to its tile", () => {
    const map = parseArenaText(SMALL, { source: "small" });
    expect(tileAt(map, 0, 0)).toBe(Tile.Wall);
    expect(tileAt(map, 2, 1)).toBe(Tile.Floor);
    expect(tileAt(map, 2, 2)).toBe(Tile.CoverLow);
    expect(tileAt(map, 1, 3)).toBe(Tile.Hazard);
    expect(tileAt(map, 1, 1)).toBe(Tile.Spawn);
    expect(tileAt(map, 3, 1)).toBe(Tile.Pickup);
  });

  it("counts a cell outside the grid as a wall", () => {
    const map = parseArenaText(SMALL, { source: "small" });
    expect(tileAt(map, -1, 0)).toBe(Tile.Wall);
    expect(tileAt(map, 0, 99)).toBe(Tile.Wall);
    expect(inBounds(map, 4, 4)).toBe(true);
    expect(inBounds(map, 5, 4)).toBe(false);
  });

  it("reads the header and removes it from the map", () => {
    const map = parseArenaText(`name: Yard\nnotes: a test\n---\n${SMALL}`, { source: "yard" });
    expect(map.name).toBe("Yard");
    expect(map.height).toBe(5);
  });

  it("uses the source as the name when the header has none", () => {
    expect(parseArenaText(SMALL, { source: "small" }).name).toBe("small");
  });

  it("removes the empty lines at the start and at the end", () => {
    const map = parseArenaText(`\n\n${SMALL}\n\n`, { source: "small" });
    expect(map.height).toBe(5);
  });

  it("numbers the slot ids per kind, in row-major order", () => {
    const map = parseArenaText(["#######", "#SWAWH#", "#W...S#", "#######"].join("\n"), {
      source: "slots",
    });
    expect(map.pickups.map((pickup) => pickup.slotId)).toEqual([
      "weapon:0",
      "armor:0",
      "weapon:1",
      "health:0",
      "weapon:2",
    ]);
  });

  it("gives the same result every time", () => {
    expect(parseArenaText(SMALL, { source: "small" })).toEqual(
      parseArenaText(SMALL, { source: "small" }),
    );
  });

  it("rejects a ragged map", () => {
    expect(() => parseArenaText("#####\n#S.S#\n####", { source: "bad" })).toThrow(ArenaParseError);
    expect(() => parseArenaText("#####\n#S.S#\n####", { source: "bad" })).toThrow(/row 3 is 4/);
  });

  it("rejects an unknown glyph", () => {
    expect(() => parseArenaText("#####\n#SZS#\n#####", { source: "bad" })).toThrow(/unknown glyph/);
  });

  it("rejects an empty map", () => {
    expect(() => parseArenaText("   \n\n", { source: "bad" })).toThrow(/the map is empty/);
    expect(() => parseArenaText("name: x\n---\n", { source: "bad" })).toThrow(/the map is empty/);
  });

  it("rejects a map with fewer than two spawns", () => {
    expect(() => parseArenaText("#####\n#S..#\n#####", { source: "bad" })).toThrow(/spawn cells/);
  });

  it("rejects an unknown header key", () => {
    expect(() => parseArenaText(`colour: red\n---\n${SMALL}`, { source: "bad" })).toThrow(
      /unknown header key/,
    );
  });

  it("rejects a header line with no colon", () => {
    expect(() => parseArenaText(`broken\n---\n${SMALL}`, { source: "bad" })).toThrow(/has no ":"/);
  });
});

describe("loadTestArena", () => {
  beforeEach(() => {
    clearArenaCache();
  });

  it("loads data/arenas/test-arena.txt", () => {
    const map = loadTestArena();
    expect(map.name).toBe("Proving Ground");
    expect(map.source).toBe("data/arenas/test-arena.txt");
    expect(map.width).toBe(60);
    expect(map.height).toBe(30);
    expect(map.tiles).toHaveLength(60 * 30);
  });

  it("caches the result", () => {
    expect(loadTestArena()).toBe(loadTestArena());
  });

  it("gives one spawn per bot for two teams of three", () => {
    expect(loadTestArena().spawns).toHaveLength(6);
  });

  it("holds one pickup of every kind", () => {
    const kinds = new Set(loadTestArena().pickups.map((pickup) => pickup.kind));
    expect([...kinds].sort()).toEqual(["ammo", "armor", "health", "powerup", "weapon"]);
  });

  it("gives every pickup a unique slot id", () => {
    const { pickups } = loadTestArena();
    expect(new Set(pickups.map((pickup) => pickup.slotId)).size).toBe(pickups.length);
  });

  it("has a wall on every edge", () => {
    const map = loadTestArena();
    for (let x = 0; x < map.width; x += 1) {
      expect(tileAt(map, x, 0)).toBe(Tile.Wall);
      expect(tileAt(map, x, map.height - 1)).toBe(Tile.Wall);
    }
    for (let y = 0; y < map.height; y += 1) {
      expect(tileAt(map, 0, y)).toBe(Tile.Wall);
      expect(tileAt(map, map.width - 1, y)).toBe(Tile.Wall);
    }
  });

  it("connects every walkable cell", () => {
    // Full arena validation arrives with M7. This test checks the M1 asset.
    const map = loadTestArena();
    expect(reachableCount(map)).toBe(walkableCount(map));
  });

  it("has 180-degree rotational symmetry", () => {
    // Section 7.2.1: a symmetric arena gives the two teams the same arena, so
    // a batch result measures the tactics and not the spawn position.
    const map = loadTestArena();
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const mirror = tileAt(map, map.width - 1 - x, map.height - 1 - y);
        expect(tileAt(map, x, y), `cell ${x},${y} does not match its image`).toBe(mirror);
      }
    }
  });

  it("gives each team the same pickup points, by kind", () => {
    const map = loadTestArena();
    const byKind = new Map<string, number>();
    for (const pickup of map.pickups) {
      const mirror = map.pickups.find(
        (other) =>
          other.cell.x === map.width - 1 - pickup.cell.x &&
          other.cell.y === map.height - 1 - pickup.cell.y,
      );
      expect(mirror?.kind, `${pickup.slotId} has no image`).toBe(pickup.kind);
      byKind.set(pickup.kind, (byKind.get(pickup.kind) ?? 0) + 1);
    }
    for (const [kind, count] of byKind) {
      expect(count % 2, `the arena has an odd number of ${kind} points`).toBe(0);
    }
  });

  it("gives the two spawn groups the same shape", () => {
    const map = loadTestArena();
    const size = map.spawns.length / 2;
    const teamA = map.spawns.slice(0, size);
    const teamB = map.spawns.slice(size);
    for (const spawn of teamA) {
      const image = { x: map.width - 1 - spawn.x, y: map.height - 1 - spawn.y };
      expect(teamB, `the spawn ${spawn.x},${spawn.y} has no image`).toContainEqual(image);
    }
  });

  it("pairs the slots of the two teams, not only the groups", () => {
    // Section 7.2.1: a scan of the map collects the second group in the
    // reverse order of the first, so the slot 0 of team B stood where the slot
    // 2 of team A stood. The arena was symmetric and the match was not.
    const map = loadTestArena();
    const size = map.spawns.length / 2;
    for (let slot = 0; slot < size; slot += 1) {
      const a = map.spawns[slot]!;
      const b = map.spawns[size + slot]!;
      expect(b).toEqual({ x: map.width - 1 - a.x, y: map.height - 1 - a.y });
    }
  });

  it("keeps the two spawn groups apart", () => {
    const { spawns } = loadTestArena();
    const distances = spawns.flatMap((a, i) =>
      spawns.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y)),
    );
    expect(Math.max(...distances)).toBeGreaterThan(40);
  });
});

describe("orderSpawnsForFairness", () => {
  it("turns a scan order into slots that face each other", () => {
    // The scan gives the second group in the reverse order of the first.
    const spawns = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 4 },
      { x: 8, y: 5 },
      { x: 6, y: 8 },
      { x: 8, y: 8 },
    ];
    const ordered = orderSpawnsForFairness(spawns, 10, 10, 3);
    expect(ordered.slice(3)).toEqual([
      { x: 8, y: 8 },
      { x: 6, y: 8 },
      { x: 8, y: 5 },
    ]);
  });

  it("keeps every cell and the first group as it is", () => {
    const spawns = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 4 },
      { x: 8, y: 5 },
      { x: 6, y: 8 },
      { x: 8, y: 8 },
    ];
    const ordered = orderSpawnsForFairness(spawns, 10, 10, 3);
    expect(ordered.slice(0, 3)).toEqual(spawns.slice(0, 3));
    expect([...ordered].sort(byCell)).toEqual([...spawns].sort(byCell));
  });

  it("gives the list back when there is not a team on each side", () => {
    const spawns = [
      { x: 1, y: 1 },
      { x: 8, y: 8 },
    ];
    expect(orderSpawnsForFairness(spawns, 10, 10, 3)).toEqual(spawns);
  });

  it("takes the nearest cell to the image on an arena that is not symmetric", () => {
    const spawns = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 9, y: 2 },
      { x: 7, y: 8 },
      { x: 8, y: 8 },
    ];
    const ordered = orderSpawnsForFairness(spawns, 10, 10, 3);
    // The image of 1,1 is 8,8; of 2,1 is 7,8; of 1,2 is 8,7, and the nearest
    // cell that is left is 9,2.
    expect(ordered.slice(3)).toEqual([
      { x: 8, y: 8 },
      { x: 7, y: 8 },
      { x: 9, y: 2 },
    ]);
  });
});

function byCell(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.y - b.y || a.x - b.x;
}

describe("checkArenaFairness", () => {
  it("passes the test arena", () => {
    // These are the acceptance rules that the generator of M7 must meet.
    const report = checkArenaFairness(loadTestArena());
    expect(report.failures).toEqual([]);
  });

  it("puts a power-up and a weapon point in a conflict zone", () => {
    const map = loadTestArena();
    const report = checkArenaFairness(map);
    const kindOf = (slotId: string): string =>
      map.pickups.find((point) => point.slotId === slotId)?.kind ?? "";
    expect(report.contested.some((slotId) => kindOf(slotId) === "powerup")).toBe(true);
    expect(report.contested.some((slotId) => kindOf(slotId) === "weapon")).toBe(true);
  });

  it("names a power-up that one team owns", () => {
    // A power-up in a corner is a free run for the near team, not a contest.
    const unfair = [
      "##############",
      "#SSS.......SS#",
      "#U..........S#",
      "#............#",
      "#...........U#",
      "##############",
    ].join("\n");
    const report = checkArenaFairness(parseArenaText(unfair, { source: "unfair" }));
    expect(report.failures.join(" ")).toContain("power-up");
  });

  it("names a pickup point with no partner", () => {
    const lopsided = ["##########", "#SSS..SSS#", "#H.......#", "##########"].join("\n");
    const report = checkArenaFairness(parseArenaText(lopsided, { source: "lopsided" }));
    expect(report.failures.join(" ")).toContain("partner");
  });
});
