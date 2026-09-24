import { describe, expect, it } from "vitest";
import { generateArena, isSymmetric } from "../src/arena/generate.js";
import type { ArenaMap } from "../src/arena/types.js";
import { loadArenaProfiles, loadDefaultTactics } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng, deriveSeed, type Rng, type RngState } from "../src/core/rng.js";
import { generateWeaponSet } from "../src/weapons/generate.js";
import { rollSpawnTable, type SpawnTable } from "../src/sim/pickups.js";
import {
  botCell,
  createSimState,
  simConfigFromTuning,
  step,
  teamSideIndex,
  type BotState,
} from "../src/sim/index.js";

/**
 * The mirror test (dev-guide Section 7.20.23).
 *
 * An arena is symmetric under a half turn. Give the two teams the same
 * tactics, the same roles and a spawn table that is symmetric too, take the
 * randomness out, and the round must stay a mirror image of itself. Every tick
 * that breaks the mirror is a place where the engine treats one side
 * differently from the other, and that is a side bias.
 *
 * The test found three of them: a decision phase that came from the index in
 * the bot list, a path search that broke a tie against the axes of the world,
 * and a danger map that did not know whose bots made the danger.
 */

const TICKS = 260;
const SEED = 20260924;
const config = simConfigFromTuning();

/** An RNG with the randomness taken out. Every draw gives the middle. */
function flatRng(label: string): Rng {
  const state: RngState = { a: 1, b: 2, c: 3, d: 4 };
  return {
    label,
    next: () => 0.5,
    int: (lo, hi) => Math.floor((lo + hi) / 2),
    float: (lo, hi) => (lo + hi) / 2,
    bool: (p) => p >= 0.5,
    pick: <T,>(items: readonly T[]) => items[0] as T,
    shuffle: <T,>(items: readonly T[]) => items.slice(),
    fork: (child: string) => flatRng(`${label}/${child}`),
    getState: () => ({ ...state }),
    setState: () => undefined,
  };
}

/** Give every pickup point the item of the point that it faces. */
function mirrorTable(map: ArenaMap, table: SpawnTable): SpawnTable {
  const slots: Record<string, string> = { ...table.slots };
  const byCell = new Map<string, string>();
  for (const point of map.pickups) byCell.set(`${point.cell.x},${point.cell.y}`, point.slotId);
  for (const point of map.pickups) {
    const image = `${map.width - 1 - point.cell.x},${map.height - 1 - point.cell.y}`;
    const partner = byCell.get(image);
    if (partner === undefined) continue;
    const winner = point.slotId < partner ? point.slotId : partner;
    const item = table.slots[winner];
    if (item !== undefined) slots[point.slotId] = item;
  }
  return { slots };
}

/**
 * How far the two bots are from being mirror images, in cells.
 * Floating point alone gives a number near zero; anything larger is a real
 * difference of state.
 */
function mirrorError(map: ArenaMap, a: BotState, b: BotState): number {
  return Math.max(
    Math.abs(b.pos.x - (map.width - a.pos.x)),
    Math.abs(b.pos.y - (map.height - a.pos.y)),
  );
}

describe("the mirror test", () => {
  for (const style of ["bastion", "openfield", "cavern"] as const) {
    it(`keeps the two teams mirrored on ${style}`, () => {
      const profiles = loadArenaProfiles();
      const profile = profiles.profiles[style];
      expect(profile).toBeDefined();
      const seed = deriveSeed(SEED, `${style}:arena:0`);
      const map = generateArena(profile!, createRng(seed, "arena"), seed, { rules: profiles.rules });
      expect(isSymmetric(map)).toBe(true);

      const weapons = generateWeaponSet(
        createRng(deriveSeed(seed, "weapons"), "weapons"),
        config.weaponsPerRun,
        { ticksPerSecond: config.ticksPerSecond },
      );
      const spawnTable = mirrorTable(
        map,
        rollSpawnTable(map, weapons, createRng(deriveSeed(seed, "spawnTable"), "weapons")),
      );
      const state = createSimState({
        map,
        seed,
        config,
        bus: new EventBus(),
        weapons,
        tactics: loadDefaultTactics(),
        spawnTable,
      });
      state.rng = flatRng("sim");

      const half = state.bots.length / 2;
      for (let tick = 1; tick <= TICKS && state.outcome === null; tick += 1) {
        step(state);
        for (let slot = 0; slot < half; slot += 1) {
          const a = state.bots[slot] as BotState;
          const b = state.bots[half + slot] as BotState;
          // A tenth of a cell. Rounding alone gives about 1e-13.
          expect(mirrorError(map, a, b), `tick ${tick}, slot ${slot}`).toBeLessThan(0.1);
          expect(a.health, `tick ${tick}, slot ${slot} health`).toBe(b.health);
          expect(a.armor, `tick ${tick}, slot ${slot} armor`).toBe(b.armor);
          expect(a.alive, `tick ${tick}, slot ${slot} alive`).toBe(b.alive);
          expect(a.weapons.length, `tick ${tick}, slot ${slot} weapons`).toBe(b.weapons.length);
          expect(a.action.kind, `tick ${tick}, slot ${slot} action`).toBe(b.action.kind);
        }
      }
      expect(state.score.A).toBe(state.score.B);
    });
  }
});


describe("the change of ends", () => {
  it("gives a team the other half on the next round", () => {
    expect(teamSideIndex("A", 1)).toBe(0);
    expect(teamSideIndex("B", 1)).toBe(1);
    expect(teamSideIndex("A", 2)).toBe(1);
    expect(teamSideIndex("B", 2)).toBe(0);
    expect(teamSideIndex("A", 3)).toBe(0);
  });

  it("starts team A of round 2 on the cells of team B of round 1", () => {
    const profiles = loadArenaProfiles();
    const profile = profiles.profiles["bastion"];
    expect(profile).toBeDefined();
    const seed = deriveSeed(SEED, "ends:arena");
    const map = generateArena(profile!, createRng(seed, "arena"), seed, { rules: profiles.rules });

    const cellsOf = (roundNumber: number): Record<string, string> => {
      const state = createSimState({ map, seed, config, roundNumber, bus: new EventBus() });
      const out: Record<string, string> = {};
      for (const bot of state.bots) {
        const cell = botCell(bot);
        out[bot.id] = `${cell.x},${cell.y}`;
      }
      return out;
    };

    const first = cellsOf(1);
    const second = cellsOf(2);
    for (let slot = 0; slot < config.teamSize; slot += 1) {
      expect(second[`A${slot}`]).toBe(first[`B${slot}`]);
      expect(second[`B${slot}`]).toBe(first[`A${slot}`]);
    }
  });

  it("puts a bot back on the half that its team holds this round", () => {
    // `respawn` reads the same rule, or a bot would come back on the half that
    // it started the match on.
    const profiles = loadArenaProfiles();
    const seed = deriveSeed(SEED, "ends:respawn");
    const map = generateArena(
      profiles.profiles["bastion"]!,
      createRng(seed, "arena"),
      seed,
      { rules: profiles.rules },
    );
    const state = createSimState({ map, seed, config, roundNumber: 2, bus: new EventBus() });
    // On round 2 team A holds the second block of the spawn list.
    const half = map.spawns.length / 2;
    const held = map.spawns.slice(half).map((cell) => `${cell.x},${cell.y}`);
    for (const bot of state.bots) {
      if (bot.teamId !== "A") continue;
      const cell = botCell(bot);
      expect(held).toContain(`${cell.x},${cell.y}`);
    }
  });
});
