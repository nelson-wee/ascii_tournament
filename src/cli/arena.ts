/**
 * Look at a generated arena (dev-guide Section 7.2). Node only.
 *
 *   npm run arena                          # one of each style
 *   npm run arena -- --style cavern --seed 7
 *   npm run arena -- --style openfield --count 3
 *   npm run arena -- --stats 40            # metrics over 40 seeds per style
 *
 * It prints the arena as text in the glyphs of Section 7.2, and then its
 * metrics. The text is the same format that `data/arenas/*.txt` uses, so a
 * generated arena can be saved and hand-edited.
 */
import { createRng, deriveSeed } from "../core/rng.js";
import { loadArenaProfiles } from "../core/data.js";
import { ARENA_STYLES, generateArena, type ArenaStyle, type GeneratedArena } from "../arena/generate.js";
import { describeArena, type ArenaMetrics } from "../arena/metrics.js";
import { arenaToText } from "../arena/textArena.js";

interface Options {
  style: ArenaStyle | null;
  seed: number;
  count: number;
  stats: number;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { style: null, seed: 1, count: 1, stats: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--style" && value) {
      if (!(ARENA_STYLES as readonly string[]).includes(value)) {
        throw new Error(`Unknown style "${value}". Use one of ${ARENA_STYLES.join(", ")}.`);
      }
      options.style = value as ArenaStyle;
      i += 1;
    } else if (flag === "--seed" && value) {
      options.seed = Number(value);
      i += 1;
    } else if (flag === "--count" && value) {
      options.count = Number(value);
      i += 1;
    } else if (flag === "--stats" && value) {
      options.stats = Number(value);
      i += 1;
    }
  }
  return options;
}

function build(style: ArenaStyle, seed: number): GeneratedArena {
  const data = loadArenaProfiles();
  const profile = data.profiles[style];
  if (!profile) throw new Error(`data/arena-profiles.json has no profile "${style}"`);
  return generateArena(profile, createRng(deriveSeed(seed, `arena:${style}`), "arena"), seed, {
    rules: data.rules,
  });
}

function row(values: (string | number)[], widths: number[]): string {
  return values.map((value, i) => String(value).padStart(widths[i] ?? 8)).join("  ");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const styles = options.style ? [options.style] : [...ARENA_STYLES];

  if (options.stats > 0) {
    const widths = [10, 7, 7, 7, 7, 7, 8, 8, 8, 7];
    console.log(
      row(
        ["style", "floor", "open%", "cover%", "cycles", "chokes", "sight", "sight90", "longest", "fair"],
        widths,
      ),
    );
    for (const style of styles) {
      const runs: ArenaMetrics[] = [];
      for (let seed = 1; seed <= options.stats; seed += 1) runs.push(build(style, seed).metrics);
      const mean = (pick: (m: (typeof runs)[number]) => number): number =>
        runs.reduce((sum, m) => sum + pick(m), 0) / runs.length;
      console.log(
        row(
          [
            style,
            mean((m) => m.floorCells).toFixed(0),
            (mean((m) => m.openAreaRatio) * 100).toFixed(0),
            (mean((m) => m.coverDensity) * 100).toFixed(1),
            mean((m) => m.floorCycles).toFixed(0),
            mean((m) => m.chokepoints).toFixed(0),
            mean((m) => m.meanSightline).toFixed(1),
            mean((m) => m.sightline90).toFixed(1),
            mean((m) => m.longestSightline).toFixed(1),
            mean((m) => m.spawnFairness).toFixed(1),
          ],
          widths,
        ),
      );
    }
    return;
  }

  for (const style of styles) {
    for (let i = 0; i < options.count; i += 1) {
      const map = build(style, options.seed + i);
      console.log(arenaToText(map));
      console.log(describeArena(map.metrics).join(" "));
      console.log(
        `floor ${map.metrics.floorCells}  open ${(map.metrics.openAreaRatio * 100).toFixed(0)} %  ` +
          `cycles ${map.metrics.floorCycles}  chokepoints ${map.metrics.chokepoints}  ` +
          `sightline 10th ${map.metrics.sightline10} / mean ${map.metrics.meanSightline.toFixed(1)} / 90th ${map.metrics.sightline90} / longest ${map.metrics.longestSightline}  ` +
          `spawn fairness ${map.metrics.spawnFairness}\n`,
      );
    }
  }
}

main();
