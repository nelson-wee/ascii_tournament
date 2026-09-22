/**
 * The round loop (dev-guide Section 7.4).
 *
 * `step(state)` runs one tick. The display uses it to advance the simulation at
 * different speeds. `runRound(state)` runs a full round with no display.
 *
 * Tick order of Section 7.4. A step of a later milestone is marked:
 *
 *   1. Timers          — respawn, the weapon cooldown, damage over time, and
 *                        the hazard tiles. The pickup timers arrive with M8.
 *   2. Perception      — FOV, visible enemies, memory
 *   3. AI decision     — the utility AI of Section 7.8
 *   4. AI action       — movement intent and fire intent
 *   5. Movement        — apply movement, resolve collisions
 *   6. Combat          — the seven attack types of Section 7.20.3
 *   7. Death, respawn
 *   8. Pickups         — M8
 *   9. Events
 *  10. End condition   — the score limit, the time limit, or sudden death
 */
import { updatePerception } from "../ai/perception.js";
import { actionLabel, applyAction, decide, noteReachedPickup } from "../ai/utility.js";
import type { GameEvent } from "../core/events.js";
import { applyDots, applyHazards, updateProjectiles } from "./attacks.js";
import { respawn, tryFire } from "./combat.js";
import { advanceBot } from "./movement.js";
import {
  TEAM_IDS,
  botsInTickOrder,
  type RoundOutcome,
  type SimState,
  type TeamId,
} from "./state.js";

/**
 * The AI decision step (Section 7.4, step 3).
 *
 * Only a bot whose decision timer is at zero decides. The others keep their
 * action. The bot then turns the action into a movement intent.
 */
function decideActions(state: SimState): void {
  for (const bot of botsInTickOrder(state)) {
    if (!bot.alive) continue;
    noteReachedPickup(state, bot);
    if (bot.decisionCooldownTicks > 0) {
      bot.decisionCooldownTicks -= 1;
      continue;
    }
    bot.decisionCooldownTicks = state.config.aiDecisionIntervalTicks;

    const chosen = decide(state, bot);
    const label = actionLabel(chosen.action);
    const changed = label !== actionLabel(bot.action);
    bot.action = chosen.action;
    bot.actionScore = chosen.score;
    // The intent refreshes on every decision, because a target moves.
    applyAction(state, bot, chosen.action);

    if (changed) {
      state.bus.emit("DecisionChanged", state.tick, state.roundNumber, {
        botId: bot.id,
        action: label,
        score: chosen.score,
      });
    }
  }
}

/** The team with the higher score, or `null` if the score is equal. */
function leader(state: SimState): TeamId | null {
  const [first, second] = TEAM_IDS;
  const a = state.score[first] ?? 0;
  const b = state.score[second] ?? 0;
  if (a > b) return first;
  if (b > a) return second;
  return null;
}

/**
 * Start sudden death if the time limit arrived with an equal score.
 *
 * Decision: a drawn round goes to sudden death, and the next kill wins.
 */
export function enterSuddenDeathIfNeeded(state: SimState): void {
  if (state.suddenDeath) return;
  if (state.tick < state.config.timeLimitTicks) return;
  if (leader(state) !== null) return;

  state.suddenDeath = true;
  state.suddenDeathStartTick = state.tick;
  state.bus.emit("Announcement", state.tick, state.roundNumber, {
    kind: "suddenDeath",
    text: "Sudden Death",
  });
}

/** The result of the round, or `null` while the round runs. */
export function checkRoundEnd(state: SimState): RoundOutcome | null {
  const { config, score, tick } = state;

  for (const teamId of TEAM_IDS) {
    if ((score[teamId] ?? 0) >= config.scoreLimit) {
      return { winnerTeamId: teamId, reason: "scoreLimit", score: { ...score }, ticks: tick };
    }
  }

  if (state.suddenDeath) {
    // The next kill wins.
    const winner = leader(state);
    if (winner !== null) {
      return { winnerTeamId: winner, reason: "suddenDeath", score: { ...score }, ticks: tick };
    }
    // A safety limit. It stops a round that never ends.
    if (tick - state.suddenDeathStartTick >= config.suddenDeathMaxTicks) {
      return { winnerTeamId: null, reason: "timeLimit", score: { ...score }, ticks: tick };
    }
    return null;
  }

  if (tick >= config.timeLimitTicks) {
    const winner = leader(state);
    // An equal score starts sudden death instead of a draw.
    if (winner === null) return null;
    return { winnerTeamId: winner, reason: "timeLimit", score: { ...score }, ticks: tick };
  }

  return null;
}

/** Run one tick of the simulation. A tick after the round end does nothing. */
export function step(state: SimState): void {
  if (state.outcome !== null) return;
  state.tick += 1;

  const order = botsInTickOrder(state);

  // 1. Timers.
  for (const bot of order) {
    if (bot.fireCooldownTicks > 0) bot.fireCooldownTicks -= 1;
    if (!bot.alive && state.tick >= bot.respawnAtTick) respawn(state, bot);
  }
  applyDots(state);
  applyHazards(state);

  // 2. Perception.
  updatePerception(state);

  // 3 and 4. AI decision and intent.
  decideActions(state);

  // 5. Movement.
  for (const bot of order) {
    advanceBot(state, bot);
    // The crit of Section 7.20.5 reads the first counter, the dodge the second.
    if (bot.movedLastTick) {
      bot.movingTicks += 1;
      bot.stationaryTicks = 0;
    } else {
      bot.stationaryTicks += 1;
      bot.movingTicks = 0;
    }
  }

  // 6 and 7. Combat, death, and the kill events. The shots that are already
  // in the air move before the new ones leave.
  updateProjectiles(state);
  for (const bot of order) tryFire(state, bot);

  // 10. End condition.
  enterSuddenDeathIfNeeded(state);
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
