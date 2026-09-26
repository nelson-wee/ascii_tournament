/**
 * A replay ticket (dev-guide Section 7.23).
 *
 * A ticket names one match exactly: which session seed, which match of it,
 * which ground, and the seed that each of the three generators used. It is
 * text, so it fits in a URL, in a note, or in a line of a report.
 *
 *     seed=1758800000&match=2&style=bastion&mode=test
 *     seed=1758800000&match=2&style=bastion&mode=test&weapons=91h4k
 *
 * The second one is the first one with **one** field added, and that is the
 * point of the format. The three seeds are independent, so a reader can keep
 * a layout and reroll the weapons on it, or keep both and reroll the spawn
 * table. A field that is absent comes from the match seed as usual, so the
 * short ticket stays short.
 *
 * Numbers are base 36, because a 32-bit seed is 6 characters there and 10
 * characters in base 10.
 *
 * This module holds no browser API. The menu reads a ticket out of the address
 * bar, and the batch harness writes one into a report, and both use this.
 */
import type { ArenaStyle } from "../arena/generate.js";
import { buildId } from "../core/build.js";
import { SESSION_MODES, type MatchSeeds, type SessionMode } from "./session.js";

export interface ReplayTicket {
  seed: number;
  /** The match of the session. It starts at 1. */
  matchNumber: number;
  /** `null` cycles the styles, which is what a tournament does. */
  style: ArenaStyle | null;
  mode: SessionMode;
  /** Seeds that replace the ones the match seed gives. */
  overrides: Partial<MatchSeeds>;
  /**
   * The build that wrote the ticket, or `null` when it did not say. A ticket
   * from another build still runs; it gives a different match, and
   * `ticketWarning` says so.
   */
  build: string | null;
}

const STYLES: readonly string[] = ["bastion", "openfield", "cavern"];

function base36(value: number): string {
  return (value >>> 0).toString(36);
}

/** Read a base-36 or base-10 number. `null` when the text is not one. */
function readNumber(text: string | undefined): number | null {
  if (text === undefined || text === "") return null;
  const value = /^[0-9]+$/.test(text) ? Number(text) : Number.parseInt(text, 36);
  return Number.isFinite(value) ? value >>> 0 : null;
}

/** The ticket of a match that is about to run, or that just ran. */
export function makeTicket(options: {
  seed: number;
  matchNumber: number;
  style: ArenaStyle | null;
  mode: SessionMode;
  seeds?: MatchSeeds;
  /** The seeds that the match seed gives. A seed equal to one is not written. */
  defaults?: MatchSeeds;
}): ReplayTicket {
  const overrides: Partial<MatchSeeds> = {};
  const { seeds, defaults } = options;
  if (seeds) {
    // Only a seed that differs from the default is worth carrying. A ticket
    // that names all three is correct but says less about what was changed.
    if (!defaults || seeds.arena !== defaults.arena) overrides.arena = seeds.arena;
    if (!defaults || seeds.weapons !== defaults.weapons) overrides.weapons = seeds.weapons;
    if (!defaults || seeds.spawnTable !== defaults.spawnTable) {
      overrides.spawnTable = seeds.spawnTable;
    }
  }
  return {
    seed: options.seed,
    matchNumber: options.matchNumber,
    style: options.style,
    mode: options.mode,
    overrides,
    build: buildId(),
  };
}

/** Write a ticket as text. The order is fixed, so two tickets compare. */
export function formatTicket(ticket: ReplayTicket): string {
  const parts: string[] = [
    `seed=${ticket.seed >>> 0}`,
    `match=${ticket.matchNumber}`,
  ];
  if (ticket.style !== null) parts.push(`style=${ticket.style}`);
  parts.push(`mode=${ticket.mode}`);
  if (ticket.overrides.arena !== undefined) parts.push(`arena=${base36(ticket.overrides.arena)}`);
  if (ticket.overrides.weapons !== undefined) {
    parts.push(`weapons=${base36(ticket.overrides.weapons)}`);
  }
  if (ticket.overrides.spawnTable !== undefined) {
    parts.push(`spawn=${base36(ticket.overrides.spawnTable)}`);
  }
  if (ticket.build !== null) parts.push(`build=${ticket.build}`);
  return parts.join("&");
}

/**
 * Read a ticket from text.
 *
 * It takes a leading `#` or `?`, so the fragment of an address goes straight
 * in. It also takes a bare number, which a person types far more often than a
 * full ticket: `1758800000` reads as `seed=1758800000`. A bare number is base
 * 10, because that is what a person types.
 *
 * It returns `null` when the text has no seed, because a ticket without one
 * names no match. Every other field falls back to a default.
 */
export function parseTicket(text: string): ReplayTicket | null {
  const trimmed = text.trim().replace(/^[#?]+/, "");
  if (trimmed === "") return null;
  const body = /^[0-9]+$/.test(trimmed) ? `seed=${trimmed}` : trimmed;

  const fields = new Map<string, string>();
  for (const pair of body.split("&")) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    fields.set(pair.slice(0, at).trim().toLowerCase(), pair.slice(at + 1).trim());
  }

  const seed = readNumber(fields.get("seed"));
  if (seed === null) return null;

  const matchNumber = readNumber(fields.get("match")) ?? 1;
  const styleText = fields.get("style");
  const style = styleText && STYLES.includes(styleText) ? (styleText as ArenaStyle) : null;
  const modeText = fields.get("mode");
  const mode = (SESSION_MODES as readonly string[]).includes(modeText ?? "")
    ? (modeText as SessionMode)
    : "tournament";

  const overrides: Partial<MatchSeeds> = {};
  const arena = readNumber(fields.get("arena"));
  const weapons = readNumber(fields.get("weapons"));
  const spawnTable = readNumber(fields.get("spawn"));
  if (arena !== null) overrides.arena = arena;
  if (weapons !== null) overrides.weapons = weapons;
  if (spawnTable !== null) overrides.spawnTable = spawnTable;

  return {
    seed,
    matchNumber: Math.max(1, matchNumber),
    style,
    mode,
    overrides,
    build: fields.get("build") ?? null,
  };
}

/**
 * What to tell a reader before a ticket from elsewhere runs, or `null` when
 * there is nothing to tell.
 *
 * A ticket from another build is not an error. It runs, and it gives a
 * different match, and the reader must know which of the two they are looking
 * at.
 */
export function ticketWarning(ticket: ReplayTicket): string | null {
  const here = buildId();
  if (ticket.build === null) {
    return "This ticket does not name a build. It replays this build, which may not be the one that made it.";
  }
  if (ticket.build === here) return null;
  const [code, data] = ticket.build.split(".");
  const [hereCode, hereData] = here.split(".");
  if (code !== hereCode && data !== hereData) {
    return `This ticket is from build ${ticket.build} and the code and the data both changed since. The same seeds give a different match.`;
  }
  if (data !== hereData) {
    return `This ticket is from build ${ticket.build} and the data files changed since. The generators give different weapons and arenas.`;
  }
  return `This ticket is from build ${ticket.build} and the code changed since. The same seeds give a different match.`;
}

/** A short line for a screen: what the ticket holds, in words. */
export function describeTicket(ticket: ReplayTicket): string {
  const changed: string[] = [];
  if (ticket.overrides.arena !== undefined) changed.push("arena");
  if (ticket.overrides.weapons !== undefined) changed.push("weapons");
  if (ticket.overrides.spawnTable !== undefined) changed.push("spawn table");
  const where = ticket.style ?? "every style";
  const tail = changed.length === 0 ? "" : `, new ${changed.join(" and ")}`;
  return `${where}, match ${ticket.matchNumber}${tail}`;
}
