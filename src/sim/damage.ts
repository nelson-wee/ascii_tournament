/**
 * Damage, death, and the kill record (dev-guide Sections 7.6 and 7.17).
 *
 * Every source of damage ends here: a shot, area damage, a hazard tile, and
 * damage over time. The module owns the `Death` event, the `Kill` event with
 * the context of Section 6.8, and the kill announcements of Section 7.17.
 */
import { Tile, tileAt } from "../arena/types.js";
import { isUnaware, noteIncomingFire } from "../ai/perception.js";
import type { RangeBand } from "../weapons/types.js";
import { botCell, distanceBetween, type BotState, type SimState } from "./state.js";

/** The range band of a distance (Section 6.8). */
export function rangeBandOf(state: SimState, distance: number): RangeBand {
  if (distance <= state.config.rangeBandCloseMax) return "close";
  if (distance <= state.config.rangeBandMidMax) return "mid";
  return "long";
}

/** True if the bot stands on a low cover tile. TBD */
export function isInCover(state: SimState, bot: BotState): boolean {
  const cell = botCell(bot);
  return tileAt(state.map, cell.x, cell.y) === Tile.CoverLow;
}

/** The tier text of an exact count, or `null`. */
function tierText(tiers: readonly { count: number; text: string }[], count: number): string | null {
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

/** What caused the damage. The kill feed and the reports read it. */
export type DamageSource = "shot" | "area" | "hazard" | "dot";

export interface DamageContext {
  weaponId: string;
  weaponArchetype: string;
  attackType: string;
  source: DamageSource;
  /** True if the shot was a critical hit. */
  crit?: boolean;
}

/**
 * Take health from a bot and, if it dies, record the death and the kill.
 * `attacker` and `target` are always on different teams.
 */
export function damageBot(
  state: SimState,
  attacker: BotState,
  target: BotState,
  amount: number,
  context: DamageContext,
): void {
  if (!target.alive || amount <= 0) return;

  // Section 7.20.6: a bot that takes fire learns where the shot came from.
  if (context.source !== "hazard" && context.source !== "dot") {
    noteIncomingFire(state, target, attacker);
  }

  const { config, tick, roundNumber } = state;
  target.health -= amount;
  state.bus.emit("Hit", tick, roundNumber, {
    shooterId: attacker.id,
    targetId: target.id,
    damage: amount,
    source: context.source,
    weaponId: context.weaponId,
  });
  if (context.crit === true) {
    state.bus.emit("Crit", tick, roundNumber, {
      shooterId: attacker.id,
      targetId: target.id,
      damage: amount,
    });
  }
  if (target.health > 0) return;

  const distance = distanceBetween(attacker, target);
  const unaware = isUnaware(state, attacker, target);

  target.alive = false;
  target.health = 0;
  target.respawnAtTick = tick + config.respawnDelayTicks;
  target.path = [];
  target.pathGoal = null;
  target.goalSlotId = null;
  target.targetId = null;
  target.aimTicks = 0;
  target.dots = [];
  target.visibleCells.clear();
  target.fovCell = null;
  target.visibleEnemyIds = [];
  target.peripheralEnemyIds = [];
  target.peripheralTicks.clear();

  attacker.multiKillCount =
    tick - attacker.lastKillTick <= config.multiKillWindowTicks ? attacker.multiKillCount + 1 : 1;
  attacker.lastKillTick = tick;
  attacker.spreeCount += 1;
  state.score[attacker.teamId] += 1;

  state.bus.emit("Death", tick, roundNumber, {
    botId: target.id,
    teamId: target.teamId,
    killerId: attacker.id,
    cell: botCell(target),
  });
  state.bus.emit("Kill", tick, roundNumber, {
    killerId: attacker.id,
    killerTeamId: attacker.teamId,
    victimId: target.id,
    victimTeamId: target.teamId,
    weaponId: context.weaponId,
    weaponArchetype: context.weaponArchetype,
    attackType: context.attackType,
    source: context.source,
    rangeBand: rangeBandOf(state, distance),
    distance,
    killerInCover: isInCover(state, attacker),
    targetAware: !unaware,
    killerHealth: attacker.health,
    multiKillCount: attacker.multiKillCount,
    spreeCount: attacker.spreeCount,
  });
  emitAnnouncements(state, attacker, target);
  target.spreeCount = 0;
}

/** Put damage over time on a bot (Section 7.6). */
export function applyDot(
  target: BotState,
  weapon: { dotDamage: number; dotTicks: number; id: string; archetype: string },
  sourceId: string,
): void {
  if (weapon.dotDamage <= 0 || weapon.dotTicks <= 0 || !target.alive) return;
  target.dots.push({
    damagePerTick: weapon.dotDamage,
    ticksLeft: weapon.dotTicks,
    sourceId,
    weaponId: weapon.id,
    weaponArchetype: weapon.archetype,
  });
}
