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
import type { RangeBand, Weapon } from "../weapons/types.js";
import {
  botCell,
  distanceBetween,
  findBot,
  teamSpawns,
  type BotState,
  type SimState,
} from "../sim/state.js";
import { findPath } from "./navigation.js";

export type Action =
  | { kind: "Engage"; targetId: string }
  | { kind: "Chase"; targetId: string }
  | { kind: "Retreat" }
  | { kind: "SeekPickup"; slotId: string }
  | { kind: "HoldPosition"; cell: Cell }
  | { kind: "Reposition"; band: RangeBand }
  | { kind: "SwitchWeapon"; weaponId: string }
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
    case "SwitchWeapon":
      return `SwitchWeapon(${action.weaponId})`;
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

/** Role behaviors arrive with M8 (Section 7.11). */
function roleModifier(_action: Action, _bot: BotState): number {
  return 1;
}

/** Trait tendencies arrive with M10 (Section 7.13). They stay small. */
function traitModifiers(_action: Action, _bot: BotState): number {
  return 1;
}

/** Team tactics (cohesion, focus fire, spacing, trading) arrive with M8. */
function teamModifier(_action: Action, _bot: BotState): number {
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
  let best = bot.weapon;
  let bestValue = -Infinity;
  for (const weapon of bot.weapons) {
    if (distance > weapon.rangeMax) continue;
    let value = weapon.dpsProfile[band];
    // The weapon role preference is a bias, not a rule.
    if (bot.tactics.weaponRolePref !== null && weapon.archetype === bot.tactics.weaponRolePref) {
      value *= 1.25;
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
function pickupTarget(
  state: SimState,
  bot: BotState,
  from: Cell,
): { slotId: string; value: number } | null {
  const { pickups } = state.map;

  // Hold the current goal while the bot is still on the way.
  const committed = bot.action.kind === "SeekPickup" ? bot.action.slotId : null;
  if (committed !== null) {
    const current = pickups.find((pickup) => pickup.slotId === committed);
    if (current && (current.cell.x !== from.x || current.cell.y !== from.y)) {
      return { slotId: current.slotId, value: nearness(state, from, current.cell) };
    }
  }

  let best: { slotId: string; value: number } | null = null;
  for (const pickup of pickups) {
    if (pickup.cell.x === from.x && pickup.cell.y === from.y) continue;
    if (bot.visitedSlotIds.includes(pickup.slotId)) continue;
    const value = nearness(state, from, pickup.cell);
    if (best === null || value > best.value) best = { slotId: pickup.slotId, value };
  }
  return best;
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

  bot.visitedSlotIds.push(bot.goalSlotId);
  // Always keep one free point, so that the bot always has a goal.
  while (bot.visitedSlotIds.length >= state.map.pickups.length) bot.visitedSlotIds.shift();
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
      teamModifier(action, bot);
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
    const wanted = bandDistance(state, tactics.preferredRange);
    const mismatch = Math.min(1, Math.abs(distance - wanted) / Math.max(1, wanted));
    push({ kind: "Reposition", band: tactics.preferredRange }, (base["reposition"] ?? 1) * mismatch, 1);

    // Retreat: the health fell under the retreat threshold.
    // Benefit: the bot lives. Cost: it gives ground and makes no kills.
    if (tactics.retreatThreshold > 0 && health < tactics.retreatThreshold) {
      const urgency = (tactics.retreatThreshold - health) / tactics.retreatThreshold;
      push({ kind: "Retreat" }, (base["retreat"] ?? 1) * urgency, 1.5 - tactics.aggression);
    }
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

  // SeekPickup: the nearest pickup point that the bot did not just take.
  // Benefit of item control: the bot holds the items. Cost: it crosses the open
  // arena instead of holding its ground.
  const from = botCell(bot);
  const target = pickupTarget(state, bot, from);
  if (target !== null) {
    push(
      { kind: "SeekPickup", slotId: target.slotId },
      (base["seekPickup"] ?? 1) * target.value,
      (0.5 + tactics.itemControl) * (1 - tactics.holdPosition),
    );
  }

  // HoldPosition: stay on the current cell.
  // Benefit: the bot keeps a sightline. Cost: it takes no items and no ground.
  push({ kind: "HoldPosition", cell: from }, base["holdPosition"] ?? 1, tactics.holdPosition * 2);

  // SwitchWeapon: another weapon gives more damage at this distance.
  const distanceForWeapon = enemy ? distanceBetween(bot, enemy) : bandDistance(state, tactics.preferredRange);
  const better = bestWeaponAt(state, bot, distanceForWeapon);
  if (better.id !== bot.weapon.id) {
    push({ kind: "SwitchWeapon", weaponId: better.id }, base["switchWeapon"] ?? 1, 1);
  }

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

// ---------------------------------------------------------------------------
// From an action to a movement intent
// ---------------------------------------------------------------------------

/** Set the path of a bot to a cell. Returns false if no path exists. */
function pathTo(state: SimState, bot: BotState, to: Cell): boolean {
  const avoidHazard = bot.tactics.hazardTolerance < state.config.hazardAvoidBelowTolerance;
  const path = findPath(state.map, botCell(bot), to, { avoidHazard });
  if (path === null || path.length < 2) return false;
  bot.path = path.slice(1);
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
 * Turn an action into a movement intent and, for `SwitchWeapon`, into a new
 * weapon in the hands of the bot.
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
      const wanted = bandDistance(state, bot.tactics.preferredRange);
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
    case "Retreat": {
      // Move to the nearest spawn cell of the team, away from the fight.
      const spawns = teamSpawns(state, bot.teamId);
      const from = botCell(bot);
      const sorted = [...spawns].sort(
        (a, b) =>
          Math.abs(a.x - from.x) + Math.abs(a.y - from.y) -
          (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)),
      );
      for (const cell of sorted) {
        if (pathTo(state, bot, cell)) return;
      }
      bot.path = [];
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
    case "SwitchWeapon": {
      const weapon = bot.weapons.find((candidate) => candidate.id === action.weaponId);
      if (weapon) {
        bot.weapon = weapon;
        bot.fireCooldownTicks = Math.max(bot.fireCooldownTicks, weapon.fireIntervalTicks);
      }
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
