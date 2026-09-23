/**
 * The kill feed (dev-guide Section 7.17).
 *
 * A line comes from an event template. Milestone M3 gives one simple template
 * set and uses the bot ids. Generated bot names arrive with M11, and the full
 * grammar of Section 7.19 replaces these strings.
 */
import { loadAnnouncements } from "../core/data.js";
import type { GameEvent } from "../core/events.js";
import type { Announcements } from "../core/schemas.js";

/** The words of a range band. TBD */
const RANGE_WORDS: Readonly<Record<string, string>> = {
  close: "at close range",
  mid: "at mid range",
  long: "at long range",
};

function text(value: unknown, fallback = "?"): string {
  return typeof value === "string" ? value : fallback;
}

/** Replace every `{key}` of a template. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/**
 * One kill feed line from an `Announcement` event (Section 7.17).
 *
 * The kinds are the classic arena shooter announcements: a multi-kill, a
 * killing spree, the end of a spree, and sudden death.
 */
export function announcementLine(
  event: GameEvent,
  tables: Announcements = loadAnnouncements(),
): string | null {
  if (event.type !== "Announcement") return null;
  const { data } = event;
  const values = {
    bot: text(data["botId"]),
    killer: text(data["killerId"]),
    victim: text(data["botId"]),
    text: text(data["text"]),
    count: String(data["count"] ?? ""),
  };
  switch (data["kind"]) {
    case "multiKill":
      return fill(tables.multiKillTemplate, values);
    case "spree":
      return fill(tables.spreeTemplate, values);
    case "spreeEnded":
      return fill(tables.spreeEndedTemplate, values);
    case "suddenDeath":
      return values.text;
    default:
      return null;
  }
}

/**
 * One kill feed line from a `Kill` event.
 * Returns `null` for any other event type.
 */
export function killFeedLine(event: GameEvent): string | null {
  if (event.type !== "Kill") return null;
  const { data } = event;
  const killer = text(data["killerId"]);
  const victim = text(data["victimId"]);
  const archetype = text(data["weaponArchetype"], "unknown");
  const range = RANGE_WORDS[text(data["rangeBand"], "mid")] ?? "";

  const parts = [`${killer} killed ${victim} with a ${archetype} weapon ${range}`.trim()];
  if (data["targetAware"] === false) parts.push("from behind");
  const multiKill = data["multiKillCount"];
  if (typeof multiKill === "number" && multiKill > 1) parts.push(`(×${multiKill})`);
  return parts.join(" ");
}

/** One line of the kill feed: a kill or an announcement. */
export interface FeedLine {
  text: string;
  /** `kill`, or the kind of the announcement. */
  kind: string;
  tick: number;
}

/** The last `limit` lines of the kill feed, newest last. */
export function killFeedLines(events: readonly GameEvent[], limit = 8): string[] {
  return feedLines(events, limit).map((line) => line.text);
}

/**
 * The last `limit` lines of the kill feed with their kind, newest last.
 * The display uses the kind to make an announcement stand out.
 */
export function feedLines(events: readonly GameEvent[], limit = 8): FeedLine[] {
  const tables = loadAnnouncements();
  const lines: FeedLine[] = [];
  for (const event of events) {
    const kill = killFeedLine(event);
    if (kill !== null) {
      lines.push({ text: kill, kind: "kill", tick: event.tick });
      continue;
    }
    const announcement = announcementLine(event, tables);
    if (announcement !== null) {
      lines.push({ text: announcement, kind: text(event.data["kind"], "announcement"), tick: event.tick });
    }
  }
  return lines.slice(-limit);
}
