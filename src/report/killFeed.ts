/**
 * The kill feed (dev-guide Section 7.17).
 *
 * A line comes from an event template. Milestone M3 gives one simple template
 * set and uses the bot ids. Generated bot names arrive with M11, and the full
 * grammar of Section 7.19 replaces these strings.
 */
import type { GameEvent } from "../core/events.js";

/** The words of a range band. TBD */
const RANGE_WORDS: Readonly<Record<string, string>> = {
  close: "at close range",
  mid: "at mid range",
  long: "at long range",
};

function text(value: unknown, fallback = "?"): string {
  return typeof value === "string" ? value : fallback;
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

/** The last `limit` kill feed lines of an event log, newest last. */
export function killFeedLines(events: readonly GameEvent[], limit = 8): string[] {
  const lines: string[] = [];
  for (const event of events) {
    const line = killFeedLine(event);
    if (line !== null) lines.push(line);
  }
  return lines.slice(-limit);
}
