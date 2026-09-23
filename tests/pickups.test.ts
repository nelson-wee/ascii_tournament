/**
 * Pickups, power-ups, and the spawn table (dev-guide Section 7.12, M8).
 */
import { describe, expect, it } from "vitest";
import {
  cellIndex,
  isContested,
  loadTestArena,
  parseArenaText,
  pickupEvenness,
} from "../src/arena/index.js";
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
  readyPickupCells,
  rollSpawnTable,
  respawn,
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
    for (const weapon of state.runWeapons.slice(1)) {
      bot.weapons.push(weapon);
      bot.ammo.set(weapon.id, 0);
    }
    expect(takePickup(state, bot, pickupOf(state, "ammo"))).toBe(true);
    for (const weapon of bot.weapons.slice(1)) {
      const left = bot.ammo.get(weapon.id) ?? 0;
      expect(left).toBe(Math.min(weapon.ammoMax, weapon.ammoPerPickup));
    }
  });

  it("gives the weapon itself, with a full magazine", () => {
    // Section 7.12: a weapon point is the only way to a generated weapon.
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "weapon");
    const weapon = state.runWeapons.find((candidate) => candidate.id === pickup.itemId);
    expect(weapon).toBeDefined();
    expect(bot.weapons).toHaveLength(1);

    expect(takePickup(state, bot, pickup)).toBe(true);
    expect(bot.weapons.map((held) => held.id)).toContain(weapon!.id);
    expect(bot.ammo.get(weapon!.id)).toBe(weapon!.ammoMax);
  });

  it("refills a weapon that the bot already carries", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "weapon");
    takePickup(state, bot, pickup);
    pickup.ready = true;
    const held = bot.weapons.length;
    bot.ammo.set(pickup.itemId, 0);

    expect(takePickup(state, bot, pickup)).toBe(true);
    expect(bot.weapons).toHaveLength(held);
    const weapon = state.runWeapons.find((candidate) => candidate.id === pickup.itemId);
    expect(bot.ammo.get(pickup.itemId)).toBe(weapon!.ammoMax);
  });

  it("gives nothing when the bot already carries a full one", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "weapon");
    takePickup(state, bot, pickup);
    pickup.ready = true;
    expect(takePickup(state, bot, pickup)).toBe(false);
    expect(pickup.ready).toBe(true);
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

describe("the weapon economy", () => {
  it("starts a bot on the baseline weapon alone", () => {
    // Section 7.12: the arena decides who holds what. Before this, every bot
    // spawned with every weapon, so a weapon point only refilled ammo and the
    // prize weapon was free (Section 3.1 of the M8 weapon analysis).
    const state = itemState();
    for (const bot of state.bots) {
      expect(bot.weapons).toHaveLength(1);
      expect(bot.weapons[0]!.id).toBe(state.runWeapons[0]!.id);
      expect(bot.weapon.id).toBe(state.runWeapons[0]!.id);
    }
    expect(state.runWeapons.length).toBeGreaterThan(1);
  });

  it("keeps the weapons it found when a bot dies, and starts on the baseline", () => {
    // Section 7.3: the baseline is a fallback. Dropping every weapon on death
    // made it the main weapon, at 43 % of the kills.
    const state = itemState();
    const bot = firstBot(state);
    takePickup(state, bot, pickupOf(state, "weapon"));
    const held = bot.weapons.length;
    expect(held).toBeGreaterThan(1);

    bot.alive = false;
    bot.health = 0;
    respawn(state, bot);
    expect(bot.weapons).toHaveLength(held);
    expect(bot.weapon.id).toBe(state.runWeapons[0]!.id);
  });

  it("wants a weapon that beats the one it holds, and not one that does not", () => {
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "weapon");
    const weapon = state.runWeapons.find((candidate) => candidate.id === pickup.itemId)!;

    const strong = { ...weapon, dpsProfile: { close: 200, mid: 200, long: 200 } };
    const weak = { ...weapon, dpsProfile: { close: 1, mid: 1, long: 1 } };
    state.runWeapons = [state.runWeapons[0]!, strong];
    pickup.itemId = strong.id;
    const worthTaking = pickupValue(state, bot, pickup);

    state.runWeapons = [state.runWeapons[0]!, weak];
    const notWorthTaking = pickupValue(state, bot, pickup);

    expect(worthTaking).toBeGreaterThan(notWorthTaking);
    expect(worthTaking).toBeGreaterThan(0.5);
  });
});

describe("rollSpawnTable placement", () => {
  it("mirrors a weapon point that one team reaches first", () => {
    // Section 7.2.1: a point outside a conflict zone belongs to the nearer
    // team, so the only fair answer is the same weapon at the same distance.
    const map = loadTestArena();
    const weapons = generateWeaponSet(createRng(5, "weapons"), 5, { ticksPerSecond: 20 });
    const table = rollSpawnTable(map, weapons, createRng(5, "weapons"));
    const evenness = pickupEvenness(map);
    const points = map.pickups.filter((point) => point.kind === "weapon");

    for (const point of points) {
      if (isContested(evenness, point.slotId)) continue;
      const image = { x: map.width - 1 - point.cell.x, y: map.height - 1 - point.cell.y };
      const partner = points.find(
        (other) => other.cell.x === image.x && other.cell.y === image.y,
      );
      expect(partner, `the point ${point.slotId} has no partner`).toBeDefined();
      expect(table.slots[partner!.slotId]).toBe(table.slots[point.slotId]);
    }
  });

  it("lets a weapon point in a conflict zone hold its own weapon", () => {
    // Both teams arrive together, so the point is fair on its own and the run
    // can offer more of what it generated.
    const map = loadTestArena();
    const evenness = pickupEvenness(map);
    const contested = map.pickups.filter(
      (point) => point.kind === "weapon" && isContested(evenness, point.slotId),
    );
    expect(contested.length).toBeGreaterThan(1);

    const weapons = generateWeaponSet(createRng(11, "weapons"), 5, { ticksPerSecond: 20 });
    const table = rollSpawnTable(map, weapons, createRng(11, "weapons"));
    const offered = contested.map((point) => table.slots[point.slotId]);
    expect(new Set(offered).size).toBe(offered.length);
  });

  it("never offers the baseline weapon, and offers every weapon it can", () => {
    const map = loadTestArena();
    const weapons = generateWeaponSet(createRng(5, "weapons"), 5, { ticksPerSecond: 20 });
    const table = rollSpawnTable(map, weapons, createRng(5, "weapons"));
    const placed = map.pickups
      .filter((point) => point.kind === "weapon")
      .map((point) => table.slots[point.slotId]);
    expect(placed).not.toContain(weapons[0]!.id);
    expect(new Set(placed).size).toBe(weapons.length - 1);
  });

  it("puts the best weapon on the most contested pair", () => {
    // Section 7.12: the prize must not favour one side.
    const map = loadTestArena();
    const weapons = generateWeaponSet(createRng(9, "weapons"), 5, { ticksPerSecond: 20 });
    const table = rollSpawnTable(map, weapons, createRng(9, "weapons"));
    const best = [...weapons.slice(1)].sort(
      (a, b) => b.budgetUsed - a.budgetUsed || a.id.localeCompare(b.id),
    )[0]!;

    const points = map.pickups.filter((point) => point.kind === "weapon");
    const evenness = pickupEvenness(map);
    const chosen = points.filter((point) => table.slots[point.slotId] === best.id);
    expect(chosen.length).toBeGreaterThan(0);
    const chosenScore = Math.min(...chosen.map((point) => evenness.get(point.slotId) ?? Infinity));
    for (const point of points) {
      expect(chosenScore).toBeLessThanOrEqual((evenness.get(point.slotId) ?? Infinity) + 1e-9);
    }
  });
});

describe("readyPickupCells", () => {
  it("holds every point at the start of a round", () => {
    const state = itemState();
    expect(readyPickupCells(state).size).toBe(state.pickups.length);
  });

  it("drops a point that a bot emptied, and takes it back on the timer", () => {
    // Section 7.12: the display draws a glyph only for a point that holds its
    // item, so a bare pad reads as floor.
    const state = itemState();
    const bot = firstBot(state);
    const pickup = pickupOf(state, "health");
    const cell = cellIndex(state.map, pickup.point.cell.x, pickup.point.cell.y);
    expect(readyPickupCells(state).has(cell)).toBe(true);

    bot.health = 10;
    takePickup(state, bot, pickup);
    expect(readyPickupCells(state).has(cell)).toBe(false);

    state.tick = pickup.readyAtTick;
    updatePickups(state);
    expect(readyPickupCells(state).has(cell)).toBe(true);
  });
});

describe("the spawn table is symmetric", () => {
  it("gives the two power-up points that face each other the same power-up", () => {
    // Section 7.2.1: a roll per point gave one team the double damage and the
    // other the shield belt.
    const map = loadTestArena();
    const weapons = generateWeaponSet(createRng(1, "weapons"), 5, { ticksPerSecond: 20 });
    for (let seed = 1; seed <= 20; seed += 1) {
      const table = rollSpawnTable(map, weapons, createRng(seed, "weapons"));
      const points = map.pickups.filter((point) => point.kind === "powerup");
      for (const point of points) {
        const image = { x: map.width - 1 - point.cell.x, y: map.height - 1 - point.cell.y };
        const partner = points.find(
          (other) => other.cell.x === image.x && other.cell.y === image.y,
        );
        expect(partner).toBeDefined();
        expect(table.slots[partner!.slotId]).toBe(table.slots[point.slotId]);
      }
    }
  });

  it("gives both teams the same offer on every point that one team owns", () => {
    const map = loadTestArena();
    const evenness = pickupEvenness(map);
    const weapons = generateWeaponSet(createRng(3, "weapons"), 5, { ticksPerSecond: 20 });
    const table = rollSpawnTable(map, weapons, createRng(3, "weapons"));
    for (const point of map.pickups) {
      if (isContested(evenness, point.slotId)) continue;
      const image = { x: map.width - 1 - point.cell.x, y: map.height - 1 - point.cell.y };
      const partner = map.pickups.find(
        (other) => other.cell.x === image.x && other.cell.y === image.y,
      );
      expect(partner, `the point ${point.slotId} has no partner`).toBeDefined();
      expect(table.slots[partner!.slotId]).toBe(table.slots[point.slotId]);
    }
  });
});
