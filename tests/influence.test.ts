/**
 * Influence maps (dev-guide Section 7.9, M8).
 */
import { describe, expect, it } from "vitest";
import { parseArenaText } from "../src/arena/index.js";
import { EventBus } from "../src/core/events.js";
import {
  controlAt,
  createInfluenceMaps,
  dangerAt,
  dangerFor,
  updateInfluence,
} from "../src/ai/influence.js";
import { botCell, createSimState, type SimState } from "../src/sim/index.js";

/** A long hall with a hazard tile in the middle and three spawns per side. */
const HALL = [
  "######################",
  "#SSS...............SS#",
  "#.........^..........#",
  "#...................S#",
  "######################",
].join("\n");

function hallState(seed = 1): SimState {
  return createSimState({ map: parseArenaText(HALL, { source: "hall" }), seed, bus: new EventBus() });
}

describe("createInfluenceMaps", () => {
  it("makes one value per cell, all zero", () => {
    const map = parseArenaText(HALL, { source: "hall" });
    const maps = createInfluenceMaps(map);
    expect(maps.danger.A).toHaveLength(map.width * map.height);
    expect(maps.danger.B).toHaveLength(map.width * map.height);
    expect(maps.control).toHaveLength(map.width * map.height);
    expect([...maps.danger.A].every((value) => value === 0)).toBe(true);
    expect([...maps.danger.B].every((value) => value === 0)).toBe(true);
  });

  it("gives zero outside the map", () => {
    const maps = createInfluenceMaps(parseArenaText(HALL, { source: "hall" }));
    expect(dangerAt(maps, "A", -1, 0)).toBe(0);
    expect(controlAt(maps, 0, -1)).toBe(0);
    expect(dangerAt(maps, "A", 1000, 0)).toBe(0);
  });
});

describe("updateInfluence", () => {
  it("gives each team the ground around its own bots", () => {
    const state = hallState();
    updateInfluence(state);
    for (const bot of state.bots) {
      const cell = botCell(bot);
      const control = controlAt(state.influence, cell.x, cell.y);
      if (bot.teamId === "A") expect(control).toBeGreaterThan(0);
      else expect(control).toBeLessThan(0);
    }
  });

  it("keeps a bot out of the danger that its own team makes", () => {
    // Section 7.9: an enemy is dangerous, a teammate is not. One shared grid
    // made a bot fear the ground that its own team was watching, and on open
    // ground that painted its own half as the dangerous half
    // (Section 7.20.23).
    const state = hallState();
    updateInfluence(state);
    for (const bot of state.bots) {
      const cell = botCell(bot);
      const own = dangerAt(state.influence, bot.teamId, cell.x, cell.y);
      const other = dangerAt(state.influence, bot.teamId === "A" ? "B" : "A", cell.x, cell.y);
      // The cell a bot stands on is dangerous to the other team, not to it.
      expect(other).toBeGreaterThan(own);
    }
  });

  it("makes the hazard tile dangerous", () => {
    const state = hallState();
    updateInfluence(state);
    expect(dangerAt(state.influence, "A", 10, 2)).toBeGreaterThan(0);
  });

  it("runs again only after the interval", () => {
    const state = hallState();
    updateInfluence(state);
    const first = state.influence.updatedAtTick;
    state.tick += 1;
    updateInfluence(state);
    expect(state.influence.updatedAtTick).toBe(first);
    state.tick += state.config.influenceIntervalTicks;
    updateInfluence(state);
    expect(state.influence.updatedAtTick).toBeGreaterThan(first);
  });

  it("makes the cell of a recent death dangerous, and forgets it later", () => {
    const state = hallState();
    const cell = { x: 5, y: 1 };
    state.recentDeaths.push({ cell, tick: state.tick, teamId: "A" });
    updateInfluence(state);
    const fresh = dangerAt(state.influence, "A", cell.x, cell.y);

    state.tick += state.config.influenceDeathMemoryTicks + 1;
    updateInfluence(state);
    expect(dangerAt(state.influence, "A", cell.x, cell.y)).toBeLessThan(fresh);
  });

  it("forgets the bots that died between two updates", () => {
    const state = hallState();
    updateInfluence(state);
    for (const bot of state.bots) bot.alive = false;
    state.tick += state.config.influenceIntervalTicks;
    updateInfluence(state);
    expect(state.influence.control.every((value) => value === 0)).toBe(true);
  });
});

describe("dangerFor", () => {
  it("falls with the hazard nerve of a bot", () => {
    const state = hallState();
    updateInfluence(state);
    const bot = state.bots[0]!;
    const cell = { x: 10, y: 2 };
    bot.tactics = { ...bot.tactics, hazardTolerance: 0 };
    const careful = dangerFor(state, bot, cell);
    bot.tactics = { ...bot.tactics, hazardTolerance: 0.9 };
    expect(dangerFor(state, bot, cell)).toBeLessThan(careful);
  });
});
