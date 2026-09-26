/**
 * `run.json`: what made a batch (dev-guide Section 7.23). Node only.
 *
 * Every round record already carries a seed, and the engine is deterministic,
 * so a seed re-runs a round and gives back the event log that was never
 * written down. **A seed does that only against the same engine and the same
 * data.** Both moved several times while the side bias of Section 7.20.26 was
 * hunted, so the seeds in an older `rounds.csv` still run and give a different
 * round. This file is the other half of the key.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeVersion, dataFingerprint } from "../core/build.js";

export interface RunInfo {
  /** When the batch ran, so two runs of the same seed sort. */
  ranAt: string;
  /** The commit, with `+` when the tree had changes that it does not hold. */
  commit: string;
  /** A hash of every data file a generator reads. */
  dataFingerprint: string;
  /** The seed of the batch. Each round takes a sub-seed from it. */
  seed: number;
  rounds: number;
  /** The config file that the batch ran, as it was read. */
  config: unknown;
  /** What to do with this file, for a reader who finds it alone. */
  note: string;
}

/**
 * The commit of the working tree, or "dev".
 *
 * A tree with changes in it is not a version, so it gets a `+`. Without that
 * mark a `run.json` would name a commit that does not match the code that ran.
 */
function commitOf(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return status === "" ? head : `${head}+`;
  } catch {
    // No git, or no repository. The build id still holds the data hash.
    return codeVersion();
  }
}

export function makeRunInfo(options: {
  seed: number;
  rounds: number;
  config: unknown;
}): RunInfo {
  return {
    ranAt: new Date().toISOString(),
    commit: commitOf(),
    dataFingerprint: dataFingerprint(),
    seed: options.seed,
    rounds: options.rounds,
    config: options.config,
    note:
      "A seed in rounds.csv re-runs its round only against this commit and this " +
      "data fingerprint. A different commit or fingerprint gives a different round.",
  };
}

/** Write `run.json` beside the CSV files of a batch. */
export function writeRunInfo(outDir: string, info: RunInfo): void {
  writeFileSync(resolve(outDir, "run.json"), `${JSON.stringify(info, null, 2)}\n`, "utf8");
}
