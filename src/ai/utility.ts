/**
 * Utility AI (dev-guide Section 7.8).
 *
 * The AI gives a score to each possible action and selects the highest:
 *
 *   score(action) = baseConsideration(action, world)
 *                 × tacticsWeight(action, bot.tactics)
 *                 × roleModifier(action, bot.role)
 *                 × traitModifiers(action, bot.traits)
 *                 × teamModifier(action, team.tactics)
 *
 * Milestone M4 gives the base considerations and the tactics weights. The role
 * modifier (M8), the trait modifiers (M10), and the team modifier (M8) are
 * hooks that give 1 until their milestone.
 *
 * Rules of Section 7.8:
 * - Weapon selection uses the DPS profile. The AI never names a weapon id.
 * - Tactics are orders. Traits are tendencies. The tactics weights lead.
 * - Each tactic has a cost and a benefit.
 * - A bot keeps its action unless a new action scores higher by a margin.
 */
import type { Cell } from "../core/types.js";
import type { Tactics } from "../core/schemas.js";
import { RANGE_BANDS, type RangeBand, type Weapon } from "../weapons/types.js";
import {
  botCell,
  distanceBetween,
  findBot,
  teamSideIndex,
  type BotState,
  type SimState,
} from "../sim/state.js";
import { hasAmmo } from "../sim/combat.js";
import { pickupValue } from "../sim/pickups.js";
import { controlAt, dangerFor } from "./influence.js";
import { findPath } from "./navigation.js";

export type Action =
  | { kind: "Engage"; targetId: string }
  | { kind: "Chase"; targetId: string }
  | { kind: "SeekPickup"; slotId: string }
  | { kind: "HoldPosition"; cell: Cell }
  | { kind: "Reposition"; band: RangeBand }
  | { kind: "Follow"; teammateId: string }
  | { kind: "Idle" };

export type ActionKind = Action["kind"];

export interface ScoredAction {
  action: Action;
  score: number;
}

/** A short label for a debug view and for the `DecisionChanged` event. */
export function actionLabel(action: Action): string {
  switch (action.kind) {
    case "Engage":
    case "Chase":
      return `${action.kind}(${action.targetId})`;
    case "SeekPickup":
      return `SeekPickup(${action.slotId})`;
    case "Reposition":
      return `Reposition(${action.band})`;
    case "Follow":
      return `Follow(${action.teammateId})`;
    case "HoldPosition":
      return `HoldPosition(${action.cell.x},${action.cell.y})`;
    default:
      return action.kind;
  }
}

// ---------------------------------------------------------------------------
// Modifier hooks of later milestones
// ---------------------------------------------------------------------------

/**
 * The behavior weights of the role of a bot (Section 7.11).
 *
 * An Overwatch bot holds a sightline, a Tank presses and takes the items, and
 * a Skirmisher follows the team and moves. The weights are small: the tactics
 * of the player stay the main factor (Section 7.8).
 */
function roleModifier(action: Action, bot: BotState): number {
  const key = action.kind.charAt(0).toLowerCase() + action.kind.slice(1);
  return bot.roleBehavior[key] ?? 1;
}

/** Trait tendencies arrive with M10 (Section 7.13). They stay small. */
function traitModifiers(_action: Action, _bot: BotState): number {
  return 1;
}

/**
 * The team tactics of Section 6.5.
 *
 * - `cohesion` pulls a bot toward its team, so it raises `Follow`.
 * - `spacing` pushes the team apart, so it lowers `Follow`.
 * - `focusFire` raises `Engage` and `Chase` on an enemy that a teammate is
 *   already fighting.
 * - `trading` raises `Engage` while the bot is hurt: a trade is worth it.
 */
function teamModifier(state: SimState, action: Action, bot: BotState): number {
  const team = state.teamTactics[bot.teamId];
  if (!team) return 1;

  if (action.kind === "Follow") return 0.6 + team.cohesion - team.spacing * 0.5;
  if (action.kind === "HoldPosition") return 0.8 + team.spacing * 0.4;

  if (action.kind === "Engage" || action.kind === "Chase") {
    let factor = 1;
    const shared = state.bots.some(
      (other) => other !== bot && other.teamId === bot.teamId && other.targetId === action.targetId,
    );
    if (shared) factor *= 1 + team.focusFire * 0.5;
    if (action.kind === "Engage" && healthFraction(state, bot) < 0.5) {
      factor *= 0.7 + team.trading * 0.6;
    }
    return factor;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The health of a bot as a part of the full health. */
export function healthFraction(state: SimState, bot: BotState): number {
  return state.config.healthMax === 0 ? 0 : bot.health / state.config.healthMax;
}

/** The middle distance of a range band, in cells. */
export function bandDistance(state: SimState, band: RangeBand): number {
  const { rangeBandCloseMax, rangeBandMidMax } = state.config;
  if (band === "close") return rangeBandCloseMax / 2;
  if (band === "mid") return (rangeBandCloseMax + rangeBandMidMax) / 2;
  return rangeBandMidMax * 1.25;
}

/**
 * The band that a bot wants to fight in.
 *
 * The `preferredRange` tactic is a bias on the weapon in the hands of the bot,
 * not an order. A bot that walks into close range with a long-range weapon
 * crosses open ground and then fires the weapon where it is weakest, which is
 * why the aggressive preset lost every matchup before this rule
 * (Section 7.20.12). The weapon carries the band; the tactic breaks the tie.
 */
export function wantedBand(state: SimState, bot: BotState): RangeBand {
  const bias = state.config.preferredRangeBias;
  let best: RangeBand = bot.tactics.preferredRange;
  let bestValue = -Infinity;
  for (const band of RANGE_BANDS) {
    if (bandDistance(state, band) > bot.weapon.rangeMax) continue;
    const value = bot.weapon.dpsProfile[band] * (band === bot.tactics.preferredRange ? 1 + bias : 1);
    if (value > bestValue) {
      best = band;
      bestValue = value;
    }
  }
  return best;
}

/** The band of a distance. It repeats `rangeBandOf` without a circular import. */
function bandOf(state: SimState, distance: number): RangeBand {
  if (distance <= state.config.rangeBandCloseMax) return "close";
  if (distance <= state.config.rangeBandMidMax) return "mid";
  return "long";
}

/**
 * The best weapon of a bot at a distance (Section 7.8).
 * The AI reads the DPS profile. It never names a weapon id.
 */
export function bestWeaponAt(state: SimState, bot: BotState, distance: number): Weapon {
  const band = bandOf(state, distance);
  let best = bot.weapons[0] ?? bot.weapon;
  let bestValue = -Infinity;
  for (const weapon of bot.weapons) {
    if (distance > weapon.rangeMax) continue;
    // An empty weapon is not a choice. The magazine is a real limit.
    if (!hasAmmo(bot, weapon)) continue;
    let value = weapon.dpsProfile[band];
    // The weapon role preference is a bias, not a rule. It is the tournament
    // weapon priority that a player sets (Section 7.20.8).
    if (bot.tactics.weaponRolePref !== null && weapon.archetype === bot.tactics.weaponRolePref) {
      value *= 1 + state.config.weaponRolePrefBonus;
    }
    if (value > bestValue) {
      best = weapon;
      bestValue = value;
    }
  }
  return best;
}

/**
 * The weapon that a bot carries while it sees nobody (Section 7.8).
 *
 * A weapon is worth what it can reach. A bot that picks its weapon for one
 * band alone carries a short-range weapon into a mid-range arena and then
 * cannot fire at all: that, and not the walk, is what the close preference
 * cost the aggressive preset (Section 7.20.12). So the value of a weapon is
 * its damage over every band it reaches, and the `preferredRange` tactic
 * raises one of those bands.
 */
export function bestWeaponOverall(state: SimState, bot: BotState): Weapon {
  const bias = state.config.preferredRangeBias;
  const share = state.config.bandShare;
  let best = bot.weapons[0] ?? bot.weapon;
  let bestValue = -Infinity;
  for (const weapon of bot.weapons) {
    if (!hasAmmo(bot, weapon)) continue;
    let value = 0;
    for (const band of RANGE_BANDS) {
      if (bandDistance(state, band) > weapon.rangeMax) continue;
      // The band counts for how often the arena fires in it, which is the same
      // weight that the power budget uses (Section 7.20.15). The AI and the
      // budget must read one number, or the AI takes a weapon that the budget
      // called strong and the arena calls weak.
      value +=
        weapon.dpsProfile[band] * share[band] * (band === bot.tactics.preferredRange ? 1 + bias : 1);
    }
    if (bot.tactics.weaponRolePref !== null && weapon.archetype === bot.tactics.weaponRolePref) {
      value *= 1 + state.config.weaponRolePrefBonus;
    }
    if (value > bestValue) {
      best = weapon;
      bestValue = value;
    }
  }
  return best;
}

/** The nearest visible enemy, or `null`. */
function nearestVisibleEnemy(state: SimState, bot: BotState): BotState | null {
  let best: BotState | null = null;
  let bestDistance = Infinity;
  for (const id of bot.visibleEnemyIds) {
    const enemy = findBot(state, id);
    if (!enemy?.alive) continue;
    const distance = distanceBetween(bot, enemy);
    if (distance >= bestDistance) continue;
    best = enemy;
    bestDistance = distance;
  }
  return best;
}

/** The nearest living teammate, or `null`. */
function nearestTeammate(state: SimState, bot: BotState): BotState | null {
  let best: BotState | null = null;
  let bestDistance = Infinity;
  for (const other of state.bots) {
    if (other === bot || !other.alive || other.teamId !== bot.teamId) continue;
    const distance = distanceBetween(bot, other);
    if (distance >= bestDistance) continue;
    best = other;
    bestDistance = distance;
  }
  return best;
}

/** How near a cell is, from 1 (here) to 0 (across the arena). */
function nearness(state: SimState, from: Cell, to: Cell): number {
  const span = state.map.width + state.map.height;
  return Math.max(0, 1 - (Math.abs(from.x - to.x) + Math.abs(from.y - to.y)) / span);
}

/**
 * The pickup point that a bot walks to.
 *
 * The bot holds its current goal until it reaches it. It then selects the
 * nearest point that is not in its visited memory. The memory makes the bot
 * work a route over the arena. Without it the bot steps between the two points
 * beside its spawn and never meets the other team.
 */
/**
 * The kinds of pickup that a bot leaves alone while it has an enemy to fight.
 *
 * Health and armor are for between fights. A bot that breaks off to heal in the
 * middle of a fight makes the round slow and the combat careful, which is the
 * opposite of what Section 2.1 asks for. A weapon, its ammo, and a power-up are
 * worth taking under fire, so they stay contestable: they are what a fight over
 * ground is about (Section 7.12).
 */
const BETWEEN_FIGHT_KINDS: ReadonlySet<string> = new Set(["health", "armor"]);

function pickupTarget(
  state: SimState,
  bot: BotState,
  from: Cell,
  hasTarget: boolean,
): { slotId: string; value: number; nearness: number } | null {
  // Hold the current goal while the bot is still on the way and the point is
  // still worth something.
  const committed = bot.action.kind === "SeekPickup" ? bot.action.slotId : null;
  if (committed !== null) {
    const current = state.pickups.find((pickup) => pickup.point.slotId === committed);
    if (
      current &&
      !(hasTarget && BETWEEN_FIGHT_KINDS.has(current.point.kind)) &&
      (current.point.cell.x !== from.x || current.point.cell.y !== from.y) &&
      pickupValue(state, bot, current) > 0
    ) {
      const near = nearness(state, from, current.point.cell);
      return {
        slotId: current.point.slotId,
        value: pickupValue(state, bot, current) * near * safety(state, bot, current.point.cell),
        nearness: near,
      };
    }
  }

  // What a point is worth now, and how far it is. Before M8 a point gave
  // nothing, so the only question was the distance (Section 7.20.10).
  //
  // Two points are often worth almost the same, and the two teams stand on
  // mirrored ground, so their two lists of values are mirror images thatdiffer by
  // about 1e-13: floating point addition is not the same at x = 22 as it is at
  // x = 38. A plain `>` then lets the 13th decimal decide which point a bot
  // walks to, and the two halves of the arena stop matching (Section 7.20.25).
  //
  // So a difference below `pickupTieShare` of the value counts as a tie, and
  // the tie goes to the point nearer to the spawn ground of the team of the
  // bot. That rule turns with the arena, so the two teams answer a tie the
  // same way.
  const home = homeCell(state, bot);
  const share = state.config.pickupTieShare;
  let best: { slotId: string; value: number; nearness: number; home: number } | null = null;
  for (const pickup of state.pickups) {
    const point = pickup.point;
    if (point.cell.x === from.x && point.cell.y === from.y) continue;
    if (hasTarget && BETWEEN_FIGHT_KINDS.has(point.kind)) continue;
    const worth = pickupValue(state, bot, pickup);
    if (worth <= 0) continue;
    const near = nearness(state, from, point.cell);
    const value = worth * near * safety(state, bot, point.cell);
    const toHome = (point.cell.x - home.x) ** 2 + (point.cell.y - home.y) ** 2;
    if (best === null) {
      best = { slotId: point.slotId, value, nearness: near, home: toHome };
      continue;
    }
    const tied = Math.abs(value - best.value) <= Math.max(value, best.value) * share;
    const better = tied ? toHome < best.home : value > best.value;
    if (better) best = { slotId: point.slotId, value, nearness: near, home: toHome };
  }
  return best;
}

/**
 * The middle of the spawn ground of the team of a bot.
 *
 * The spawn cells of the two teams are images of each other, so this cell and
 * the cell of the other team are images too, and a tie broken against it
 * breaks the same way for both teams.
 */
function homeCell(state: SimState, bot: BotState): Cell {
  const size = state.config.teamSize;
  const start = teamSideIndex(bot.teamId, state.roundNumber) * size;
  let x = 0;
  let y = 0;
  let count = 0;
  for (let i = start; i < start + size; i += 1) {
    const cell = state.map.spawns[i];
    if (!cell) continue;
    x += cell.x;
    y += cell.y;
    count += 1;
  }
  return count === 0 ? { x: 0, y: 0 } : { x: x / count, y: y / count };
}

/**
 * How much a cell is worth walking to, from about 0.3 to 1.
 *
 * A pickup run crosses ground that the enemy holds, and that is the cost of the
 * `itemControl` tactic. Without it the tactic was worth 19 points of win rate
 * and never turned over, which breaks the rule of Section 7.8 that every tactic
 * has a cost and a benefit (Section 4 of the M8 weapon analysis).
 */
function safety(state: SimState, bot: BotState, cell: Cell): number {
  const risk = dangerFor(state, bot, cell);
  return 1 / (1 + risk * state.config.pickupRiskWeight);
}

/**
 * How much the cell that a bot stands on is worth holding, from about 0.2 to 1.
 *
 * A cell is worth holding when a pickup point is near it, when the team holds
 * the ground around it, and when it is not itself dangerous. This is the
 * "contested cell" of Section 7.2 step 5, measured on the grid: the arena has
 * no macro graph until M7.
 */
export function positionValue(state: SimState, bot: BotState, cell: Cell): number {
  let nearestPickup = 0;
  for (const pickup of state.pickups) {
    const worth = Math.max(0.35, pickupValue(state, bot, pickup));
    const value = worth * nearness(state, cell, pickup.point.cell) ** 2;
    if (value > nearestPickup) nearestPickup = value;
  }

  const control = controlAt(state.influence, cell.x, cell.y);
  const friendly = bot.teamId === "A" ? control : -control;
  const danger = dangerFor(state, bot, cell);

  const value = 0.2 + nearestPickup + Math.max(0, friendly) * 0.1 - Math.min(0.4, danger * 0.05);
  return Math.max(0.1, Math.min(1.4, value * contactFactor(state, bot)));
}

/**
 * How much the last contact with an enemy is still worth, from
 * `ai.holdBlindShare` to 1.
 *
 * Holding ground is a sightline action, so it is worth the most while an enemy
 * is in that sightline. A bot that has seen no enemy for `ai.holdContactTicks`
 * holds a sightline that nothing crosses. The measurement of Section 7.20.12
 * found 29 000 of 29 051 HoldPosition ticks with no enemy in sight, which is
 * the low-kill defect of Section 7.2.1: both teams stand still and the round
 * runs to the time limit.
 */
function contactFactor(state: SimState, bot: BotState): number {
  if (bot.visibleEnemyIds.length > 0) return 1;

  let last = -Infinity;
  for (const seen of bot.lastSeen.values()) {
    if (seen.tick > last) last = seen.tick;
  }
  const { holdContactTicks, holdBlindShare } = state.config;
  const since = state.tick - last;
  if (!Number.isFinite(since) || since >= holdContactTicks) return holdBlindShare;
  return holdBlindShare + (1 - holdBlindShare) * (1 - since / holdContactTicks);
}

/**
 * Mark the pickup point that a bot reached.
 * The round loop calls this before the bot decides again.
 */
export function noteReachedPickup(state: SimState, bot: BotState): void {
  if (bot.goalSlotId === null) return;
  const goal = state.map.pickups.find((pickup) => pickup.slotId === bot.goalSlotId);
  if (!goal) return;
  const cell = botCell(bot);
  if (goal.cell.x !== cell.x || goal.cell.y !== cell.y) return;

  // A point that the bot took is empty until its timer runs out, and
  // `pickupValue` returns 0 for it, so no visited memory is needed any more.
  bot.goalSlotId = null;
  if (bot.action.kind === "SeekPickup") bot.action = { kind: "Idle" };
}

// ---------------------------------------------------------------------------
// Base considerations and tactics weights
// ---------------------------------------------------------------------------

/**
 * Every action that the bot can take now, with its score.
 * Exported for the tests and for a debug view.
 */
export function scoreActions(state: SimState, bot: BotState): ScoredAction[] {
  const base = state.config.actionBase;
  const tactics = bot.tactics;
  const health = healthFraction(state, bot);
  const enemy = nearestVisibleEnemy(state, bot);
  const scored: ScoredAction[] = [];

  const push = (action: Action, consideration: number, weight: number): void => {
    if (consideration <= 0 || weight <= 0) return;
    const score =
      consideration *
      weight *
      roleModifier(action, bot) *
      traitModifiers(action, bot) *
      teamModifier(state, action, bot);
    if (score > 0) scored.push({ action, score });
  };

  // Engage: a visible enemy inside the weapon range.
  if (enemy) {
    const distance = distanceBetween(bot, enemy);
    const inRange = distance <= bot.weapon.rangeMax;
    if (inRange) {
      // Benefit of aggression: the bot presses the fight. Cost: it fights while
      // its health is low, so it dies more often.
      const consideration = (base["engage"] ?? 1) * (0.4 + 0.6 * health);
      push({ kind: "Engage", targetId: enemy.id }, consideration, 0.5 + tactics.aggression);
    } else {
      const consideration = (base["chase"] ?? 1) * nearness(state, botCell(bot), botCell(enemy));
      push({ kind: "Chase", targetId: enemy.id }, consideration, 0.5 + tactics.aggression);
    }

    // Reposition: the distance is outside the preferred band.
    // The cost of the distance is the damage that the distance loses, not the
    // number of cells. A bot that walks toward a band where its weapon is no
    // better walks under fire for nothing: the close preference cost the
    // aggressive preset 20 points of win rate that way (Section 7.20.12).
    const band = wantedBand(state, bot);
    const here = bot.weapon.dpsProfile[bandOf(state, distance)];
    const there = bot.weapon.dpsProfile[band];
    const mismatch = there <= 0 ? 0 : Math.max(0, Math.min(1, (there - here) / there));
    push(
      { kind: "Reposition", band },
      (base["reposition"] ?? 1) * mismatch,
      // A bold bot presses the fight where it stands. A careful one walks to
      // the band where its weapon is strongest.
      Math.max(0.1, 1 - tactics.aggression * state.config.aggressionRepositionDiscount),
    );
  } else {
    // Chase a remembered enemy.
    let bestId: string | null = null;
    let bestValue = 0;
    for (const [id, seen] of bot.lastSeen) {
      const age = state.tick - seen.tick;
      const freshness = Math.max(0, 1 - age / Math.max(1, state.config.memoryTicks));
      const value = freshness * nearness(state, botCell(bot), seen.cell);
      if (value > bestValue) {
        bestValue = value;
        bestId = id;
      }
    }
    if (bestId !== null) {
      push({ kind: "Chase", targetId: bestId }, (base["chase"] ?? 1) * bestValue, 0.5 + tactics.aggression);
    }
  }

  // SeekPickup: the point that is worth the most to this bot, right now.
  // Benefit of item control: health, armor, ammo, and the power-ups. Cost: the
  // bot crosses the open arena instead of holding its ground.
  const from = botCell(bot);
  const target = pickupTarget(state, bot, from, enemy !== null);
  if (target !== null) {
    // `holdPosition` suppresses a run across the arena, but not the item at the
    // feet of the bot. A bot that camps a point still takes what lands on it,
    // which is what a player does with the armor in an arena shooter. Without
    // this the anchor preset held ground that it could not arm itself from, and
    // it won 34.6 % (Section 7.20.16).
    const suppression =
      1 - tactics.holdPosition * state.config.holdSuppressesPickup * (1 - target.nearness);
    push(
      { kind: "SeekPickup", slotId: target.slotId },
      (base["seekPickup"] ?? 1) * target.value,
      (0.5 + tactics.itemControl) * Math.max(0.05, suppression),
    );
  }

  // HoldPosition: stay on the current cell, if the cell is worth holding.
  //
  // Benefit: the bot keeps a sightline over ground that matters. Cost: it
  // takes no items and no new ground.
  //
  // The value of the cell is the point of this action. A bot that holds a
  // corner with nothing near it holds nothing: both teams then stand still and
  // the round runs to the time limit with almost no kill, which is the defect
  // of Section 7.2.1. Section 7.11 says the same thing for the Overwatch role:
  // it holds a sightline over a contested pickup, not any cell at all.
  push(
    { kind: "HoldPosition", cell: from },
    (base["holdPosition"] ?? 1) * positionValue(state, bot, from),
    tactics.holdPosition * 2,
  );

  // Follow: a teammate is far away (cohesion).
  const mate = nearestTeammate(state, bot);
  if (mate) {
    const distance = distanceBetween(bot, mate);
    const spread = Math.min(1, distance / Math.max(1, state.config.teamSpacingCells));
    push({ kind: "Follow", teammateId: mate.id }, (base["follow"] ?? 1) * spread, 1 - tactics.holdPosition);
  }

  return scored;
}

/**
 * Select an action for a bot (Section 7.8).
 *
 * `SimState` is the world view of Milestone M4. A narrower view can replace it
 * when a system needs the AI without the full state.
 */
export function decide(state: SimState, bot: BotState): ScoredAction {
  equipBestWeapon(state, bot);
  const scored = scoreActions(state, bot);
  if (scored.length === 0) return { action: { kind: "Idle" }, score: 0 };

  let best = scored[0] as ScoredAction;
  for (const candidate of scored) {
    if (candidate.score > best.score) best = candidate;
  }

  // Hysteresis: keep the current action unless the new one is clearly better.
  // This stops fast changes of decision.
  const current = scored.find(
    (candidate) => actionLabel(candidate.action) === actionLabel(bot.action),
  );
  if (current && best.score < current.score * state.config.hysteresisMargin) {
    return current;
  }
  return best;
}

/**
 * Put the best weapon in the hands of the bot (Section 7.8).
 *
 * This is a rule, not an action. It used to compete with `Engage` for the one
 * action of the tick, and `Engage` almost always won, so a bot that ran a
 * weapon dry stayed on the baseline even after an ammo point refilled it. The
 * baseline took half of every kill that way, which is not a fallback
 * (Section 7.3). A real bot changes weapon while it moves and fires.
 */
export function equipBestWeapon(state: SimState, bot: BotState): void {
  const enemy = nearestVisibleEnemy(state, bot);
  const better = enemy
    ? bestWeaponAt(state, bot, distanceBetween(bot, enemy))
    : bestWeaponOverall(state, bot);
  if (better.id === bot.weapon.id) return;

  // Out of a fight the swap is free: this is where a bot picks the weapon its
  // role and its doctrine want, and where the preference of Section 6.4 does
  // its work.
  if (!enemy) {
    swapTo(state, bot, better, 0);
    return;
  }

  // In a fight the swap costs firing ticks, so it must pay for itself. A bot
  // with a target already in its sights loses the shot it was about to take,
  // and it fires the sub-optimal weapon instead when the gain is small. Without
  // a cost the best weapon is always in hand and the weapon tactics mean
  // nothing (Section 7.20.17).
  const band = bandOf(state, distanceBetween(bot, enemy));
  const now = bot.weapon.dpsProfile[band];
  const then = better.dpsProfile[band];
  if (then <= now) return;

  const swapTicks = state.config.weaponSwapTicks;
  // What the swap costs: the damage the held weapon would have done while the
  // bot changes over. What it gains: the extra damage of the new weapon over
  // the rest of the engagement.
  const cost = now * (swapTicks / state.config.ticksPerSecond);
  const gain = (then - now) * (state.config.weaponSwapPayoffTicks / state.config.ticksPerSecond);
  if (gain <= cost) return;

  swapTo(state, bot, better, swapTicks);
}

/** Put a weapon in the hands of the bot, and pay for the change. */
function swapTo(state: SimState, bot: BotState, weapon: Weapon, swapTicks: number): void {
  bot.weapon = weapon;
  if (swapTicks > 0) {
    bot.fireCooldownTicks = Math.max(bot.fireCooldownTicks, swapTicks);
    bot.aimTicks = 0;
  }
  state.bus.emit("DecisionChanged", state.tick, state.roundNumber, {
    botId: bot.id,
    weaponId: weapon.id,
    reason: "weapon",
    swapTicks,
  });
}

// ---------------------------------------------------------------------------
// From an action to a movement intent
// ---------------------------------------------------------------------------

/**
 * Set the path of a bot to a cell. Returns false if no path exists.
 *
 * A bot decides every few ticks, but its goal cell is often the same as on the
 * last decision. The function then keeps the path that the bot already walks.
 * A new search is the most expensive step of a tick.
 */
function pathTo(state: SimState, bot: BotState, to: Cell): boolean {
  if (bot.path.length > 0 && bot.pathGoal?.x === to.x && bot.pathGoal.y === to.y) return true;

  const avoidHazard = bot.tactics.hazardTolerance < state.config.hazardAvoidBelowTolerance;
  const path = findPath(state.map, botCell(bot), to, { avoidHazard });
  if (path === null || path.length < 2) return false;
  bot.path = path.slice(1);
  bot.pathGoal = { x: to.x, y: to.y };
  return true;
}

/**
 * The cell that holds the bot at `wanted` distance from `target`.
 * It walks along the line between the two bots.
 */
function cellAtRange(state: SimState, bot: BotState, target: BotState, wanted: number): Cell {
  const dx = bot.pos.x - target.pos.x;
  const dy = bot.pos.y - target.pos.y;
  const distance = Math.hypot(dx, dy) || 1;
  const x = target.pos.x + (dx / distance) * wanted;
  const y = target.pos.y + (dy / distance) * wanted;
  return {
    x: Math.min(state.map.width - 1, Math.max(0, Math.floor(x))),
    y: Math.min(state.map.height - 1, Math.max(0, Math.floor(y))),
  };
}

/**
 * Turn an action into a movement intent.
 *
 * The weapon in the hands of the bot is not an action: `equipBestWeapon` is a
 * rule that runs at every decision (Section 7.20.16).
 */
export function applyAction(state: SimState, bot: BotState, action: Action): void {
  bot.goalSlotId = null;

  switch (action.kind) {
    case "Engage":
    case "Reposition": {
      const targetId = action.kind === "Engage" ? action.targetId : bot.targetId;
      const target = targetId === null ? null : findBot(state, targetId);
      if (!target?.alive) {
        bot.path = [];
        return;
      }
      const wanted = bandDistance(state, wantedBand(state, bot));
      const distance = distanceBetween(bot, target);
      // Inside the preferred band the bot stands and fires.
      if (Math.abs(distance - wanted) <= state.config.rangeBandCloseMax / 2) {
        bot.path = [];
        return;
      }
      if (!pathTo(state, bot, cellAtRange(state, bot, target, wanted))) bot.path = [];
      return;
    }
    case "Chase": {
      const target = findBot(state, action.targetId);
      const goal = target?.alive
        ? botCell(target)
        : (bot.lastSeen.get(action.targetId)?.cell ?? null);
      if (goal === null || !pathTo(state, bot, goal)) bot.path = [];
      return;
    }
    case "SeekPickup": {
      const pickup = state.map.pickups.find((candidate) => candidate.slotId === action.slotId);
      if (!pickup || !pathTo(state, bot, pickup.cell)) {
        bot.path = [];
        return;
      }
      bot.goalSlotId = pickup.slotId;
      return;
    }
    case "Follow": {
      const mate = findBot(state, action.teammateId);
      if (!mate?.alive || !pathTo(state, bot, botCell(mate))) bot.path = [];
      return;
    }
    case "HoldPosition":
    case "Idle":
    default:
      bot.path = [];
  }
}

/** Re-export for the tests. */
export type { Tactics };
