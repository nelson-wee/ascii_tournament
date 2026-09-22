/**
 * The round loop (dev-guide Section 7.4).
 *
 * Milestone M2 gives `step(state)`, which runs one tick. The display uses it
 * to advance the simulation at different speeds. `runRound`, the score, and the
 * round end condition arrive with Milestone M3.
 *
 * Tick order of Section 7.4. M2 runs the steps that exist:
 *
 *   1. Timers          — M3 (respawn, DoT, hazards, pickups)
 *   2. Perception      — M3
 *   3. AI decision     — M4 (the utility AI). M2 selects a random pickup point.
 *   4. AI action       — movement intent
 *   5. Movement        — apply movement, resolve collisions
 *   6. Combat          — M3
 *   7. Death, respawn  — M3
 *   8. Pickups         — M8
 *   9. Events
 *  10. End condition   — M3
 */
import { findPath } from "../ai/navigation.js";
import type { PickupPoint } from "../arena/types.js";
import { advanceBot } from "./movement.js";
import { botCell, type BotState, type SimState } from "./state.js";

/**
 * Give a bot a new goal: a random pickup point that it can reach.
 *
 * This is a placeholder for the utility AI of Milestone M4. It proves the
 * navigation and the movement.
 */
function chooseGoal(state: SimState, bot: BotState): void {
  const from = botCell(bot);
  const candidates = state.map.pickups.filter(
    (pickup) => pickup.cell.x !== from.x || pickup.cell.y !== from.y,
  );

  // Try each candidate one time, in a random order. The arena can hold a
  // pickup point that this bot cannot reach.
  for (const pickup of state.rng.shuffle(candidates) as PickupPoint[]) {
    const path = findPath(state.map, from, pickup.cell);
    if (path === null || path.length < 2) continue;
    bot.path = path.slice(1);
    bot.goalSlotId = pickup.slotId;
    state.bus.emit("DecisionChanged", state.tick, state.roundNumber, {
      botId: bot.id,
      action: "SeekPickup",
      slotId: pickup.slotId,
      cell: pickup.cell,
      pathLength: bot.path.length,
    });
    return;
  }

  bot.path = [];
  bot.goalSlotId = null;
}

/** Run one tick of the simulation. */
export function step(state: SimState): void {
  state.tick += 1;

  for (const bot of state.bots) {
    if (bot.path.length === 0) chooseGoal(state, bot);
  }
  for (const bot of state.bots) {
    advanceBot(state.map, bot);
  }
}

/** Run many ticks. The batch harness of Milestone M5 uses this. */
export function stepMany(state: SimState, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) step(state);
}
