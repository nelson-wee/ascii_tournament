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
import { tempoOf, tempoView } from "./tempo.js";

/**
 * What the round knows about one bot, from outside the simulation.
 *
 * `state.bots` satisfies this, so the caller hands the bots straight over.
 */
export interface BotFacts {
  id: string;
  teamId: TeamId;
  role: string;
  aliveTicks: number;
  contactTicks: number;
}

/**
 * One bot and what it did in the round (Section 7.27).
 *
 * The round view says which weapon did the work; it cannot say **which bot**
 * did it, so it cannot say whether a role earns its place on this ground. This
 * can.
 */
export interface BotBrief {
  botId: string;
  teamId: TeamId;
  role: string;
  kills: number;
  deaths: number;
  /**
   * Kills over deaths. A round with no death gives the kills, because dividing
   * by zero would read as infinity and a bot that never died is the best case,
   * not an undefined one.
   */
  ratio: number;
  /** The weapons it killed with, most kills first. */
  weapons: { weaponId: string; archetype: string; kills: number }[];
  /** Its kills by range band: where this bot did its fighting. */
  byBand: Readonly<Record<string, number>>;
  /** Kills it made on a bot that could not see it. */
  unawareKills: number;
  /** The share of its living ticks with an enemy in sight. */
  contactShare: number;
}

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
  /**
   * One row per bot, team A first, in slot order (Section 7.27). Empty when
   * the caller gave no bots, because a role and a team cannot be read from the
   * event log.
   */
  bots: BotBrief[];
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
  /**
   * The bots, after the round. `state.bots` fits.
   *
   * It carries two things the log does not: the contact counters of
   * Section 7.22, and the role of each bot, which is what the per-bot view
   * needs to answer "does this role earn its place here".
   */
  bots?: readonly BotFacts[];
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

  // Per bot, keyed by id. Every bot gets a row, so a bot that made no kill is
  // on the list with a zero, which is itself the answer to a question.
  const perBot = new Map<
    string,
    { kills: number; deaths: number; byBand: Record<string, number>; unaware: number;
      weapons: Map<string, { archetype: string; kills: number }> }
  >();
  const botRow = (id: string) => {
    let row = perBot.get(id);
    if (!row) {
      row = { kills: 0, deaths: 0, byBand: {}, unaware: 0, weapons: new Map() };
      perBot.set(id, row);
    }
    return row;
  };
  for (const bot of options.bots ?? []) botRow(bot.id);

  for (const event of mine) {
    if (event.type === "PickupTaken") {
      bump(pickupsByKind, text(event.data["kind"]));
      continue;
    }
    if (event.type === "Death") {
      // A death, not a kill: it counts every way a bot can go down.
      botRow(text(event.data["botId"])).deaths += 1;
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

    const killer = botRow(text(event.data["killerId"]));
    killer.kills += 1;
    bump(killer.byBand, band);
    if (event.data["targetAware"] === false) killer.unaware += 1;
    const held = killer.weapons.get(weaponId);
    if (held) held.kills += 1;
    else killer.weapons.set(weaponId, { archetype: text(event.data["weaponArchetype"]), kills: 1 });
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
      ...(options.bots ? { contact: options.bots } : {}),
    }),
    1,
  );
  const rate = Math.max(1, options.ticksPerSecond);

  // Team A first, then in the order the caller gave, which is slot order.
  const bots: BotBrief[] = (options.bots ?? []).map((bot) => {
    const row = botRow(bot.id);
    const weapons = [...row.weapons.entries()]
      .map(([weaponId, held]) => ({ weaponId, archetype: held.archetype, kills: held.kills }))
      .sort((a, b) => b.kills - a.kills || a.weaponId.localeCompare(b.weaponId));
    return {
      botId: bot.id,
      teamId: bot.teamId,
      role: bot.role,
      kills: row.kills,
      deaths: row.deaths,
      ratio: row.deaths === 0 ? row.kills : row.kills / row.deaths,
      weapons,
      byBand: row.byBand,
      unawareKills: row.unaware,
      contactShare: bot.aliveTicks === 0 ? 0 : bot.contactTicks / bot.aliveTicks,
    };
  });

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
    bots,
  };
}
