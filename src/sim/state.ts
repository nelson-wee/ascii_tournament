/**
 * Simulation state (dev-guide Section 7.4).
 *
 * Milestone M3 adds health, one baseline weapon, perception, and the score.
 * The `Tactics` and the `Role` of Sections 6.4 and 7.11 arrive with M4 and M8.
 */
import { cellIndex, type ArenaMap } from "../arena/types.js";
import {
  loadAnnouncements,
  loadBaselineWeapon,
  loadDefaultTactics,
  loadPickups,
  loadRoles,
  loadTuning,
  loadWeaponRoles,
} from "../core/data.js";
import { CellSet } from "../core/cellSet.js";
import { EventBus } from "../core/events.js";
import type { Pickups, Tactics, TeamTactics, Tuning } from "../core/schemas.js";
import type { Action } from "../ai/utility.js";
import { createInfluenceMaps, type InfluenceMaps } from "../ai/influence.js";
import { createRng, deriveSeed, type Rng } from "../core/rng.js";
import {
  createPickupStates,
  rollSpawnTable,
  type PickupState,
  type SpawnTable,
} from "./pickups.js";
import type { Cell, Vec2 } from "../core/types.js";
import type { Weapon } from "../weapons/types.js";

/** Team ids of Milestone M3. Generated team names arrive with M11. */
export const TEAM_IDS = ["A", "B"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

/** The roles of Section 7.11. */
export const ROLES = ["overwatch", "tank", "skirmisher"] as const;
export type Role = (typeof ROLES)[number];

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

/** Damage over time from a weapon (Section 7.6). */
export interface DotEffect {
  damagePerTick: number;
  ticksLeft: number;
  /** The bot that gets the kill if this ends the target. */
  sourceId: string;
  /** The weapon that made the effect. The reports read it. */
  weaponId: string;
  weaponArchetype: string;
}

/** A shot that crosses the arena (Section 7.20.3). */
export interface Projectile {
  id: number;
  shooterId: string;
  teamId: TeamId;
  weapon: Weapon;
  /** True if the shot that made it rolled a critical hit. */
  crit: boolean;
  /**
   * The damage the shot itself can take before it detonates early. 0 means
   * nothing can shoot it down (Section 7.20.18).
   */
  health: number;
  /** Radians of turn per tick toward the nearest enemy. 0 means it flies straight. */
  homingTurnRate: number;
  pos: Vec2;
  /** Cells per tick. */
  velocity: Vec2;
  /** Cells that the shot can still cross. */
  rangeLeft: number;
  bouncesLeft: number;
}

/** A hazard tile that a weapon made (Section 7.6). */
export interface HazardCell {
  expiryTick: number;
  damagePerTick: number;
  ownerId: string;
  teamId: TeamId;
  /** The weapon that made the tile. The reports read it. */
  weaponId: string;
  weaponArchetype: string;
}

export interface BotState {
  id: string;
  teamId: TeamId;
  attributes: Attributes;
  /** What the player TELLS the bot (Section 6.4). */
  tactics: Tactics;
  /** The role of the bot (Section 7.11). It sets the preset and the behaviors. */
  role: Role;
  /** The behavior weights of the role, by action kind. */
  roleBehavior: Readonly<Record<string, number>>;
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
  /** Ticks that an enemy bot blocked the next cell of the path. */
  blockedTicks: number;
  /** True if the bot changed position in the last tick. */
  movedLastTick: boolean;
  /** Ticks that the bot has not moved. The crit of Section 7.20.5 reads it. */
  stationaryTicks: number;
  /** Ticks that the bot has moved without a break. The dodge reads it. */
  movingTicks: number;

  /** The action that the utility AI selected (Section 7.8). */
  action: Action;
  /** The score of `action` when the AI selected it. Hysteresis uses it. */
  actionScore: number;
  /** Ticks before the bot decides again. */
  decisionCooldownTicks: number;

  /**
   * The randomness of this bot (Section 7.1).
   *
   * The seed comes from the slot inside the team, never from the team, so the
   * bot of slot 0 of each team draws the same sequence. The two teams then get
   * the same luck, which is what makes a symmetric arena a fair fight.
   */
  rng: Rng;
  alive: boolean;
  health: number;
  /** The armor pool. It takes a share of every hit while it lasts. */
  armor: number;
  /** The shield of a shield belt. It takes a hit in full while it lasts. */
  shield: number;
  /** The power-ups that the bot holds, by name, with the tick that each ends. */
  powerups: Map<string, number>;
  /**
   * How far the bot moved on the last tick, in cells. A projectile leads a
   * moving target with it (Section 7.20.15).
   */
  velocity: Vec2;
  /** The tick of the respawn. Only valid while `alive` is false. */
  respawnAtTick: number;
  /** Every weapon that the bot holds. M3 and M4 give one baseline weapon. */
  weapons: Weapon[];
  /** The weapon in the hands of the bot. `equipBestWeapon` chooses it. */
  weapon: Weapon;
  /**
   * Rounds left, by weapon id. The baseline weapon is the fallback of
   * Section 7.3, so it never runs dry. The ammo pickups of M8 refill the rest.
   */
  ammo: Map<string, number>;
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
   * Ticks that the bot was alive this round, and ticks that it was alive with
   * an enemy in sight. The share of one over the other is the clearest single
   * measure of tempo: it says how much of a round a bot fights, and how much
   * of it the bot walks (Section 7.22). Perception sets both, because
   * perception is the only place that knows what a bot can see.
   */
  aliveTicks: number;
  contactTicks: number;
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
  /** Damage over time on this bot (Section 7.6). */
  dots: DotEffect[];
}

export interface SimConfig {
  ticksPerSecond: number;
  teamSize: number;
  weaponsPerRun: number;
  moveSpeedPerTick: number;
  repathAfterBlockedTicks: number;
  sightRadiusCells: number;
  memoryTicks: number;
  directionalVision: boolean;
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
  stationaryTicksForCrit: number;
  dodgeRampTicks: number;
  /** How often the arena fires in each band (Section 7.20.15). */
  bandShare: { close: number; mid: number; long: number };
  pickupAnticipationTicks: number;
  pickupAnticipationShare: number;
  holdContactTicks: number;
  holdBlindShare: number;
  holdSuppressesPickup: number;
  preferredRangeBias: number;
  weaponRolePrefBonus: number;
  pickupRiskWeight: number;
  /** Two pickup points this close in value count as a tie (Section 7.20.25). */
  pickupTieShare: number;
  /** The weights of the one team axis of Section 7.21. */
  team: {
    followWeight: number;
    holdWeight: number;
    objectiveWeight: number;
    focusFireWeight: number;
  };
  aggressionReactionDiscount: number;
  aggressionRepositionDiscount: number;
  influenceIntervalTicks: number;
  influenceControlRadius: number;
  influenceDangerRadius: number;
  influenceBotDanger: number;
  influenceSightDanger: number;
  influenceHazardDanger: number;
  influenceDeathRadius: number;
  influenceDeathDanger: number;
  influenceDeathMemoryTicks: number;
  distanceFalloff: number;
  movingTargetPenalty: number;
  minHitChance: number;
  maxRounds: number;
  roundWinsToWinMatch: number;
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
  weaponSwapTicks: number;
  weaponSwapPayoffTicks: number;
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
  /** The team tactics of each team (Section 6.5). */
  teamTactics: Record<TeamId, TeamTactics>;
  /** The number of ticks that ran. The first `step` makes this 1. */
  tick: number;
  /** True after the time limit ended a round with an equal score. */
  suddenDeath: boolean;
  /** The tick that sudden death started on. */
  suddenDeathStartTick: number;
  roundNumber: number;
  /** The half that team A starts the match on, 0 or 1 (Section 7.20.24). */
  sideOffset: number;
  map: ArenaMap;
  config: SimConfig;
  bots: BotState[];
  /** Kills per team. */
  score: Record<TeamId, number>;
  /** The result of the round, or `null` while the round runs. */
  outcome: RoundOutcome | null;
  /** The shots that are crossing the arena. */
  projectiles: Projectile[];
  /** The next projectile id. It keeps the ids stable and deterministic. */
  nextProjectileId: number;
  /** The hazard tiles, by cell index. */
  hazards: Map<number, HazardCell>;
  /** The pickup points of the round (Section 7.12). */
  pickups: PickupState[];
  /** The same pickup points, by cell index. The movement step reads it. */
  pickupByCell: Map<number, PickupState>;
  /** What each pickup kind gives. */
  pickupTables: Pickups;
  /** The spawn table of the match. It does not change between rounds. */
  spawnTable: SpawnTable;
  /**
   * Every weapon of the run, including the baseline at index 0. A bot holds a
   * part of this list: a weapon point is what adds one (Section 7.12).
   */
  runWeapons: readonly Weapon[];
  /** The influence maps of Section 7.9. */
  influence: InfluenceMaps;
  /** Where bots died lately. The danger map reads it. */
  recentDeaths: { cell: Cell; tick: number; teamId: TeamId }[];
  rng: Rng;
  bus: EventBus;
}

export interface CreateSimStateOptions {
  map: ArenaMap;
  /** The seed of the round. Use `deriveSeed(matchSeed, "round:N")`. */
  seed: number;
  roundNumber?: number;
  /**
   * The half that team A starts the match on, 0 or 1. It belongs to the match
   * and not to the round, so `createRoundState` gives it from the match seed
   * (Section 7.20.24). A single round with no match around it takes 0.
   */
  sideOffset?: number;
  config?: SimConfig;
  bus?: EventBus;
  /**
   * The weapons of the run. A bot starts with the first one, which is the
   * baseline fallback of Section 7.3, and takes the others from the weapon
   * points of the arena (Section 7.12).
   */
  weapons?: readonly Weapon[];
  attributes?: Attributes;
  /** The tactics of every bot, or of one team. */
  tactics?: Tactics | Partial<Record<TeamId, Tactics>>;
  /** The spawn table of the match. One is rolled if none is given. */
  spawnTable?: SpawnTable;
  /** The role of each bot slot of a team (Section 7.11). */
  roles?: Partial<Record<TeamId, readonly Role[]>>;
  /** The team tactics of Section 6.5. */
  teamTactics?: Partial<Record<TeamId, TeamTactics>>;
}

/** Read the simulation numbers from `data/tuning.json`. */
export function simConfigFromTuning(tuning: Tuning = loadTuning()): SimConfig {
  return {
    ticksPerSecond: tuning.simulation.ticksPerSecond,
    teamSize: tuning.match.teamSize,
    weaponsPerRun: tuning.match.weaponsPerRun,
    moveSpeedPerTick: tuning.movement.moveSpeedCellsPerSecond / tuning.simulation.ticksPerSecond,
    repathAfterBlockedTicks: tuning.movement.repathAfterBlockedTicks,
    sightRadiusCells: tuning.perception.sightRadiusCells,
    memoryTicks: tuning.perception.memoryTicks,
    directionalVision: tuning.perception.directionalVision,
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
    stationaryTicksForCrit: tuning.combat.stationaryTicksForCrit,
    dodgeRampTicks: tuning.combat.dodgeRampTicks,
    bandShare: { ...loadWeaponRoles().value.bandShare },
    pickupAnticipationTicks: tuning.ai.pickupAnticipationTicks,
    pickupAnticipationShare: tuning.ai.pickupAnticipationShare,
    holdContactTicks: tuning.ai.holdContactTicks,
    holdBlindShare: tuning.ai.holdBlindShare,
    holdSuppressesPickup: tuning.ai.holdSuppressesPickup,
    preferredRangeBias: tuning.ai.preferredRangeBias,
    weaponRolePrefBonus: tuning.ai.weaponRolePrefBonus,
    pickupRiskWeight: tuning.ai.pickupRiskWeight,
    pickupTieShare: tuning.ai.pickupTieShare,
    team: {
      followWeight: tuning.team.followWeight,
      holdWeight: tuning.team.holdWeight,
      objectiveWeight: tuning.team.objectiveWeight,
      focusFireWeight: tuning.team.focusFireWeight,
    },
    aggressionReactionDiscount: tuning.ai.aggressionReactionDiscount,
    aggressionRepositionDiscount: tuning.ai.aggressionRepositionDiscount,
    influenceIntervalTicks: tuning.influence.intervalTicks,
    influenceControlRadius: tuning.influence.controlRadius,
    influenceDangerRadius: tuning.influence.dangerRadius,
    influenceBotDanger: tuning.influence.botDanger,
    influenceSightDanger: tuning.influence.sightDanger,
    influenceHazardDanger: tuning.influence.hazardDanger,
    influenceDeathRadius: tuning.influence.deathRadius,
    influenceDeathDanger: tuning.influence.deathDanger,
    influenceDeathMemoryTicks: tuning.influence.deathMemoryTicks,
    distanceFalloff: tuning.combat.distanceFalloff,
    movingTargetPenalty: tuning.combat.movingTargetPenalty,
    minHitChance: tuning.combat.minHitChance,
    maxRounds: tuning.match.maxRounds,
    roundWinsToWinMatch: tuning.match.roundWinsToWinMatch,
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
    weaponSwapTicks: tuning.combat.weaponSwapTicks,
    weaponSwapPayoffTicks: tuning.combat.weaponSwapPayoffTicks,
    targetSwitchMargin: tuning.combat.targetSwitchMargin,
    multiKillTiers: loadAnnouncements().multiKill,
    spreeTiers: loadAnnouncements().spree,
  };
}

/** The role of each bot slot when the caller names none. TBD */
/** One of each role. A team gets this order when the plan names none. */
export const DEFAULT_ROLES: readonly Role[] = ["tank", "overwatch", "skirmisher"];

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
 * The bots in the order of one tick (Section 7.20.7).
 *
 * A bot acts in the order of its reaction speed: its own reaction attribute
 * plus the reaction of its weapon at the band that it is working at. A bot
 * with a fast reaction and a light weapon acts before a bot with a slow
 * reaction and a heavy weapon. This is the cost of the highest damage.
 *
 * Two bots with the same reaction need a tie-break that does not favour one
 * team. A hash of the tick gives it, and `listRunsForward` says why the parity
 * of the tick was not enough. The whole order stays a function of the state, so
 * the simulation stays deterministic.
 *
 * The check that this stays fair is in Section 7.2.1: a preset against itself
 * must win half of its rounds.
 */
/**
 * Which way the bot list runs this tick.
 *
 * The parity of the tick alone is not enough. A bot decides on a fixed period,
 * and that period is even, so every decision of a bot lands on the same parity
 * for the whole round. The tie-break then never changes hands, and two slots
 * of three gave the same team the first decision in every fight
 * (Section 7.20.26). The tick goes through a hash, so the order changes on a
 * schedule that no cadence of the game can lock onto. It is a hash and not a
 * random number: the same tick always gives the same answer, so a round still
 * replays from its seed.
 */
function listRunsForward(tick: number): boolean {
  // A mix, not a multiply. The lowest bit of a product keeps the lowest bit of
  // the input, so a plain multiply gives back the parity of the tick.
  let hash = Math.imul(tick ^ 0x9e3779b9, 2654435761);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822519);
  hash ^= hash >>> 13;
  return (hash & 1) === 0;
}

export function botsInTickOrder(state: SimState): BotState[] {
  const order = listRunsForward(state.tick) ? state.bots.slice() : state.bots.slice().reverse();
  return order
    .map((bot, index) => ({ bot, index, reaction: reactionOf(state, bot) }))
    .sort((a, b) => a.reaction - b.reaction || a.index - b.index)
    .map((entry) => entry.bot);
}

/**
 * The reaction of a bot this tick, in ticks.
 * `sim/combat.ts` holds the same calculation for the aim delay.
 */
function reactionOf(state: SimState, bot: BotState): number {
  const target = bot.targetId === null ? null : findBot(state, bot.targetId);
  let band = bot.tactics.preferredRange;
  if (target?.alive) {
    const distance = distanceBetween(bot, target);
    band =
      distance <= state.config.rangeBandCloseMax
        ? "close"
        : distance <= state.config.rangeBandMidMax
          ? "mid"
          : "long";
  }
  return bot.attributes.reactionTicks + bot.weapon.reactionByBand[band];
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

/**
 * The block of spawn cells that a team starts a round on (Section 7.20.24).
 *
 * **The teams change ends after every round, and the match decides who starts
 * where.** An arena is symmetric to the cell, but the two halves did not play
 * the same: about four points of win rate followed the half and not the team.
 * Section 7.20.26 names that cause and removes it. This rule came first and it
 * stays, because it shares out what is left.
 *
 * `sideOffset` is the half that team A starts the match on, 0 or 1, and it
 * comes from the seed of the match. Without it the change of ends corrected in
 * one direction only: a match of three rounds gives one team the ends of round
 * 1 twice, and with a fixed start that team was always team A. The swap could
 * then pull an advantaged team A down toward fair and could not lift a
 * disadvantaged one up, which is what the measurement showed
 * (Section 7.20.24).
 *
 * The round number and the offset both decide, so a round still replays from
 * its own seed and a test can ask for either side.
 */
export function teamSideIndex(teamId: TeamId, roundNumber: number, sideOffset = 0): number {
  const index = TEAM_IDS.indexOf(teamId);
  if (index < 0) return 0;
  // Round 1 keeps the ends of the offset, round 2 changes them, and so on.
  const changed = (roundNumber + sideOffset) % 2 === 0;
  return changed ? TEAM_IDS.length - 1 - index : index;
}

/** The half that team A starts a match on, from the seed of the match. */
export function sideOffsetOf(matchSeed: number | string): number {
  return createRng(deriveSeed(matchSeed, "sides"), "sides").bool(0.5) ? 1 : 0;
}

/** The spawn cells of a team this round, after the change of ends. */
export function teamSpawns(state: SimState, teamId: TeamId): Cell[] {
  const index = teamSideIndex(teamId, state.roundNumber, state.sideOffset);
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
  role: Role;
  roleBehavior: Readonly<Record<string, number>>;
  weapons: readonly Weapon[];
  cellCount: number;
  facing: number;
  rng: Rng;
}

function makeBot(options: MakeBotOptions): BotState {
  const { config } = options;
  return {
    id: options.id,
    teamId: options.teamId,
    attributes: options.attributes,
    tactics: options.tactics,
    role: options.role,
    roleBehavior: options.roleBehavior,
    pos: cellCenter(options.spawn),
    facing: options.facing,
    moveSpeedPerTick: config.moveSpeedPerTick,
    path: [],
    pathGoal: null,
    goalSlotId: null,
    blockedTicks: 0,
    movedLastTick: false,
    stationaryTicks: 0,
    movingTicks: 0,
    action: { kind: "Idle" },
    actionScore: 0,
    // The bots decide on different ticks, so that the work spreads evenly.
    //
    // The phase comes from the slot INSIDE the team, never from a number that
    // counts the teams in turn. With the global index the six bots took the
    // phases 0,1,2 and 3,4,0, so team A made its first decision on the ticks
    // 1, 2 and 3 and team B on 1, 4 and 5, and the phase held for the whole
    // round. That is one team thinking sooner than the other, every round, and
    // it is the side bias of Section 7.20.23.
    decisionCooldownTicks: options.slot % config.aiDecisionIntervalTicks,
    rng: options.rng,
    alive: true,
    health: config.healthMax,
    armor: 0,
    shield: 0,
    powerups: new Map<string, number>(),
    velocity: { x: 0, y: 0 },
    respawnAtTick: 0,
    // A bot starts with the baseline weapon alone. A generated weapon comes
    // from a weapon point, so the arena decides who holds what (Section 7.12).
    weapons: [options.weapons[0] as Weapon],
    weapon: options.weapons[0] as Weapon,
    ammo: new Map<string, number>(),
    fireCooldownTicks: 0,
    targetId: null,
    aimTicks: 0,
    visibleCells: new CellSet(options.cellCount),
    fovCell: null,
    visibleEnemyIds: [],
    aliveTicks: 0,
    contactTicks: 0,
    peripheralEnemyIds: [],
    peripheralTicks: new Map<string, number>(),
    lastSeen: new Map<string, LastSeen>(),
    lastKillTick: -Infinity,
    multiKillCount: 0,
    spreeCount: 0,
    dots: [],
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
  const sideOffset = options.sideOffset ?? 0;
  const config = options.config ?? simConfigFromTuning();
  const bus = options.bus ?? new EventBus();
  const rng = createRng(seed, "sim");
  const weapons = options.weapons ?? [loadBaselineWeapon()];
  if (weapons.length === 0) throw new Error("A round needs one weapon minimum.");
  const attributes = options.attributes ?? defaultAttributes();
  const rolesData = loadRoles();
  const pickupTables = loadPickups();
  const spawnTable =
    options.spawnTable ?? rollSpawnTable(map, weapons, createRng(seed, "weapons"), pickupTables);
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
  for (const teamId of TEAM_IDS) {
    // The teams change ends after every round, so the side comes from the
    // round number and not from the place of the team in the list.
    const side = teamSideIndex(teamId, roundNumber, sideOffset);
    for (let slot = 0; slot < config.teamSize; slot += 1) {
      const spawn = map.spawns[side * config.teamSize + slot] as Cell;
      // A role gives its tactics preset. The player can change the tactics
      // after the role applies it (Section 7.11).
      const role = options.roles?.[teamId]?.[slot] ?? DEFAULT_ROLES[slot % DEFAULT_ROLES.length]!;
      const roleData = rolesData.roles[role];
      const preset = options.tactics ? tacticsFor(teamId) : (roleData?.tactics ?? tacticsFor(teamId));
      bots.push(
        makeBot({
          id: `${teamId}${slot}`,
          teamId,
          spawn,
          // The slot inside the team, not the index in the bot list: the
          // decision phase and the random stream read it, and both must be the
          // same for the two teams.
          slot,
          rng: createRng(deriveSeed(seed, `bot:${slot}`), `sim/bot${slot}`),
          config,
          attributes: { ...attributes },
          tactics: { ...preset },
          role,
          roleBehavior: roleData?.behavior ?? {},
          weapons,
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
    sideOffset,
    map,
    config,
    bots,
    score: { A: 0, B: 0 },
    teamTactics: {
      A: options.teamTactics?.A ?? { ...rolesData.teamTacticsDefault },
      B: options.teamTactics?.B ?? { ...rolesData.teamTacticsDefault },
    },
    outcome: null,
    projectiles: [],
    nextProjectileId: 1,
    hazards: new Map<number, HazardCell>(),
    pickups: [],
    pickupByCell: new Map<number, PickupState>(),
    pickupTables,
    spawnTable,
    runWeapons: weapons,
    influence: createInfluenceMaps(map),
    recentDeaths: [],
    rng,
    bus,
  };
  state.pickups = createPickupStates(map, spawnTable);
  for (const pickup of state.pickups) {
    state.pickupByCell.set(cellIndex(map, pickup.point.cell.x, pickup.point.cell.y), pickup);
  }

  for (const bot of state.bots) {
    bus.emit("Spawn", 0, roundNumber, { botId: bot.id, teamId: bot.teamId, cell: botCell(bot) });
  }
  return state;
}
