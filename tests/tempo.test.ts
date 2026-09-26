import { describe, expect, it } from "vitest";
import { generateArena } from "../src/arena/generate.js";
import { loadArenaProfiles, loadDefaultTactics } from "../src/core/data.js";
import { EventBus, type GameEvent, type GameEventType } from "../src/core/events.js";
import { createRng, deriveSeed } from "../src/core/rng.js";
import { createSimState, runRound, simConfigFromTuning } from "../src/sim/index.js";
import { addTempo, emptyTempo, tempoOf, tempoView } from "../src/report/tempo.js";

const WINDOW = 60;

/** A small event log, written by hand, so a test can say what it expects. */
function event(type: GameEventType, tick: number, data: Record<string, unknown>): GameEvent {
  return { type, tick, roundNumber: 1, data };
}

function read(events: readonly GameEvent[]): ReturnType<typeof tempoOf> {
  return tempoOf(events, { multiKillWindowTicks: WINDOW });
}

describe("tempoOf: rhythm", () => {
  it("reads the gaps between kills, and their squares", () => {
    const record = read([
      event("Kill", 100, { killerId: "A0", victimId: "B0", killerTeamId: "A" }),
      event("Kill", 300, { killerId: "A1", victimId: "B1", killerTeamId: "A" }),
      event("Kill", 400, { killerId: "A2", victimId: "B2", killerTeamId: "A" }),
    ]);
    expect(record.kills).toBe(3);
    expect(record.firstKillTick).toBe(100);
    expect(record.killGaps).toBe(2);
    expect(record.killGapSum).toBe(300);
    expect(record.killGapSquareSum).toBe(200 * 200 + 100 * 100);
  });

  it("counts a burst and tells a trade from a double kill", () => {
    const record = read([
      event("Kill", 100, { killerId: "A0", victimId: "B0", killerTeamId: "A" }),
      // Inside the window, and the other team answered: a trade.
      event("Kill", 130, { killerId: "B1", victimId: "A0", killerTeamId: "B" }),
      // Inside the window, and the same team again: not a trade.
      event("Kill", 150, { killerId: "B1", victimId: "A1", killerTeamId: "B" }),
      // Outside the window: neither.
      event("Kill", 400, { killerId: "A2", victimId: "B2", killerTeamId: "A" }),
    ]);
    expect(record.burstKills).toBe(2);
    expect(record.tradeKills).toBe(1);
  });

  it("holds no kill as -1, not as 0", () => {
    // Tick 0 is a real tick, so a round with no kill cannot report 0.
    const record = read([event("Shot", 40, { shooterId: "A0", targetId: "B0" })]);
    expect(record.firstKillTick).toBe(-1);
    expect(record.openingTicks).toBe(40);
  });
});

describe("tempoOf: engagement", () => {
  it("measures from the first hit on that life to the kill", () => {
    const record = read([
      event("Hit", 100, { shooterId: "A0", targetId: "B0" }),
      event("Shot", 100, { shooterId: "A0", targetId: "B0" }),
      event("Hit", 120, { shooterId: "A0", targetId: "B0" }),
      event("Shot", 120, { shooterId: "A0", targetId: "B0" }),
      event("Kill", 140, { killerId: "A0", victimId: "B0", killerTeamId: "A" }),
    ]);
    expect(record.engagements).toBe(1);
    expect(record.timeToKillSum).toBe(40);
    expect(record.shotsToKillSum).toBe(2);
  });

  it("starts the count again after the victim comes back", () => {
    // Without this, the second life of a bot reads a time to kill that covers
    // the first life as well.
    const record = read([
      event("Hit", 100, { shooterId: "A0", targetId: "B0" }),
      event("Kill", 140, { killerId: "A0", victimId: "B0", killerTeamId: "A" }),
      event("Spawn", 200, { botId: "B0" }),
      event("Hit", 300, { shooterId: "A0", targetId: "B0" }),
      event("Kill", 310, { killerId: "A0", victimId: "B0", killerTeamId: "A" }),
    ]);
    expect(record.engagements).toBe(2);
    expect(record.timeToKillSum).toBe(40 + 10);
  });

  it("counts no engagement when the killer never hit that bot before", () => {
    // One shot of area damage can kill a bot that the killer never touched.
    const record = read([
      event("Kill", 140, { killerId: "A0", victimId: "B0", killerTeamId: "A" }),
    ]);
    expect(record.engagements).toBe(0);
    expect(record.kills).toBe(1);
  });
});

describe("tempoOf: downtime", () => {
  it("reads the dead time and the walk back to a fight", () => {
    const record = read([
      event("Death", 100, { botId: "A0" }),
      event("Spawn", 160, { botId: "A0" }),
      event("Shot", 250, { shooterId: "A0", targetId: "B0" }),
    ]);
    expect(record.deaths).toBe(1);
    expect(record.deadTicksSum).toBe(60);
    expect(record.returns).toBe(1);
    expect(record.returnTicksSum).toBe(90);
  });

  it("counts no return when the bot never fires again", () => {
    const record = read([
      event("Death", 100, { botId: "A0" }),
      event("Spawn", 160, { botId: "A0" }),
    ]);
    expect(record.returns).toBe(0);
  });
});

describe("tempoOf: swing", () => {
  it("counts the lead changes and the largest lead", () => {
    const kill = (tick: number, team: string): GameEvent =>
      event("Kill", tick, { killerId: `${team}0`, victimId: "X", killerTeamId: team });
    const record = read([
      kill(10, "A"),
      kill(20, "A"),
      kill(30, "A"),
      kill(40, "B"),
      kill(50, "B"),
      kill(60, "B"),
      kill(70, "B"),
    ]);
    expect(record.maxLead).toBe(3);
    expect(record.leadChanges).toBe(1);
    expect(record.killPairs).toBe(6);
    expect(record.sameTeamPairs).toBe(5);
  });
});

describe("tempoOf: item rhythm", () => {
  it("times a point from when it comes back to when a bot takes it", () => {
    const record = read([
      event("PickupRespawned", 500, { slotId: "powerup:0", kind: "powerup" }),
      event("PickupTaken", 505, { slotId: "powerup:0", kind: "powerup", botId: "A0" }),
    ]);
    expect(record.pickupWaitCount["powerup"]).toBe(1);
    expect(record.pickupWaitTicks["powerup"]).toBe(5);
  });

  it("skips the first take of a round, which had no respawn to time", () => {
    const record = read([
      event("PickupTaken", 40, { slotId: "health:0", kind: "health", botId: "A0" }),
    ]);
    expect(record.pickupWaitCount["health"]).toBeUndefined();
  });
});

describe("addTempo and tempoView", () => {
  it("adds rounds, and the view takes the means at the end", () => {
    const one = read([
      event("Kill", 100, { killerId: "A0", victimId: "B0", killerTeamId: "A" }),
      event("Kill", 200, { killerId: "A1", victimId: "B1", killerTeamId: "A" }),
    ]);
    const two = read([
      event("Kill", 50, { killerId: "B0", victimId: "A0", killerTeamId: "B" }),
      event("Kill", 350, { killerId: "B1", victimId: "A1", killerTeamId: "B" }),
    ]);
    const total = emptyTempo();
    addTempo(total, one);
    addTempo(total, two);

    expect(total.kills).toBe(4);
    expect(total.killGapSum).toBe(100 + 300);
    // The ticks of the first kill hold a sum, so the view can take the mean.
    expect(total.firstKillTick).toBe(150);

    const view = tempoView(total, 2);
    expect(view.killGapMean).toBe(200);
    expect(view.killGapSd).toBe(100);
    expect(view.burstiness).toBeCloseTo(0.5, 6);
    expect(view.firstKillTick).toBe(75);
    expect(view.sameTeamNext).toBe(1);
  });

  it("gives zero, not NaN, for a batch with no round", () => {
    const view = tempoView(emptyTempo(), 0);
    expect(view.killGapMean).toBe(0);
    expect(view.timeToKill).toBe(0);
    expect(view.contactShare).toBe(0);
    expect(view.firstKillTick).toBe(0);
  });

  it("reads the contact share from the counters of the bots", () => {
    const record = tempoOf([], {
      multiKillWindowTicks: WINDOW,
      contact: [
        { aliveTicks: 100, contactTicks: 25 },
        { aliveTicks: 100, contactTicks: 75 },
      ],
    });
    expect(tempoView(record, 1).contactShare).toBe(0.5);
  });
});

describe("the simulation counts contact", () => {
  it("counts alive ticks and contact ticks in a real round", () => {
    // The two counters are the one part of tempo that no event carries, so
    // they need the simulation (Section 7.22).
    const profiles = loadArenaProfiles();
    const profile = profiles.profiles["bastion"];
    expect(profile).toBeDefined();
    const seed = deriveSeed(4242, "tempo");
    const map = generateArena(profile!, createRng(seed, "arena"), seed, {
      rules: profiles.rules,
    });
    const config = simConfigFromTuning();
    const state = createSimState({
      map,
      seed,
      config,
      bus: new EventBus(),
      tactics: loadDefaultTactics(),
    });
    const result = runRound(state);

    for (const bot of state.bots) {
      expect(bot.aliveTicks).toBeGreaterThan(0);
      expect(bot.aliveTicks).toBeLessThanOrEqual(result.outcome.ticks);
      expect(bot.contactTicks).toBeGreaterThan(0);
      expect(bot.contactTicks).toBeLessThanOrEqual(bot.aliveTicks);
    }

    const record = tempoOf(result.events, {
      multiKillWindowTicks: config.multiKillWindowTicks,
      contact: state.bots,
    });
    expect(record.kills).toBe(state.score.A + state.score.B);
    expect(record.deaths).toBeGreaterThan(0);
    const view = tempoView(record, 1);
    expect(view.contactShare).toBeGreaterThan(0);
    expect(view.contactShare).toBeLessThanOrEqual(1);
    expect(view.killGapMean).toBeGreaterThan(0);
  });
});
