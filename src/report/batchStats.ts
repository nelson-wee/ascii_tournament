/**
 * Batch statistics (dev-guide Section 7.16).
 *
 * The module takes one record per round and makes the tables and the CSV
 * files. It has no input and no output of its own, so the tests can use it.
 *
 * Milestone M5 measures what exists. A doctrine (Section 6.5) arrives with
 * M11, so a named tactics preset stands in its place. An arena profile
 * (Section 7.2) arrives with M7, so the name of the arena file stands in its
 * place. The rest of Section 7.16 is marked in `missingReports`.
 */
import type { RoundEndReason } from "../sim/state.js";

export interface RoundRecord {
  seed: number;
  arena: string;
  /** The tactics preset of each team. It stands in for a doctrine. */
  teamA: string;
  teamB: string;
  winner: "A" | "B" | null;
  reason: RoundEndReason;
  ticks: number;
  scoreA: number;
  scoreB: number;
  shots: number;
  hits: number;
  /** Kills where the target could not see the killer. It measures a flank. */
  unawareKills: number;
  killsByArchetype: Readonly<Record<string, number>>;
  shotsByWeapon: Readonly<Record<string, number>>;
}

export interface WinRecord {
  rounds: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface BatchSummary {
  rounds: number;
  arenas: string[];
  presets: string[];
  /** Per preset, over every arena and every opponent. */
  byPreset: Map<string, WinRecord>;
  /** Per preset and arena. The balance rule of Section 7.16 uses it. */
  byPresetArena: Map<string, WinRecord>;
  /** Per matchup: `${arena}|${teamA}|${teamB}`. */
  byMatchup: Map<string, WinRecord>;
  meanTicks: number;
  meanKills: number;
  meanShots: number;
  hitRate: number;
  /** The share of kills on a target that could not see its killer. */
  unawareKillShare: number;
  /** Rounds per end reason. */
  byReason: Map<RoundEndReason, number>;
  /** Rounds that made fewer kills than this share of the score limit. */
  lowKillRounds: number;
  killsByArchetype: Map<string, number>;
  shotsByWeapon: Map<string, number>;
  balanceFailures: string[];
  missingReports: string[];
}

function record(map: Map<string, WinRecord>, key: string): WinRecord {
  let value = map.get(key);
  if (value === undefined) {
    value = { rounds: 0, wins: 0, losses: 0, draws: 0 };
    map.set(key, value);
  }
  return value;
}

function add(target: WinRecord, result: "win" | "loss" | "draw"): void {
  target.rounds += 1;
  if (result === "win") target.wins += 1;
  else if (result === "loss") target.losses += 1;
  else target.draws += 1;
}

/** The win rate of a record, from 0 to 1. A draw counts as half a win. */
export function winRate(value: WinRecord): number {
  return value.rounds === 0 ? 0 : (value.wins + value.draws / 2) / value.rounds;
}

/**
 * The standard error of a win rate, from 0 to 1.
 * Section 7.2.1: state it with every win rate, or the reader cannot tell a
 * real difference from noise.
 */
export function standardError(value: WinRecord): number {
  if (value.rounds === 0) return 0;
  const rate = winRate(value);
  return Math.sqrt((rate * (1 - rate)) / value.rounds);
}

export interface SummarizeOptions {
  /** A preset above this win rate on every arena is a balance failure. TBD */
  balanceFailureRate?: number;
  /** A round below this share of the score limit made too few kills. TBD */
  lowKillShare?: number;
  scoreLimit?: number;
}

export function summarize(
  records: readonly RoundRecord[],
  options: SummarizeOptions = {},
): BatchSummary {
  const balanceFailureRate = options.balanceFailureRate ?? 0.6;
  const lowKillShare = options.lowKillShare ?? 0.5;
  const scoreLimit = options.scoreLimit ?? 15;

  const byPreset = new Map<string, WinRecord>();
  const byPresetArena = new Map<string, WinRecord>();
  const byMatchup = new Map<string, WinRecord>();
  const byReason = new Map<RoundEndReason, number>();
  const killsByArchetype = new Map<string, number>();
  const shotsByWeapon = new Map<string, number>();
  const arenas = new Set<string>();
  const presets = new Set<string>();

  let ticks = 0;
  let kills = 0;
  let shots = 0;
  let hits = 0;
  let unawareKills = 0;
  let lowKillRounds = 0;

  for (const round of records) {
    arenas.add(round.arena);
    presets.add(round.teamA);
    presets.add(round.teamB);

    const resultA = round.winner === "A" ? "win" : round.winner === "B" ? "loss" : "draw";
    const resultB = round.winner === "B" ? "win" : round.winner === "A" ? "loss" : "draw";
    add(record(byPreset, round.teamA), resultA);
    add(record(byPreset, round.teamB), resultB);
    add(record(byPresetArena, `${round.teamA}|${round.arena}`), resultA);
    add(record(byPresetArena, `${round.teamB}|${round.arena}`), resultB);
    add(record(byMatchup, `${round.arena}|${round.teamA}|${round.teamB}`), resultA);

    byReason.set(round.reason, (byReason.get(round.reason) ?? 0) + 1);
    ticks += round.ticks;
    kills += round.scoreA + round.scoreB;
    shots += round.shots;
    hits += round.hits;
    unawareKills += round.unawareKills;
    if (round.scoreA + round.scoreB < scoreLimit * lowKillShare) lowKillRounds += 1;

    for (const [archetype, count] of Object.entries(round.killsByArchetype)) {
      killsByArchetype.set(archetype, (killsByArchetype.get(archetype) ?? 0) + count);
    }
    for (const [weapon, count] of Object.entries(round.shotsByWeapon)) {
      shotsByWeapon.set(weapon, (shotsByWeapon.get(weapon) ?? 0) + count);
    }
  }

  // Section 7.16: a doctrine that wins on every arena is a balance failure.
  const arenaList = [...arenas].sort();
  const presetList = [...presets].sort();
  const balanceFailures: string[] = [];
  for (const preset of presetList) {
    const rates = arenaList.map((arena) => {
      const value = byPresetArena.get(`${preset}|${arena}`);
      return value && value.rounds > 0 ? winRate(value) : null;
    });
    if (rates.length > 0 && rates.every((rate) => rate !== null && rate > balanceFailureRate)) {
      balanceFailures.push(
        `${preset} wins more than ${(balanceFailureRate * 100).toFixed(0)} % on every arena`,
      );
    }
  }

  const count = records.length;
  return {
    rounds: count,
    arenas: arenaList,
    presets: presetList,
    byPreset,
    byPresetArena,
    byMatchup,
    meanTicks: count === 0 ? 0 : ticks / count,
    meanKills: count === 0 ? 0 : kills / count,
    meanShots: count === 0 ? 0 : shots / count,
    hitRate: shots === 0 ? 0 : hits / shots,
    unawareKillShare: kills === 0 ? 0 : unawareKills / kills,
    byReason,
    lowKillRounds,
    killsByArchetype,
    shotsByWeapon,
    balanceFailures,
    missingReports: [
      "Trait distribution in winning teams needs the progression of M10.",
      "Average match length needs the best-of-3 match of M8.",
      "Average run duration needs the run structure of M11.",
      "A real doctrine needs M11, and a real arena profile needs M7. A tactics "
        + "preset and an arena file name stand in their place.",
    ],
  };
}
