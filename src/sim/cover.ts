/**
 * Cover: what stands between a bot and the shot (dev-guide Section 7.32).
 *
 * Low cover used to be decoration. `isInCover` had one reader in the whole
 * codebase, the `killerInCover` field of the `Kill` event, so a `,` tile changed
 * no hit chance, no damage and no decision (Section 7.31.3).
 *
 * This gives it a mechanic, built on one rule:
 *
 * > **Cover is what is between you and the shooter.**
 *
 * The tile a bot stands on shields it from nothing. Only a cover tile on the
 * line of fire counts, and only the first `cover.depthCells` of that line. So
 * a cover tile is a screen against one arc and no others, which is what makes
 * a move around an enemy worth making: the same tile that stopped half the
 * shots from the south stops none from the east.
 *
 * That also keeps the rule of `blocksSight` intact. A cover tile a bot stands
 * on is a shooting position, not a screen. A cover tile in front of it is a
 * screen, not a shooting position.
 *
 * The protection grows with the range band, because a shooter far away has
 * little angle over a low wall and a shooter at arm's length has all of it.
 * `cover.bandFactor` holds the three numbers.
 *
 * It holds no browser API and no RNG: it is geometry, and the caller rolls.
 */
import { Tile, tileAt, type ArenaMap } from "../arena/types.js";
import type { Cell } from "../core/types.js";
import type { RangeBand } from "../weapons/types.js";
import { rangeBandOf } from "./damage.js";
import { botCell, distanceBetween, type BotState, type SimState } from "./state.js";

/**
 * The attack types that a low wall does not stop (Section 7.32.7).
 *
 * A blast does not need a clear line to the bot, only to the ground beside it,
 * so the wall it goes over is not a screen. Cover still counts against it —
 * a bot pressed against a wall is harder to reach even with a blast — but only
 * at the close-range rate, whatever the real distance.
 *
 * These two attack types are exactly the `splash` archetype: `archetypeOf` maps
 * cone and burst to it and nothing else to it. The set is keyed on the attack
 * type and not the archetype because the mechanic is the shape of the shot, not
 * the name of the weapon.
 *
 * `tile` is absent because a hazard damages through the `hazard` source, which
 * cover never shields at all.
 */
const SPLASH_ATTACK_TYPES: ReadonlySet<string> = new Set(["cone", "burst"]);

/** True if a low wall does not stop this shot (Section 7.32.7). */
export function splashesPastCover(attackType: string | undefined): boolean {
  return attackType !== undefined && SPLASH_ATTACK_TYPES.has(attackType);
}

/** The numbers that decide what cover is worth. `SimConfig.cover` holds them. */
export interface CoverConfig {
  depthCells: number;
  stepFalloff: number;
  bandFactor: { close: number; mid: number; long: number };
  aiWeight: number;
}

/**
 * How much the cover in front of `at` shields it from a shot out of `from`,
 * from 0 (open ground) to 1 (a full screen).
 *
 * It walks the line of fire out of `at` toward `from` and reads the first
 * `depthCells` cells of it. The cell `at` itself never counts. A nearer cover
 * tile is worth more than a further one, by `stepFalloff`.
 *
 * A wall ends the walk. A wall already stops the shot, so cover behind one is
 * not this function's business.
 */
export function coverAgainst(
  map: ArenaMap,
  cover: CoverConfig,
  at: Cell,
  from: Cell,
): number {
  const dx = from.x - at.x;
  const dy = from.y - at.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return 0;

  const depth = Math.min(cover.depthCells, distance);
  // Two samples a cell, the same rate `clearLine` walks at, so the cells this
  // reads are the cells the shot passes through.
  const steps = Math.max(1, Math.ceil(depth * 2));
  let shield = 0;
  let lastX = at.x;
  let lastY = at.y;
  let reached = 0;

  for (let i = 1; i <= steps; i += 1) {
    const along = (depth * i) / steps;
    const x = Math.floor(at.x + 0.5 + (dx / distance) * along);
    const y = Math.floor(at.y + 0.5 + (dy / distance) * along);
    if (x === lastX && y === lastY) continue;
    lastX = x;
    lastY = y;
    const tile = tileAt(map, x, y);
    if (tile === Tile.Wall) break;
    reached += 1;
    if (tile === Tile.CoverLow) shield += cover.stepFalloff ** (reached - 1);
  }

  return Math.min(1, shield);
}

/**
 * The share of shots that the cover in front of `target` stops, against a shot
 * out of `from`, at `distance` cells.
 *
 * This is the number the simulation rolls against, and the number the AI reads
 * when it compares one cell with another.
 */
export function coverSaveAt(
  state: SimState,
  target: Cell,
  from: Cell,
  distance: number,
  attackType?: string,
): number {
  const { cover } = state.config;
  const shield = coverAgainst(state.map, cover, target, from);
  if (shield <= 0) return 0;
  // `coverAgainst` answers at most 1, so `bandFactor` is itself the ceiling of
  // the save. A second ceiling below it would only hide the difference between
  // the mid band and the long one, which is the whole point of the three.
  return shield * cover.bandFactor[coverBandOf(state, distance, attackType)];
}

/**
 * The band that decides what cover is worth against one shot.
 *
 * It is the band of the distance, except for a shot that goes over the wall
 * rather than through the gap above it. A blast counts as close range however
 * far it flew, which is what makes a splash weapon the answer to a bot that
 * holds cover at long range (Section 7.32.7).
 */
export function coverBandOf(
  state: SimState,
  distance: number,
  attackType?: string,
): RangeBand {
  return splashesPastCover(attackType) ? "close" : rangeBandOf(state, distance);
}

/** The share of shots that cover stops, for one shot at one bot. */
export function coverSave(
  state: SimState,
  attacker: BotState,
  target: BotState,
  attackType?: string,
): number {
  return coverSaveAt(
    state,
    botCell(target),
    botCell(attacker),
    distanceBetween(attacker, target),
    attackType,
  );
}

/**
 * The worst cover a bot has against the enemies it can see, from 0 to 1.
 *
 * "Worst" and not "mean", because the bot that shoots you is the one you are
 * not shielded from. A cell that hides a bot from two enemies and leaves it
 * open to a third is an open cell.
 *
 * It reads the weapon each enemy holds, so an enemy with a blast gives the cell
 * the close-range save and not the long-range one. Without that the bot would
 * value a screen that the weapon pointed at it ignores, which is the defect of
 * Section 7.31: a number the AI reads that does not mean what its name says.
 *
 * With no enemy in sight it gives 0: cover against nobody is worth nothing, the
 * same rule `contactFactor` uses for holding a sightline that nothing crosses.
 */
export function coverFromVisible(state: SimState, bot: BotState, at: Cell): number {
  let worst = 1;
  let seen = 0;
  for (const id of bot.visibleEnemyIds) {
    const enemy = state.bots.find((candidate) => candidate.id === id);
    if (!enemy?.alive) continue;
    seen += 1;
    const from = botCell(enemy);
    const distance = Math.hypot(from.x - at.x, from.y - at.y);
    const save = coverSaveAt(state, at, from, distance, enemy.weapon.attackType);
    if (save < worst) worst = save;
  }
  return seen === 0 ? 0 : worst;
}
