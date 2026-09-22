/**
 * Movement (dev-guide Section 7.5).
 *
 * - A bot has a sub-cell position. The display shows the nearest cell.
 * - Walls block movement. Low cover does not block movement. TBD
 * - An enemy bot blocks movement. A teammate does not.
 * - A bot moves along the cells of its path, from cell centre to cell centre.
 *
 * Evasion (random lateral movement) needs the tactics of Milestone M4.
 */
import { isStepLegal } from "../ai/navigation.js";
import type { Cell } from "../core/types.js";
import { botCell, cellCenter, enemyAt, type BotState, type SimState } from "./state.js";

/** Distances below this value count as zero. */
const EPSILON = 1e-9;

/**
 * Move one bot along its path by one tick.
 *
 * The bot drops its path if the next step is not legal (a wall, or a diagonal
 * step around the corner of a wall). It waits if an enemy stands on the next
 * cell, and it takes a new path after `repathAfterBlockedTicks` ticks. This is
 * the collision step of the tick order (Section 7.4).
 */
export function advanceBot(state: SimState, bot: BotState): void {
  bot.movedLastTick = false;
  if (!bot.alive) return;

  const start = { x: bot.pos.x, y: bot.pos.y };
  let remaining = bot.moveSpeedPerTick;

  while (remaining > EPSILON && bot.path.length > 0) {
    const next = bot.path[0] as Cell;
    const from = botCell(bot);
    const leavingCell = from.x !== next.x || from.y !== next.y;

    if (leavingCell) {
      if (!isStepLegal(state.map, from, next)) {
        bot.path.length = 0;
        bot.goalSlotId = null;
        break;
      }
      if (enemyAt(state, next, bot.teamId)) {
        bot.blockedTicks += 1;
        if (bot.blockedTicks >= state.config.repathAfterBlockedTicks) {
          bot.path.length = 0;
          bot.goalSlotId = null;
          bot.blockedTicks = 0;
        }
        break;
      }
      bot.blockedTicks = 0;
    }

    const target = cellCenter(next);
    const dx = target.x - bot.pos.x;
    const dy = target.y - bot.pos.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= remaining) {
      bot.pos = target;
      bot.path.shift();
      remaining -= distance;
      continue;
    }

    bot.pos = {
      x: bot.pos.x + (dx / distance) * remaining,
      y: bot.pos.y + (dy / distance) * remaining,
    };
    remaining = 0;
  }

  bot.movedLastTick = bot.pos.x !== start.x || bot.pos.y !== start.y;
}
