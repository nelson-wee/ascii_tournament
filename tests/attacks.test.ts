import { describe, expect, it } from "vitest";
import { updatePerception } from "../src/ai/perception.js";
import { parseArenaText } from "../src/arena/index.js";
import { cellIndex } from "../src/arena/types.js";
import { loadBaselineWeapon } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import type { Weapon } from "../src/weapons/types.js";
import {
  applyAreaDamage,
  applyConeDamage,
  applyDots,
  applyHazards,
  applyLineDamage,
  botsInTickOrder,
  cellCenter,
  clearLine,
  createHazard,
  createSimState,
  critConditionMet,
  damageBot,
  dodgeOf,
  effectiveReaction,
  spawnProjectile,
  updateProjectiles,
  type BotState,
  type SimState,
} from "../src/sim/index.js";

/** A long open hall, so that nothing blocks a shot by accident. */
const HALL = [
  "##########################################",
  "#SSS...................................SS#",
  "#........................................#",
  "#.....########...........................#",
  "#........................................#",
  "#......................................S.#",
  "##########################################",
].join("\n");

function hallState(seed = 1, bus = new EventBus()): SimState {
  return createSimState({ map: parseArenaText(HALL, { source: "hall" }), seed, bus });
}

function weaponWith(over: Partial<Weapon>): Weapon {
  return { ...loadBaselineWeapon(), ...over };
}

/** Team A bot 0 and team B bot 0, both alive, with the rest removed. */
function pair(state: SimState): [BotState, BotState] {
  const a = state.bots[0] as BotState;
  const b = state.bots[3] as BotState;
  for (const bot of state.bots) if (bot !== a && bot !== b) bot.alive = false;
  return [a, b];
}

describe("clearLine", () => {
  it("is true across open floor and false through a wall", () => {
    const state = hallState();
    expect(clearLine(state, { x: 2.5, y: 1.5 }, { x: 20.5, y: 1.5 })).toBe(true);
    expect(clearLine(state, { x: 7.5, y: 2.5 }, { x: 7.5, y: 4.5 })).toBe(false);
  });
});

describe("applyAreaDamage", () => {
  it("damages an enemy inside the radius and not one outside", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 12, y: 1 });
    const weapon = weaponWith({ aoeRadius: 3, damage: 30 });
    const full = b.health;
    applyAreaDamage(state, a, { x: 12.5, y: 1.5 }, 3, 30, weapon);
    expect(b.health).toBeLessThan(full);

    const after = b.health;
    applyAreaDamage(state, a, { x: 30.5, y: 1.5 }, 3, 30, weapon);
    expect(b.health).toBe(after);
  });

  it("gives less damage at the edge than at the centre", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 12, y: 1 });
    const weapon = weaponWith({ aoeRadius: 4, damage: 30 });

    b.health = 100;
    applyAreaDamage(state, a, b.pos, 4, 30, weapon);
    const atCentre = 100 - b.health;

    b.health = 100;
    applyAreaDamage(state, a, { x: b.pos.x + 3.5, y: b.pos.y }, 4, 30, weapon);
    expect(100 - b.health).toBeLessThan(atCentre);
  });

  it("does not pass a wall", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 7, y: 4 });
    const full = b.health;
    applyAreaDamage(state, a, { x: 7.5, y: 2.5 }, 4, 30, weaponWith({ aoeRadius: 4 }));
    expect(b.health).toBe(full);
  });

  it("never damages a teammate", () => {
    const state = hallState();
    const a = state.bots[0] as BotState;
    const mate = state.bots[1] as BotState;
    a.pos = cellCenter({ x: 2, y: 1 });
    mate.pos = cellCenter({ x: 3, y: 1 });
    const full = mate.health;
    applyAreaDamage(state, a, mate.pos, 4, 30, weaponWith({ aoeRadius: 4 }));
    expect(mate.health).toBe(full);
  });
});

describe("applyConeDamage", () => {
  it("hits inside the cone and misses outside it", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 8, y: 1 });
    const weapon = weaponWith({ coneHalfAngle: 0.5, rangeMax: 40, damage: 30 });

    const full = b.health;
    applyConeDamage(state, a, 0, weapon);
    expect(b.health).toBeLessThan(full);

    // The same enemy, with the cone turned away.
    b.health = full;
    applyConeDamage(state, a, Math.PI, weapon);
    expect(b.health).toBe(full);
  });

  it("fades with the distance and reaches nothing past its range", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    const weapon = weaponWith({ coneHalfAngle: 0.6, rangeMax: 20, damage: 40 });

    b.pos = cellCenter({ x: 4, y: 1 });
    b.health = 100;
    applyConeDamage(state, a, 0, weapon);
    const near = 100 - b.health;

    b.pos = cellCenter({ x: 9, y: 1 });
    b.health = 100;
    applyConeDamage(state, a, 0, weapon);
    const far = 100 - b.health;
    expect(far).toBeLessThan(near);

    // The reach of a cone is a part of the range of the weapon.
    b.pos = cellCenter({ x: 20, y: 1 });
    b.health = 100;
    applyConeDamage(state, a, 0, weapon);
    expect(b.health).toBe(100);
  });
});

describe("applyLineDamage", () => {
  it("passes through every enemy on the line", () => {
    const state = hallState();
    const a = state.bots[0] as BotState;
    const first = state.bots[3] as BotState;
    const second = state.bots[4] as BotState;
    a.pos = cellCenter({ x: 2, y: 1 });
    first.pos = cellCenter({ x: 8, y: 1 });
    second.pos = cellCenter({ x: 14, y: 1 });
    const weapon = weaponWith({ rangeMax: 40, damage: 20 });

    applyLineDamage(state, a, 0, weapon, false);
    expect(first.health).toBeLessThan(100);
    expect(second.health).toBeLessThan(100);
  });

  it("misses an enemy that is not on the line", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 8, y: 5 });
    const full = b.health;
    applyLineDamage(state, a, 0, weaponWith({ rangeMax: 40 }), false);
    expect(b.health).toBe(full);
  });
});

describe("projectiles", () => {
  it("crosses the arena and hits an enemy", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 10, y: 1 });
    spawnProjectile(state, a, 0, weaponWith({ attackType: "projectile", projectileSpeed: 2, rangeMax: 30, damage: 25 }));
    expect(state.projectiles).toHaveLength(1);

    for (let tick = 0; tick < 40 && state.projectiles.length > 0; tick += 1) updateProjectiles(state);
    expect(b.health).toBeLessThan(100);
    expect(state.projectiles).toHaveLength(0);
  });

  it("stops at a wall", () => {
    const state = hallState();
    const [a] = pair(state);
    a.pos = cellCenter({ x: 7, y: 2 });
    spawnProjectile(state, a, Math.PI / 2, weaponWith({ attackType: "projectile", projectileSpeed: 1.5, rangeMax: 30 }));
    for (let tick = 0; tick < 40 && state.projectiles.length > 0; tick += 1) updateProjectiles(state);
    expect(state.projectiles).toHaveLength(0);
  });

  it("stops when it runs out of range", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 30, y: 1 });
    spawnProjectile(state, a, 0, weaponWith({ attackType: "projectile", projectileSpeed: 2, rangeMax: 6 }));
    for (let tick = 0; tick < 40 && state.projectiles.length > 0; tick += 1) updateProjectiles(state);
    expect(state.projectiles).toHaveLength(0);
    expect(b.health).toBe(100);
  });

  it("makes area damage where a burst lands", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 10, y: 2 });
    // The shot flies past the enemy and bursts on the far wall.
    spawnProjectile(state, a, 0, weaponWith({ attackType: "burst", projectileSpeed: 2, rangeMax: 9, aoeRadius: 4, damage: 30 }));
    for (let tick = 0; tick < 40 && state.projectiles.length > 0; tick += 1) updateProjectiles(state);
    expect(b.health).toBeLessThan(100);
  });

  it("turns a ricochet off a wall", () => {
    const state = hallState();
    const [a] = pair(state);
    a.pos = cellCenter({ x: 7, y: 2 });
    spawnProjectile(state, a, Math.PI / 2, weaponWith({ attackType: "ricochet", projectileSpeed: 1, rangeMax: 20, ricochetBounces: 1 }));
    const projectile = state.projectiles[0];
    expect(projectile).toBeDefined();
    const down = (projectile as { velocity: { y: number } }).velocity.y;
    for (let tick = 0; tick < 4; tick += 1) updateProjectiles(state);
    if (state.projectiles.length > 0) {
      expect(state.projectiles[0]!.velocity.y).not.toBe(down);
      expect(state.projectiles[0]!.bouncesLeft).toBe(0);
    }
  });

  it("leaves hazard tiles where a tile shot lands", () => {
    const bus = new EventBus();
    const state = hallState(1, bus);
    const [a] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    spawnProjectile(state, a, 0, weaponWith({ attackType: "tile", projectileSpeed: 2, rangeMax: 8, hazardTicks: 50, hazardRadius: 1, hazardDamagePerTick: 2 }));
    for (let tick = 0; tick < 40 && state.projectiles.length > 0; tick += 1) updateProjectiles(state);
    expect(state.hazards.size).toBeGreaterThan(0);
    expect(bus.filter("HazardCreated").length).toBeGreaterThan(0);
  });
});

describe("hazard tiles", () => {
  it("damages an enemy that stands on one, and not the team that made it", () => {
    const state = hallState();
    const a = state.bots[0] as BotState;
    const mate = state.bots[1] as BotState;
    const b = state.bots[3] as BotState;
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 12, y: 1 });
    mate.pos = cellCenter({ x: 12, y: 2 });
    createHazard(state, a, cellCenter({ x: 12, y: 1 }), weaponWith({ hazardTicks: 50, hazardRadius: 1.5, hazardDamagePerTick: 3 }));

    applyHazards(state);
    expect(b.health).toBeLessThan(100);
    expect(mate.health).toBe(100);
  });

  it("drops a tile when its time runs out", () => {
    const state = hallState();
    const [a] = pair(state);
    createHazard(state, a, cellCenter({ x: 12, y: 1 }), weaponWith({ hazardTicks: 5, hazardRadius: 1, hazardDamagePerTick: 2 }));
    expect(state.hazards.size).toBeGreaterThan(0);
    state.tick = 10;
    applyHazards(state);
    expect(state.hazards.size).toBe(0);
  });

  it("makes no tile on a wall", () => {
    const state = hallState();
    const [a] = pair(state);
    createHazard(state, a, cellCenter({ x: 7, y: 3 }), weaponWith({ hazardTicks: 50, hazardRadius: 1, hazardDamagePerTick: 2 }));
    for (const index of state.hazards.keys()) {
      expect(index).not.toBe(cellIndex(state.map, 7, 3));
    }
  });
});

describe("damage over time", () => {
  it("takes health every tick and then ends", () => {
    const state = hallState();
    const [a, b] = pair(state);
    b.dots.push({ damagePerTick: 2, ticksLeft: 3, sourceId: a.id, weaponId: "w", weaponArchetype: "denial" });
    applyDots(state);
    expect(b.health).toBe(98);
    applyDots(state);
    applyDots(state);
    expect(b.health).toBe(94);
    applyDots(state);
    expect(b.health).toBe(94);
    expect(b.dots).toHaveLength(0);
  });

  it("gives the kill to the bot that put it there", () => {
    const bus = new EventBus();
    const state = hallState(1, bus);
    const [a, b] = pair(state);
    b.health = 1;
    b.dots.push({ damagePerTick: 5, ticksLeft: 3, sourceId: a.id, weaponId: "w", weaponArchetype: "denial" });
    applyDots(state);
    expect(b.alive).toBe(false);
    expect(bus.filter("Kill")[0]?.data["killerId"]).toBe(a.id);
    expect(bus.filter("Kill")[0]?.data["source"]).toBe("dot");
  });
});

describe("the crit and the dodge of Section 7.20.5", () => {
  it("crits a target that has stood still long enough", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 8, y: 1 });
    a.weapon = weaponWith({ critConditions: ["targetStationary"] });
    updatePerception(state);

    b.stationaryTicks = state.config.stationaryTicksForCrit - 1;
    expect(critConditionMet(state, a, b)).toBe(false);
    b.stationaryTicks = state.config.stationaryTicksForCrit;
    expect(critConditionMet(state, a, b)).toBe(true);
  });

  it("gives a bot that keeps moving more dodge than one that just started", () => {
    const state = hallState();
    const [, b] = pair(state);
    b.movingTicks = 0;
    const still = dodgeOf(state, b);
    b.movingTicks = 1;
    const twitch = dodgeOf(state, b);
    b.movingTicks = state.config.dodgeRampTicks * 2;
    const running = dodgeOf(state, b);
    expect(twitch).toBeGreaterThan(still);
    expect(running).toBeGreaterThan(twitch);
    expect(running).toBeLessThanOrEqual(0.9);
  });
});

describe("the reaction order of Section 7.20.7", () => {
  it("puts the fastest reaction first", () => {
    const state = hallState();
    state.tick = 0;
    const slow = state.bots[0] as BotState;
    const fast = state.bots[5] as BotState;
    for (const bot of state.bots) bot.weapon = weaponWith({ reactionByBand: { close: 5, mid: 5, long: 5 } });
    slow.weapon = weaponWith({ reactionByBand: { close: 20, mid: 20, long: 20 } });
    fast.weapon = weaponWith({ reactionByBand: { close: 1, mid: 1, long: 1 } });

    const order = botsInTickOrder(state);
    expect(order[0]?.id).toBe(fast.id);
    expect(order[order.length - 1]?.id).toBe(slow.id);
  });

  it("adds the reaction of the bot to the reaction of its weapon", () => {
    const state = hallState();
    const bot = state.bots[0] as BotState;
    bot.weapon = weaponWith({ reactionByBand: { close: 2, mid: 4, long: 9 } });
    expect(effectiveReaction(bot, "close")).toBe(bot.attributes.reactionTicks + 2);
    expect(effectiveReaction(bot, "long")).toBe(bot.attributes.reactionTicks + 9);
  });

  it("breaks a tie without favouring one team", () => {
    // Section 7.2.1: a fixed order would give the first team an advantage.
    const state = hallState();
    for (const bot of state.bots) bot.weapon = weaponWith({ reactionByBand: { close: 5, mid: 5, long: 5 } });
    state.tick = 0;
    const even = botsInTickOrder(state).map((bot) => bot.id);
    state.tick = 1;
    const odd = botsInTickOrder(state).map((bot) => bot.id);
    expect(odd).toEqual([...even].reverse());
  });
});

describe("damageBot", () => {
  it("records the attack type and the source on the kill", () => {
    const bus = new EventBus();
    const state = hallState(1, bus);
    const [a, b] = pair(state);
    b.health = 1;
    damageBot(state, a, b, 50, {
      weaponId: "w1",
      weaponArchetype: "splash",
      attackType: "burst",
      source: "area",
    });
    const kill = bus.filter("Kill")[0];
    expect(kill?.data["weaponArchetype"]).toBe("splash");
    expect(kill?.data["attackType"]).toBe("burst");
    expect(kill?.data["source"]).toBe("area");
  });
});
