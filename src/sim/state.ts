/**
 * Simulation state (dev-guide Section 7.4).
 *
 * Milestone M3 adds health, one baseline weapon, perception, and the score.
 * The `Tactics` and the `Role` of Sections 6.4 and 7.11 arrive with M4 and M8.
 */
import type { ArenaMap } from "../arena/types.js";
import { loadBaselineWeapon, loadTuning } from "../core/data.js";
import { CellSet } from "../core/cellSet.js";
import { EventBus } from "../core/events.js";
import type { Tuning } from "../core/schemas.js";
import { createRng, type Rng } from "../core/rng.js";
import type { Cell, Vec2 } from "../core/types.js";
import type { Weapon } from "../weapons/types.js";

/** Team ids of Milestone M3. Generated team names arrive with M11. */
export const TEAM_IDS = ["A", "B"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

/** What a bot IS (Section 6.4). The player does not change these values. */
export interface Attributes {
  accuracy: number;
  reactionTicks: number;
  /** Cells per simulated second. */
  moveSpeed: number;
  /** No system reads this value yet. Section 6.4 names it. TBD */
  awareness: number;
}

/** The last known position of an enemy (Section 7.7). */
export interface LastSeen {
  cell: Cell;
  tick: number;
}

export interface BotState {
  id: string;
  teamId: TeamId;
  attributes: Attributes;
  /** Sub-cell position. The centre of cell (x, y) is (x + 0.5, y + 0.5). */
  pos: Vec2;
  /** Cells that the bot crosses in one tick. */
  moveSpeedPerTick: number;
  /** The cells that are left of the current path. The first is the next one. */
  path: Cell[];
  /** The `slotId` of the pickup point that the bot moves to. */
  goalSlotId: string | null;
  /** Ticks that an enemy bot blocked the next cell of the path. */
  blockedTicks: number;
  /** True if the bot changed position in the last tick. */
  movedLastTick: boolean;

  alive: boolean;
  health: number;
  /** The tick of the respawn. Only valid while `alive` is false. */
  respawnAtTick: number;
  weapon: Weapon;
  /** Ticks before the weapon can fire again. */
  fireCooldownTicks: number;
  /** The enemy that the bot aims at. */
  targetId: string | null;
  /** Ticks that the bot has aimed at `targetId`. It models the reaction time. */
  aimTicks: number;

  /** The cell indices that the bot can see. Perception fills it every tick. */
  visibleCells: CellSet;
  /** The cell that `visibleCells` belongs to, or `null` if it is not valid. */
  fovCell: Cell | null;
  /** The ids of the enemies that the bot can see, in a stable order. */
  visibleEnemyIds: string[];
  /** The last known position of each enemy. */
  lastSeen: Map<string, LastSeen>;

  /** The tick of the last kill by this bot. It counts multi-kills. */
  lastKillTick: number;
  /** Kills of this bot inside the multi-kill window. */
  multiKillCount: number;
}

export interface SimConfig {
  ticksPerSecond: number;
  teamSize: number;
  moveSpeedPerTick: number;
  repathAfterBlockedTicks: number;
  sightRadiusCells: number;
  memoryTicks: number;
  healthMax: number;
  respawnDelayTicks: number;
  rangeBandCloseMax: number;
  rangeBandMidMax: number;
  multiKillWindowTicks: number;
  critMultiplier: number;
  distanceFalloff: number;
  movingTargetPenalty: number;
  minHitChance: number;
  scoreLimit: number;
  timeLimitTicks: number;
}

/** Why a round ended. */
export type RoundEndReason = "scoreLimit" | "timeLimit";

export interface RoundOutcome {
  /** `null` means a draw: the time ran out with an equal score. */
  winnerTeamId: TeamId | null;
  reason: RoundEndReason;
  score: Record<TeamId, number>;
  ticks: number;
}

export interface SimState {
  /** The number of ticks that ran. The first `step` makes this 1. */
  tick: number;
  roundNumber: number;
  map: ArenaMap;
  config: SimConfig;
  bots: BotState[];
  /** Kills per team. */
  score: Record<TeamId, number>;
  /** The result of the round, or `null` while the round runs. */
  outcome: RoundOutcome | null;
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
  /** The weapon of every bot. M3 gives all bots the baseline weapon. */
  weapon?: Weapon;
  attributes?: Attributes;
}

/** Read the simulation numbers from `data/tuning.json`. */
export function simConfigFromTuning(tuning: Tuning = loadTuning()): SimConfig {
  return {
    ticksPerSecond: tuning.simulation.ticksPerSecond,
    teamSize: tuning.match.teamSize,
    moveSpeedPerTick: tuning.movement.moveSpeedCellsPerSecond / tuning.simulation.ticksPerSecond,
    repathAfterBlockedTicks: tuning.movement.repathAfterBlockedTicks,
    sightRadiusCells: tuning.perception.sightRadiusCells,
    memoryTicks: tuning.perception.memoryTicks,
    healthMax: tuning.combat.healthMax,
    respawnDelayTicks: tuning.combat.respawnDelayTicks,
    rangeBandCloseMax: tuning.combat.rangeBandCloseMax,
    rangeBandMidMax: tuning.combat.rangeBandMidMax,
    multiKillWindowTicks: tuning.combat.multiKillWindowTicks,
    critMultiplier: tuning.combat.critMultiplier,
    distanceFalloff: tuning.combat.distanceFalloff,
    movingTargetPenalty: tuning.combat.movingTargetPenalty,
    minHitChance: tuning.combat.minHitChance,
    scoreLimit: tuning.round.scoreLimit,
    timeLimitTicks: tuning.round.timeLimitTicks,
  };
}

/** The default attributes of a bot. Per-bot variation arrives with M11. */
export function defaultAttributes(tuning: Tuning = loadTuning()): Attributes {
  return {
    accuracy: tuning.botDefaults.accuracy,
    reactionTicks: tuning.botDefaults.reactionTicks,
    moveSpeed: tuning.movement.moveSpeedCellsPerSecond,
    awareness: tuning.botDefaults.awareness,
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

/** The distance between two bots, in cells. */
export function distanceBetween(a: BotState, b: BotState): number {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
}

/** The team of a bot id. */
export function findBot(state: SimState, id: string): BotState | undefined {
  return state.bots.find((bot) => bot.id === id);
}

/**
 * A live enemy of `teamId` that stands on `cell`.
 *
 * Decision: an enemy blocks movement. A teammate does not.
 */
export function enemyAt(state: SimState, cell: Cell, teamId: TeamId): BotState | undefined {
  return state.bots.find((bot) => {
    if (!bot.alive || bot.teamId === teamId) return false;
    const other = botCell(bot);
    return other.x === cell.x && other.y === cell.y;
  });
}

/** The spawn cells of one team. */
export function teamSpawns(state: SimState, teamId: TeamId): Cell[] {
  const index = TEAM_IDS.indexOf(teamId);
  const size = state.config.teamSize;
  return state.map.spawns.slice(index * size, index * size + size);
}

function makeBot(
  id: string,
  teamId: TeamId,
  spawn: Cell,
  config: SimConfig,
  attributes: Attributes,
  weapon: Weapon,
  cellCount: number,
): BotState {
  return {
    id,
    teamId,
    attributes,
    pos: cellCenter(spawn),
    moveSpeedPerTick: config.moveSpeedPerTick,
    path: [],
    goalSlotId: null,
    blockedTicks: 0,
    movedLastTick: false,
    alive: true,
    health: config.healthMax,
    respawnAtTick: 0,
    weapon,
    fireCooldownTicks: 0,
    targetId: null,
    aimTicks: 0,
    visibleCells: new CellSet(cellCount),
    fovCell: null,
    visibleEnemyIds: [],
    lastSeen: new Map<string, LastSeen>(),
    lastKillTick: -Infinity,
    multiKillCount: 0,
  };
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
  const weapon = options.weapon ?? loadBaselineWeapon();
  const attributes = options.attributes ?? defaultAttributes();

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
      bots.push(
        makeBot(
          `${teamId}${slot}`,
          teamId,
          spawn,
          config,
          { ...attributes },
          weapon,
          map.width * map.height,
        ),
      );
    }
  }

  const state: SimState = {
    tick: 0,
    roundNumber,
    map,
    config,
    bots,
    score: { A: 0, B: 0 },
    outcome: null,
    rng,
    bus,
  };
  for (const bot of state.bots) {
    bus.emit("Spawn", 0, roundNumber, { botId: bot.id, teamId: bot.teamId, cell: botCell(bot) });
  }
  return state;
}
