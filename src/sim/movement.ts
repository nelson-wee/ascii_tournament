/**
 * Movement (dev-guide Section 7.5).
 *
 * - A bot has a sub-cell position. The display shows the nearest cell.
 * - Walls block movement. Low cover does not block movement. TBD
 * - An enemy bot blocks movement. A teammate does not.
 * - A bot moves along the cells of its path, from cell centre to cell centre.
 * - Evasion adds random lateral movement. It lowers the accuracy of the bot in
 *   `sim/combat.ts`.
 */
import { isStepLegal } from "../ai/navigation.js";
import { updateFacing } from "../ai/perception.js";
import { isWalkable, tileAt } from "../arena/types.js";
import type { Cell } from "../core/types.js";
import { botCell, cellCenter, enemyAt, posCell, type BotState, type SimState } from "./state.js";

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

  applyEvasion(state, bot, start);
  bot.velocity = { x: bot.pos.x - start.x, y: bot.pos.y - start.y };
  bot.movedLastTick = bot.pos.x !== start.x || bot.pos.y !== start.y;
  updateFacing(state, bot, { x: bot.pos.x - start.x, y: bot.pos.y - start.y });
}

/**
 * Add random lateral movement (Section 7.5).
 *
 * The bot evades only while it can see an enemy, because evasion has a cost:
 * it lowers the accuracy of the bot itself. The offset applies only if the new
 * cell is free.
 */
function applyEvasion(state: SimState, bot: BotState, start: { x: number; y: number }): void {
  const strength = bot.tactics.evasion;
  if (strength <= 0 || bot.visibleEnemyIds.length === 0) return;

  let dx = bot.pos.x - start.x;
  let dy = bot.pos.y - start.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    // The bot stands. It side-steps across the line to its target.
    const target = state.bots.find((other) => other.id === bot.visibleEnemyIds[0]);
    if (!target) return;
    dx = target.pos.x - bot.pos.x;
    dy = target.pos.y - bot.pos.y;
  }
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return;

  const amount =
    state.rng.float(-1, 1) * strength * state.config.evasionLateralFactor * bot.moveSpeedPerTick;
  const next = {
    x: bot.pos.x + (-dy / length) * amount,
    y: bot.pos.y + (dx / length) * amount,
  };

  const from = botCell(bot);
  const to = posCell(next);
  if (!isWalkable(tileAt(state.map, to.x, to.y))) return;
  if ((to.x !== from.x || to.y !== from.y) && !isStepLegal(state.map, from, to)) return;
  if ((to.x !== from.x || to.y !== from.y) && enemyAt(state, to, bot.teamId)) return;
  bot.pos = next;
}
