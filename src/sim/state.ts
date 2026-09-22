/**
 * Simulation state (dev-guide Section 7.4).
 *
 * Milestone M2 holds only what movement needs. Health, weapons, ammo, and the
 * score arrive with M3. The full `Bot` of Section 6.4 (role, attributes,
 * tactics, affinities, traits) arrives with its own milestones, and a
 * `BotState` then points at it.
 */
import type { ArenaMap } from "../arena/types.js";
import { loadTuning } from "../core/data.js";
import type { Tuning } from "../core/schemas.js";
import { EventBus } from "../core/events.js";
import { createRng, type Rng } from "../core/rng.js";
import type { Cell, Vec2 } from "../core/types.js";

/** Team ids of Milestone M2. Generated team names arrive with M11. */
export const TEAM_IDS = ["A", "B"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export interface BotState {
  id: string;
  teamId: TeamId;
  /** Sub-cell position. The centre of cell (x, y) is (x + 0.5, y + 0.5). */
  pos: Vec2;
  /** Cells that the bot crosses in one tick. */
  moveSpeedPerTick: number;
  /** The cells that are left of the current path. The first is the next one. */
  path: Cell[];
  /** The `slotId` of the pickup point that the bot moves to. */
  goalSlotId: string | null;
}

export interface SimConfig {
  ticksPerSecond: number;
  teamSize: number;
  moveSpeedPerTick: number;
}

export interface SimState {
  /** The number of ticks that ran. The first `step` makes this 1. */
  tick: number;
  roundNumber: number;
  map: ArenaMap;
  config: SimConfig;
  bots: BotState[];
  rng: Rng;
  bus: EventBus;
}

export interface CreateSimStateOptions {
  map: ArenaMap;
  /** The seed of the round. Use `deriveSeed(matchSeed, "round:N")`. */
  seed: number;
  roundNumber?: number;
  config?: SimConfig;
  bus?: EventBus;
}

/** Read the simulation numbers from `data/tuning.json`. */
export function simConfigFromTuning(tuning: Tuning = loadTuning()): SimConfig {
  return {
    ticksPerSecond: tuning.simulation.ticksPerSecond,
    teamSize: tuning.match.teamSize,
    moveSpeedPerTick: tuning.movement.moveSpeedCellsPerSecond / tuning.simulation.ticksPerSecond,
  };
}

/** The centre of a cell. */
export function cellCenter(cell: Cell): Vec2 {
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

/** The cell that holds a sub-cell position. */
export function posCell(pos: Vec2): Cell {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y) };
}

/** The cell of a bot. The display shows the bot in this cell. */
export function botCell(bot: BotState): Cell {
  return posCell(bot.pos);
}

/**
 * Build the state of one round.
 *
 * Spawn rule of M2: the first `teamSize` spawn cells of the arena belong to
 * team A, and the next `teamSize` cells belong to team B. The arena file sets
 * the order. A fair split by distance arrives with the arena generator (M7).
 */
export function createSimState(options: CreateSimStateOptions): SimState {
  const { map, seed } = options;
  const roundNumber = options.roundNumber ?? 1;
  const config = options.config ?? simConfigFromTuning();
  const bus = options.bus ?? new EventBus();
  const rng = createRng(seed, "sim");

  const needed = config.teamSize * TEAM_IDS.length;
  if (map.spawns.length < needed) {
    throw new Error(
      `The arena "${map.name}" has ${map.spawns.length} spawn cells, but ${needed} are needed.`,
    );
  }

  const bots: BotState[] = [];
  for (const [teamIndex, teamId] of TEAM_IDS.entries()) {
    for (let slot = 0; slot < config.teamSize; slot += 1) {
      const spawn = map.spawns[teamIndex * config.teamSize + slot] as Cell;
      bots.push({
        id: `${teamId}${slot}`,
        teamId,
        pos: cellCenter(spawn),
        moveSpeedPerTick: config.moveSpeedPerTick,
        path: [],
        goalSlotId: null,
      });
    }
  }

  const state: SimState = { tick: 0, roundNumber, map, config, bots, rng, bus };
  for (const bot of state.bots) {
    const cell = botCell(bot);
    bus.emit("Spawn", 0, roundNumber, { botId: bot.id, teamId: bot.teamId, cell });
  }
  return state;
}
