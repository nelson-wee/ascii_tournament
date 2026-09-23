/**
 * Arena generation (dev-guide Sections 7.2 and 7.20.19), Milestone M7.
 */
import { describe, expect, it } from "vitest";
import {
  ARENA_STYLES,
  arenaPasses,
  contestedShare,
  floorCount,
  generateArena,
  isSymmetric,
  type ArenaStyle,
  type GeneratedArena,
} from "../src/arena/generate.js";
import { checkArenaFairness, Tile, tileAt } from "../src/arena/index.js";
import { describeArena, measureArena, validateArena } from "../src/arena/metrics.js";
import { loadArenaProfiles } from "../src/core/data.js";
import { createRng, deriveSeed } from "../src/core/rng.js";
import { EventBus } from "../src/core/events.js";
import { createSimState, runRound } from "../src/sim/index.js";

const data = loadArenaProfiles();

function build(style: ArenaStyle, seed: number): GeneratedArena {
  const profile = data.profiles[style];
  if (!profile) throw new Error(`no profile for ${style}`);
  return generateArena(profile, createRng(deriveSeed(seed, `arena:${style}`), "arena"), seed, {
    rules: data.rules,
  });
}

describe("generateArena", () => {
  it("builds every style", () => {
    for (const style of ARENA_STYLES) {
      const map = build(style, 1);
      expect(map.profile.style).toBe(style);
      expect(map.width).toBe(data.profiles[style]!.width);
      expect(floorCount(map)).toBeGreaterThan(data.rules.minFloorCells);
    }
  });

  it("gives the same arena for the same seed, and a different one for another", () => {
    for (const style of ARENA_STYLES) {
      const first = build(style, 4);
      const second = build(style, 4);
      expect([...second.tiles]).toEqual([...first.tiles]);
      expect(second.spawns).toEqual(first.spawns);

      const other = build(style, 5);
      expect([...other.tiles]).not.toEqual([...first.tiles]);
    }
  });

  it("makes every arena symmetric to the cell", () => {
    // Section 7.2.1: the two teams must get the same arena.
    for (const style of ARENA_STYLES) {
      for (const seed of [1, 2, 3, 4]) {
        expect(isSymmetric(build(style, seed)), `${style} seed ${seed}`).toBe(true);
      }
    }
  });

  it("passes its own rules and the fairness rules", () => {
    for (const style of ARENA_STYLES) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const map = build(style, seed);
        expect(arenaPasses(map), `${style} seed ${seed}`).toBe(true);
        expect(checkArenaFairness(map).failures, `${style} seed ${seed}`).toEqual([]);
      }
    }
  });

  it("closes the outside edge", () => {
    for (const style of ARENA_STYLES) {
      const map = build(style, 2);
      for (let x = 0; x < map.width; x += 1) {
        expect(tileAt(map, x, 0)).toBe(Tile.Wall);
        expect(tileAt(map, x, map.height - 1)).toBe(Tile.Wall);
      }
      for (let y = 0; y < map.height; y += 1) {
        expect(tileAt(map, 0, y)).toBe(Tile.Wall);
        expect(tileAt(map, map.width - 1, y)).toBe(Tile.Wall);
      }
    }
  });

  it("connects every floor cell", () => {
    for (const style of ARENA_STYLES) {
      for (const seed of [1, 2, 3]) {
        expect(measureArena(build(style, seed)).connected, `${style} seed ${seed}`).toBe(true);
      }
    }
  });

  it("gives each team three spawn cells that face each other", () => {
    for (const style of ARENA_STYLES) {
      const map = build(style, 3);
      expect(map.spawns).toHaveLength(6);
      for (let slot = 0; slot < 3; slot += 1) {
        const a = map.spawns[slot]!;
        const b = map.spawns[3 + slot]!;
        expect(b).toEqual({ x: map.width - 1 - a.x, y: map.height - 1 - a.y });
      }
    }
  });

  it("puts a power-up and a weapon point on ground that both teams reach together", () => {
    for (const style of ARENA_STYLES) {
      const map = build(style, 6);
      expect(map.metrics.spawnFairness).toBeLessThanOrEqual(data.rules.maxSpawnFairness);
      expect(contestedShare(map)).toBeGreaterThan(0);
    }
  });

  it("gives every pickup point a partner of its own kind", () => {
    for (const style of ARENA_STYLES) {
      const map = build(style, 7);
      for (const point of map.pickups) {
        const image = { x: map.width - 1 - point.cell.x, y: map.height - 1 - point.cell.y };
        const partner = map.pickups.find(
          (other) => other.cell.x === image.x && other.cell.y === image.y,
        );
        expect(partner, `${style}: ${point.slotId} has no partner`).toBeDefined();
        expect(partner!.kind).toBe(point.kind);
      }
      expect(new Set(map.pickups.map((point) => point.slotId)).size).toBe(map.pickups.length);
    }
  });
});

describe("the three styles differ", () => {
  it("gives each style its own sightline profile", () => {
    // Section 7.20.19: three algorithms, three shapes of fight. `bastion` is
    // the closed one and `openfield` keeps its fire lanes.
    const mean = (style: ArenaStyle): number => {
      const runs = [1, 2, 3, 4, 5].map((seed) => build(style, seed).metrics.meanSightline);
      return runs.reduce((sum, value) => sum + value, 0) / runs.length;
    };
    const bastion = mean("bastion");
    const cavern = mean("cavern");
    const openfield = mean("openfield");
    expect(openfield).toBeGreaterThan(cavern);
    expect(cavern).toBeGreaterThan(bastion);
  });

  it("makes the open field more open than the other two", () => {
    const open = (style: ArenaStyle): number => build(style, 2).metrics.openAreaRatio;
    expect(open("openfield")).toBeGreaterThan(open("cavern"));
    expect(open("cavern")).toBeGreaterThan(open("bastion"));
  });
});

describe("measureArena and validateArena", () => {
  it("names the rule that an arena breaks", () => {
    const map = build("cavern", 1);
    const failures = validateArena(map.metrics, {
      ...data.rules,
      minLongSightline: 500,
      minFloorCells: 100000,
    });
    expect(failures.join(" ")).toContain("sightline");
    expect(failures.join(" ")).toContain("floor cells");
  });

  it("describes an arena in plain words", () => {
    for (const style of ARENA_STYLES) {
      const lines = describeArena(build(style, 1).metrics);
      expect(lines.length).toBeGreaterThan(2);
      expect(lines.join(" ")).toMatch(/sightlines|fire lanes/);
    }
  });
});

describe("a generated arena plays", () => {
  it("runs a full round on every style", () => {
    for (const style of ARENA_STYLES) {
      const bus = new EventBus();
      const result = runRound(createSimState({ map: build(style, 1), seed: 9, bus }));
      expect(result.outcome).not.toBeNull();
      expect(bus.filter("Shot").length).toBeGreaterThan(0);
      expect(bus.filter("Kill").length).toBeGreaterThan(0);
    }
  });
});
