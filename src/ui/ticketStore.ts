/**
 * Saved replay tickets, and the seed of the last session (Section 7.23).
 * Browser only.
 *
 * `localStorage` belongs to one browser. It never reaches another machine, and
 * it can come back empty or throw: a private window, cleared site data, or a
 * browser that blocks storage. So **every read and every write is guarded, and
 * the game works with none of it.** This holds a convenience, not a record.
 * The record is the ticket text, which a person can copy anywhere.
 */
import { formatTicket, parseTicket, type ReplayTicket } from "../meta/ticket.js";

const SAVED_KEY = "ascii-tournament.tickets";
const SESSION_KEY = "ascii-tournament.session-seed";
/** Enough to hold a session of interesting finds, and short enough to read. */
const MAX_SAVED = 20;

export interface SavedTicket {
  ticket: ReplayTicket;
  /** What the person called it, or "" when they named nothing. */
  label: string;
  /** When it was saved, so the newest comes first. */
  savedAt: number;
}

interface StoredRow {
  text: string;
  label: string;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    // Reading the property itself throws in some browsers.
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // A full or blocked store is not an error that the player must see.
  }
}

/** The saved tickets, newest first. An unreadable store gives an empty list. */
export function loadTickets(): SavedTicket[] {
  const text = read(SAVED_KEY);
  if (text === null) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];

  const out: SavedTicket[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { text: body, label, savedAt } = row as Partial<StoredRow>;
    if (typeof body !== "string") continue;
    const ticket = parseTicket(body);
    if (ticket === null) continue;
    out.push({
      ticket,
      label: typeof label === "string" ? label : "",
      savedAt: typeof savedAt === "number" ? savedAt : 0,
    });
  }
  out.sort((a, b) => b.savedAt - a.savedAt);
  return out.slice(0, MAX_SAVED);
}

function save(rows: readonly SavedTicket[]): void {
  const stored: StoredRow[] = rows.slice(0, MAX_SAVED).map((row) => ({
    text: formatTicket(row.ticket),
    label: row.label,
    savedAt: row.savedAt,
  }));
  write(SAVED_KEY, JSON.stringify(stored));
}

/**
 * Save a ticket and give back the new list.
 *
 * A ticket that is already saved moves to the top and takes the new label, so
 * saving the same match twice does not fill the list with copies.
 */
export function saveTicket(ticket: ReplayTicket, label = ""): SavedTicket[] {
  const text = formatTicket(ticket);
  const rest = loadTickets().filter((row) => formatTicket(row.ticket) !== text);
  const rows = [{ ticket, label, savedAt: Date.now() }, ...rest];
  save(rows);
  return rows.slice(0, MAX_SAVED);
}

/** Forget one ticket and give back the new list. */
export function removeTicket(ticket: ReplayTicket): SavedTicket[] {
  const text = formatTicket(ticket);
  const rows = loadTickets().filter((row) => formatTicket(row.ticket) !== text);
  save(rows);
  return rows;
}

/**
 * The seed of the last session, so a refresh does not throw a run away.
 * `null` when there is none, or when the store cannot be read.
 */
export function lastSessionSeed(): number | null {
  const text = read(SESSION_KEY);
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value >>> 0 : null;
}

export function rememberSessionSeed(seed: number): void {
  write(SESSION_KEY, String(seed >>> 0));
}
