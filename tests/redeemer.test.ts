/**
 * The Redeemer (dev-guide Section 7.20.18).
 *
 * A power-up that hands over one shot: a slow homing projectile with a wide
 * blast. It sits outside the power budget of Section 7.3 on purpose.
 */
import { describe, expect, it } from "vitest";
import { parseArenaText } from "../src/arena/index.js";
import { loadPickups, loadRedeemerWeapon } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng } from "../src/core/rng.js";
import { generateWeaponSet } from "../src/weapons/generate.js";
import {
  cellCenter,
  createSimState,
  damageProjectile,
  interceptableProjectiles,
  respawn,
  spawnProjectile,
  takePickup,
  updateProjectiles,
  type BotState,
  type PickupState,
  type SimState,
} from "../src/sim/index.js";

/** A long open hall with a power-up point, so a shot has room to fly. */
const HALL = [
  "##########################################",
  "#SSS...................................SS#",
  "#..U.....................................#",
  "#......................................S.#",
  "##########################################",
].join("\n");

function hallState(seed = 1, bus = new EventBus()): SimState {
  const map = parseArenaText(HALL, { source: "hall" });
  const weapons = generateWeaponSet(createRng(seed, "weapons"), 5, { ticksPerSecond: 20 });
  return createSimState({ map, seed, bus, weapons });
}

function powerupOf(state: SimState): PickupState {
  const found = state.pickups.find((pickup) => pickup.point.kind === "powerup");
  if (!found) throw new Error("the test arena has no power-up point");
  found.itemId = "redeemer";
  return found;
}

/** Team A bot 0 and team B bot 0, both alive, with the rest removed. */
function pair(state: SimState): [BotState, BotState] {
  const a = state.bots[0] as BotState;
  const b = state.bots[3] as BotState;
  for (const bot of state.bots) if (bot !== a && bot !== b) bot.alive = false;
  return [a, b];
}

describe("the Redeemer weapon", () => {
  it("is outside the power budget", () => {
    // Section 7.3 prices a weapon by its DPS profile. A Redeemer is one shot
    // that ends a fight, so pricing it would make the profile lie.
    const redeemer = loadRedeemerWeapon();
    expect(redeemer.budgetUsed).toBe(0);
    expect(redeemer.tier).toBe("powerup");
    expect(redeemer.archetype).toBe("redeemer");
  });

  it("kills a whole bot at the centre and leaves one alive at the edge", () => {
    const state = hallState();
    const [a, b] = pair(state);
    const redeemer = loadRedeemerWeapon();
    const full = state.config.healthMax;

    // At the centre of the blast.
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 20, y: 1 });
    b.health = full;
    b.armor = 0;
    b.shield = 0;
    spawnProjectile(state, a, 0, redeemer);
    for (let tick = 0; tick < 200 && state.projectiles.length > 0; tick += 1) {
      updateProjectiles(state);
    }
    expect(b.alive).toBe(false);
  });

  it("leaves a bot alive at the edge of the blast", () => {
    const state = hallState();
    const [a, b] = pair(state);
    const redeemer = loadRedeemerWeapon();
    a.pos = cellCenter({ x: 2, y: 1 });
    b.health = state.config.healthMax;
    b.armor = 0;
    b.shield = 0;
    // Just inside the radius, where the blast has faded the most.
    const edge = redeemer.aoeRadius - 0.1;
    b.pos = { x: 20.5 + edge, y: 1.5 };
    // The blast goes off at 20.5, not at the bot: aim a straight shot there.
    const straight = { ...redeemer, homingTurnRate: 0 };
    const wall = { ...straight, rangeMax: 18 };
    spawnProjectile(state, a, 0, wall);
    for (let tick = 0; tick < 200 && state.projectiles.length > 0; tick += 1) {
      updateProjectiles(state);
    }
    expect(b.alive).toBe(true);
    expect(b.health).toBeLessThan(state.config.healthMax);
  });

  it("turns toward an enemy that moves out of its line", () => {
    const state = hallState();
    const [a, b] = pair(state);
    const redeemer = loadRedeemerWeapon();
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 30, y: 3 });

    // Fired straight down the hall, away from the enemy.
    spawnProjectile(state, a, 0, redeemer);
    const shot = state.projectiles[0]!;
    const before = Math.atan2(shot.velocity.y, shot.velocity.x);
    for (let tick = 0; tick < 5; tick += 1) updateProjectiles(state);
    const after = Math.atan2(shot.velocity.y, shot.velocity.x);
    expect(after).toBeGreaterThan(before);
  });

  it("flies straight when the weapon has no turn rate", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 30, y: 3 });
    const straight = { ...loadRedeemerWeapon(), homingTurnRate: 0 };
    spawnProjectile(state, a, 0, straight);
    const shot = state.projectiles[0]!;
    const before = shot.velocity.y;
    for (let tick = 0; tick < 5; tick += 1) updateProjectiles(state);
    expect(shot.velocity.y).toBe(before);
  });
});

describe("shooting a Redeemer down", () => {
  it("lets the other team see it and reach it", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 12, y: 1 });
    spawnProjectile(state, a, 0, loadRedeemerWeapon());

    expect(interceptableProjectiles(state, b)).toHaveLength(1);
    // The team that fired it cannot shoot its own shot down.
    expect(interceptableProjectiles(state, a)).toHaveLength(0);
  });

  it("detonates where it flies when its own health runs out", () => {
    const state = hallState();
    const [a, b] = pair(state);
    const redeemer = loadRedeemerWeapon();
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 34, y: 1 });
    b.health = state.config.healthMax;
    spawnProjectile(state, a, 0, redeemer);
    const shot = state.projectiles[0]!;

    // One hit that does not finish it leaves it in the air.
    expect(damageProjectile(state, shot, redeemer.projectileHealth! - 1)).toBe(false);
    expect(state.projectiles).toHaveLength(1);

    // The hit that finishes it sets it off far from the enemy, who lives.
    expect(damageProjectile(state, shot, 5)).toBe(true);
    expect(state.projectiles).toHaveLength(0);
    expect(b.alive).toBe(true);
    expect(b.health).toBe(state.config.healthMax);
  });

  it("gives nothing to a shot that cannot be shot down", () => {
    const state = hallState();
    const [a, b] = pair(state);
    a.pos = cellCenter({ x: 2, y: 1 });
    b.pos = cellCenter({ x: 12, y: 1 });
    const plain = { ...loadRedeemerWeapon(), projectileHealth: 0 };
    spawnProjectile(state, a, 0, plain);
    expect(interceptableProjectiles(state, b)).toHaveLength(0);
  });
});

describe("the Redeemer power-up point", () => {
  it("hands over the weapon with one round", () => {
    const state = hallState();
    const bot = state.bots[0] as BotState;
    const pickup = powerupOf(state);
    expect(takePickup(state, bot, pickup)).toBe(true);

    const held = bot.weapons.find((weapon) => weapon.id === "redeemer");
    expect(held).toBeDefined();
    expect(bot.ammo.get("redeemer")).toBe(1);
    expect(pickup.ready).toBe(false);
  });

  it("is not refilled by an ammo point", () => {
    // One shot means one shot (Section 7.20.18).
    expect(loadRedeemerWeapon().ammoPerPickup).toBe(0);
  });

  it("is lost when the bot dies", () => {
    const state = hallState();
    const bot = state.bots[0] as BotState;
    takePickup(state, bot, powerupOf(state));
    expect(bot.weapons.some((weapon) => weapon.id === "redeemer")).toBe(true);

    bot.alive = false;
    bot.health = 0;
    respawn(state, bot);
    expect(bot.weapons.some((weapon) => weapon.id === "redeemer")).toBe(false);
    expect(bot.ammo.get("redeemer")).toBeUndefined();
  });

  it("is worth nothing to a bot that already holds a loaded one", () => {
    const state = hallState();
    const bot = state.bots[0] as BotState;
    const pickup = powerupOf(state);
    takePickup(state, bot, pickup);
    pickup.ready = true;
    expect(takePickup(state, bot, pickup)).toBe(false);
  });

  it("comes back rarely, against the other power-ups", () => {
    const tables = loadPickups();
    const redeemer = tables.powerups["redeemer"];
    expect(redeemer).toBeDefined();
    expect(redeemer!.weapon).toBe("redeemer");
    const total = Object.values(tables.powerups).reduce((sum, item) => sum + item.weight, 0);
    const share = redeemer!.weight / total;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.4);
  });
});
