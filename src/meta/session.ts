/**
 * A session of matches (dev-guide Section 7.15, a first piece of M11).
 *
 * A session chains matches so that the browser never stops: a match ends, the
 * next arena is generated, and the next match begins. It holds the seed, the
 * arena style to use next, and the tally.
 *
 * **This is not the run of Section 7.15.** A run has opponent teams with
 * doctrines, an adaptation record, generated names, and an end. A session has
 * none of those: it is the loop that carries the game between matches until
 * M11 gives it a shape. Nothing here writes a save.
 */
import { generateArena, type ArenaStyle, type GeneratedArena } from "../arena/generate.js";
import { loadArenaProfiles } from "../core/data.js";
import { createRng, deriveSeed } from "../core/rng.js";
import { rollSpawnTable, type SpawnTable } from "../sim/pickups.js";
import type { TeamId } from "../sim/state.js";
import { generateWeaponSet } from "../weapons/generate.js";
import type { Weapon } from "../weapons/types.js";

export const SESSION_MODES = ["tournament", "test"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export interface SessionOptions {
  mode: SessionMode;
  seed: number;
  /**
   * The style of every arena. `null` cycles the styles in turn, which is what
   * tournament mode does: a match on each kind of ground.
   */
  style?: ArenaStyle | null;
  /** The styles to cycle. The profiles of `data/arena-profiles.json` by default. */
  styles?: readonly ArenaStyle[];
  /** Weapons in a run. `match.weaponsPerRun` of the tuning by default. */
  weaponsPerRun?: number;
  ticksPerSecond?: number;
}

/**
 * The three seeds of a match, one for each generator.
 *
 * They come from the match seed by default, through three named streams, so
 * they are **independent**: change the weapons seed and the arena does not
 * move. That is what lets a player hold a layout and try a different loadout
 * on it (Section 7.23).
 */
export interface MatchSeeds {
  arena: number;
  weapons: number;
  spawnTable: number;
}

/** The three seeds that a match seed gives, when nothing overrides them. */
export function matchSeedsOf(matchSeed: number): MatchSeeds {
  return {
    arena: deriveSeed(matchSeed, "arena"),
    weapons: deriveSeed(matchSeed, "weapons"),
    spawnTable: deriveSeed(matchSeed, "spawnTable"),
  };
}

/** The seed of match `matchNumber` of a session. */
export function matchSeedOf(sessionSeed: number, matchNumber: number): number {
  return deriveSeed(sessionSeed, `match:${matchNumber}`);
}

/** What one match of a session needs to start. */
export interface MatchSetup {
  matchNumber: number;
  seed: number;
  /** The style of the ground, so a ticket can name it back (Section 7.23). */
  style: ArenaStyle;
  /** The seed that each generator used. A ticket carries these. */
  seeds: MatchSeeds;
  arena: GeneratedArena;
  weapons: Weapon[];
  spawnTable: SpawnTable;
}

/** What one finished match left behind. */
export interface MatchRecord {
  matchNumber: number;
  arenaName: string;
  style: ArenaStyle;
  winnerTeamId: TeamId | null;
  roundWins: Record<TeamId, number>;
}

export interface Session {
  mode: SessionMode;
  seed: number;
  /** The match that `nextMatch` will build. It starts at 1. */
  matchNumber: number;
  styles: readonly ArenaStyle[];
  /** `null` cycles the styles. */
  style: ArenaStyle | null;
  weaponsPerRun: number;
  ticksPerSecond: number;
  /** Matches won, by team. A drawn match counts for neither. */
  matchWins: Record<TeamId, number>;
  history: MatchRecord[];
}

const DEFAULT_STYLES: readonly ArenaStyle[] = ["bastion", "openfield", "cavern"];

export function createSession(options: SessionOptions): Session {
  const styles = options.styles ?? DEFAULT_STYLES;
  if (styles.length === 0) throw new Error("A session needs one arena style minimum.");
  return {
    mode: options.mode,
    seed: options.seed,
    matchNumber: 1,
    styles,
    style: options.style ?? null,
    weaponsPerRun: options.weaponsPerRun ?? 5,
    ticksPerSecond: options.ticksPerSecond ?? 20,
    matchWins: { A: 0, B: 0 },
    history: [],
  };
}

/** The style that the next match plays on. */
export function nextStyle(session: Session): ArenaStyle {
  if (session.style !== null) return session.style;
  const index = (session.matchNumber - 1) % session.styles.length;
  return session.styles[index] as ArenaStyle;
}

/**
 * Build the next match: a new arena, a new weapon set, and a new spawn table.
 *
 * It does not advance the session. `recordMatch` does that, so a match that is
 * abandoned does not skip a number.
 */
export function nextMatch(session: Session, overrides: Partial<MatchSeeds> = {}): MatchSetup {
  const style = nextStyle(session);
  const profiles = loadArenaProfiles();
  const profile = profiles.profiles[style];
  if (!profile) throw new Error(`data/arena-profiles.json has no profile "${style}"`);

  // Every part of a match takes its own sub-seed, so one session seed replays
  // the whole session (Section 7.1). `overrides` replaces one of them and
  // leaves the others where they were, which is how a player keeps a layout
  // and rerolls the weapons on it (Section 7.23).
  const seed = matchSeedOf(session.seed, session.matchNumber);
  const seeds = { ...matchSeedsOf(seed), ...overrides };

  // The arena reads its own seed, not the seed of the match, so a new arena
  // seed gives a new name as well as new ground.
  const arena = generateArena(profile, createRng(seeds.arena, "arena"), seeds.arena, {
    rules: profiles.rules,
  });
  const weapons = generateWeaponSet(createRng(seeds.weapons, "weapons"), session.weaponsPerRun, {
    ticksPerSecond: session.ticksPerSecond,
  });
  const spawnTable = rollSpawnTable(arena, weapons, createRng(seeds.spawnTable, "weapons"));

  return { matchNumber: session.matchNumber, seed, style, seeds, arena, weapons, spawnTable };
}

/** Write down how a match ended, and move the session on to the next one. */
export function recordMatch(
  session: Session,
  setup: MatchSetup,
  winnerTeamId: TeamId | null,
  roundWins: Record<TeamId, number>,
): MatchRecord {
  const record: MatchRecord = {
    matchNumber: setup.matchNumber,
    arenaName: setup.arena.name,
    style: setup.arena.profile.style,
    winnerTeamId,
    roundWins: { ...roundWins },
  };
  session.history.push(record);
  if (winnerTeamId !== null) session.matchWins[winnerTeamId] += 1;
  session.matchNumber += 1;
  return record;
}

/** The tally, in one line, for a screen or a log. */
export function sessionTally(session: Session): string {
  const played = session.history.length;
  if (played === 0) return "No match played yet.";
  const draws = played - session.matchWins.A - session.matchWins.B;
  const drawText = draws > 0 ? `, ${draws} drawn` : "";
  const matches = played === 1 ? "1 match" : `${played} matches`;
  return `${matches}: team A ${session.matchWins.A}, team B ${session.matchWins.B}${drawText}.`;
}
