/**
 * Pickups (dev-guide Section 7.12).
 *
 * Each pickup point has a respawn timer. The game rolls one spawn table per
 * match, and the table does not change between rounds.
 *
 * The items follow the classic arena shooter:
 *
 *   health       health back, up to the maximum
 *   armor        an armor pool that takes a share of every hit
 *   ammo         universal: it refills every weapon that the bot holds
 *   weapon       the weapon of the slot, plus its rounds
 *   powerup      double damage for a time, or a shield belt
 *
 * A power-up comes back far less often than health or armor, so holding the
 * point where it lands is worth a fight.
 */
import { cellIndex } from "../arena/types.js";
import { loadPickups } from "../core/data.js";
import type { Pickups } from "../core/schemas.js";
import type { Rng } from "../core/rng.js";
import type { ArenaMap, PickupPoint } from "../arena/types.js";
import type { Weapon } from "../weapons/types.js";
import { botCell, botsInTickOrder, type BotState, type SimState } from "./state.js";

/** The item that each pickup slot gives, for a whole match (Section 7.12). */
export interface SpawnTable {
  slots: Record<string, string>;
}

/** The state of one pickup point during a round. */
export interface PickupState {
  point: PickupPoint;
  /** The item id from the spawn table. */
  itemId: string;
  /** True while a bot can take it. */
  ready: boolean;
  /** The tick that it comes back on, while `ready` is false. */
  readyAtTick: number;
}

/**
 * Roll the spawn table of a match.
 *
 * A weapon slot takes one of the weapons of the run. A power-up slot takes one
 * of the power-ups by weight. Every other slot gives what its kind says.
 */
export function rollSpawnTable(
  map: ArenaMap,
  weapons: readonly Weapon[],
  rng: Rng,
  tables: Pickups = loadPickups(),
): SpawnTable {
  const slots: Record<string, string> = {};
  // The baseline weapon is the fallback that every bot already holds, so a
  // weapon point gives one of the others.
  const offered = weapons.length > 1 ? weapons.slice(1) : weapons;
  const powerupNames = Object.keys(tables.powerups);
  const powerupWeights = powerupNames.map((name) => tables.powerups[name]?.weight ?? 1);

  for (const point of map.pickups) {
    if (point.kind === "weapon") {
      slots[point.slotId] = (rng.pick(offered) as Weapon).id;
      continue;
    }
    if (point.kind === "powerup") {
      const total = powerupWeights.reduce((sum, weight) => sum + weight, 0);
      let roll = rng.float(0, total);
      let chosen = powerupNames[powerupNames.length - 1] as string;
      for (const [index, name] of powerupNames.entries()) {
        roll -= powerupWeights[index] as number;
        if (roll <= 0) {
          chosen = name;
          break;
        }
      }
      slots[point.slotId] = chosen;
      continue;
    }
    slots[point.slotId] = point.kind;
  }
  return { slots };
}

/** The pickup points of a round, all ready. */
export function createPickupStates(map: ArenaMap, table: SpawnTable): PickupState[] {
  return map.pickups.map((point) => ({
    point,
    itemId: table.slots[point.slotId] ?? point.kind,
    ready: true,
    readyAtTick: 0,
  }));
}

/** Bring back every pickup point whose timer ran out. */
export function updatePickups(state: SimState): void {
  for (const pickup of state.pickups) {
    if (pickup.ready || state.tick < pickup.readyAtTick) continue;
    pickup.ready = true;
    state.bus.emit("PickupRespawned", state.tick, state.roundNumber, {
      slotId: pickup.point.slotId,
      kind: pickup.point.kind,
      itemId: pickup.itemId,
      cell: pickup.point.cell,
    });
  }
}

/**
 * How much a bot wants a pickup, from 0 (no use) to about 1.5.
 *
 * The AI reads this, so a bot walks to what it needs. Before M8 a pickup point
 * gave nothing, so `itemControl` had a cost and no benefit at all
 * (Section 7.20.10).
 */
export function pickupValue(state: SimState, bot: BotState, pickup: PickupState): number {
  const worth = readyValue(state, bot, pickup);
  if (pickup.ready) return worth;

  // A point that is not ready is still worth walking to, if it comes back
  // soon. This is what a player does in an arena shooter: stand where the
  // power-up will land. It also keeps the bots moving. Without it a bot with
  // nothing to take stands still, the two teams never meet, and the round runs
  // to the time limit with no kill.
  const left = pickup.readyAtTick - state.tick;
  if (left <= 0 || left > state.config.pickupAnticipationTicks) return 0;
  const nearness = 1 - left / state.config.pickupAnticipationTicks;
  return worth * nearness * state.config.pickupAnticipationShare;
}

/** What a pickup point is worth to a bot when it is ready. */
function readyValue(state: SimState, bot: BotState, pickup: PickupState): number {
  const tables = state.pickupTables;

  switch (pickup.point.kind) {
    case "health": {
      const missing = 1 - bot.health / state.config.healthMax;
      return missing * 1.4;
    }
    case "armor": {
      const missing = 1 - bot.armor / tables.armorMax;
      return missing * 1.1;
    }
    case "ammo": {
      let need = 0;
      for (const weapon of bot.weapons.slice(1)) {
        const left = bot.ammo.get(weapon.id) ?? weapon.ammoMax;
        need = Math.max(need, 1 - left / weapon.ammoMax);
      }
      return need * 1.2;
    }
    case "powerup":
      // A power-up is always worth taking, and it is rare.
      return 1.5;
    case "weapon": {
      const weapon = bot.weapons.find((candidate) => candidate.id === pickup.itemId);
      if (!weapon) return 0.8;
      const left = bot.ammo.get(weapon.id) ?? weapon.ammoMax;
      return (1 - left / weapon.ammoMax) * 1.0;
    }
    default:
      return 0;
  }
}

/** Give a bot the item of a pickup point. Returns true if it took anything. */
export function takePickup(state: SimState, bot: BotState, pickup: PickupState): boolean {
  if (!pickup.ready || !bot.alive) return false;
  const tables = state.pickupTables;
  const kindData = tables.kinds[pickup.point.kind];
  let took = false;

  switch (pickup.point.kind) {
    case "health": {
      if (bot.health >= state.config.healthMax) break;
      bot.health = Math.min(state.config.healthMax, bot.health + (kindData?.amount ?? 0));
      took = true;
      break;
    }
    case "armor": {
      if (bot.armor >= tables.armorMax) break;
      bot.armor = Math.min(tables.armorMax, bot.armor + (kindData?.amount ?? 0));
      took = true;
      break;
    }
    case "ammo": {
      for (const weapon of bot.weapons.slice(1)) {
        const left = bot.ammo.get(weapon.id) ?? weapon.ammoMax;
        if (left >= weapon.ammoMax) continue;
        bot.ammo.set(weapon.id, Math.min(weapon.ammoMax, left + weapon.ammoPerPickup));
        took = true;
      }
      break;
    }
    case "weapon": {
      const weapon = bot.weapons.find((candidate) => candidate.id === pickup.itemId);
      if (!weapon) break;
      const left = bot.ammo.get(weapon.id) ?? weapon.ammoMax;
      if (left >= weapon.ammoMax) break;
      bot.ammo.set(weapon.id, weapon.ammoMax);
      took = true;
      break;
    }
    case "powerup": {
      const powerup = tables.powerups[pickup.itemId];
      if (!powerup) break;
      if (powerup.shield !== undefined) {
        bot.shield = Math.min(tables.shieldMax, bot.shield + powerup.shield);
      }
      if (powerup.durationTicks > 0) {
        bot.powerups.set(pickup.itemId, state.tick + powerup.durationTicks);
      }
      took = true;
      break;
    }
    default:
      break;
  }

  if (!took) return false;
  pickup.ready = false;
  pickup.readyAtTick = state.tick + (kindData?.respawnTicks ?? 300);
  state.bus.emit("PickupTaken", state.tick, state.roundNumber, {
    botId: bot.id,
    teamId: bot.teamId,
    slotId: pickup.point.slotId,
    kind: pickup.point.kind,
    itemId: pickup.itemId,
    cell: pickup.point.cell,
  });
  return true;
}

/**
 * Let every bot take the pickup point that it stands on.
 *
 * Two enemies can stand on one point in the same tick, and only the first one
 * takes it. So the bots come in reaction order, as they do when they fire
 * (Section 7.20.7): the fixed order of the team list would hand every
 * contested point to team A (Section 7.2.1).
 */
export function applyPickups(state: SimState): void {
  if (state.pickups.length === 0) return;
  for (const bot of botsInTickOrder(state)) {
    if (!bot.alive) continue;
    const cell = botCell(bot);
    const index = cellIndex(state.map, cell.x, cell.y);
    const pickup = state.pickupByCell.get(index);
    if (pickup) takePickup(state, bot, pickup);
  }
}

/** Drop a power-up whose time ran out. */
export function updatePowerups(state: SimState): void {
  for (const bot of state.bots) {
    if (bot.powerups.size === 0) continue;
    for (const [name, expiry] of bot.powerups) {
      if (state.tick >= expiry) bot.powerups.delete(name);
    }
  }
}

/** The factor that a bot's power-ups put on its outgoing damage. */
export function damageMultiplierOf(state: SimState, bot: BotState): number {
  let factor = 1;
  for (const name of bot.powerups.keys()) {
    factor *= state.pickupTables.powerups[name]?.damageMultiplier ?? 1;
  }
  return factor;
}
