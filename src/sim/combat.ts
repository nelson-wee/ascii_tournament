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
import type { RangeBand } from "../weapons/types.js";
import {
  applyConeDamage,
  applyLineDamage,
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

/** The reaction of a bot with its weapon, at a range band (Section 7.20.7). */
export function effectiveReaction(bot: BotState, band: RangeBand): number {
  return bot.attributes.reactionTicks + bot.weapon.reactionByBand[band];
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
    const distance = distanceBetween(bot, enemy);
    if (distance > bot.weapon.rangeMax || distance >= bestDistance) continue;
    best = enemy;
    bestDistance = distance;
  }

  if (bot.targetId === null) return best;
  const current = findBot(state, bot.targetId);
  if (!current?.alive || !bot.visibleEnemyIds.includes(current.id)) return best;
  const currentDistance = distanceBetween(bot, current);
  if (currentDistance > bot.weapon.rangeMax) return best;
  if (best === null || bestDistance > currentDistance * state.config.targetSwitchMargin) {
    return current;
  }
  return best;
}

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
      // A projectile is dodged by moving out of its way, not by a roll.
      spawnProjectile(state, bot, aimAngle, weapon);
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
  // A bot that retreats breaks contact. It does not fire. This gives the
  // aggression tactic a cost and a benefit. TBD
  if (bot.action.kind === "Retreat") {
    bot.targetId = null;
    bot.aimTicks = 0;
    return;
  }

  const target = selectTarget(state, bot);
  if (!target) {
    bot.targetId = null;
    bot.aimTicks = 0;
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
  if (bot.aimTicks < effectiveReaction(bot, band)) return;

  bot.fireCooldownTicks = bot.weapon.fireIntervalTicks;
  state.bus.emit("Shot", state.tick, state.roundNumber, {
    shooterId: bot.id,
    targetId: target.id,
    weaponId: bot.weapon.id,
    attackType: bot.weapon.attackType,
    rangeBand: band,
  });
  releaseShot(state, bot, target);
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
