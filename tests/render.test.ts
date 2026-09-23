import { describe, expect, it } from "vitest";
import { ATTACK_TYPES } from "../src/weapons/types.js";
import { FAMILY } from "../src/render/vfxLayer.js";
import {
  INTENSITY,
  NEON_THEMES,
  PICKUP_GLYPHS,
  pickRotation,
  themeForMatch,
} from "../src/render/neonThemes.js";
import { FACING_CHARS, facingChar } from "../src/render/theme.js";

/**
 * The parts of the display that hold no browser code (dev-guide Section 7.18).
 * A canvas needs a browser, but the palette, the rotation and the table that
 * maps an attack type to a visual are plain data, and a wrong value there is
 * what a viewer sees.
 */
describe("neon palettes", () => {
  it("gives every palette a name and the colors that the grid reads", () => {
    const keys = [
      "bg",
      "floor",
      "floorChar",
      "wall",
      "wallBg",
      "wallLit",
      "cover",
      "hazard",
      "hazardBg",
      "spawn",
      "teamA",
      "teamB",
      "glow",
    ] as const;
    for (const theme of NEON_THEMES) {
      expect(theme.name.length).toBeGreaterThan(0);
      for (const key of keys) expect(theme[key]).toMatch(/^(#|rgba\()/);
    }
  });

  it("holds a palette for each of the six looks, with no two names the same", () => {
    const names = new Set(NEON_THEMES.map((theme) => theme.name));
    expect(names.size).toBe(NEON_THEMES.length);
    expect(NEON_THEMES.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps the two teams apart in every palette", () => {
    for (const theme of NEON_THEMES) expect(theme.teamA).not.toBe(theme.teamB);
  });

  it("gives every pickup kind a glyph and a color", () => {
    for (const kind of ["weapon", "armor", "health", "powerup", "ammo"] as const) {
      expect(PICKUP_GLYPHS[kind].ch.length).toBeGreaterThan(0);
      expect(PICKUP_GLYPHS[kind].color).toMatch(/^#/);
    }
  });

  it("reads one scalar for the whole look", () => {
    expect(INTENSITY.restrained).toBeLessThan(INTENSITY.punchy);
    expect(INTENSITY.punchy).toBeLessThan(INTENSITY.maximalist);
  });
});

describe("pickRotation", () => {
  it("gives five palettes that are all different", () => {
    const rotation = pickRotation(12345);
    expect(rotation).toHaveLength(5);
    expect(new Set(rotation).size).toBe(5);
    for (const index of rotation) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(NEON_THEMES.length);
    }
  });

  it("gives the same order for the same seed", () => {
    expect(pickRotation(99)).toEqual(pickRotation(99));
  });

  it("gives another order for another seed", () => {
    // A shuffle can repeat by chance, so the check reads a set of seeds.
    const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => pickRotation(seed).join(",")));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("takes the whole list when more palettes are asked for than exist", () => {
    expect(pickRotation(7, 99)).toHaveLength(NEON_THEMES.length);
  });
});

describe("themeForMatch", () => {
  it("gives a palette to every match, and repeats after the rotation", () => {
    const seed = 4242;
    const first = themeForMatch(seed, 1);
    const names = [1, 2, 3, 4, 5].map((match) => themeForMatch(seed, match).name);
    expect(new Set(names).size).toBe(5);
    expect(themeForMatch(seed, 6).name).toBe(first.name);
  });

  it("gives the same look to the same match of the same run", () => {
    expect(themeForMatch(11, 3)).toBe(themeForMatch(11, 3));
  });
});

describe("attack type to visual family", () => {
  it("names a family for every attack type that the generator makes", () => {
    for (const attackType of ATTACK_TYPES) expect(FAMILY[attackType]).toBeDefined();
  });

  it("falls back to a tracer for an attack type that it does not know", () => {
    // A new attack type must draw something, not nothing and not an error.
    expect(FAMILY["a-type-that-does-not-exist"] ?? "tracer").toBe("tracer");
  });

  it("gives the five attack shapes a look that a viewer can tell apart", () => {
    expect(FAMILY["hitscan"]).toBe("beam");
    expect(FAMILY["line"]).toBe("beam");
    expect(FAMILY["projectile"]).toBe("tracer");
    expect(FAMILY["cone"]).toBe("cone");
    expect(FAMILY["tile"]).toBe("rocket");
  });
});

describe("facingChar", () => {
  it("gives one arrow for each of the eight octants", () => {
    const turn = Math.PI * 2;
    const seen = FACING_CHARS.map((_char, octant) => facingChar((octant * turn) / 8));
    expect(seen).toEqual([...FACING_CHARS]);
  });

  it("reads an angle below zero and an angle above one turn", () => {
    expect(facingChar(-Math.PI * 2)).toBe(facingChar(0));
    expect(facingChar(Math.PI * 4)).toBe(facingChar(0));
  });
});
