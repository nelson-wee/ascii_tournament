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
import { pickupEvenness } from "../arena/contested.js";
import { loadPickups, loadRedeemerWeapon } from "../core/data.js";
import type { Pickups } from "../core/schemas.js";
import type { Rng } from "../core/rng.js";
import type { ArenaMap, PickupPoint } from "../arena/types.js";
import type { Weapon } from "../weapons/types.js";
import { botCell, botsInTickOrder, type BotState, type SimState } from "./state.js";

/**
 * The fixed weapon that a power-up hands over, by its id.
 *
 * These weapons sit outside the power budget of Section 7.3 on purpose. A
 * Redeemer is one shot that ends a fight, not a damage-per-second profile, so
 * pricing it against the budget would either make it useless or make
 * `expectedTargets` lie again (Section 7.20.18).
 */
function powerupWeapon(id: string): Weapon | null {
  return id === "redeemer" ? loadRedeemerWeapon() : null;
}

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
  const powerupNames = Object.keys(tables.powerups);
  const powerupWeights = powerupNames.map((name) => tables.powerups[name]?.weight ?? 1);

  for (const [slotId, weaponId] of placeWeapons(map, weapons, rng)) slots[slotId] = weaponId;

  // A power-up point rolls once per facing pair, so both teams get the same
  // power-up on the same ground. A roll per point gave one team the double
  // damage and the other the shield belt (Section 7.2.1).
  const powerupPoints = map.pickups.filter((point) => point.kind === "powerup");
  for (const pair of pairFacingPoints(map, powerupPoints)) {
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
    for (const point of pair) slots[point.slotId] = chosen;
  }

  for (const point of map.pickups) {
    if (point.kind === "weapon" || point.kind === "powerup") continue;
    slots[point.slotId] = point.kind;
  }
  return { slots };
}

/**
 * Put the generated weapons on the weapon points of the arena.
 *
 * Two rules, from Section 3.1 of the M8 weapon analysis and Section 7.2.1:
 *
 * 1. **The strongest weapon takes the most contested pair.** A prize weapon on
 *    ground that one team owns is not a prize, it is a head start. An arena is
 *    expected to offer a conflict zone for it; `checkArenaFairness` is the
 *    acceptance rule, and M7 must meet it.
 * 2. **Every point holds the weapon of the point that it faces.** This was once
 *    the rule for the points outside a conflict zone only, and a contested
 *    point held a weapon of its own, because both teams reach it together.
 *    That was the side bias: the two contested points of an arena always tie on
 *    evenness, the sort fell through to the slot id, and the same half took the
 *    strongest weapon of the run in every match. Both teams then went for the
 *    same point, so the two teams stopped being mirror images of each other
 *    (Section 7.20.26). Without the mirror the matchup read 68 %.
 *
 * The baseline weapon is the fallback that every bot already carries
 * (Section 7.3), so no point gives it.
 */
function placeWeapons(
  map: ArenaMap,
  weapons: readonly Weapon[],
  rng: Rng,
): Map<string, string> {
  const placed = new Map<string, string>();
  const points = map.pickups.filter((point) => point.kind === "weapon");
  const offered = weapons.length > 1 ? weapons.slice(1) : weapons;
  if (points.length === 0 || offered.length === 0) return placed;

  const evenness = pickupEvenness(map);
  // Every point joins the point that it faces, contested or not.
  const groups: PickupPoint[][] = pairFacingPoints(map, points);

  groups.sort((a, b) => {
    const left = Math.min(...a.map((point) => evenness.get(point.slotId) ?? Infinity));
    const right = Math.min(...b.map((point) => evenness.get(point.slotId) ?? Infinity));
    return left - right || (a[0] as PickupPoint).slotId.localeCompare((b[0] as PickupPoint).slotId);
  });

  // The strongest weapon first, by what the budget paid for it.
  const byPower = [...offered].sort((a, b) => b.budgetUsed - a.budgetUsed || a.id.localeCompare(b.id));
  const order: Weapon[] = [...byPower];
  while (order.length < groups.length) order.push(...rng.shuffle(byPower));

  for (const [index, group] of groups.entries()) {
    const weapon = order[index] as Weapon;
    for (const point of group) placed.set(point.slotId, weapon.id);
  }
  return placed;
}

/**
 * Group the points into the pairs that face each other under a half turn.
 * A point with no partner makes a group of one, so an arena that is not
 * symmetric still gets every point filled.
 */
function pairFacingPoints(
  map: ArenaMap,
  points: readonly PickupPoint[],
): PickupPoint[][] {
  const left = [...points];
  const groups: PickupPoint[][] = [];

  while (left.length > 0) {
    const point = left.shift() as PickupPoint;
    const image = { x: map.width - 1 - point.cell.x, y: map.height - 1 - point.cell.y };
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (const [index, other] of left.entries()) {
      const distance = (other.cell.x - image.x) ** 2 + (other.cell.y - image.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) {
      groups.push([point]);
      continue;
    }
    const partner = left.splice(bestIndex, 1)[0] as PickupPoint;
    groups.push([point, partner]);
  }
  return groups;
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

/**
 * The damage per second of a weapon, over the bands that the arena fires in
 * (Section 7.20.15). The AI and the power budget read the same weights.
 */
export function meanDps(state: SimState, weapon: Weapon): number {
  const share = state.config.bandShare;
  return (
    weapon.dpsProfile.close * share.close +
    weapon.dpsProfile.mid * share.mid +
    weapon.dpsProfile.long * share.long
  );
}

/** The best weapon that a bot holds, by the same measure. */
function bestHeldDps(state: SimState, bot: BotState): number {
  let best = 0;
  for (const weapon of bot.weapons) best = Math.max(best, meanDps(state, weapon));
  return best;
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
    case "powerup": {
      // A power-up is always worth taking, and it is rare. A power-up that
      // hands over a weapon is worth nothing to a bot that already holds it
      // with a round in the magazine.
      const weaponId = state.pickupTables.powerups[pickup.itemId]?.weapon;
      if (weaponId !== undefined) {
        const held = bot.weapons.find((candidate) => candidate.id === weaponId);
        if (held && (bot.ammo.get(held.id) ?? held.ammoMax) > 0) return 0;
        return 2.2;
      }
      return 1.5;
    }
    case "weapon": {
      const weapon = state.runWeapons.find((candidate) => candidate.id === pickup.itemId);
      if (!weapon) return 0;
      const held = bot.weapons.some((candidate) => candidate.id === weapon.id);
      if (!held) {
        // A weapon the bot does not hold is worth what it adds over the best
        // weapon it does hold. A flat guess here sent bots to a point that
        // gave them nothing better (Section 3.1 of the M8 weapon analysis).
        const best = bestHeldDps(state, bot);
        const gain = meanDps(state, weapon) / Math.max(1, best);
        return Math.max(0, Math.min(1.6, (gain - 1) * 1.6 + 0.3));
      }
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
        // A weapon that an ammo point does not refill: the Redeemer is one
        // shot, and an ammo point must not make it two.
        if (weapon.ammoPerPickup <= 0) continue;
        const left = bot.ammo.get(weapon.id) ?? weapon.ammoMax;
        if (left >= weapon.ammoMax) continue;
        bot.ammo.set(weapon.id, Math.min(weapon.ammoMax, left + weapon.ammoPerPickup));
        took = true;
      }
      break;
    }
    case "weapon": {
      const weapon = state.runWeapons.find((candidate) => candidate.id === pickup.itemId);
      if (!weapon) break;
      const held = bot.weapons.some((candidate) => candidate.id === weapon.id);
      if (!held) {
        // The point gives the weapon itself, with a full magazine. This is the
        // only way a bot gets a generated weapon (Section 7.12).
        bot.weapons.push(weapon);
        bot.ammo.set(weapon.id, weapon.ammoMax);
        took = true;
        break;
      }
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
      if (powerup.weapon !== undefined) {
        // A power-up that hands over a weapon: the Redeemer (Section 7.20.18).
        // It carries one round, so the bot fires it once and falls back.
        const weapon = powerupWeapon(powerup.weapon);
        if (!weapon) break;
        const held = bot.weapons.find((candidate) => candidate.id === weapon.id);
        // A bot that still has the shot takes nothing, and the point stays for
        // a teammate or for the other team.
        if (held && (bot.ammo.get(held.id) ?? held.ammoMax) > 0) break;
        if (!held) bot.weapons.push(weapon);
        bot.ammo.set(weapon.id, weapon.ammoMax);
        took = true;
        break;
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

/**
 * The cells of the pickup points that hold their item now, by cell index.
 *
 * The display draws a glyph only for these, so a bare point reads as floor
 * (Section 7.12). It lives here, and not in the display, because it is a rule
 * of the simulation and a test must reach it without a browser.
 */
export function readyPickupCells(state: SimState): Set<number> {
  const ready = new Set<number>();
  for (const pickup of state.pickups) {
    if (!pickup.ready) continue;
    ready.add(cellIndex(state.map, pickup.point.cell.x, pickup.point.cell.y));
  }
  return ready;
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
