/**
 * The arena-style analysis harness (dev-guide Sections 7.16 and 7.20.19).
 * Node only.
 *
 *   npm run styles                                   # the defaults below
 *   npm run styles -- --rounds 2430 --arenas 3
 *   npm run styles -- --seed 7 --out batch-out/styles
 *   npm run styles -- --styles bastion,cavern
 *
 * The batch harness of `cli/batch.ts` answers "is a tactics preset balanced
 * over the arenas that it is given". This harness answers a different
 * question: **does a style of ground change what wins on it**. It runs one
 * batch per style, over several arenas of that style, and it reports the
 * tactics, the weapons and the mix of roles for each style side by side.
 *
 * A style is measured over several arena seeds, not one. One arena is one roll
 * of the generator, and a result from one arena says nothing about the style.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateArena, ARENA_STYLES } from "../arena/generate.js";
import type { ArenaMetrics } from "../arena/metrics.js";
import { loadArenaProfiles, parseData } from "../core/data.js";
import { createRng, deriveSeed } from "../core/rng.js";
import { BatchConfigSchema } from "../core/schemas.js";
import { runBatch, STANDARD_COMPOSITION, type BatchArena } from "../report/batchRunner.js";
import {
  standardError,
  summarize,
  winRate,
  type BatchSummary,
  type RoundRecord,
  type WinRecord,
} from "../report/batchStats.js";
import { roundsCsv } from "../report/batchTables.js";
import { simConfigFromTuning } from "../sim/index.js";
import type { Role } from "../sim/state.js";

const DEFAULT_CONFIG = "data/batch.json";
const DEFAULT_ROUNDS = 2430;
const DEFAULT_ARENAS = 3;
const DEFAULT_SEED = 20260924;
const DEFAULT_OUT = "batch-out/styles";

interface CliOptions {
  config: string;
  rounds: number;
  arenas: number;
  seed: number;
  out: string;
  styles: string[];
  quiet: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    config: DEFAULT_CONFIG,
    rounds: DEFAULT_ROUNDS,
    arenas: DEFAULT_ARENAS,
    seed: DEFAULT_SEED,
    out: DEFAULT_OUT,
    styles: [...ARENA_STYLES],
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    const number = (): number => {
      if (value === undefined) throw new Error(`${flag} needs a value`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`${flag} needs a number, not "${value}"`);
      return Math.floor(parsed);
    };
    switch (flag) {
      case "--config":
        if (value === undefined) throw new Error("--config needs a value");
        options.config = value;
        i += 1;
        break;
      case "--out":
        if (value === undefined) throw new Error("--out needs a value");
        options.out = value;
        i += 1;
        break;
      case "--styles":
        if (value === undefined) throw new Error("--styles needs a value");
        options.styles = value.split(",").map((name) => name.trim()).filter(Boolean);
        i += 1;
        break;
      case "--rounds":
        options.rounds = number();
        i += 1;
        break;
      case "--arenas":
        options.arenas = number();
        i += 1;
        break;
      case "--seed":
        options.seed = number();
        i += 1;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          "Usage: npm run styles -- [--config file] [--rounds n] [--arenas n]\n" +
            "                         [--seed n] [--out dir] [--styles a,b] [--quiet]\n",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option "${flag}". Use --help.`);
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// The measurements that one style gives
// ---------------------------------------------------------------------------

interface StyleResult {
  style: string;
  arenas: { name: string; metrics: ArenaMetrics }[];
  records: RoundRecord[];
  summary: BatchSummary;
  /** Kills by range band, over the whole style. */
  killsByBand: Map<string, number>;
  /** The mean distance of a kill, in cells. */
  meanKillDistance: number;
  /** Kills, deaths and bot-rounds of each role. */
  byRole: Map<string, { kills: number; deaths: number; botRounds: number }>;
  /** Items taken by kind, per round. */
  pickupsPerRound: Map<string, number>;
  /** Win rate of each tactics preset with each role mix. */
  byPresetComposition: Map<string, WinRecord>;
  /** Rounds that held each archetype, and the kills it made in them. */
  byArchetype: Map<string, { rounds: number; kills: number }>;
}

function bump<K>(map: Map<K, number>, key: K, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function tally(
  map: Map<string, WinRecord>,
  key: string,
  result: "win" | "loss" | "draw",
): void {
  let value = map.get(key);
  if (!value) {
    value = { rounds: 0, wins: 0, losses: 0, draws: 0 };
    map.set(key, value);
  }
  value.rounds += 1;
  if (result === "win") value.wins += 1;
  else if (result === "loss") value.losses += 1;
  else value.draws += 1;
}

function measure(
  style: string,
  arenas: { name: string; metrics: ArenaMetrics }[],
  records: RoundRecord[],
  summary: BatchSummary,
  compositions: Readonly<Record<string, readonly Role[]>>,
): StyleResult {
  const killsByBand = new Map<string, number>();
  const byRole = new Map<string, { kills: number; deaths: number; botRounds: number }>();
  const pickups = new Map<string, number>();
  const byPresetComposition = new Map<string, WinRecord>();
  let distanceSum = 0;
  let kills = 0;

  const byArchetype = new Map<string, { rounds: number; kills: number }>();
  const archetype = (name: string): { rounds: number; kills: number } => {
    let value = byArchetype.get(name);
    if (!value) {
      value = { rounds: 0, kills: 0 };
      byArchetype.set(name, value);
    }
    return value;
  };

  const role = (name: string): { kills: number; deaths: number; botRounds: number } => {
    let value = byRole.get(name);
    if (!value) {
      value = { kills: 0, deaths: 0, botRounds: 0 };
      byRole.set(name, value);
    }
    return value;
  };

  for (const round of records) {
    for (const [band, count] of Object.entries(round.killsByBand)) bump(killsByBand, band, count);
    for (const [kind, count] of Object.entries(round.pickupsByKind)) bump(pickups, kind, count);
    for (const [name, count] of Object.entries(round.killsByRole)) role(name).kills += count;
    for (const [name, count] of Object.entries(round.deathsByRole)) role(name).deaths += count;
    distanceSum += round.killDistanceSum;
    kills += round.scoreA + round.scoreB;

    // A role mix can hold one role twice, so a raw kill count favours the role
    // that has two bots. The bot-rounds are what make the counts comparable.
    for (const name of compositions[round.compA] ?? STANDARD_COMPOSITION) role(name).botRounds += 1;
    for (const name of compositions[round.compB] ?? STANDARD_COMPOSITION) role(name).botRounds += 1;

    // A share of the kills says how much fighting an archetype did. Kills over
    // the rounds that held it say how good it is, which is not the same thing:
    // the generator makes some archetypes far more often than others.
    for (const name of round.weaponArchetypes) archetype(name).rounds += 1;
    for (const [name, count] of Object.entries(round.killsByArchetype)) {
      archetype(name).kills += count;
    }

    const resultA = round.winner === "A" ? "win" : round.winner === "B" ? "loss" : "draw";
    const resultB = round.winner === "B" ? "win" : round.winner === "A" ? "loss" : "draw";
    tally(byPresetComposition, `${round.teamA}|${round.compA}`, resultA);
    tally(byPresetComposition, `${round.teamB}|${round.compB}`, resultB);
  }

  const pickupsPerRound = new Map<string, number>();
  for (const [kind, count] of pickups) {
    pickupsPerRound.set(kind, records.length === 0 ? 0 : count / records.length);
  }

  return {
    style,
    arenas,
    records,
    summary,
    killsByBand,
    meanKillDistance: kills === 0 ? 0 : distanceSum / kills,
    byRole,
    pickupsPerRound,
    byPresetComposition,
    byArchetype,
  };
}

// ---------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------

function pad(text: string, width: number, right: boolean): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

function table(headers: string[], rows: string[][], rightAlign: boolean[] = []): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => pad(cell, widths[column] ?? 0, rightAlign[column] ?? false))
      .join("  ")
      .trimEnd();
  return [
    line(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function rateCell(value: WinRecord | undefined): string {
  if (!value || value.rounds === 0) return "-";
  return `${(winRate(value) * 100).toFixed(1)} ±${(standardError(value) * 100).toFixed(1)}`;
}

function shareRows(counts: Map<string, number>): [string, number][] {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => [name, total === 0 ? 0 : count / total]);
}

function report(results: StyleResult[]): string {
  const parts: string[] = [];
  const styles = results.map((result) => result.style);
  const presets = results[0]?.summary.presets ?? [];
  const compositions = results[0]?.summary.compositions ?? [];

  parts.push(
    "THE GROUND: what the generator built\n" +
      table(
        ["style", "arenas", "floor", "cover", "chokepoints", "mean sightline", "sightline 90"],
        results.map((result) => {
          const n = Math.max(1, result.arenas.length);
          const mean = (read: (m: ArenaMetrics) => number): number =>
            result.arenas.reduce((sum, arena) => sum + read(arena.metrics), 0) / n;
          return [
            result.style,
            String(result.arenas.length),
            percent(mean((m) => m.openAreaRatio)),
            percent(mean((m) => m.coverDensity)),
            mean((m) => m.chokepoints).toFixed(0),
            mean((m) => m.meanSightline).toFixed(1),
            mean((m) => m.sightline90).toFixed(1),
          ];
        }),
        [false, true, true, true, true, true, true],
      ),
  );

  parts.push(
    "THE FIGHT: how a round runs on each style\n" +
      table(
        [
          "style",
          "rounds",
          "mean ticks",
          "mean kills",
          "kill distance",
          "close",
          "mid",
          "long",
          "from behind",
          "hits per shot",
        ],
        results.map((result) => {
          const bands = [...result.killsByBand.values()].reduce((sum, value) => sum + value, 0);
          const share = (band: string): string =>
            bands === 0 ? "-" : percent((result.killsByBand.get(band) ?? 0) / bands);
          return [
            result.style,
            String(result.summary.rounds),
            result.summary.meanTicks.toFixed(0),
            result.summary.meanKills.toFixed(1),
            result.meanKillDistance.toFixed(1),
            share("close"),
            share("mid"),
            share("long"),
            percent(result.summary.unawareKillShare),
            result.summary.hitsPerShot.toFixed(2),
          ];
        }),
        [false, true, true, true, true, true, true, true, true, true],
      ),
  );

  parts.push(
    "TACTICS: win rate of a preset on each style, in percent\n" +
      table(
        ["preset", ...styles],
        presets.map((preset) => [
          preset,
          ...results.map((result) => rateCell(result.summary.byPreset.get(preset))),
        ]),
        [false, ...styles.map(() => true)],
      ),
  );

  parts.push(
    "ROLE MIX: win rate of a composition on each style, in percent\n" +
      table(
        ["composition", ...styles],
        compositions.map((composition) => [
          composition,
          ...results.map((result) => rateCell(result.summary.byComposition.get(composition))),
        ]),
        [false, ...styles.map(() => true)],
      ),
  );

  parts.push(
    "TACTICS x ROLE MIX: win rate of a team that plays both, in percent\n" +
      table(
        ["preset + composition", ...styles],
        presets.flatMap((preset) =>
          compositions.map((composition) => [
            `${preset} + ${composition}`,
            ...results.map((result) =>
              rateCell(result.byPresetComposition.get(`${preset}|${composition}`)),
            ),
          ]),
        ),
        [false, ...styles.map(() => true)],
      ),
  );

  const archetypes = [
    ...new Set(results.flatMap((result) => [...result.summary.killsByArchetype.keys()])),
  ].sort();
  parts.push(
    "WEAPONS: share of the kills of a style, by archetype\n" +
      table(
        ["archetype", ...styles],
        archetypes.map((archetype) => [
          archetype,
          ...results.map((result) => {
            const total = [...result.summary.killsByArchetype.values()].reduce(
              (sum, value) => sum + value,
              0,
            );
            return total === 0
              ? "-"
              : percent((result.summary.killsByArchetype.get(archetype) ?? 0) / total);
          }),
        ]),
        [false, ...styles.map(() => true)],
      ),
  );

  parts.push(
    "WEAPONS: kills in one round that held the archetype, and how often it is made\n" +
      table(
        [
          "archetype",
          ...styles.flatMap((style) => [`${style} in set`, `${style} kills/round`]),
        ],
        archetypes.map((name) => [
          name,
          ...results.flatMap((result) => {
            const value = result.byArchetype.get(name);
            if (!value || value.rounds === 0) {
              // An archetype that no weapon set held still takes kills: the
              // Redeemer comes from a power-up, not from the set.
              const kills = result.summary.killsByArchetype.get(name) ?? 0;
              const rounds = Math.max(1, result.summary.rounds);
              return ["not in a set", (kills / rounds).toFixed(2)];
            }
            return [
              percent(value.rounds / Math.max(1, result.summary.rounds)),
              (value.kills / value.rounds).toFixed(2),
            ];
          }),
        ]),
        [false, ...styles.flatMap(() => [true, true])],
      ),
  );

  const roles = [
    ...new Set(results.flatMap((result) => [...result.byRole.keys()])),
  ].sort();
  parts.push(
    "ROLES: kills for each bot-round of the role, and kills over deaths\n" +
      table(
        ["role", ...styles.flatMap((style) => [`${style} k/bot`, `${style} k/d`])],
        roles.map((role) => [
          role,
          ...results.flatMap((result) => {
            const value = result.byRole.get(role);
            if (!value || value.botRounds === 0) return ["-", "-"];
            return [
              (value.kills / value.botRounds).toFixed(2),
              value.deaths === 0 ? "-" : (value.kills / value.deaths).toFixed(2),
            ];
          }),
        ]),
        [false, ...styles.flatMap(() => [true, true])],
      ),
  );

  const kinds = [
    ...new Set(results.flatMap((result) => [...result.pickupsPerRound.keys()])),
  ].sort();
  parts.push(
    "ITEMS: items taken in one round, by kind\n" +
      table(
        ["style", ...kinds],
        results.map((result) => [
          result.style,
          ...kinds.map((kind) => (result.pickupsPerRound.get(kind) ?? 0).toFixed(1)),
        ]),
        [false, ...kinds.map(() => true)],
      ),
  );

  for (const result of results) {
    const reasons = shareRows(
      new Map([...result.summary.byReason].map(([reason, count]) => [String(reason), count])),
    );
    parts.push(
      `HOW A ROUND ON ${result.style.toUpperCase()} ENDS\n` +
        table(
          ["reason", "share"],
          reasons.map(([reason, share]) => [reason, percent(share)]),
          [false, true],
        ),
    );
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const text = readFileSync(resolve(options.config), "utf8");
  const config = parseData(options.config, BatchConfigSchema, JSON.parse(text) as unknown);
  const profiles = loadArenaProfiles();
  const simConfig = simConfigFromTuning();
  const results: StyleResult[] = [];
  const started = Date.now();

  for (const style of options.styles) {
    const profile = profiles.profiles[style];
    if (!profile) throw new Error(`Unknown arena style "${style}".`);

    // One style, several arenas. The seed of each arena comes from the seed of
    // the batch, so the whole analysis replays from one number (Section 7.1).
    const arenas: BatchArena[] = [];
    const metrics: { name: string; metrics: ArenaMetrics }[] = [];
    for (let i = 0; i < options.arenas; i += 1) {
      const seed = deriveSeed(options.seed, `${style}:arena:${i}`);
      const map = generateArena(profile, createRng(seed, "arena"), seed, {
        rules: profiles.rules,
      });
      const name = `${style}-${i}`;
      arenas.push({ name, map });
      metrics.push({ name, metrics: map.metrics });
    }

    // `planRounds` walks the cells in order and starts again at the top. A
    // round count that is not a whole number of passes gives the first cells
    // one round more than the last, which tilts every table by a little.
    const presetCount = Object.keys(config.presets).length;
    const compCount = Math.max(1, Object.keys(config.compositions ?? {}).length);
    const cells = arenas.length * presetCount * presetCount * compCount * compCount;
    if (!options.quiet) {
      process.stderr.write(`\n${style}: ${options.rounds} rounds over ${arenas.length} arenas\n`);
      if (options.rounds % cells !== 0) {
        process.stderr.write(
          `  ! ${options.rounds} is not a multiple of the ${cells} cells of the plan, ` +
            `so some cells get one round more than others.\n`,
        );
      }
    }
    const records = runBatch({
      arenas,
      presets: config.presets,
      compositions: config.compositions,
      rounds: options.rounds,
      seed: deriveSeed(options.seed, `style:${style}`),
      config: simConfig,
      onProgress: options.quiet
        ? undefined
        : (done, total) => {
            if (done !== total && done % 50 !== 0) return;
            const elapsed = (Date.now() - started) / 1000;
            process.stderr.write(`\r  ${done}/${total} rounds, ${elapsed.toFixed(0)} s elapsed `);
            if (done === total) process.stderr.write("\n");
          },
    });
    const summary = summarize(records, {
    scoreLimit: simConfig.scoreLimit,
    ticksPerSecond: simConfig.ticksPerSecond,
  });
    results.push(measure(style, metrics, records, summary, config.compositions ?? {}));
  }

  const text2 = report(results);
  process.stdout.write(`${text2}\n`);

  mkdirSync(resolve(options.out), { recursive: true });
  writeFileSync(resolve(options.out, "report.txt"), `${text2}\n`, "utf8");
  for (const result of results) {
    writeFileSync(
      resolve(options.out, `rounds-${result.style}.csv`),
      roundsCsv(result.records),
      "utf8",
    );
  }
  const seconds = (Date.now() - started) / 1000;
  const rounds = results.reduce((sum, result) => sum + result.records.length, 0);
  process.stdout.write(
    `\n${rounds} rounds in ${(seconds / 60).toFixed(1)} min ` +
      `(${((seconds / Math.max(1, rounds)) * 1000).toFixed(0)} ms per round).\n` +
      `Written to ${options.out}/.\n`,
  );
}

main();
