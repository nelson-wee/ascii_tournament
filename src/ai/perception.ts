/**
 * Perception (dev-guide Sections 7.7 and 7.20.6).
 *
 * A bot does not see through 360 degrees. It has a facing and two arcs:
 *
 * - **Focus**, a narrow arc in front. The bot sees an enemy fully, and it can
 *   fire at it.
 * - **Peripheral**, a wide arc to the sides. The bot notices an enemy after
 *   `peripheralDelayTicks` of unbroken sight. It knows that the enemy is
 *   there, but it must turn before it can fire.
 * - Behind the bot: nothing.
 *
 * The `awareness` attribute of Section 6.4 makes the peripheral arc wider.
 *
 * The set of cells that a bot can see comes from rot.js
 * `FOV.PreciseShadowcasting`. That set depends only on the cell of the bot and
 * on the walls, not on the facing, so the cache of Section 7.7 still holds.
 * The arcs are one angle comparison per enemy.
 */
import { FOV } from "rot-js";
import type PreciseShadowcasting from "rot-js/lib/fov/precise-shadowcasting.js";
import { Tile, cellIndex, inBounds, tileAt, type ArenaMap } from "../arena/types.js";
import {
  angleBetween,
  angleTo,
  botCell,
  normalizeAngle,
  peripheralHalfAngle,
  type BotState,
  type SimState,
} from "../sim/state.js";

/** A wall blocks sight. Low cover does not block sight. TBD */
export function blocksSight(map: ArenaMap, x: number, y: number): boolean {
  return tileAt(map, x, y) === Tile.Wall;
}

/**
 * One FOV object per arena. The object holds no state of the last call, so
 * every bot reuses it. A new object on every bot on every tick costs more than
 * the calculation itself.
 */
const fovByMap = new WeakMap<ArenaMap, PreciseShadowcasting>();

function fovFor(map: ArenaMap): PreciseShadowcasting {
  let fov = fovByMap.get(map);
  if (fov === undefined) {
    fov = new FOV.PreciseShadowcasting((x, y) => inBounds(map, x, y) && !blocksSight(map, x, y));
    fovByMap.set(map, fov);
  }
  return fov;
}

/**
 * Fill `visibleCells` of one bot.
 *
 * The set depends only on the cell of the bot and on the walls of the arena,
 * and neither changes inside one tick. The function therefore calculates the
 * set again only after the bot changes cell.
 *
 * A system that makes a wall during a round must set `fovCell` of every bot to
 * `null`. No system does this today.
 */
function computeVisibleCells(state: SimState, bot: BotState): void {
  const { map, config } = state;
  const from = botCell(bot);
  if (bot.fovCell !== null && bot.fovCell.x === from.x && bot.fovCell.y === from.y) return;

  bot.visibleCells.clear();
  fovFor(map).compute(from.x, from.y, Math.round(config.sightRadiusCells), (x, y, _r, visibility) => {
    if (visibility > 0 && inBounds(map, x, y)) bot.visibleCells.add(cellIndex(map, x, y));
  });
  bot.fovCell = from;
}

/** True if a wall does not block the line from `viewer` to `other`. */
export function hasLineOfSight(state: SimState, viewer: BotState, other: BotState): boolean {
  const cell = botCell(other);
  return viewer.visibleCells.has(cellIndex(state.map, cell.x, cell.y));
}

/** Where a bot lies in the vision of another bot. */
export type VisionArc = "focus" | "peripheral" | "blind";

/**
 * The arc that holds `other`, before the peripheral delay applies.
 *
 * With `directionalVision` off, every cell that the bot can see is in its
 * focus arc, which is the 360-degree sight of the milestones before M5.5.
 */
export function arcOf(state: SimState, viewer: BotState, other: BotState): VisionArc {
  if (!hasLineOfSight(state, viewer, other)) return "blind";
  if (!state.config.directionalVision) return "focus";
  const offset = angleBetween(viewer.facing, angleTo(viewer, other.pos.x, other.pos.y));
  if (offset <= state.config.focusHalfAngle) return "focus";
  if (offset <= peripheralHalfAngle(state, viewer)) return "peripheral";
  return "blind";
}

/**
 * True if `viewer` knows that `other` is there: in the focus arc, or noticed
 * in the peripheral arc. "Target unaware" of Section 6.8 uses this.
 */
export function canSee(_state: SimState, viewer: BotState, other: BotState): boolean {
  // The state is not needed any more, because `updatePerception` fills the two
  // lists. The parameter stays, so that every caller keeps the same shape.
  return viewer.visibleEnemyIds.includes(other.id) || viewer.peripheralEnemyIds.includes(other.id);
}

/** True if `viewer` can fire at `other`: the focus arc only. */
export function canTarget(viewer: BotState, other: BotState): boolean {
  return viewer.visibleEnemyIds.includes(other.id);
}

/** True if `viewer` noticed `other` at the side of its vision. */
export function seesInPeriphery(viewer: BotState, other: BotState): boolean {
  return viewer.peripheralEnemyIds.includes(other.id);
}

/**
 * True if `target` cannot see `attacker`.
 * The `Kill` event and the crit conditions use this value (Section 6.8).
 */
export function isUnaware(state: SimState, attacker: BotState, target: BotState): boolean {
  return !canSee(state, target, attacker);
}

/**
 * Turn a bot toward what it should look at (Section 7.20.6).
 *
 * The order is: the enemy that it aims at, then the nearest enemy that it
 * knows about, then the way that it moves. A bot with nothing to look at keeps
 * its facing.
 *
 * A bot turns at `turnRatePerTick`, not at once. This is what gives a flank
 * its value: a bot that is caught from the side needs time to bring its focus
 * arc around, and it cannot fire until it does.
 */
export function updateFacing(state: SimState, bot: BotState, moved: { x: number; y: number }): void {
  if (!bot.alive || !state.config.directionalVision) return;

  const target = bot.targetId === null ? null : state.bots.find((o) => o.id === bot.targetId);
  if (target?.alive && canSee(state, bot, target)) {
    turnToward(state, bot, angleTo(bot, target.pos.x, target.pos.y));
    return;
  }

  // The nearest enemy that the bot knows about, seen or remembered.
  let bestX = 0;
  let bestY = 0;
  let bestDistance = Infinity;
  for (const id of [...bot.visibleEnemyIds, ...bot.peripheralEnemyIds]) {
    const enemy = state.bots.find((o) => o.id === id);
    if (!enemy?.alive) continue;
    const distance = Math.hypot(enemy.pos.x - bot.pos.x, enemy.pos.y - bot.pos.y);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    bestX = enemy.pos.x;
    bestY = enemy.pos.y;
  }
  if (bestDistance === Infinity) {
    for (const seen of bot.lastSeen.values()) {
      const distance = Math.hypot(seen.cell.x + 0.5 - bot.pos.x, seen.cell.y + 0.5 - bot.pos.y);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      bestX = seen.cell.x + 0.5;
      bestY = seen.cell.y + 0.5;
    }
  }
  if (bestDistance !== Infinity && bestDistance > 1e-6) {
    turnToward(state, bot, angleTo(bot, bestX, bestY));
    return;
  }

  if (Math.abs(moved.x) > 1e-9 || Math.abs(moved.y) > 1e-9) {
    turnToward(state, bot, Math.atan2(moved.y, moved.x));
  }
}

/** Turn a bot toward an angle, by no more than one tick of its turn rate. */
function turnToward(state: SimState, bot: BotState, wanted: number): void {
  const difference = normalizeAngle(wanted - bot.facing);
  const rate = state.config.turnRatePerTick;
  if (Math.abs(difference) <= rate) {
    bot.facing = normalizeAngle(wanted);
    return;
  }
  bot.facing = normalizeAngle(bot.facing + Math.sign(difference) * rate);
}

/**
 * Update the perception of every bot.
 *
 * A dead bot sees nothing, and no bot sees a dead bot. The memory of a last
 * seen position expires after `memoryTicks`.
 */
export function updatePerception(state: SimState): void {
  for (const bot of state.bots) {
    if (!bot.alive) {
      bot.visibleCells.clear();
      bot.fovCell = null;
      bot.visibleEnemyIds = [];
      bot.peripheralEnemyIds = [];
      bot.peripheralTicks.clear();
      continue;
    }
    computeVisibleCells(state, bot);
  }

  for (const bot of state.bots) {
    if (!bot.alive) continue;
    const focus: string[] = [];
    const peripheral: string[] = [];

    for (const other of state.bots) {
      if (!other.alive || other.teamId === bot.teamId) continue;
      const arc = arcOf(state, bot, other);

      if (arc === "focus") {
        focus.push(other.id);
        bot.peripheralTicks.set(other.id, state.config.peripheralDelayTicks);
        bot.lastSeen.set(other.id, { cell: botCell(other), tick: state.tick });
        continue;
      }

      if (arc === "peripheral") {
        // A peripheral contact needs unbroken sight before the bot notices it.
        const ticks = (bot.peripheralTicks.get(other.id) ?? 0) + 1;
        bot.peripheralTicks.set(other.id, ticks);
        if (ticks >= state.config.peripheralDelayTicks) {
          peripheral.push(other.id);
          bot.lastSeen.set(other.id, { cell: botCell(other), tick: state.tick });
        }
        continue;
      }

      bot.peripheralTicks.delete(other.id);
    }

    bot.visibleEnemyIds = focus;
    bot.peripheralEnemyIds = peripheral;

    // The tempo counters of Section 7.22. A bot is "in contact" when it can
    // see an enemy in either arc: it is fighting, not walking to a fight.
    bot.aliveTicks += 1;
    if (focus.length > 0 || peripheral.length > 0) bot.contactTicks += 1;

    for (const [id, seen] of bot.lastSeen) {
      if (state.tick - seen.tick > state.config.memoryTicks) bot.lastSeen.delete(id);
    }
  }
}

/**
 * A bot that takes damage learns where the shot came from.
 *
 * Without this rule a bot can be shot from behind and never turn, because a
 * shooter behind it is outside both arcs.
 */
export function noteIncomingFire(state: SimState, target: BotState, attacker: BotState): void {
  target.lastSeen.set(attacker.id, { cell: botCell(attacker), tick: state.tick });
}
