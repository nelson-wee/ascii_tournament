/**
 * Combat (dev-guide Sections 7.6, 7.20.5, and 7.20.7).
 *
 * This module picks a target, decides whether a shot hits, and hands the shot
 * to the attack type in `sim/attacks.ts`. The damage itself is in
 * `sim/damage.ts`.
 *
 * Two rules push a bot to keep moving (Section 7.20.5):
 * - A weapon with the `targetStationary` crit condition crits a target that
 *   has not moved for `stationaryTicksForCrit` ticks.
 * - A target that moves has a dodge, which rises over `dodgeRampTicks` ticks
 *   of movement. Its own `evasion` tactic adds to it, and evasion still lowers
 *   the accuracy of the bot that evades.
 *
 * Ammo is not counted yet: the baseline weapon must stay a viable fallback
 * (Section 7.3), and the ammo pickups arrive with M8.
 */
import { canSee, isUnaware } from "../ai/perception.js";
import type { RangeBand, Weapon } from "../weapons/types.js";
import {
  applyConeDamage,
  applyLineDamage,
  areaTargetsIfAimedAt,
  leadAngle,
  spawnProjectile,
} from "./attacks.js";
import { damageBot, isInCover, rangeBandOf } from "./damage.js";
import { applyDot } from "./damage.js";
import {
  botCell,
  cellCenter,
  distanceBetween,
  findBot,
  teamSpawns,
  type BotState,
  type SimState,
} from "./state.js";

export { isInCover, rangeBandOf };

/**
 * True if the weapon never runs out of rounds.
 * The baseline weapon is the fallback of Section 7.3, so it is never empty.
 */
export function hasUnlimitedAmmo(bot: BotState, weapon: Weapon): boolean {
  return weapon.id === (bot.weapons[0]?.id ?? "");
}

/**
 * The rounds that a bot has left for a weapon.
 * The map records what a bot spent, so a weapon that it never fired is full.
 */
export function ammoOf(bot: BotState, weapon: Weapon): number {
  if (hasUnlimitedAmmo(bot, weapon)) return Number.POSITIVE_INFINITY;
  return bot.ammo.get(weapon.id) ?? weapon.ammoMax;
}

/** True if the bot can fire the weapon now. */
export function hasAmmo(bot: BotState, weapon: Weapon): boolean {
  return ammoOf(bot, weapon) > 0;
}

/**
 * Spend one round, and fall back to the baseline weapon if that was the last.
 *
 * A magazine is therefore a real cost: a weapon with a small magazine gives a
 * short burst of power and then the bot is back on the fallback. The ammo
 * pickups of M8 refill it.
 */
function spendAmmo(state: SimState, bot: BotState): void {
  if (hasUnlimitedAmmo(bot, bot.weapon)) return;
  const left = (bot.ammo.get(bot.weapon.id) ?? 0) - 1;
  bot.ammo.set(bot.weapon.id, Math.max(0, left));
  if (left > 0) return;

  const fallback = bot.weapons[0];
  if (!fallback) return;
  state.bus.emit("WeaponEmpty", state.tick, state.roundNumber, {
    botId: bot.id,
    weaponId: bot.weapon.id,
    fallbackId: fallback.id,
  });
  bot.weapon = fallback;
  bot.fireCooldownTicks = Math.max(bot.fireCooldownTicks, fallback.fireIntervalTicks);
}

/** The reaction of a bot with its weapon, at a range band (Section 7.20.7). */
export function effectiveReaction(bot: BotState, band: RangeBand, aggressionDiscount = 0): number {
  const ticks = bot.attributes.reactionTicks + bot.weapon.reactionByBand[band];
  // A bold bot shoots first. That is the benefit of aggression. Its cost is
  // already in place: it fights at low health, it does not break off, and it
  // does not walk to the band where its weapon is strongest (Section 7.20.16).
  return Math.max(1, Math.round(ticks * (1 - bot.tactics.aggression * aggressionDiscount)));
}

/** The range band that a bot is working at: to its target, or its preferred one. */
export function currentBand(state: SimState, bot: BotState): RangeBand {
  const target = bot.targetId === null ? null : findBot(state, bot.targetId);
  if (target?.alive) return rangeBandOf(state, distanceBetween(bot, target));
  return bot.tactics.preferredRange;
}

/**
 * How much a target avoids a shot, from 0 to 1 (Section 7.20.5).
 * A bot that has moved without a break dodges more than one that just started.
 */
export function dodgeOf(state: SimState, target: BotState): number {
  const { config } = state;
  const ramp = Math.min(1, target.movingTicks / Math.max(1, config.dodgeRampTicks));
  return Math.min(0.9, ramp * config.movingTargetPenalty + target.tactics.evasion * 0.15);
}

/**
 * The chance that a shot hits.
 *
 * The chance falls with the distance and with the dodge of the target
 * (Section 7.3). Every number is a placeholder. TBD
 */
export function hitChance(state: SimState, shooter: BotState, target: BotState): number {
  const { config } = state;
  const distance = distanceBetween(shooter, target);
  const reach = Math.min(1, distance / shooter.weapon.rangeMax);
  let chance = shooter.attributes.accuracy * (1 - reach * config.distanceFalloff);
  chance *= 1 - dodgeOf(state, target);
  // Section 7.5: evasion lowers the accuracy of the bot that evades.
  chance *= 1 - shooter.tactics.evasion * config.evasionAccuracyPenalty;
  return Math.min(1, Math.max(config.minHitChance, chance));
}

/** True if a crit condition of the weapon is true for this shot. */
export function critConditionMet(state: SimState, shooter: BotState, target: BotState): boolean {
  for (const condition of shooter.weapon.critConditions) {
    if (condition === "targetUnaware" && isUnaware(state, shooter, target)) return true;
    if (
      condition === "targetStationary" &&
      target.stationaryTicks >= state.config.stationaryTicksForCrit
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The live enemy that a bot aims at.
 *
 * The bot keeps its current target while it can see it, it is alive, and it is
 * inside the weapon range. It changes target only for an enemy that is clearly
 * nearer (`targetSwitchMargin`).
 *
 * The margin is necessary. Two or three enemies at almost the same distance
 * make the nearest one change on every tick. The reaction timer of `tryFire`
 * starts again with every change, so the bot never fires. A round can then end
 * with no kill at all.
 */
export function selectTarget(state: SimState, bot: BotState): BotState | null {
  let best: BotState | null = null;
  let bestDistance = Infinity;
  for (const id of bot.visibleEnemyIds) {
    const enemy = findBot(state, id);
    if (!enemy || !enemy.alive) continue;
    const distance = aimCost(state, bot, enemy);
    if (distanceBetween(bot, enemy) > bot.weapon.rangeMax || distance >= bestDistance) continue;
    best = enemy;
    bestDistance = distance;
  }

  if (bot.targetId === null) return best;
  const current = findBot(state, bot.targetId);
  if (!current?.alive || !bot.visibleEnemyIds.includes(current.id)) return best;
  if (distanceBetween(bot, current) > bot.weapon.rangeMax) return best;
  const currentDistance = aimCost(state, bot, current);
  if (best === null || bestDistance > currentDistance * state.config.targetSwitchMargin) {
    return current;
  }
  return best;
}

/**
 * What an enemy costs to aim at. The nearest enemy wins, unless an area weapon
 * catches more than one enemy by aiming at another (Section 7.8).
 *
 * The cost is the distance divided by the enemies that the shot would catch, so
 * a shot that catches two counts as half as far. An enemy behind an enemy is
 * then worth turning to.
 */
function aimCost(state: SimState, bot: BotState, enemy: BotState): number {
  const distance = distanceBetween(bot, enemy);
  if (!AREA_ATTACK_TYPES.has(bot.weapon.attackType)) return distance;
  return distance / areaTargetsIfAimedAt(state, bot, bot.weapon, enemy.pos);
}

/** The attack types whose shot can catch more than one bot. */
const AREA_ATTACK_TYPES = new Set(["cone", "line", "burst", "tile"]);

/** Send the shot on its way, by the attack type of the weapon (Section 7.20.3). */
function releaseShot(state: SimState, bot: BotState, target: BotState): void {
  const { weapon } = bot;
  const aimAngle = Math.atan2(target.pos.y - bot.pos.y, target.pos.x - bot.pos.x);
  const crit = critConditionMet(state, bot, target) && state.rng.bool(weapon.critChance);

  switch (weapon.attackType) {
    case "cone":
      // An area does not roll to hit. A bot that holds one cell cannot dodge it.
      applyConeDamage(state, bot, aimAngle, weapon);
      return;
    case "line":
      if (!state.rng.bool(hitChance(state, bot, target))) return;
      applyLineDamage(state, bot, aimAngle, weapon, crit);
      return;
    case "projectile":
    case "burst":
    case "ricochet":
    case "tile":
      // A projectile is dodged by moving out of its way, not by a roll. It
      // leads a moving target, and it carries the critical hit that it rolled.
      spawnProjectile(state, bot, leadAngle(bot, target, weapon), weapon, crit);
      return;
    case "hitscan":
    default: {
      if (!state.rng.bool(hitChance(state, bot, target))) return;
      const damage = weapon.damage * (crit ? state.config.critMultiplier : 1);
      damageBot(state, bot, target, damage, {
        weaponId: weapon.id,
        weaponArchetype: weapon.archetype,
        attackType: weapon.attackType,
        source: "shot",
        crit,
      });
      applyDot(target, weapon, bot.id);
    }
  }
}

/**
 * One shot of one bot, if it has a target, its reaction time passed, and its
 * weapon is ready.
 */
export function tryFire(state: SimState, bot: BotState): void {
  if (!bot.alive) return;
  if (bot.fireCooldownTicks > 0) return;
  const target = selectTarget(state, bot);
  if (!target) {
    // The aim falls away, it does not vanish. A bot that walks behind a pillar
    // for a moment should not start its whole reaction again. Without this a
    // bot that moves almost never finishes aiming, and a round of bots that
    // cross the arena for pickups slows to a stop.
    bot.aimTicks = Math.max(0, bot.aimTicks - 1);
    if (bot.aimTicks === 0) bot.targetId = null;
    return;
  }

  // Reaction time: the bot needs its reaction on one target before it fires.
  // The weapon adds to it, so a heavy weapon is slow to bring to bear.
  if (bot.targetId !== target.id) {
    bot.targetId = target.id;
    bot.aimTicks = 0;
    return;
  }
  bot.aimTicks += 1;
  const band = rangeBandOf(state, distanceBetween(bot, target));
  if (bot.aimTicks < effectiveReaction(bot, band, state.config.aggressionReactionDiscount)) return;

  bot.fireCooldownTicks = bot.weapon.fireIntervalTicks;
  const fired = bot.weapon;
  state.bus.emit("Shot", state.tick, state.roundNumber, {
    shooterId: bot.id,
    targetId: target.id,
    weaponId: bot.weapon.id,
    attackType: bot.weapon.attackType,
    rangeBand: band,
  });
  releaseShot(state, bot, target);
  if (bot.weapon.id === fired.id) spendAmmo(state, bot);
}

/** Put a dead bot back on a spawn cell of its team. */
export function respawn(state: SimState, bot: BotState): void {
  const spawns = teamSpawns(state, bot.teamId);
  const free = spawns.filter(
    (cell) =>
      !state.bots.some((other) => {
        if (!other.alive || other === bot) return false;
        const at = botCell(other);
        return at.x === cell.x && at.y === cell.y;
      }),
  );
  const cell = state.rng.pick(free.length > 0 ? free : spawns);

  bot.alive = true;
  bot.health = state.config.healthMax;
  bot.armor = 0;
  bot.shield = 0;
  bot.powerups.clear();
  bot.pos = cellCenter(cell);
  bot.facing = Math.atan2(state.map.height / 2 - bot.pos.y, state.map.width / 2 - bot.pos.x);
  bot.fovCell = null;
  bot.path = [];
  bot.pathGoal = null;
  bot.goalSlotId = null;
  bot.blockedTicks = 0;
  bot.movedLastTick = false;
  bot.stationaryTicks = 0;
  bot.movingTicks = 0;
  bot.fireCooldownTicks = 0;
  bot.targetId = null;
  bot.aimTicks = 0;
  bot.dots = [];
  bot.velocity = { x: 0, y: 0 };
  // A bot keeps the weapons it found, for the round. Dropping them on every
  // death put the bot back on the baseline for most of its life, and the
  // baseline took 43 % of the kills, which is not a fallback (Section 7.3).
  // Death still costs the armor, the shield, the power-ups, and the ground.
  bot.weapon = bot.weapons[0] ?? bot.weapon;
  bot.ammo.clear();
  bot.lastSeen.clear();
  bot.peripheralEnemyIds = [];
  bot.peripheralTicks.clear();
  state.bus.emit("Spawn", state.tick, state.roundNumber, {
    botId: bot.id,
    teamId: bot.teamId,
    cell,
  });
}

/** `canSee` is re-exported so that the tests and the AI use one entry point. */
export { canSee };
