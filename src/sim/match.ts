/**
 * The match loop (dev-guide Section 7.4).
 *
 * A match is best of 3 rounds. All rounds use the same arena and the same
 * spawn table. At the start of each round the game resets health, armor,
 * weapons, ammo, pickups, hazards, and the influence maps. It does not reset
 * the affinity counters: events from all rounds count (Section 7.13, M10).
 *
 * `getTactics` runs between rounds. In the browser it opens the between-round
 * screen. In the batch harness it returns fixed tactics.
 */
import type { ArenaMap } from "../arena/types.js";
import { EventBus } from "../core/events.js";
import { createRng, deriveSeed } from "../core/rng.js";
import type { Tactics, TeamTactics } from "../core/schemas.js";
import type { Weapon } from "../weapons/types.js";
import { rollSpawnTable, type SpawnTable } from "./pickups.js";
import { runRound } from "./round.js";
import {
  createSimState,
  simConfigFromTuning,
  TEAM_IDS,
  type Role,
  type RoundOutcome,
  type SimConfig,
  type SimState,
  type TeamId,
} from "./state.js";

/** What the player or the AI sets for one team before a round. */
export interface TeamPlan {
  tactics?: Tactics;
  teamTactics?: TeamTactics;
  roles?: readonly Role[];
}

export type MatchPlan = Partial<Record<TeamId, TeamPlan>>;

/** Called before each round. The round number starts at 1. */
export type GetTactics = (roundNumber: number, previous: readonly RoundOutcome[]) => MatchPlan;

export interface RunMatchOptions {
  map: ArenaMap;
  weapons: readonly Weapon[];
  /** The seed of the match. Each round takes a sub-seed from it. */
  seed: number;
  matchId?: string;
  config?: SimConfig;
  bus?: EventBus;
  /** The plan of the first round, and of every round if `getTactics` is absent. */
  plan?: MatchPlan;
  getTactics?: GetTactics;
  spawnTable?: SpawnTable;
}

export interface MatchResult {
  matchId: string;
  seed: number;
  /** The same spawn table for every round of the match (Section 2.2). */
  spawnTable: SpawnTable;
  rounds: RoundOutcome[];
  /** Round wins per team. */
  roundWins: Record<TeamId, number>;
  winnerTeamId: TeamId | null;
}

/** Build the state of one round of a match. */
export function createRoundState(
  options: RunMatchOptions,
  roundNumber: number,
  plan: MatchPlan,
  spawnTable: SpawnTable,
  config: SimConfig,
  bus: EventBus,
): SimState {
  const tactics: Partial<Record<TeamId, Tactics>> = {};
  const teamTactics: Partial<Record<TeamId, TeamTactics>> = {};
  const roles: Partial<Record<TeamId, readonly Role[]>> = {};
  for (const teamId of TEAM_IDS) {
    const team = plan[teamId];
    if (team?.tactics) tactics[teamId] = team.tactics;
    if (team?.teamTactics) teamTactics[teamId] = team.teamTactics;
    if (team?.roles) roles[teamId] = team.roles;
  }

  return createSimState({
    map: options.map,
    // A round takes a sub-seed from the match seed, so it can replay alone
    // (Section 7.1).
    seed: deriveSeed(options.seed, `round:${roundNumber}`),
    roundNumber,
    config,
    bus,
    weapons: options.weapons,
    spawnTable,
    ...(Object.keys(tactics).length > 0 ? { tactics } : {}),
    ...(Object.keys(teamTactics).length > 0 ? { teamTactics } : {}),
    ...(Object.keys(roles).length > 0 ? { roles } : {}),
  });
}

/**
 * Run a best-of-3 match.
 *
 * A team wins the match when it wins `roundWinsToWinMatch` rounds. A drawn
 * round gives neither team a round win, and the match then runs its full
 * length; if the round wins are equal at the end, the match has no winner.
 */
export function runMatch(options: RunMatchOptions): MatchResult {
  const config = options.config ?? simConfigFromTuning();
  const bus = options.bus ?? new EventBus();
  const matchId = options.matchId ?? `match-${options.seed}`;
  const spawnTable =
    options.spawnTable ??
    rollSpawnTable(options.map, options.weapons, createRng(options.seed, "weapons"));

  bus.emit("MatchStart", 0, 0, {
    matchId,
    arena: options.map.name,
    weapons: options.weapons.map((weapon) => weapon.id),
    spawnTable: spawnTable.slots,
  });

  const rounds: RoundOutcome[] = [];
  const roundWins: Record<TeamId, number> = { A: 0, B: 0 };
  let winnerTeamId: TeamId | null = null;

  for (let roundNumber = 1; roundNumber <= config.maxRounds; roundNumber += 1) {
    const plan = options.getTactics
      ? options.getTactics(roundNumber, rounds)
      : (options.plan ?? {});
    const state = createRoundState(options, roundNumber, plan, spawnTable, config, bus);
    const result = runRound(state);
    rounds.push(result.outcome);
    if (result.outcome.winnerTeamId !== null) roundWins[result.outcome.winnerTeamId] += 1;

    for (const teamId of TEAM_IDS) {
      if (roundWins[teamId] >= config.roundWinsToWinMatch) winnerTeamId = teamId;
    }
    if (winnerTeamId !== null) break;
  }

  if (winnerTeamId === null) {
    const [first, second] = TEAM_IDS;
    if (roundWins[first] > roundWins[second]) winnerTeamId = first;
    else if (roundWins[second] > roundWins[first]) winnerTeamId = second;
  }

  bus.emit("MatchEnd", 0, rounds.length, {
    matchId,
    winnerTeamId,
    roundWins: { ...roundWins },
    rounds: rounds.length,
  });

  return { matchId, seed: options.seed, spawnTable, rounds, roundWins, winnerTeamId };
}
