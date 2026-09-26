/**
 * Tempo: the rhythm of a round (dev-guide Section 7.22).
 *
 * Every other number in a round record is a **total**: kills, shots, pickups,
 * ticks. A total cannot tell a steady drip of kills from five short fights with
 * long walks between them. Those are opposite games, and they read the same.
 *
 * This module reads the event log, which already carries a tick on every event,
 * and turns it into the distribution over time. Only one input comes from
 * outside the log: the contact counters, because perception state is not an
 * event.
 *
 * **Every field is a sum or a count, never a mean.** A sum adds over rounds and
 * a mean does not, so a batch can add the records of 1000 rounds and take the
 * means at the end. The helpers at the foot of the file do that last step.
 */
import type { GameEvent } from "../core/events.js";

/** The contact counters of one bot, from `BotState` (Section 7.22). */
export interface ContactCounts {
  aliveTicks: number;
  contactTicks: number;
}

export interface TempoRecord {
  // --- Rhythm: is the round a steady drip, or a set of fights? -------------
  /** The tick of the first kill, or -1 when the round made none. */
  firstKillTick: number;
  /** The tick of the first shot, which is the walk from the spawn to a fight. */
  openingTicks: number;
  kills: number;
  /** Gaps between kills: one less than the kills, per round. */
  killGaps: number;
  killGapSum: number;
  /** The squares, so a batch can take the standard deviation of the gap. */
  killGapSquareSum: number;
  /** Kills inside `multiKillWindowTicks` of the kill before them. */
  burstKills: number;
  /** Of those, the ones where the other team made the kill before: a trade. */
  tradeKills: number;

  // --- Engagement: how long does a fight last? -----------------------------
  /** Kills where the killer had already hit that victim in this life. */
  engagements: number;
  /** Ticks from the first hit to the kill, summed over those. */
  timeToKillSum: number;
  /** Shots that the killer aimed at that victim in the same time. */
  shotsToKillSum: number;

  // --- Downtime: what share of a round is not fighting? --------------------
  deaths: number;
  /** Ticks from a death to the respawn that followed it. */
  deadTicksSum: number;
  /** Respawns that were followed by a shot from the same bot. */
  returns: number;
  /** Ticks from a respawn to the next shot by that bot: the walk back. */
  returnTicksSum: number;

  // --- Contact: how much of the round does a bot spend near an enemy? ------
  aliveTicksSum: number;
  contactTicksSum: number;

  // --- Swing: does an advantage compound? ----------------------------------
  /** How often the leading team changed. A round at 0 never had a comeback. */
  leadChanges: number;
  /** The largest lead that either team held, in kills. */
  maxLead: number;
  /** Consecutive pairs of kills: one less than the kills. */
  killPairs: number;
  /** Pairs where one team made both kills. Above half of the pairs snowballs. */
  sameTeamPairs: number;

  // --- Item rhythm: is the economy played, or only walked into? ------------
  /**
   * Points taken after a respawn, by kind, and the ticks that they waited. A
   * power-up taken 2 ticks after it lands means a team stood on it. Ninety
   * seconds means that nobody timed it.
   *
   * The first take of a round is not counted: the points all start ready, so
   * there is no respawn to time.
   */
  pickupWaitCount: Record<string, number>;
  pickupWaitTicks: Record<string, number>;
}

export function emptyTempo(): TempoRecord {
  return {
    firstKillTick: -1,
    openingTicks: -1,
    kills: 0,
    killGaps: 0,
    killGapSum: 0,
    killGapSquareSum: 0,
    burstKills: 0,
    tradeKills: 0,
    engagements: 0,
    timeToKillSum: 0,
    shotsToKillSum: 0,
    deaths: 0,
    deadTicksSum: 0,
    returns: 0,
    returnTicksSum: 0,
    aliveTicksSum: 0,
    contactTicksSum: 0,
    leadChanges: 0,
    maxLead: 0,
    killPairs: 0,
    sameTeamPairs: 0,
    pickupWaitCount: {},
    pickupWaitTicks: {},
  };
}

export interface TempoOptions {
  /** `combat.multiKillWindowTicks`. It decides what counts as one burst. */
  multiKillWindowTicks: number;
  /** The contact counters of every bot, after the round. */
  contact?: readonly ContactCounts[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "unknown";
}

function bump(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

/**
 * Read the tempo of one round from its event log.
 *
 * The log must hold one round. `runPlannedRound` gives each round its own bus,
 * so it already does; a match bus holds every round of the match, and the
 * caller must split it first.
 */
export function tempoOf(events: readonly GameEvent[], options: TempoOptions): TempoRecord {
  const out = emptyTempo();
  const burstWindow = options.multiKillWindowTicks;

  // The first hit that each shooter landed on each target in its current life,
  // and the shots that the shooter aimed at it. Both clear when the target
  // dies, because the next life is a new fight.
  const firstHitTick = new Map<string, number>();
  const shotsAtTarget = new Map<string, number>();
  const deathTick = new Map<string, number>();
  const spawnTick = new Map<string, number>();
  const readyTick = new Map<string, number>();

  let lastKillTick = -1;
  let lastKillTeam = "";
  let scoreA = 0;
  let scoreB = 0;
  let leader = "";

  for (const event of events) {
    const data = event.data;

    if (event.type === "Shot") {
      if (out.openingTicks < 0) out.openingTicks = event.tick;
      const shooter = text(data["shooterId"]);
      const at = `${shooter}>${text(data["targetId"])}`;
      shotsAtTarget.set(at, (shotsAtTarget.get(at) ?? 0) + 1);
      const spawned = spawnTick.get(shooter);
      if (spawned !== undefined) {
        out.returns += 1;
        out.returnTicksSum += event.tick - spawned;
        spawnTick.delete(shooter);
      }
      continue;
    }

    if (event.type === "Hit") {
      const key = `${text(data["shooterId"])}>${text(data["targetId"])}`;
      if (!firstHitTick.has(key)) firstHitTick.set(key, event.tick);
      continue;
    }

    if (event.type === "Spawn") {
      const bot = text(data["botId"]);
      const died = deathTick.get(bot);
      if (died !== undefined) {
        out.deaths += 1;
        out.deadTicksSum += event.tick - died;
        deathTick.delete(bot);
      }
      spawnTick.set(bot, event.tick);
      continue;
    }

    if (event.type === "Death") {
      deathTick.set(text(data["botId"]), event.tick);
      continue;
    }

    if (event.type === "PickupRespawned") {
      readyTick.set(text(data["slotId"]), event.tick);
      continue;
    }

    if (event.type === "PickupTaken") {
      const slot = text(data["slotId"]);
      const ready = readyTick.get(slot);
      if (ready !== undefined) {
        const kind = text(data["kind"]);
        bump(out.pickupWaitCount, kind);
        bump(out.pickupWaitTicks, kind, event.tick - ready);
        readyTick.delete(slot);
      }
      continue;
    }

    if (event.type !== "Kill") continue;

    const killer = text(data["killerId"]);
    const victim = text(data["victimId"]);
    const team = text(data["killerTeamId"]);

    out.kills += 1;
    if (out.firstKillTick < 0) out.firstKillTick = event.tick;

    if (lastKillTick >= 0) {
      const gap = event.tick - lastKillTick;
      out.killGaps += 1;
      out.killGapSum += gap;
      out.killGapSquareSum += gap * gap;
      out.killPairs += 1;
      if (team === lastKillTeam) out.sameTeamPairs += 1;
      if (gap <= burstWindow) {
        out.burstKills += 1;
        if (team !== lastKillTeam) out.tradeKills += 1;
      }
    }
    lastKillTick = event.tick;
    lastKillTeam = team;

    // The engagement that this kill ended.
    const key = `${killer}>${victim}`;
    const opened = firstHitTick.get(key);
    if (opened !== undefined) {
      out.engagements += 1;
      out.timeToKillSum += event.tick - opened;
      out.shotsToKillSum += shotsAtTarget.get(key) ?? 0;
    }
    // The victim starts a new life, so every fight against it starts again.
    for (const held of [...firstHitTick.keys()]) {
      if (held.endsWith(`>${victim}`)) firstHitTick.delete(held);
    }
    for (const held of [...shotsAtTarget.keys()]) {
      if (held.endsWith(`>${victim}`)) shotsAtTarget.delete(held);
    }

    if (team === "A") scoreA += 1;
    else if (team === "B") scoreB += 1;
    const lead = scoreA - scoreB;
    out.maxLead = Math.max(out.maxLead, Math.abs(lead));
    const ahead = lead > 0 ? "A" : lead < 0 ? "B" : "";
    if (ahead !== "" && leader !== "" && ahead !== leader) out.leadChanges += 1;
    if (ahead !== "") leader = ahead;
  }

  for (const bot of options.contact ?? []) {
    out.aliveTicksSum += bot.aliveTicks;
    out.contactTicksSum += bot.contactTicks;
  }
  return out;
}

/** Add the tempo of one round into a running total, for a batch. */
export function addTempo(total: TempoRecord, round: TempoRecord): void {
  total.kills += round.kills;
  total.killGaps += round.killGaps;
  total.killGapSum += round.killGapSum;
  total.killGapSquareSum += round.killGapSquareSum;
  total.burstKills += round.burstKills;
  total.tradeKills += round.tradeKills;
  total.engagements += round.engagements;
  total.timeToKillSum += round.timeToKillSum;
  total.shotsToKillSum += round.shotsToKillSum;
  total.deaths += round.deaths;
  total.deadTicksSum += round.deadTicksSum;
  total.returns += round.returns;
  total.returnTicksSum += round.returnTicksSum;
  total.aliveTicksSum += round.aliveTicksSum;
  total.contactTicksSum += round.contactTicksSum;
  total.leadChanges += round.leadChanges;
  total.maxLead += round.maxLead;
  total.killPairs += round.killPairs;
  total.sameTeamPairs += round.sameTeamPairs;
  for (const [kind, count] of Object.entries(round.pickupWaitCount)) {
    bump(total.pickupWaitCount, kind, count);
  }
  for (const [kind, ticks] of Object.entries(round.pickupWaitTicks)) {
    bump(total.pickupWaitTicks, kind, ticks);
  }
  // A tick is a round number, so summing it is meaningless. `firstKillTick`
  // and `openingTicks` hold their own sums in a total, and -1 means "none".
  if (round.firstKillTick >= 0) {
    total.firstKillTick = Math.max(0, total.firstKillTick) + round.firstKillTick;
  }
  if (round.openingTicks >= 0) {
    total.openingTicks = Math.max(0, total.openingTicks) + round.openingTicks;
  }
}

/**
 * The numbers that a reader wants, from the sums.
 *
 * `rounds` is how many rounds went into the total. It is needed for the two
 * fields that a total holds as a sum of per-round ticks.
 */
export interface TempoView {
  /** Mean ticks between kills, and the standard deviation of that gap. */
  killGapMean: number;
  killGapSd: number;
  /** The gap over its own mean. Above 1 means the kills arrive in bursts. */
  burstiness: number;
  /** Share of kills that landed inside the multi-kill window of another. */
  burstShare: number;
  /** Share of kills that answered a kill by the other team inside the window. */
  tradeShare: number;
  /** Mean ticks from the first hit on a victim to the kill. */
  timeToKill: number;
  /** Mean shots that the killer aimed at the victim in that time. */
  shotsToKill: number;
  /** Mean ticks from a death to the respawn. */
  deadTicks: number;
  /** Mean ticks from a respawn to the next shot: the walk back to a fight. */
  returnTicks: number;
  /** Share of the alive ticks of a bot with an enemy in sight. */
  contactShare: number;
  /** Mean ticks to the first kill and to the first shot of a round. */
  firstKillTick: number;
  openingTicks: number;
  /** Mean lead changes and mean largest lead, per round. */
  leadChanges: number;
  maxLead: number;
  /**
   * The chance that the next kill goes to the team that made the last one.
   * Above 0.5 says that an advantage compounds.
   */
  sameTeamNext: number;
  /** Mean ticks that a point waited after it came back, by kind. */
  pickupWait: Record<string, number>;
}

function over(sum: number, count: number): number {
  return count > 0 ? sum / count : 0;
}

export function tempoView(total: TempoRecord, rounds: number): TempoView {
  const mean = over(total.killGapSum, total.killGaps);
  const variance = Math.max(0, over(total.killGapSquareSum, total.killGaps) - mean * mean);
  const sd = Math.sqrt(variance);
  const pickupWait: Record<string, number> = {};
  for (const [kind, ticks] of Object.entries(total.pickupWaitTicks)) {
    pickupWait[kind] = over(ticks, total.pickupWaitCount[kind] ?? 0);
  }
  return {
    killGapMean: mean,
    killGapSd: sd,
    burstiness: mean > 0 ? sd / mean : 0,
    burstShare: over(total.burstKills, total.kills),
    tradeShare: over(total.tradeKills, total.kills),
    timeToKill: over(total.timeToKillSum, total.engagements),
    shotsToKill: over(total.shotsToKillSum, total.engagements),
    deadTicks: over(total.deadTicksSum, total.deaths),
    returnTicks: over(total.returnTicksSum, total.returns),
    contactShare: over(total.contactTicksSum, total.aliveTicksSum),
    firstKillTick: over(Math.max(0, total.firstKillTick), rounds),
    openingTicks: over(Math.max(0, total.openingTicks), rounds),
    leadChanges: over(total.leadChanges, rounds),
    maxLead: over(total.maxLead, rounds),
    sameTeamNext: over(total.sameTeamPairs, total.killPairs),
    pickupWait,
  };
}
