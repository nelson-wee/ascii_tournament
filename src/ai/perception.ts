/**
 * Perception (dev-guide Section 7.7).
 *
 * - rot.js `FOV.PreciseShadowcasting` gives the visible cells.
 * - Each bot keeps the visible enemies and the last seen position of each enemy.
 * - "Target unaware" is true if the target cannot see the attacker.
 */
import { FOV } from "rot-js";
import type PreciseShadowcasting from "rot-js/lib/fov/precise-shadowcasting.js";
import { Tile, cellIndex, inBounds, tileAt, type ArenaMap } from "../arena/types.js";
import { botCell, type BotState, type SimState } from "../sim/state.js";

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
 * set again only after the bot changes cell. A bot crosses one cell in about
 * five ticks, so this removes most of the work of the perception step.
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

/** True if `viewer` can see the cell of `other`. */
export function canSee(state: SimState, viewer: BotState, other: BotState): boolean {
  const cell = botCell(other);
  return viewer.visibleCells.has(cellIndex(state.map, cell.x, cell.y));
}

/**
 * True if `target` cannot see `attacker`.
 * The `Kill` event and the crit conditions use this value (Section 6.8).
 */
export function isUnaware(state: SimState, attacker: BotState, target: BotState): boolean {
  return !canSee(state, target, attacker);
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
      continue;
    }
    computeVisibleCells(state, bot);
  }

  for (const bot of state.bots) {
    if (!bot.alive) continue;
    const visible: string[] = [];
    for (const other of state.bots) {
      if (!other.alive || other.teamId === bot.teamId) continue;
      if (!canSee(state, bot, other)) continue;
      visible.push(other.id);
      bot.lastSeen.set(other.id, { cell: botCell(other), tick: state.tick });
    }
    bot.visibleEnemyIds = visible;

    for (const [id, seen] of bot.lastSeen) {
      if (state.tick - seen.tick > state.config.memoryTicks) bot.lastSeen.delete(id);
    }
  }
}
