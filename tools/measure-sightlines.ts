/**
 * How far can two bots actually see each other? (dev-guide Section 7.30)
 *
 * The range bands were set by hand and the long one begins at 20 cells, which
 * is exactly `perception.sightRadiusCells`. A band that starts where vision
 * ends cannot be fought in, and the three sweeps of Section 7.29 measured it:
 * 6 %, 1 % and 7 % of kills.
 *
 * This derives the boundaries from the ground instead of setting them by hand.
 * For a sample of floor cells it asks which other floor cells they can see, by
 * the same rule the simulation shoots by — only a wall blocks — and reports the
 * distribution of those distances.
 *
 * It runs no rounds. Usage:
 *
 *     npx tsx tools/measure-sightlines.ts [arenas-per-style]
 */
import { generateArena } from "../src/arena/generate.js";
import { Tile, tileAt, type ArenaMap } from "../src/arena/types.js";
import { loadArenaProfiles } from "../src/core/data.js";
import { createRng, deriveSeed } from "../src/core/rng.js";
import type { Cell } from "../src/core/types.js";

const SEED = 20260929;
const ARENAS = Number(process.argv[2] ?? 6);
/** Floor cells sampled per arena. Every pair of them is tested. */
const SAMPLE = 260;

/**
 * True when nothing blocks the straight line between two cell centres.
 *
 * It walks the line the way `clearLine` does, so what this counts as visible is
 * what a weapon can shoot along.
 */
function canSee(map: ArenaMap, a: Cell, b: Cell): boolean {
  const ax = a.x + 0.5;
  const ay = a.y + 0.5;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.ceil(distance * 2);
  for (let i = 1; i < steps; i += 1) {
    const x = ax + (dx * i) / steps;
    const y = ay + (dy * i) / steps;
    if (tileAt(map, Math.floor(x), Math.floor(y)) === Tile.Wall) return false;
  }
  return true;
}

/** Take at most `count` cells, spread evenly, so the answer is repeatable. */
function sample(cells: readonly Cell[], count: number): Cell[] {
  if (cells.length <= count) return [...cells];
  const stride = cells.length / count;
  const out: Cell[] = [];
  for (let i = 0; i < count; i += 1) out.push(cells[Math.floor(i * stride)] as Cell);
  return out;
}

function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
  return sorted[at] as number;
}

const profiles = loadArenaProfiles();
const STYLES = ["bastion", "openfield", "cavern"] as const;
const all: number[] = [];

console.log(
  "HOW FAR TWO CELLS SEE EACH OTHER, over every visible pair of a sample\n" +
    `${ARENAS} arenas a style, ${SAMPLE} cells an arena\n`,
);
console.log(
  `${"style".padEnd(11)}${"pairs".padStart(9)}${"visible".padStart(9)}` +
    `${"p50".padStart(7)}${"p75".padStart(7)}${"p90".padStart(7)}${"p95".padStart(7)}` +
    `${"p99".padStart(7)}${"max".padStart(7)}`,
);

const byStyle = new Map<string, number[]>();
for (const style of STYLES) {
  const profile = profiles.profiles[style];
  if (!profile) continue;
  const seen: number[] = [];
  let pairs = 0;

  for (let a = 0; a < ARENAS; a += 1) {
    const seed = deriveSeed(SEED, `${style}:arena:${a}`);
    const map = generateArena(profile, createRng(seed, "arena"), seed, { rules: profiles.rules });
    const floor: Cell[] = [];
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (tileAt(map, x, y) !== Tile.Wall) floor.push({ x, y });
      }
    }
    const cells = sample(floor, SAMPLE);
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        pairs += 1;
        const one = cells[i] as Cell;
        const two = cells[j] as Cell;
        if (!canSee(map, one, two)) continue;
        seen.push(Math.hypot(two.x - one.x, two.y - one.y));
      }
    }
  }

  seen.sort((x, y) => x - y);
  byStyle.set(style, seen);
  all.push(...seen);
  console.log(
    `${style.padEnd(11)}${String(pairs).padStart(9)}` +
      `${`${((seen.length / pairs) * 100).toFixed(1)} %`.padStart(9)}` +
      `${percentile(seen, 0.5).toFixed(1).padStart(7)}` +
      `${percentile(seen, 0.75).toFixed(1).padStart(7)}` +
      `${percentile(seen, 0.9).toFixed(1).padStart(7)}` +
      `${percentile(seen, 0.95).toFixed(1).padStart(7)}` +
      `${percentile(seen, 0.99).toFixed(1).padStart(7)}` +
      `${percentile(seen, 1).toFixed(1).padStart(7)}`,
  );
}

all.sort((x, y) => x - y);
console.log(
  `${"ALL".padEnd(11)}${"".padStart(9)}${"".padStart(9)}` +
    `${percentile(all, 0.5).toFixed(1).padStart(7)}` +
    `${percentile(all, 0.75).toFixed(1).padStart(7)}` +
    `${percentile(all, 0.9).toFixed(1).padStart(7)}` +
    `${percentile(all, 0.95).toFixed(1).padStart(7)}` +
    `${percentile(all, 0.99).toFixed(1).padStart(7)}` +
    `${percentile(all, 1).toFixed(1).padStart(7)}`,
);

// What the bands hold today, and what they would hold at the quartile.
const share = (list: readonly number[], lo: number, hi: number): string => {
  const n = list.filter((d) => d > lo && d <= hi).length;
  return `${((n / Math.max(1, list.length)) * 100).toFixed(1)} %`;
};
const p75 = percentile(all, 0.75);
console.log(`\nWHAT EACH BAND HOLDS, over every visible pair`);
console.log(`${"style".padEnd(11)}${"close ≤8".padStart(11)}${"mid ≤20".padStart(11)}${"long >20".padStart(11)}` +
  `  |  ${`close ≤8`.padStart(9)}${`mid ≤${p75.toFixed(0)}`.padStart(10)}${`long >${p75.toFixed(0)}`.padStart(11)}`);
for (const style of STYLES) {
  const list = byStyle.get(style) ?? [];
  console.log(
    `${style.padEnd(11)}${share(list, 0, 8).padStart(11)}${share(list, 8, 20).padStart(11)}` +
      `${share(list, 20, Infinity).padStart(11)}  |  ` +
      `${share(list, 0, 8).padStart(9)}${share(list, 8, p75).padStart(10)}${share(list, p75, Infinity).padStart(11)}`,
  );
}
