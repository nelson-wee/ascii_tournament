/**
 * Simulation state (dev-guide Section 7.4).
 *
 * Milestone M3 adds health, one baseline weapon, perception, and the score.
 * The `Tactics` and the `Role` of Sections 6.4 and 7.11 arrive with M4 and M8.
 */
import type { ArenaMap } from "../arena/types.js";
import {
  loadAnnouncements,
  loadBaselineWeapon,
  loadDefaultTactics,
  loadTuning,
} from "../core/data.js";
import { CellSet } from "../core/cellSet.js";
import { EventBus } from "../core/events.js";
import type { Tactics, Tuning } from "../core/schemas.js";
import type { Action } from "../ai/utility.js";
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
  /** What the player TELLS the bot (Section 6.4). */
  tactics: Tactics;
  /** Sub-cell position. The centre of cell (x, y) is (x + 0.5, y + 0.5). */
  pos: Vec2;
  /** Cells that the bot crosses in one tick. */
  moveSpeedPerTick: number;
  /**
   * The way that the bot looks, in radians. 0 points at +x, and the angle
   * turns toward +y. Vision uses it (Section 7.20.6).
   */
  facing: number;
  /** The cells that are left of the current path. The first is the next one. */
  path: Cell[];
  /** The cell that the current path ends on. It stops a needless new search. */
  pathGoal: Cell | null;
  /** The `slotId` of the pickup point that the bot moves to. */
  goalSlotId: string | null;
  /**
   * The pickup points that the bot reached, oldest first.
   *
   * The bot does not walk back to a point that it just took, so it works a
   * route over the arena instead of stepping between two near points. M8
   * replaces this memory with the real respawn timers of Section 7.12.
   */
  visitedSlotIds: string[];
  /** Ticks that an enemy bot blocked the next cell of the path. */
  blockedTicks: number;
  /** True if the bot changed position in the last tick. */
  movedLastTick: boolean;

  /** The action that the utility AI selected (Section 7.8). */
  action: Action;
  /** The score of `action` when the AI selected it. Hysteresis uses it. */
  actionScore: number;
  /** Ticks before the bot decides again. */
  decisionCooldownTicks: number;

  alive: boolean;
  health: number;
  /** The tick of the respawn. Only valid while `alive` is false. */
  respawnAtTick: number;
  /** Every weapon that the bot holds. M3 and M4 give one baseline weapon. */
  weapons: Weapon[];
  /** The weapon in the hands of the bot. `SwitchWeapon` changes it. */
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
  /**
   * The enemies inside the focus arc, in a stable order. The bot fires only at
   * these.
   */
  visibleEnemyIds: string[];
  /**
   * The enemies inside the peripheral arc that the bot noticed. It knows that
   * they are there, but it must turn before it can fire.
   */
  peripheralEnemyIds: string[];
  /** Ticks of unbroken sight of an enemy inside the peripheral arc. */
  peripheralTicks: Map<string, number>;
  /** The last known position of each enemy. */
  lastSeen: Map<string, LastSeen>;

  /** The tick of the last kill by this bot. It counts multi-kills. */
  lastKillTick: number;
  /** Kills of this bot inside the multi-kill window. */
  multiKillCount: number;
  /** Kills of this bot with no death between them (a killing spree). */
  spreeCount: number;
}

export interface SimConfig {
  ticksPerSecond: number;
  teamSize: number;
  moveSpeedPerTick: number;
  repathAfterBlockedTicks: number;
  sightRadiusCells: number;
  memoryTicks: number;
  focusHalfAngle: number;
  peripheralHalfAngleBase: number;
  peripheralHalfAngleAwareness: number;
  peripheralDelayTicks: number;
  turnRatePerTick: number;
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
  suddenDeathMaxTicks: number;
  aiDecisionIntervalTicks: number;
  hysteresisMargin: number;
  hazardAvoidBelowTolerance: number;
  teamSpacingCells: number;
  actionBase: Readonly<Record<string, number>>;
  evasionLateralFactor: number;
  evasionAccuracyPenalty: number;
  targetSwitchMargin: number;
  /** The kill announcement tiers (Section 7.17). */
  multiKillTiers: readonly { count: number; text: string }[];
  spreeTiers: readonly { count: number; text: string }[];
}

/** Why a round ended. */
export type RoundEndReason = "scoreLimit" | "timeLimit" | "suddenDeath";

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
  /** True after the time limit ended a round with an equal score. */
  suddenDeath: boolean;
  /** The tick that sudden death started on. */
  suddenDeathStartTick: number;
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
  /** The tactics of every bot, or of one team. */
  tactics?: Tactics | Partial<Record<TeamId, Tactics>>;
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
    focusHalfAngle: (tuning.perception.focusHalfAngleDegrees * Math.PI) / 180,
    peripheralHalfAngleBase: (tuning.perception.peripheralHalfAngleBaseDegrees * Math.PI) / 180,
    peripheralHalfAngleAwareness:
      (tuning.perception.peripheralHalfAngleAwarenessDegrees * Math.PI) / 180,
    peripheralDelayTicks: tuning.perception.peripheralDelayTicks,
    turnRatePerTick: (tuning.perception.turnRateDegreesPerTick * Math.PI) / 180,
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
    suddenDeathMaxTicks: tuning.round.suddenDeathMaxTicks,
    aiDecisionIntervalTicks: tuning.simulation.aiDecisionIntervalTicks,
    hysteresisMargin: tuning.ai.hysteresisMargin,
    hazardAvoidBelowTolerance: tuning.ai.hazardAvoidBelowTolerance,
    teamSpacingCells: tuning.ai.teamSpacingCells,
    actionBase: tuning.ai.actionBase,
    evasionLateralFactor: tuning.movement.evasionLateralFactor,
    evasionAccuracyPenalty: tuning.combat.evasionAccuracyPenalty,
    targetSwitchMargin: tuning.combat.targetSwitchMargin,
    multiKillTiers: loadAnnouncements().multiKill,
    spreeTiers: loadAnnouncements().spree,
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

/**
 * The bots in the order of one tick.
 *
 * The order changes with every tick. A fixed order gives the first team a
 * small advantage: in a shot at the same tick, the bot that fires first can
 * kill the other before it fires, and the bot that moves first can take a
 * cell that the other wanted. The order stays a function of the tick, so the
 * simulation stays deterministic.
 */
export function botsInTickOrder(state: SimState): BotState[] {
  return state.tick % 2 === 0 ? state.bots : [...state.bots].reverse();
}

/** An angle folded into the range -pi to pi. */
export function normalizeAngle(angle: number): number {
  const turn = Math.PI * 2;
  let value = angle % turn;
  if (value > Math.PI) value -= turn;
  if (value < -Math.PI) value += turn;
  return value;
}

/** The smallest turn from one angle to another, always 0 or more. */
export function angleBetween(a: number, b: number): number {
  return Math.abs(normalizeAngle(b - a));
}

/** The angle from one bot to a point. */
export function angleTo(from: BotState, x: number, y: number): number {
  return Math.atan2(y - from.pos.y, x - from.pos.x);
}

/**
 * Half the width of the peripheral arc of a bot (Section 7.20.6).
 * The `awareness` attribute makes the arc wider.
 */
export function peripheralHalfAngle(state: SimState, bot: BotState): number {
  return (
    state.config.peripheralHalfAngleBase +
    bot.attributes.awareness * state.config.peripheralHalfAngleAwareness
  );
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

interface MakeBotOptions {
  id: string;
  teamId: TeamId;
  spawn: Cell;
  slot: number;
  config: SimConfig;
  attributes: Attributes;
  tactics: Tactics;
  weapon: Weapon;
  cellCount: number;
  facing: number;
}

function makeBot(options: MakeBotOptions): BotState {
  const { config } = options;
  return {
    id: options.id,
    teamId: options.teamId,
    attributes: options.attributes,
    tactics: options.tactics,
    pos: cellCenter(options.spawn),
    facing: options.facing,
    moveSpeedPerTick: config.moveSpeedPerTick,
    path: [],
    pathGoal: null,
    goalSlotId: null,
    visitedSlotIds: [],
    blockedTicks: 0,
    movedLastTick: false,
    action: { kind: "Idle" },
    actionScore: 0,
    // The bots decide on different ticks, so that the work spreads evenly.
    decisionCooldownTicks: options.slot % config.aiDecisionIntervalTicks,
    alive: true,
    health: config.healthMax,
    respawnAtTick: 0,
    weapons: [options.weapon],
    weapon: options.weapon,
    fireCooldownTicks: 0,
    targetId: null,
    aimTicks: 0,
    visibleCells: new CellSet(options.cellCount),
    fovCell: null,
    visibleEnemyIds: [],
    peripheralEnemyIds: [],
    peripheralTicks: new Map<string, number>(),
    lastSeen: new Map<string, LastSeen>(),
    lastKillTick: -Infinity,
    multiKillCount: 0,
    spreeCount: 0,
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
  const tacticsOption = options.tactics ?? loadDefaultTactics();
  const tacticsFor = (teamId: TeamId): Tactics =>
    "aggression" in tacticsOption
      ? tacticsOption
      : (tacticsOption[teamId] ?? loadDefaultTactics());

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
        makeBot({
          id: `${teamId}${slot}`,
          teamId,
          spawn,
          slot: teamIndex * config.teamSize + slot,
          config,
          attributes: { ...attributes },
          tactics: { ...tacticsFor(teamId) },
          weapon,
          cellCount: map.width * map.height,
          // A bot starts by looking at the middle of the arena.
          facing: Math.atan2(map.height / 2 - (spawn.y + 0.5), map.width / 2 - (spawn.x + 0.5)),
        }),
      );
    }
  }

  const state: SimState = {
    tick: 0,
    suddenDeath: false,
    suddenDeathStartTick: 0,
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
