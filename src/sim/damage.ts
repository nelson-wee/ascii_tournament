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
import { damageMultiplierOf } from "./pickups.js";
import { botCell, distanceBetween, type BotState, type SimState } from "./state.js";
import { coverSave } from "./cover.js";

/** The range band of a distance (Section 6.8). */
export function rangeBandOf(state: SimState, distance: number): RangeBand {
  if (distance <= state.config.rangeBandCloseMax) return "close";
  if (distance <= state.config.rangeBandMidMax) return "mid";
  return "long";
}

/**
 * True if the bot stands on a low cover tile.
 *
 * This is a **report** field, not the cover mechanic. The tile a bot stands on
 * shields it from nothing: cover is what lies between it and the shooter, and
 * `coverSave` in `cover.ts` is the function that decides what a shot meets
 * (Section 7.32). The kill feed still names the ground the killer fired from.
 */
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
 *
 * It answers **true** when the damage landed. Cover can stop a shot here, so a
 * caller that adds a side effect of its own — damage over time, for one — must
 * read the answer instead of assuming the hit.
 *
 * Every source of damage funnels through this one function, which is why the
 * cover roll of Section 7.32 lives here and nowhere else. A roll in `hitChance`
 * would cover the hitscan and line families and miss the cone, the projectile
 * and the area, and a roll in both would charge twice.
 */
export function damageBot(
  state: SimState,
  attacker: BotState,
  target: BotState,
  amount: number,
  context: DamageContext,
): boolean {
  if (!target.alive || amount <= 0) return false;

  // Section 7.20.6: a bot that takes fire learns where the shot came from.
  // This runs before the cover roll on purpose: a shot that hits the wall in
  // front of you still tells you that somebody is shooting at you.
  if (context.source !== "hazard" && context.source !== "dot") {
    noteIncomingFire(state, target, attacker);
  }

  const { config, tick, roundNumber } = state;

  // Section 7.32: low cover on the line of fire stops a share of the shots.
  // A hazard tile and damage over time are already on or in the target, so
  // cover cannot screen them.
  if (context.source === "shot" || context.source === "area") {
    const save = coverSave(state, attacker, target);
    if (save > 0 && attacker.rng.bool(save)) {
      state.bus.emit("CoverSave", tick, roundNumber, {
        shooterId: attacker.id,
        targetId: target.id,
        weaponId: context.weaponId,
        source: context.source,
        rangeBand: rangeBandOf(state, distanceBetween(attacker, target)),
        save,
      });
      return false;
    }
  }

  // A power-up of the attacker raises the damage (Section 7.12).
  const raised = amount * damageMultiplierOf(state, attacker);

  // The shield of a shield belt takes a hit in full. The armor pool then takes
  // a share of what is left. Health takes the rest.
  let left = raised;
  if (target.shield > 0) {
    const taken = Math.min(target.shield, left);
    target.shield -= taken;
    left -= taken;
  }
  if (left > 0 && target.armor > 0) {
    const share = state.pickupTables.armorAbsorb;
    const wanted = left * share;
    const taken = Math.min(target.armor, wanted);
    target.armor -= taken;
    left -= taken;
  }
  target.health -= left;

  state.bus.emit("Hit", tick, roundNumber, {
    shooterId: attacker.id,
    targetId: target.id,
    damage: left,
    rawDamage: raised,
    source: context.source,
    weaponId: context.weaponId,
  });
  if (context.crit === true) {
    state.bus.emit("Crit", tick, roundNumber, {
      shooterId: attacker.id,
      targetId: target.id,
      damage: left,
    });
    // A crit is rare: it needs a condition AND a roll, so a round makes 0 to 2
    // of them (Section 7.24). That is why it is worth calling out.
    state.bus.emit("Announcement", tick, roundNumber, {
      kind: "headShot",
      botId: attacker.id,
      teamId: attacker.teamId,
      victimId: target.id,
      damage: Math.round(left),
    });
  }

  // One hit that takes a large share of full health. A crit is not what drops
  // a bot from near full health; a single sniper shot is, and it read 85 to
  // 194 against 100 health in the measurement of Section 7.24.
  if (left >= state.config.healthMax * state.config.heavyHitShare) {
    state.bus.emit("Announcement", tick, roundNumber, {
      kind: "heavyHit",
      botId: attacker.id,
      teamId: attacker.teamId,
      victimId: target.id,
      damage: Math.round(left),
    });
  }

  if (target.health > 0) return true;

  const distance = distanceBetween(attacker, target);
  const unaware = isUnaware(state, attacker, target);

  target.alive = false;
  target.health = 0;
  target.armor = 0;
  target.shield = 0;
  target.powerups.clear();
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

  state.recentDeaths.push({ cell: botCell(target), tick, teamId: target.teamId });
  // Keep the list short: the danger map only reads the last few hundred ticks.
  if (state.recentDeaths.length > 64) state.recentDeaths.shift();
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
    /** What cover the victim had from this angle. 0 means it died in the open. */
    targetCover: coverSave(state, attacker, target),
    targetAware: !unaware,
    killerHealth: attacker.health,
    multiKillCount: attacker.multiKillCount,
    spreeCount: attacker.spreeCount,
  });
  emitAnnouncements(state, attacker, target);
  target.spreeCount = 0;
  return true;
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
