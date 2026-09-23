/**
 * Pickups, power-ups, and the spawn table (dev-guide Section 7.12, M8).
 */
import { describe, expect, it } from "vitest";
import { loadTestArena, parseArenaText } from "../src/arena/index.js";
import { loadPickups } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng } from "../src/core/rng.js";
import { generateWeaponSet } from "../src/weapons/generate.js";
import {
  applyPickups,
  createPickupStates,
  createSimState,
  damageMultiplierOf,
  pickupValue,
  rollSpawnTable,
  takePickup,
  updatePickups,
  updatePowerups,
  type BotState,
  type PickupState,
  type SimState,
} from "../src/sim/index.js";

/** One pickup of every kind, two cells apart, with three spawn cells per team. */
const ITEMS = [
  "##############",
  "#SSS....SSS..#",
  "#H.A.M.W.U...#",
  "##############",
].join("\n");

function itemState(seed = 1, bus = new EventBus()): SimState {
  const map = parseArenaText(ITEMS, { source: "items" });
  const weapons = generateWeaponSet(createRng(seed, "weapons"), 5, { ticksPerSecond: 20 });
  return createSimState({ map, seed, bus, weapons });
}

function pickupOf(state: SimState, kind: string): PickupState {
  const found = state.pickups.find((pickup) => pickup.point.kind === kind);
  if (!found) throw new Error(`the test arena has no ${kind} point`);
  return found;
}

function firstBot(state: SimState): BotState {
  return state.bots[0] as BotState;
}

describe("rollSpawnTable", () => {
  it("gives every point an item", () => {
    const map = loadTestArena();
    const weapons = generateWeaponSet(createRng(1, "weapons"), 5, { ticksPerSecond: 20 });
    const table = rollSpawnTable(map, weapons, createRng(1, "weapons"));
    for (const point of map.pickups) {
      expect(table.slots[point.slotId]).toBeDefined();
    }
  });

  it("gives the same table for the same seed", () => {
    const map = loadTestArena();
    const weapons = generateWeaponSet(createRng(1, "weapons"), 5, { ticksPerSecond: 20 });
    const first = rollSpawnTable(map, weapons, createRng(7, "weapons"));
    const second = rollSpawnTable(map, weapons, createRng(7, "weapons"));
    expect(second.slots).toEqual(first.slots);
  });

  it("never puts the baseline weapon on a weapon point", () => {
    // Every bot already holds it, so the point would give nothing.
    const map = loadTestArena();
    const weapons = generateWeaponSet(createRng(3, "weapons"), 5, { ticksPerSecond: 20 });
    const table = rollSpawnTable(map, weapons, createRng(3, "weapons"));
    for (const point of map.pickups) {
      if (point.kind !== "weapon") continue;
      expect(table.slots[point.slotId]).not.toBe(weapons[0]!.id);
    }
  });

  it("gives a power-up point one of the power-ups", () => {
    const map = loadTestArena();
    const names = Object.keys(loadPickups().powerups);
    const weapons = generateWeaponSet(createRng(1, "weapons"), 5, { ticksPerSecond: 20 });
    const table = rollSpawnTable(map, weapons, createRng(11, "weapons"));
    for (const point of map.pickups) {
      if (point.kind !== "powerup") continue;
      expect(names).toContain(table.slots[point.slotId]);
    }
  });

  it("makes one state per point, all ready", () => {
    const map = loadTestArena();
    const weapons = generateWeaponSet(createRng(1, "weapons"), 5, { ticksPerSecond: 20 });
    const states = createPickupStates(map, rollSpawnTable(map, weapons, createRng(1, "weapons")));
    expect(states).toHaveLength(map.pickups.length);
    expect(states.every((pickup) => pickup.ready)).toBe(true);
  });
});

describe("takePickup", () => {
  it("heals a hurt bot and empties the point", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "health");
    bot.health = 20;
    expect(takePickup(state, bot, pickup)).toBe(true);
    expect(bot.health).toBeGreaterThan(20);
    expect(bot.health).toBeLessThanOrEqual(state.config.healthMax);
    expect(pickup.ready).toBe(false);
  });

  it("gives nothing to a bot at full health, and the point stays", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "health");
    expect(takePickup(state, bot, pickup)).toBe(false);
    expect(pickup.ready).toBe(true);
  });

  it("caps armor at the maximum of the data file", () => {
    const state = itemState();
    const bot = firstBot(state);
    bot.armor = state.pickupTables.armorMax - 1;
    takePickup(state, bot, pickupOf(state, "armor"));
    expect(bot.armor).toBe(state.pickupTables.armorMax);
  });

  it("refills every weapon from one ammo point, up to each maximum", () => {
    // Section 7.12: the ammo is universal, not weapon by weapon.
    const state = itemState();
    const bot = firstBot(state);
    for (const weapon of bot.weapons.slice(1)) bot.ammo.set(weapon.id, 0);
    expect(takePickup(state, bot, pickupOf(state, "ammo"))).toBe(true);
    for (const weapon of bot.weapons.slice(1)) {
      const left = bot.ammo.get(weapon.id) ?? 0;
      expect(left).toBe(Math.min(weapon.ammoMax, weapon.ammoPerPickup));
    }
  });

  it("gives a weapon point its full magazine", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "weapon");
    const weapon = bot.weapons.find((candidate) => candidate.id === pickup.itemId);
    expect(weapon).toBeDefined();
    bot.ammo.set(weapon!.id, 0);
    expect(takePickup(state, bot, pickup)).toBe(true);
    expect(bot.ammo.get(weapon!.id)).toBe(weapon!.ammoMax);
  });

  it("emits one event with the team that took the item", () => {
    const bus = new EventBus();
    const state = itemState(1, bus);
    const bot = firstBot(state);
    bot.health = 10;
    takePickup(state, bot, pickupOf(state, "health"));
    const taken = bus.filter("PickupTaken");
    expect(taken).toHaveLength(1);
    expect(taken[0]!.data["teamId"]).toBe(bot.teamId);
    expect(taken[0]!.data["kind"]).toBe("health");
  });

  it("gives nothing to a dead bot", () => {
    const state = itemState();
    const bot = firstBot(state);
    bot.alive = false;
    bot.health = 0;
    expect(takePickup(state, bot, pickupOf(state, "health"))).toBe(false);
  });
});

describe("power-ups", () => {
  it("raises the damage of a bot while it holds double damage", () => {
    const state = itemState();
    const bot = firstBot(state);
    const powerup = pickupOf(state, "powerup");
    powerup.itemId = "doubleDamage";
    expect(damageMultiplierOf(state, bot)).toBe(1);
    takePickup(state, bot, powerup);
    expect(damageMultiplierOf(state, bot)).toBeGreaterThan(1);
  });

  it("drops the power-up when its time runs out", () => {
    const state = itemState();
    const bot = firstBot(state);
    const powerup = pickupOf(state, "powerup");
    powerup.itemId = "doubleDamage";
    takePickup(state, bot, powerup);
    const duration = state.pickupTables.powerups["doubleDamage"]?.durationTicks ?? 0;
    state.tick += duration;
    updatePowerups(state);
    expect(bot.powerups.size).toBe(0);
    expect(damageMultiplierOf(state, bot)).toBe(1);
  });

  it("gives the shield belt a shield pool", () => {
    const state = itemState();
    const bot = firstBot(state);
    const powerup = pickupOf(state, "powerup");
    powerup.itemId = "shieldBelt";
    takePickup(state, bot, powerup);
    expect(bot.shield).toBeGreaterThan(0);
    expect(bot.shield).toBeLessThanOrEqual(state.pickupTables.shieldMax);
  });

  it("comes back far less often than health", () => {
    // Section 7.12: a power-up point is worth a fight because it is rare.
    const tables = loadPickups();
    const powerup = tables.kinds["powerup"]?.respawnTicks ?? 0;
    const health = tables.kinds["health"]?.respawnTicks ?? 0;
    expect(powerup).toBeGreaterThan(health * 2);
  });
});

describe("updatePickups", () => {
  it("brings a point back when its timer runs out, and says so", () => {
    const bus = new EventBus();
    const state = itemState(1, bus);
    const bot = firstBot(state);
    bot.health = 10;
    const pickup = pickupOf(state, "health");
    takePickup(state, bot, pickup);
    expect(pickup.ready).toBe(false);

    state.tick = pickup.readyAtTick - 1;
    updatePickups(state);
    expect(pickup.ready).toBe(false);

    state.tick = pickup.readyAtTick;
    updatePickups(state);
    expect(pickup.ready).toBe(true);
    expect(bus.filter("PickupRespawned")).toHaveLength(1);
  });
});

describe("pickupValue", () => {
  it("is worth more to a hurt bot than to a whole one", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "health");
    const whole = pickupValue(state, bot, pickup);
    bot.health = 10;
    expect(pickupValue(state, bot, pickup)).toBeGreaterThan(whole);
  });

  it("is zero for a point that is far from coming back", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "health");
    bot.health = 10;
    pickup.ready = false;
    pickup.readyAtTick = state.tick + state.config.pickupAnticipationTicks + 1;
    expect(pickupValue(state, bot, pickup)).toBe(0);
  });

  it("is worth part of its value while the point comes back soon", () => {
    // Section 7.20.11: a bot with nothing to take stands still, and then the
    // two teams never meet.
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "health");
    bot.health = 10;
    const full = pickupValue(state, bot, pickup);
    pickup.ready = false;
    pickup.readyAtTick = state.tick + 1;
    const soon = pickupValue(state, bot, pickup);
    expect(soon).toBeGreaterThan(0);
    expect(soon).toBeLessThan(full);
  });
});

describe("applyPickups", () => {
  it("gives a bot the point that it stands on", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "health");
    bot.health = 10;
    bot.pos = { x: pickup.point.cell.x + 0.5, y: pickup.point.cell.y + 0.5 };
    applyPickups(state);
    expect(bot.health).toBeGreaterThan(10);
    expect(pickup.ready).toBe(false);
  });

  it("does not hand every contested point to team A", () => {
    // Section 7.2.1: a fixed team order is a side bias.
    const takenBy = new Set<string>();
    for (let tick = 0; tick < 2; tick += 1) {
      const state = itemState();
      const pickup = pickupOf(state, "health");
      state.tick = tick;
      for (const bot of state.bots) {
        bot.health = 10;
        bot.pos = { x: pickup.point.cell.x + 0.5, y: pickup.point.cell.y + 0.5 };
      }
      applyPickups(state);
      const winner = state.bots.find((bot) => bot.health > 10);
      takenBy.add(winner?.teamId ?? "none");
    }
    expect(takenBy.size).toBeGreaterThan(1);
  });
});
