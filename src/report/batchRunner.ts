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
import type { Tactics, TeamTactics } from "../core/schemas.js";
import type { Role } from "../sim/state.js";
import { EventBus } from "../core/events.js";
import { deriveSeed } from "../core/rng.js";
import { createRng, deriveSeed as derive } from "../core/rng.js";
import { generateWeaponSet } from "../weapons/generate.js";
import { loadDefaultTactics } from "../core/data.js";
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
   * One named team axis per team (Section 7.21). When it is here it names the
   * matchup axis instead of `presets`, and a team that has no entry in
   * `presets` plays the default tactics. The batch then measures the team
   * decision and holds everything else still.
   */
  teamPresets?: Readonly<Record<string, TeamTactics>> | undefined;
  /**
   * One named role order per team (Section 7.11). Left out, every team plays
   * `STANDARD_COMPOSITION`, which is what the simulation gives by default.
   */
  compositions?: Readonly<Record<string, readonly Role[]>> | undefined;
  /**
   * Let the roles own the tactics of every round (Section 7.26). Set it in a
   * batch that measures compositions; leave it out in one that measures
   * presets, because a preset is a team-wide override of the role presets.
   */
  useRoleTactics?: boolean | undefined;
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
  /**
   * Let the roles own the tactics, instead of giving both teams a preset
   * (Section 7.26).
   *
   * A preset is a team-wide override that throws the role presets away, so a
   * batch that measures **compositions** must set this. A batch that measures
   * presets must not.
   */
  useRoleTactics?: boolean;
}

/**
 * Spread the rounds over every arena and every pair of presets.
 *
 * Each preset plays as team A and as team B against every preset, itself
 * included. This cancels any side that is left over, and the mirror matchup
 * shows whether a preset is even against itself.
 */
export function planRounds(options: BatchPlanOptions): PlannedRound[] {
  const presetNames = Object.keys(options.teamPresets ?? options.presets).sort();
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
    planned.push({
      ...cell,
      seed: deriveSeed(options.seed, label),
      index,
      ...(options.useRoleTactics === true ? { useRoleTactics: true } : {}),
    });
  }
  return planned;
}

/** Run one planned round and make its record. */
export function runPlannedRound(
  round: PlannedRound,
  presets: Readonly<Record<string, Tactics>>,
  config: SimConfig = simConfigFromTuning(),
  compositions: Readonly<Record<string, readonly Role[]>> = DEFAULT_COMPOSITIONS,
  teamPresets: Readonly<Record<string, TeamTactics>> | undefined = undefined,
): RoundRecord {
  const bus = new EventBus();
  // With a team axis the name belongs to it, and a bot plays the default
  // tactics unless the batch also names tactics for it (Section 7.21).
  const fallback = teamPresets === undefined ? undefined : loadDefaultTactics();
  const teamATactics = presets[round.teamA] ?? fallback;
  const teamBTactics = presets[round.teamB] ?? fallback;
  if (!teamATactics || !teamBTactics) {
    throw new Error(`The batch has no preset "${round.teamA}" or "${round.teamB}".`);
  }
  const teamAxis =
    teamPresets === undefined
      ? undefined
      : { A: teamPresets[round.teamA], B: teamPresets[round.teamB] };
  if (teamPresets !== undefined && (!teamAxis?.A || !teamAxis.B)) {
    throw new Error(`The batch has no team preset "${round.teamA}" or "${round.teamB}".`);
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
    // A preset is a **team-wide override**: it throws the role presets away, so
    // a batch that measures compositions must leave it out (Section 7.26).
    ...(round.useRoleTactics
      ? {}
      : { tacticsOverride: { A: teamATactics, B: teamBTactics } }),
    ...(teamAxis?.A && teamAxis.B ? { teamTactics: { A: teamAxis.A, B: teamAxis.B } } : {}),
    roles: {
      A: compositions[round.compA] ?? STANDARD_COMPOSITION,
      B: compositions[round.compB] ?? STANDARD_COMPOSITION,
    },
  });
  const result = runRound(state);

  const killsByArchetype: Record<string, number> = {};
  const shotsByWeapon: Record<string, number> = {};
  const killsByBand: Record<string, number> = {};
  const shotsByBand: Record<string, number> = {};
  const hitsByBand: Record<string, number> = {};
  const damageByBand: Record<string, number> = {};
  const killsByRole: Record<string, number> = {};
  const deathsByRole: Record<string, number> = {};
  const shotsByRole: Record<string, number> = {};
  const hitsByRole: Record<string, number> = {};
  const damageByRole: Record<string, number> = {};
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
      const shooter = roleOf(event.data["shooterId"]);
      shotsByRole[shooter] = (shotsByRole[shooter] ?? 0) + 1;
      // Section 7.46: where the round FIRED, which is what `value.bandShare`
      // claims to hold. A shot at a projectile is left out: it is a real use of
      // the weapon and it damages no bot, so no DPS profile is paid for it.
      const at = String(event.data["targetId"] ?? "");
      if (!at.startsWith("projectile:")) {
        const band = String(event.data["rangeBand"] ?? "unknown");
        shotsByBand[band] = (shotsByBand[band] ?? 0) + 1;
      }
    } else if (event.type === "Hit") {
      hits += 1;
      // Only damage that a SHOT delivered counts against the shots fired. A
      // `Hit` also fires for every tick of a burn and every tick of a hazard
      // tile, and counting those would make `hitsByRole / shotsByRole` a number
      // that does not mean what its name says: a weapon with a long burn would
      // read as accurate (Section 7.39.2).
      const source = String(event.data["source"] ?? "");
      const shooter = roleOf(event.data["shooterId"]);
      if (source === "shot" || source === "area") {
        hitsByRole[shooter] = (hitsByRole[shooter] ?? 0) + 1;
      }
      // Damage counts every source, the burn a shot left behind included,
      // because all of it is work the role did (Section 7.39.3).
      const dealt = event.data["damage"];
      if (typeof dealt === "number") {
        damageByRole[shooter] = (damageByRole[shooter] ?? 0) + dealt;
      }
      // By band, a burn and a hazard tile are left out instead. They are
      // already on the target, so the distance to whoever started them is not
      // the range of anything, and `damageBot` marks them with a `null` band
      // (Section 7.46). Summing them would fill a band nothing fired at.
      const landed = event.data["rangeBand"];
      if (typeof landed === "string") {
        hitsByBand[landed] = (hitsByBand[landed] ?? 0) + 1;
        if (typeof dealt === "number") {
          damageByBand[landed] = (damageByBand[landed] ?? 0) + dealt;
        }
      }
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
    shotsByBand,
    hitsByBand,
    damageByBand,
    killDistanceSum,
    killsByRole,
    deathsByRole,
    shotsByRole,
    hitsByRole,
    damageByRole,
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
    records.push(
      runPlannedRound(round, options.presets, config, compositions, options.teamPresets),
    );
    options.onProgress?.(records.length, planned.length);
  }
  return records;
}
