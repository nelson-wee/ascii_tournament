/**
 * Combat (dev-guide Section 7.6).
 *
 * Milestone M3 gives the hitscan path only:
 * - Line of sight at fire time. The perception step gives it.
 * - The hit chance comes from the accuracy, the distance, and the movement of
 *   the target.
 * - A crit needs a true crit condition. It is not only a random roll.
 *
 * Projectiles, area damage, DoT, and hazards arrive with Milestone M6.
 * Ammo is not counted yet: the baseline weapon must stay a viable fallback
 * (Section 7.3), and the ammo pickups arrive with M8.
 */
import { Tile, tileAt } from "../arena/types.js";
import { canSee, isUnaware } from "../ai/perception.js";
import type { RangeBand } from "../weapons/types.js";
import {
  botCell,
  cellCenter,
  distanceBetween,
  findBot,
  teamSpawns,
  type BotState,
  type SimState,
} from "./state.js";

/** The range band of a distance (Section 6.8). */
export function rangeBandOf(state: SimState, distance: number): RangeBand {
  if (distance <= state.config.rangeBandCloseMax) return "close";
  if (distance <= state.config.rangeBandMidMax) return "mid";
  return "long";
}

/**
 * The chance that a shot hits.
 *
 * The chance falls with the distance and falls again if the target moved in
 * the last tick (Section 7.3). Every number is a placeholder. TBD
 */
export function hitChance(state: SimState, shooter: BotState, target: BotState): number {
  const { config } = state;
  const distance = distanceBetween(shooter, target);
  const reach = Math.min(1, distance / shooter.weapon.rangeMax);
  let chance = shooter.attributes.accuracy * (1 - reach * config.distanceFalloff);
  if (target.movedLastTick) chance *= 1 - config.movingTargetPenalty;
  // Section 7.5: evasion lowers the accuracy of the bot that evades.
  chance *= 1 - shooter.tactics.evasion * config.evasionAccuracyPenalty;
  return Math.min(1, Math.max(config.minHitChance, chance));
}

/** True if the bot stands on a low cover tile. TBD */
export function isInCover(state: SimState, bot: BotState): boolean {
  const cell = botCell(bot);
  return tileAt(state.map, cell.x, cell.y) === Tile.CoverLow;
}

/** True if a crit condition of the weapon is true for this shot. */
function critConditionMet(state: SimState, shooter: BotState, target: BotState): boolean {
  for (const condition of shooter.weapon.critConditions) {
    if (condition === "targetUnaware" && isUnaware(state, shooter, target)) return true;
    if (condition === "targetStationary" && !target.movedLastTick) return true;
  }
  return false;
}

/** The live enemy that a bot aims at: the nearest one inside the weapon range. */
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
  return best;
}

/** The tier text of an exact count, or `null`. */
function tierText(
  tiers: readonly { count: number; text: string }[],
  count: number,
): string | null {
  return tiers.find((tier) => tier.count === count)?.text ?? null;
}

/** The highest tier that a count reached, or `null`. */
function reachedTier(
  tiers: readonly { count: number; text: string }[],
  count: number,
): string | null {
  let text: string | null = null;
  for (const tier of tiers) {
    if (count >= tier.count) text = tier.text;
  }
  return text;
}

/**
 * The kill announcements of Section 7.17: a multi-kill, a killing spree, and
 * the end of a spree.
 */
function emitAnnouncements(state: SimState, shooter: BotState, victim: BotState): void {
  const { config, tick, roundNumber, bus } = state;

  const multiKill = tierText(config.multiKillTiers, shooter.multiKillCount);
  if (multiKill !== null) {
    bus.emit("Announcement", tick, roundNumber, {
      kind: "multiKill",
      botId: shooter.id,
      teamId: shooter.teamId,
      count: shooter.multiKillCount,
      text: multiKill,
    });
  }

  const spree = tierText(config.spreeTiers, shooter.spreeCount);
  if (spree !== null) {
    bus.emit("Announcement", tick, roundNumber, {
      kind: "spree",
      botId: shooter.id,
      teamId: shooter.teamId,
      count: shooter.spreeCount,
      text: spree,
    });
  }

  const endedSpree = reachedTier(config.spreeTiers, victim.spreeCount);
  if (endedSpree !== null) {
    bus.emit("Announcement", tick, roundNumber, {
      kind: "spreeEnded",
      botId: victim.id,
      teamId: victim.teamId,
      killerId: shooter.id,
      count: victim.spreeCount,
      text: endedSpree,
    });
  }
}

/** Apply damage and, if the target dies, the death and the kill. */
function applyDamage(state: SimState, shooter: BotState, target: BotState, damage: number): void {
  target.health -= damage;
  if (target.health > 0) return;

  const { config, tick, roundNumber } = state;
  const distance = distanceBetween(shooter, target);
  const unaware = isUnaware(state, shooter, target);

  target.alive = false;
  target.health = 0;
  target.respawnAtTick = tick + config.respawnDelayTicks;
  target.path = [];
  target.goalSlotId = null;
  target.targetId = null;
  target.aimTicks = 0;
  target.visibleCells.clear();
  target.visibleEnemyIds = [];

  shooter.multiKillCount =
    tick - shooter.lastKillTick <= config.multiKillWindowTicks ? shooter.multiKillCount + 1 : 1;
  shooter.lastKillTick = tick;
  shooter.spreeCount += 1;
  state.score[shooter.teamId] += 1;

  state.bus.emit("Death", tick, roundNumber, {
    botId: target.id,
    teamId: target.teamId,
    killerId: shooter.id,
    cell: botCell(target),
  });
  // The context of Section 6.8.
  state.bus.emit("Kill", tick, roundNumber, {
    killerId: shooter.id,
    killerTeamId: shooter.teamId,
    victimId: target.id,
    victimTeamId: target.teamId,
    weaponId: shooter.weapon.id,
    weaponArchetype: shooter.weapon.archetype,
    rangeBand: rangeBandOf(state, distance),
    distance,
    killerInCover: isInCover(state, shooter),
    targetAware: !unaware,
    killerHealth: shooter.health,
    multiKillCount: shooter.multiKillCount,
    spreeCount: shooter.spreeCount,
  });
  emitAnnouncements(state, shooter, target);
  // The death ends the killing spree of the target.
  target.spreeCount = 0;
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

  // Reaction time: the bot needs `reactionTicks` on one target before it fires.
  if (bot.targetId !== target.id) {
    bot.targetId = target.id;
    bot.aimTicks = 0;
    return;
  }
  bot.aimTicks += 1;
  if (bot.aimTicks < bot.attributes.reactionTicks) return;

  const { tick, roundNumber } = state;
  bot.fireCooldownTicks = bot.weapon.fireIntervalTicks;
  const distance = distanceBetween(bot, target);
  const band = rangeBandOf(state, distance);
  state.bus.emit("Shot", tick, roundNumber, {
    shooterId: bot.id,
    targetId: target.id,
    weaponId: bot.weapon.id,
    rangeBand: band,
  });

  if (!state.rng.bool(hitChance(state, bot, target))) return;

  let damage = bot.weapon.damage;
  const crit = critConditionMet(state, bot, target) && state.rng.bool(bot.weapon.critChance);
  if (crit) damage *= state.config.critMultiplier;

  state.bus.emit("Hit", tick, roundNumber, {
    shooterId: bot.id,
    targetId: target.id,
    damage,
    rangeBand: band,
  });
  if (crit) {
    state.bus.emit("Crit", tick, roundNumber, { shooterId: bot.id, targetId: target.id, damage });
  }
  applyDamage(state, bot, target, damage);
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
  bot.path = [];
  bot.goalSlotId = null;
  bot.blockedTicks = 0;
  bot.movedLastTick = false;
  bot.fireCooldownTicks = 0;
  bot.targetId = null;
  bot.aimTicks = 0;
  bot.lastSeen.clear();
  state.bus.emit("Spawn", state.tick, state.roundNumber, {
    botId: bot.id,
    teamId: bot.teamId,
    cell,
  });
}

/** `canSee` is re-exported so that the tests and the AI use one entry point. */
export { canSee };
