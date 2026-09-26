/**
 * The batch runner (dev-guide Section 7.16).
 *
 * It runs rounds with no display and makes one `RoundRecord` per round. It has
 * no file input and no file output, so the tests and the CLI both use it.
 *
 * Determinism: the seed of a round comes from the batch seed and the name of
 * the matchup, so a round always gives the same result, whatever the order of
 * the rounds.
 */
import { tempoOf } from "./tempo.js";
import type { ArenaMap } from "../arena/types.js";
import type { Tactics } from "../core/schemas.js";
import type { Role } from "../sim/state.js";
import { EventBus } from "../core/events.js";
import { deriveSeed } from "../core/rng.js";
import { createRng, deriveSeed as derive } from "../core/rng.js";
import { generateWeaponSet } from "../weapons/generate.js";
import { createSimState, runRound, simConfigFromTuning, type SimConfig } from "../sim/index.js";
import type { RoundRecord } from "./batchStats.js";

export interface BatchArena {
  /** The name that the report shows. It stands in for an arena profile. */
  name: string;
  map: ArenaMap;
}

export interface BatchPlanOptions {
  arenas: readonly BatchArena[];
  presets: Readonly<Record<string, Tactics>>;
  /**
   * One named role order per team (Section 7.11). Left out, every team plays
   * `STANDARD_COMPOSITION`, which is what the simulation gives by default.
   */
  compositions?: Readonly<Record<string, readonly Role[]>> | undefined;
  rounds: number;
  seed: number;
}

/** One of each role. The simulation uses this order when nothing else says so. */
export const STANDARD_COMPOSITION: readonly Role[] = ["tank", "overwatch", "skirmisher"];

const DEFAULT_COMPOSITIONS: Readonly<Record<string, readonly Role[]>> = {
  standard: STANDARD_COMPOSITION,
};

export interface PlannedRound {
  arena: BatchArena;
  teamA: string;
  teamB: string;
  /** The name of the role composition of each team. */
  compA: string;
  compB: string;
  seed: number;
  index: number;
}

/**
 * Spread the rounds over every arena and every pair of presets.
 *
 * Each preset plays as team A and as team B against every preset, itself
 * included. This cancels any side that is left over, and the mirror matchup
 * shows whether a preset is even against itself.
 */
export function planRounds(options: BatchPlanOptions): PlannedRound[] {
  const presetNames = Object.keys(options.presets).sort();
  const compositions = options.compositions ?? DEFAULT_COMPOSITIONS;
  const compNames = Object.keys(compositions).sort();
  const cells: { arena: BatchArena; teamA: string; teamB: string; compA: string; compB: string }[] =
    [];
  for (const arena of options.arenas) {
    for (const teamA of presetNames) {
      for (const teamB of presetNames) {
        for (const compA of compNames) {
          for (const compB of compNames) cells.push({ arena, teamA, teamB, compA, compB });
        }
      }
    }
  }
  if (cells.length === 0) return [];

  const planned: PlannedRound[] = [];
  for (let index = 0; index < options.rounds; index += 1) {
    const cell = cells[index % cells.length] as (typeof cells)[number];
    const label =
      `${cell.arena.name}|${cell.teamA}|${cell.teamB}|${cell.compA}|${cell.compB}` +
      `|${Math.floor(index / cells.length)}`;
    planned.push({ ...cell, seed: deriveSeed(options.seed, label), index });
  }
  return planned;
}

/** Run one planned round and make its record. */
export function runPlannedRound(
  round: PlannedRound,
  presets: Readonly<Record<string, Tactics>>,
  config: SimConfig = simConfigFromTuning(),
  compositions: Readonly<Record<string, readonly Role[]>> = DEFAULT_COMPOSITIONS,
): RoundRecord {
  const bus = new EventBus();
  const teamATactics = presets[round.teamA];
  const teamBTactics = presets[round.teamB];
  if (!teamATactics || !teamBTactics) {
    throw new Error(`The batch has no preset "${round.teamA}" or "${round.teamB}".`);
  }

  // Every round of the batch gets its own weapon set, from the weapons stream
  // (Section 7.1). Both teams hold the same set, so the batch measures the
  // tactics and not the luck of a roll.
  const weapons = generateWeaponSet(
    createRng(derive(round.seed, "weapons"), "weapons"),
    config.weaponsPerRun,
    { ticksPerSecond: config.ticksPerSecond },
  );

  const state = createSimState({
    map: round.arena.map,
    seed: round.seed,
    config,
    bus,
    weapons,
    tactics: { A: teamATactics, B: teamBTactics },
    roles: {
      A: compositions[round.compA] ?? STANDARD_COMPOSITION,
      B: compositions[round.compB] ?? STANDARD_COMPOSITION,
    },
  });
  const result = runRound(state);

  const killsByArchetype: Record<string, number> = {};
  const shotsByWeapon: Record<string, number> = {};
  const killsByBand: Record<string, number> = {};
  const killsByRole: Record<string, number> = {};
  const deathsByRole: Record<string, number> = {};
  const pickupsByKind: Record<string, number> = {};
  let shots = 0;
  let hits = 0;
  let unawareKills = 0;
  let killDistanceSum = 0;

  // A bot id is the team letter and the slot, for example "A0". The slot is
  // the index in the role order of the team, so the id names the role.
  const rolesOf: Readonly<Record<string, readonly Role[]>> = {
    A: compositions[round.compA] ?? STANDARD_COMPOSITION,
    B: compositions[round.compB] ?? STANDARD_COMPOSITION,
  };
  const roleOf = (botId: unknown): string => {
    const id = String(botId ?? "");
    const order = rolesOf[id.slice(0, 1)];
    const slot = Number(id.slice(1));
    if (!order || !Number.isInteger(slot)) return "unknown";
    return order[slot] ?? "unknown";
  };

  for (const event of bus.log) {
    if (event.type === "Shot") {
      shots += 1;
      const weapon = String(event.data["weaponId"] ?? "unknown");
      shotsByWeapon[weapon] = (shotsByWeapon[weapon] ?? 0) + 1;
    } else if (event.type === "Hit") {
      hits += 1;
    } else if (event.type === "PickupTaken") {
      const kind = String(event.data["kind"] ?? "unknown");
      pickupsByKind[kind] = (pickupsByKind[kind] ?? 0) + 1;
    } else if (event.type === "Kill") {
      const archetype = String(event.data["weaponArchetype"] ?? "unknown");
      killsByArchetype[archetype] = (killsByArchetype[archetype] ?? 0) + 1;
      const band = String(event.data["rangeBand"] ?? "unknown");
      killsByBand[band] = (killsByBand[band] ?? 0) + 1;
      const distance = event.data["distance"];
      if (typeof distance === "number") killDistanceSum += distance;
      const killer = roleOf(event.data["killerId"]);
      killsByRole[killer] = (killsByRole[killer] ?? 0) + 1;
      const victim = roleOf(event.data["victimId"]);
      deathsByRole[victim] = (deathsByRole[victim] ?? 0) + 1;
      if (event.data["targetAware"] === false) unawareKills += 1;
    }
  }

  return {
    tempo: tempoOf(bus.log, {
      multiKillWindowTicks: config.multiKillWindowTicks,
      contact: state.bots.map((bot) => ({
        aliveTicks: bot.aliveTicks,
        contactTicks: bot.contactTicks,
      })),
    }),
    seed: round.seed,
    arena: round.arena.name,
    teamA: round.teamA,
    teamB: round.teamB,
    compA: round.compA,
    compB: round.compB,
    winner: result.outcome.winnerTeamId,
    reason: result.outcome.reason,
    ticks: result.outcome.ticks,
    scoreA: result.outcome.score.A,
    scoreB: result.outcome.score.B,
    shots,
    hits,
    unawareKills,
    killsByArchetype,
    shotsByWeapon,
    killsByBand,
    killDistanceSum,
    killsByRole,
    deathsByRole,
    pickupsByKind,
    weaponArchetypes: [...new Set(weapons.map((weapon) => weapon.archetype))].sort(),
  };
}

export interface RunBatchOptions extends BatchPlanOptions {
  config?: SimConfig | undefined;
  /** Called after each round. The CLI shows progress with it. */
  onProgress?: ((done: number, total: number) => void) | undefined;
}

/** Run a full batch. */
export function runBatch(options: RunBatchOptions): RoundRecord[] {
  const config = options.config ?? simConfigFromTuning();
  const planned = planRounds(options);
  const records: RoundRecord[] = [];
  const compositions = options.compositions ?? DEFAULT_COMPOSITIONS;
  for (const round of planned) {
    records.push(runPlannedRound(round, options.presets, config, compositions));
    options.onProgress?.(records.length, planned.length);
  }
  return records;
}
