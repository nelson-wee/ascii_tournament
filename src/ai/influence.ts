/**
 * Influence maps (dev-guide Section 7.9).
 *
 * Two grids, one value per cell:
 *
 * - `danger`: the sightlines of live enemies, the hazard tiles, and the cells
 *   where bots died not long ago.
 * - `control`: which team holds a cell. Above zero means team A, below zero
 *   means team B.
 *
 * The maps update every `influenceIntervalTicks` ticks, not every tick.
 *
 * **What is missing until M7.** Section 7.9 says that `control` is "which team
 * holds each area". An area means a room of the macro graph, and the arena has
 * no macro graph yet (Section 7.2 arrives with M7). The map therefore works on
 * the raw grid: a cell, not a room. When M7 gives the arena its rooms, a room
 * value is the mean of its cells.
 */
import { Tile, cellIndex, inBounds, isWalkable, tileAt } from "../arena/types.js";
import type { ArenaMap } from "../arena/types.js";
import type { Cell } from "../core/types.js";
import { botCell, type BotState, type SimState } from "../sim/state.js";

export interface InfluenceMaps {
  width: number;
  height: number;
  /** 0 = safe. It rises with the danger. */
  danger: Float32Array;
  /** Above 0 = team A holds the cell. Below 0 = team B. */
  control: Float32Array;
  /** The tick of the last update. */
  updatedAtTick: number;
}

export function createInfluenceMaps(map: ArenaMap): InfluenceMaps {
  const cells = map.width * map.height;
  return {
    width: map.width,
    height: map.height,
    danger: new Float32Array(cells),
    control: new Float32Array(cells),
    updatedAtTick: -1,
  };
}

/** The danger of one cell. */
export function dangerAt(maps: InfluenceMaps, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= maps.width || y >= maps.height) return 0;
  return maps.danger[y * maps.width + x] ?? 0;
}

/** The control of one cell. Above 0 = team A. */
export function controlAt(maps: InfluenceMaps, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= maps.width || y >= maps.height) return 0;
  return maps.control[y * maps.width + x] ?? 0;
}

/** Spread a value around a cell, falling to nothing at the radius. */
function stamp(
  grid: Float32Array,
  map: ArenaMap,
  centre: Cell,
  radius: number,
  amount: number,
): void {
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const x = centre.x + dx;
      const y = centre.y + dy;
      if (!inBounds(map, x, y) || !isWalkable(tileAt(map, x, y))) continue;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const share = 1 - distance / radius;
      const index = cellIndex(map, x, y);
      grid[index] = (grid[index] ?? 0) + amount * share;
    }
  }
}

/**
 * Update both maps.
 *
 * A live enemy makes danger around itself and along the cells that it can see.
 * A hazard tile makes danger where it stands. A recent death makes danger where
 * it happened. Each live bot gives control to its team around itself.
 */
export function updateInfluence(state: SimState): void {
  const maps = state.influence;
  if (maps.updatedAtTick >= 0 && state.tick - maps.updatedAtTick < state.config.influenceIntervalTicks) {
    return;
  }
  maps.updatedAtTick = state.tick;
  maps.danger.fill(0);
  maps.control.fill(0);

  const { map, config } = state;

  for (const bot of state.bots) {
    if (!bot.alive) continue;
    const cell = botCell(bot);
    // Control: a bot holds the ground around it, for its team.
    stamp(maps.control, map, cell, config.influenceControlRadius, bot.teamId === "A" ? 1 : -1);
    // Danger: an enemy is dangerous near itself, and along what it can see.
    stamp(maps.danger, map, cell, config.influenceDangerRadius, config.influenceBotDanger);
  }

  // A cell that an enemy can see is dangerous, whatever the distance.
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const index = cellIndex(map, x, y);
        if (!bot.visibleCells.has(index)) continue;
        maps.danger[index] = (maps.danger[index] ?? 0) + config.influenceSightDanger;
      }
    }
  }

  // The hazard tiles of Section 7.6.
  for (const [index] of state.hazards) {
    maps.danger[index] = (maps.danger[index] ?? 0) + config.influenceHazardDanger;
  }
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (tileAt(map, x, y) !== Tile.Hazard) continue;
      const index = cellIndex(map, x, y);
      maps.danger[index] = (maps.danger[index] ?? 0) + config.influenceHazardDanger;
    }
  }

  // A cell where a bot died not long ago.
  for (const death of state.recentDeaths) {
    if (state.tick - death.tick > config.influenceDeathMemoryTicks) continue;
    const age = 1 - (state.tick - death.tick) / config.influenceDeathMemoryTicks;
    stamp(maps.danger, map, death.cell, config.influenceDeathRadius, config.influenceDeathDanger * age);
  }
}

/**
 * How dangerous a cell is for one bot, after its `hazardTolerance` tactic.
 * Section 7.9: the tactic controls how much a bot avoids danger.
 */
export function dangerFor(state: SimState, bot: BotState, cell: Cell): number {
  // Only `hazardTolerance` decides how much danger a bot sees. Letting
  // `aggression` discount it as well was measured and reverted: a bold bot
  // walked into danger and died, and aggression 0.9 lost 17 points of win rate
  // to aggression 0.1 (Section 7.20.16). Danger is about the ground; the job of
  // aggression is in the fight, in `effectiveReaction`.
  return dangerAt(state.influence, cell.x, cell.y) * (1 - bot.tactics.hazardTolerance);
}
