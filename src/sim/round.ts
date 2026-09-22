/**
 * The round loop (dev-guide Section 7.4).
 *
 * `step(state)` runs one tick. The display uses it to advance the simulation at
 * different speeds. `runRound(state)` runs a full round with no display.
 *
 * Tick order of Section 7.4. A step of a later milestone is marked:
 *
 *   1. Timers          — respawn and the weapon cooldown. DoT, hazards, and
 *                        pickup timers arrive with M6 and M8.
 *   2. Perception      — FOV, visible enemies, memory
 *   3. AI decision     — M4 (the utility AI). M3 selects a random pickup point.
 *   4. AI action       — movement intent and fire intent
 *   5. Movement        — apply movement, resolve collisions
 *   6. Combat          — hitscan shots. Projectiles and area damage: M6.
 *   7. Death, respawn
 *   8. Pickups         — M8
 *   9. Events
 *  10. End condition   — the score limit or the time limit
 */
import { findPath } from "../ai/navigation.js";
import { updatePerception } from "../ai/perception.js";
import type { PickupPoint } from "../arena/types.js";
import type { GameEvent } from "../core/events.js";
import { respawn, tryFire } from "./combat.js";
import { advanceBot } from "./movement.js";
import {
  TEAM_IDS,
  botCell,
  type BotState,
  type RoundOutcome,
  type SimState,
  type TeamId,
} from "./state.js";

/**
 * Give a bot a new goal: a random pickup point that it can reach.
 *
 * This is a placeholder for the utility AI of Milestone M4. It keeps the bots
 * in motion, so that they meet and fight.
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

/** The result of the round, or `null` while the round runs. */
export function checkRoundEnd(state: SimState): RoundOutcome | null {
  const { config, score, tick } = state;

  for (const teamId of TEAM_IDS) {
    if ((score[teamId] ?? 0) >= config.scoreLimit) {
      return { winnerTeamId: teamId, reason: "scoreLimit", score: { ...score }, ticks: tick };
    }
  }

  if (tick >= config.timeLimitTicks) {
    const [first, second] = TEAM_IDS;
    const a = score[first] ?? 0;
    const b = score[second] ?? 0;
    // A draw is possible at the time limit. The match rules of M8 decide what
    // a draw does to the best-of-3 count. TBD
    let winnerTeamId: TeamId | null = null;
    if (a > b) winnerTeamId = first;
    else if (b > a) winnerTeamId = second;
    return { winnerTeamId, reason: "timeLimit", score: { ...score }, ticks: tick };
  }

  return null;
}

/** Run one tick of the simulation. A tick after the round end does nothing. */
export function step(state: SimState): void {
  if (state.outcome !== null) return;
  state.tick += 1;

  // 1. Timers.
  for (const bot of state.bots) {
    if (bot.fireCooldownTicks > 0) bot.fireCooldownTicks -= 1;
    if (!bot.alive && state.tick >= bot.respawnAtTick) respawn(state, bot);
  }

  // 2. Perception.
  updatePerception(state);

  // 3. AI decision.
  for (const bot of state.bots) {
    if (bot.alive && bot.path.length === 0) chooseGoal(state, bot);
  }

  // 4 and 5. Movement.
  for (const bot of state.bots) advanceBot(state, bot);

  // 6 and 7. Combat, death, and the kill events.
  for (const bot of state.bots) tryFire(state, bot);

  // 10. End condition.
  const outcome = checkRoundEnd(state);
  if (outcome !== null) {
    state.outcome = outcome;
    state.bus.emit("RoundEnd", state.tick, state.roundNumber, {
      winnerTeamId: outcome.winnerTeamId,
      reason: outcome.reason,
      score: outcome.score,
      ticks: outcome.ticks,
    });
  }
}

/** Run many ticks, or fewer if the round ends first. */
export function stepMany(state: SimState, ticks: number): void {
  for (let i = 0; i < ticks && state.outcome === null; i += 1) step(state);
}

/** The result of one round (Section 6.6). `tacticsUsed` arrives with M4. */
export interface RoundResult {
  roundNumber: number;
  outcome: RoundOutcome;
  events: readonly GameEvent[];
}

/**
 * Run a full round with no display (Section 7.4).
 *
 * The round always ends, because the time limit ends it.
 */
export function runRound(state: SimState): RoundResult {
  state.bus.emit("RoundStart", state.tick, state.roundNumber, {
    arena: state.map.name,
    scoreLimit: state.config.scoreLimit,
    timeLimitTicks: state.config.timeLimitTicks,
  });
  while (state.outcome === null) step(state);
  return {
    roundNumber: state.roundNumber,
    outcome: state.outcome,
    events: state.bus.log,
  };
}
