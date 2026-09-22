/**
 * Movement (dev-guide Section 7.5).
 *
 * - A bot has a sub-cell position. The display shows the nearest cell.
 * - Walls block movement. Low cover does not block movement. TBD
 * - A bot moves along the cells of its path, from cell centre to cell centre.
 *
 * Evasion (random lateral movement) needs the tactics of Milestone M4.
 */
import type { ArenaMap } from "../arena/types.js";
import { isStepLegal } from "../ai/navigation.js";
import type { Cell } from "../core/types.js";
import { botCell, cellCenter, type BotState } from "./state.js";

/** Distances below this value count as zero. */
const EPSILON = 1e-9;

/**
 * Move one bot along its path by one tick.
 *
 * The bot stops and drops its path if the next step is not legal (a wall, or a
 * diagonal step around the corner of a wall). The AI gives it a new path on the
 * next tick. This is the collision step of the tick order (Section 7.4).
 */
export function advanceBot(map: ArenaMap, bot: BotState): void {
  let remaining = bot.moveSpeedPerTick;

  while (remaining > EPSILON && bot.path.length > 0) {
    const next = bot.path[0] as Cell;
    const from = botCell(bot);

    if (from.x !== next.x || from.y !== next.y) {
      if (!isStepLegal(map, from, next)) {
        bot.path.length = 0;
        bot.goalSlotId = null;
        return;
      }
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
}
