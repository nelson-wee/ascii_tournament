/**
 * What the last round looked like, for the tactics screen (Section 7.25).
 *
 * The screen asks a player to set tactics for the next round. Before this, the
 * only thing it showed about the round that just ended was the score. A score
 * says who won; it does not say **why**, and a tactic is a guess without that.
 *
 * This reads the event log of one round and gives back the three things a
 * player can act on:
 *
 * - **Where the fighting happened.** Kills by range band. It decides
 *   `preferredRange` and the weapon that a bot reaches for.
 * - **Which weapons did the work.** Kills per weapon, with the band that most
 *   of them landed at. It decides `weaponRolePref`.
 * - **The rhythm.** The gap between kills, how long a fight lasts, and how much
 *   of the round a bot spends near an enemy (Section 7.22). It decides
 *   `aggression`, `holdPosition` and `itemControl`.
 *
 * It holds no browser API, so the tests read it and the screen only draws it.
 */
import type { GameEvent } from "../core/events.js";
import type { TeamId } from "../sim/state.js";
import { tempoOf, tempoView, type ContactCounts } from "./tempo.js";

/** One weapon and what it did in the round. */
export interface WeaponBrief {
  weaponId: string;
  archetype: string;
  kills: number;
  /** The band that most of its kills landed at. */
  band: string;
  /** Kills by band, so a reader can see a weapon that works everywhere. */
  byBand: Readonly<Record<string, number>>;
}

export interface RoundBrief {
  roundNumber: number;
  kills: Record<TeamId, number>;
  /** Kills by the range band of the killing blow, both teams together. */
  killsByBand: Readonly<Record<string, number>>;
  /** The weapons that made a kill, most kills first. */
  weapons: WeaponBrief[];
  /** Kills on a bot that could not see its killer. A flank worked. */
  unawareKills: number;
  /** Seconds between kills, and how long a fight took, from the first hit. */
  killGapSeconds: number;
  timeToKillSeconds: number;
  /** The share of its living ticks that a bot spent with an enemy in sight. */
  contactShare: number;
  /** Items taken, by kind. */
  pickupsByKind: Readonly<Record<string, number>>;
}

function text(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function bump(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

export interface RoundBriefOptions {
  ticksPerSecond: number;
  multiKillWindowTicks: number;
  /** The contact counters of the bots, after the round (Section 7.22). */
  contact?: readonly ContactCounts[];
}

/**
 * Read one round out of a match log.
 *
 * A match keeps one bus, so its log holds every round. The events carry their
 * round number, which is how this picks one out.
 */
export function roundBrief(
  events: readonly GameEvent[],
  roundNumber: number,
  options: RoundBriefOptions,
): RoundBrief {
  const mine = events.filter((event) => event.roundNumber === roundNumber);

  const kills: Record<TeamId, number> = { A: 0, B: 0 };
  const killsByBand: Record<string, number> = {};
  const pickupsByKind: Record<string, number> = {};
  const byWeapon = new Map<string, { archetype: string; byBand: Record<string, number> }>();
  let unawareKills = 0;

  for (const event of mine) {
    if (event.type === "PickupTaken") {
      bump(pickupsByKind, text(event.data["kind"]));
      continue;
    }
    if (event.type !== "Kill") continue;

    const team = text(event.data["killerTeamId"]);
    if (team === "A" || team === "B") kills[team] += 1;
    const band = text(event.data["rangeBand"], "mid");
    bump(killsByBand, band);
    if (event.data["targetAware"] === false) unawareKills += 1;

    const weaponId = text(event.data["weaponId"]);
    let row = byWeapon.get(weaponId);
    if (!row) {
      row = { archetype: text(event.data["weaponArchetype"]), byBand: {} };
      byWeapon.set(weaponId, row);
    }
    bump(row.byBand, band);
  }

  const weapons: WeaponBrief[] = [...byWeapon.entries()]
    .map(([weaponId, row]) => {
      const total = Object.values(row.byBand).reduce((sum, count) => sum + count, 0);
      // The band that most of the kills landed at. A tie goes to the first in
      // close, mid, long order, so the answer does not move with the log.
      let band = "mid";
      let best = -1;
      for (const candidate of ["close", "mid", "long"]) {
        const count = row.byBand[candidate] ?? 0;
        if (count > best) {
          best = count;
          band = candidate;
        }
      }
      return { weaponId, archetype: row.archetype, kills: total, band, byBand: row.byBand };
    })
    .sort((a, b) => b.kills - a.kills || a.weaponId.localeCompare(b.weaponId));

  const tempo = tempoView(
    tempoOf(mine, {
      multiKillWindowTicks: options.multiKillWindowTicks,
      ...(options.contact ? { contact: options.contact } : {}),
    }),
    1,
  );
  const rate = Math.max(1, options.ticksPerSecond);

  return {
    roundNumber,
    kills,
    killsByBand,
    weapons,
    unawareKills,
    killGapSeconds: tempo.killGapMean / rate,
    timeToKillSeconds: tempo.timeToKill / rate,
    contactShare: tempo.contactShare,
    pickupsByKind,
  };
}
