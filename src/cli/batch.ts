/**
 * The batch harness (dev-guide Section 7.16). Node only.
 *
 *   npm run batch                          # data/batch.json
 *   npm run batch -- --config my.json
 *   npm run batch -- --rounds 200 --seed 7
 *   npm run batch -- --out results --quiet
 *   npm run batch -- --fail-on-balance       # a gate for a workflow
 *
 * It runs rounds with no display, prints the tables, and writes the CSV files.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArenaText } from "../arena/textArena.js";
import type { ArenaMap } from "../arena/types.js";
import { parseData } from "../core/data.js";
import { BatchConfigSchema, type BatchConfig } from "../core/schemas.js";
import { runBatch, type BatchArena } from "../report/batchRunner.js";
import { summarize } from "../report/batchStats.js";
import { formatReport, matchupsCsv, presetsCsv, roundsCsv } from "../report/batchTables.js";
import { simConfigFromTuning } from "../sim/index.js";

interface CliOptions {
  config: string;
  rounds: number | null;
  seed: number | null;
  out: string | null;
  quiet: boolean;
  failOnBalance: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    config: "data/batch.json",
    rounds: null,
    seed: null,
    out: null,
    quiet: false,
    failOnBalance: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--config":
      case "--rounds":
      case "--seed":
      case "--out":
        if (value === undefined) throw new Error(`${flag} needs a value`);
        i += 1;
        if (flag === "--config") options.config = value;
        else if (flag === "--out") options.out = value;
        else {
          const number = Number(value);
          if (!Number.isFinite(number)) throw new Error(`${flag} needs a number, not "${value}"`);
          if (flag === "--rounds") options.rounds = Math.floor(number);
          else options.seed = Math.floor(number);
        }
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--fail-on-balance":
        options.failOnBalance = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          "Usage: npm run batch -- [--config file] [--rounds n] [--seed n] [--out dir]\n" +
            "                        [--quiet] [--fail-on-balance]\n",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option "${flag}". Use --help.`);
    }
  }
  return options;
}

function loadConfig(path: string): BatchConfig {
  const text = readFileSync(resolve(path), "utf8");
  return parseData(path, BatchConfigSchema, JSON.parse(text) as unknown);
}

function loadArena(path: string): BatchArena {
  const text = readFileSync(resolve(path), "utf8");
  const map: ArenaMap = parseArenaText(text, { source: path });
  return { name: basename(path, ".txt"), map };
}

/** A progress line that stays on one row. */
function progress(done: number, total: number, startedMs: number): void {
  if (done !== total && done % 25 !== 0) return;
  const share = done / total;
  const elapsed = (Date.now() - startedMs) / 1000;
  const left = share > 0 ? elapsed / share - elapsed : 0;
  const bar = "#".repeat(Math.round(share * 24)).padEnd(24, ".");
  process.stderr.write(
    `\r[${bar}] ${done}/${total} rounds  ${elapsed.toFixed(0)}s elapsed, ${left.toFixed(0)}s left `,
  );
  if (done === total) process.stderr.write("\n");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options.config);
  const rounds = options.rounds ?? config.rounds;
  const seed = options.seed ?? config.seed;
  const outDir = options.out ?? config.outDir;

  const arenas = config.arenas.map(loadArena);
  const simConfig = simConfigFromTuning();

  if (!options.quiet) {
    process.stderr.write(
      `Batch: ${rounds} rounds, seed ${seed}, ${arenas.length} arena(s), ` +
        `${Object.keys(config.presets).length} presets\n`,
    );
  }

  const started = Date.now();
  const records = runBatch({
    arenas,
    presets: config.presets,
    rounds,
    seed,
    config: simConfig,
    onProgress: options.quiet ? undefined : (done, total) => progress(done, total, started),
  });
  const seconds = (Date.now() - started) / 1000;

  const summary = summarize(records, { scoreLimit: simConfig.scoreLimit });
  process.stdout.write(`${formatReport(summary)}\n`);

  mkdirSync(resolve(outDir), { recursive: true });
  const files: [string, string][] = [
    ["rounds.csv", roundsCsv(records)],
    ["matchups.csv", matchupsCsv(summary)],
    ["presets.csv", presetsCsv(summary)],
  ];
  for (const [name, text] of files) writeFileSync(resolve(outDir, name), text, "utf8");

  process.stdout.write(
    `\n${records.length} rounds in ${seconds.toFixed(1)} s ` +
      `(${((seconds / Math.max(1, records.length)) * 1000).toFixed(0)} ms per round).\n` +
      `CSV files: ${files.map(([name]) => `${outDir}/${name}`).join(", ")}\n`,
  );

  // The report is the product. A workflow that wants a gate asks for one.
  if (options.failOnBalance && summary.balanceFailures.length > 0) process.exitCode = 1;
}

main();
