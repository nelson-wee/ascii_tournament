import { describe, expect, it } from "vitest";
import { generateArena } from "../src/arena/generate.js";
import { loadArenaProfiles, loadDefaultTactics } from "../src/core/data.js";
import { EventBus, type GameEvent, type GameEventType } from "../src/core/events.js";
import { createRng, deriveSeed } from "../src/core/rng.js";
import { roundBrief } from "../src/report/roundBrief.js";
import {
  createSession,
  matchSeedOf,
  matchSeedsOf,
  nextMatch,
  type Session,
} from "../src/meta/session.js";
import { createSimState, runRound, simConfigFromTuning } from "../src/sim/index.js";

function event(
  type: GameEventType,
  tick: number,
  roundNumber: number,
  data: Record<string, unknown>,
): GameEvent {
  return { type, tick, roundNumber, data };
}

const OPTIONS = { ticksPerSecond: 20, multiKillWindowTicks: 60 };

describe("roundBrief", () => {
  it("reads one round out of a log that holds the whole match", () => {
    const events = [
      event("Kill", 10, 1, { killerTeamId: "A", rangeBand: "close", weaponId: "w1" }),
      event("Kill", 20, 2, { killerTeamId: "B", rangeBand: "long", weaponId: "w2" }),
      event("Kill", 30, 2, { killerTeamId: "B", rangeBand: "long", weaponId: "w2" }),
    ];
    const brief = roundBrief(events, 2, OPTIONS);
    expect(brief.roundNumber).toBe(2);
    expect(brief.kills).toEqual({ A: 0, B: 2 });
    expect(brief.killsByBand).toEqual({ long: 2 });
    expect(brief.weapons).toHaveLength(1);
  });

  it("names the band that most of a weapon's kills landed at", () => {
    const events = [
      event("Kill", 10, 1, { killerTeamId: "A", rangeBand: "close", weaponId: "w", weaponArchetype: "assault" }),
      event("Kill", 20, 1, { killerTeamId: "A", rangeBand: "long", weaponId: "w", weaponArchetype: "assault" }),
      event("Kill", 30, 1, { killerTeamId: "A", rangeBand: "long", weaponId: "w", weaponArchetype: "assault" }),
    ];
    const brief = roundBrief(events, 1, OPTIONS);
    expect(brief.weapons[0]?.band).toBe("long");
    expect(brief.weapons[0]?.kills).toBe(3);
    expect(brief.weapons[0]?.archetype).toBe("assault");
    expect(brief.weapons[0]?.byBand).toEqual({ close: 1, long: 2 });
  });

  it("puts the weapon with the most kills first", () => {
    const events = [
      event("Kill", 10, 1, { killerTeamId: "A", rangeBand: "mid", weaponId: "few" }),
      event("Kill", 20, 1, { killerTeamId: "A", rangeBand: "mid", weaponId: "many" }),
      event("Kill", 30, 1, { killerTeamId: "A", rangeBand: "mid", weaponId: "many" }),
    ];
    expect(roundBrief(events, 1, OPTIONS).weapons.map((w) => w.weaponId)).toEqual(["many", "few"]);
  });

  it("counts the items taken and the kills from behind", () => {
    const events = [
      event("PickupTaken", 5, 1, { kind: "health" }),
      event("PickupTaken", 6, 1, { kind: "health" }),
      event("PickupTaken", 7, 1, { kind: "weapon" }),
      event("Kill", 10, 1, { killerTeamId: "A", rangeBand: "mid", weaponId: "w", targetAware: false }),
    ];
    const brief = roundBrief(events, 1, OPTIONS);
    expect(brief.pickupsByKind).toEqual({ health: 2, weapon: 1 });
    expect(brief.unawareKills).toBe(1);
  });

  it("gives zero, not NaN, for a round with no kill", () => {
    const brief = roundBrief([], 1, OPTIONS);
    expect(brief.killGapSeconds).toBe(0);
    expect(brief.timeToKillSeconds).toBe(0);
    expect(brief.contactShare).toBe(0);
    expect(brief.weapons).toEqual([]);
  });

  it("reads a real round, and the seconds are seconds", () => {
    const profiles = loadArenaProfiles();
    const profile = profiles.profiles["bastion"];
    expect(profile).toBeDefined();
    const seed = deriveSeed(31415, "brief");
    const map = generateArena(profile!, createRng(seed, "arena"), seed, { rules: profiles.rules });
    const config = simConfigFromTuning();
    const state = createSimState({
      map,
      seed,
      config,
      bus: new EventBus(),
      tacticsOverride: loadDefaultTactics(),
    });
    const result = runRound(state);

    const brief = roundBrief(result.events, 1, {
      ticksPerSecond: config.ticksPerSecond,
      multiKillWindowTicks: config.multiKillWindowTicks,
      bots: state.bots,
    });
    expect(brief.kills.A + brief.kills.B).toBe(state.score.A + state.score.B);
    expect(brief.killGapSeconds).toBeGreaterThan(0);
    // A round runs about two minutes, so a kill every few seconds.
    expect(brief.killGapSeconds).toBeLessThan(result.outcome.ticks / config.ticksPerSecond);
    expect(brief.contactShare).toBeGreaterThan(0);
    expect(brief.contactShare).toBeLessThanOrEqual(1);
  });
});

describe("the weapons of a tournament (Section 7.25)", () => {
  function play(session: Session, matches: number): { arenas: string[]; weapons: string[][] } {
    const arenas: string[] = [];
    const weapons: string[][] = [];
    for (let i = 0; i < matches; i += 1) {
      const setup = nextMatch(session);
      arenas.push(setup.arena.name);
      weapons.push(setup.weapons.map((weapon) => weapon.id));
      session.matchNumber += 1;
    }
    return { arenas, weapons };
  }

  it("keeps one weapon set for the whole tournament, and changes the ground", () => {
    // Option B. A weapon preference cannot be a tactic while the weapons change
    // before a player can learn them.
    const session = createSession({ mode: "tournament", seed: 20260928 });
    const { arenas, weapons } = play(session, 4);

    expect(new Set(weapons.map((set) => set.join(","))).size).toBe(1);
    expect(new Set(arenas).size).toBe(4);
  });

  it("changes the spawn table between matches, with the same weapons", () => {
    const session = createSession({ mode: "tournament", seed: 99, style: "bastion" });
    const one = nextMatch(session);
    session.matchNumber += 1;
    const two = nextMatch(session);

    expect(two.weapons.map((w) => w.id)).toEqual(one.weapons.map((w) => w.id));
    expect(two.seeds.spawnTable).not.toBe(one.seeds.spawnTable);
  });

  it("gives test mode a new weapon set every match, until the lobby pins one", () => {
    const session = createSession({ mode: "test", seed: 20260928, style: "cavern" });
    expect(session.pinned).toEqual({});
    const { weapons } = play(session, 3);
    expect(new Set(weapons.map((set) => set.join(","))).size).toBe(3);

    // What the lobby does: hold the weapons, and let the ground move.
    session.pinned = { weapons: 4242 };
    const after = play(session, 2);
    expect(after.weapons[0]).toEqual(after.weapons[1]);
  });

  it("lets a ticket win over what the session pinned", () => {
    // A ticket names one match exactly, so it must beat a pin.
    const session = createSession({ mode: "tournament", seed: 7 });
    const pinned = nextMatch(session);
    const asked = nextMatch(session, { weapons: 8888 });
    expect(pinned.seeds.weapons).not.toBe(8888);
    expect(asked.seeds.weapons).toBe(8888);
    expect(asked.arena.name).toBe(pinned.arena.name);
  });

  it("pins the weapons of a tournament to the session seed, not to a match", () => {
    const session = createSession({ mode: "tournament", seed: 555 });
    const perMatch = matchSeedsOf(matchSeedOf(555, 1));
    expect(session.pinned.weapons).toBeDefined();
    expect(session.pinned.weapons).not.toBe(perMatch.weapons);
    expect(nextMatch(session).seeds.weapons).toBe(session.pinned.weapons);
  });
});

describe("the per-bot view (Section 7.27)", () => {
  const BOTS = [
    { id: "A0", teamId: "A" as const, role: "tank", aliveTicks: 100, contactTicks: 40 },
    { id: "A1", teamId: "A" as const, role: "overwatch", aliveTicks: 100, contactTicks: 10 },
    { id: "B0", teamId: "B" as const, role: "tank", aliveTicks: 80, contactTicks: 40 },
  ];
  const WITH_BOTS = { ...OPTIONS, bots: BOTS };

  function kill(tick: number, killer: string, victim: string, extra: Record<string, unknown> = {}) {
    return [
      event("Kill", tick, 1, {
        killerId: killer,
        victimId: victim,
        killerTeamId: killer.slice(0, 1),
        rangeBand: "mid",
        weaponId: "w1",
        weaponArchetype: "assault",
        ...extra,
      }),
      event("Death", tick, 1, { botId: victim }),
    ];
  }

  it("gives every bot a row, in the order the caller gave", () => {
    const brief = roundBrief(kill(10, "A0", "B0"), 1, WITH_BOTS);
    expect(brief.bots.map((bot) => bot.botId)).toEqual(["A0", "A1", "B0"]);
    expect(brief.bots.map((bot) => bot.role)).toEqual(["tank", "overwatch", "tank"]);
  });

  it("counts the kills and the deaths of each bot", () => {
    const events = [...kill(10, "A0", "B0"), ...kill(30, "A0", "B0"), ...kill(50, "B0", "A1")];
    const brief = roundBrief(events, 1, WITH_BOTS);
    const [a0, a1, b0] = brief.bots;
    expect(a0?.kills).toBe(2);
    expect(a0?.deaths).toBe(0);
    expect(a1?.kills).toBe(0);
    expect(a1?.deaths).toBe(1);
    expect(b0?.kills).toBe(1);
    expect(b0?.deaths).toBe(2);
  });

  it("gives the kills as the ratio when a bot never died", () => {
    // Dividing by zero would read as infinity, and a bot that never died is
    // the best case, not an undefined one.
    const brief = roundBrief([...kill(10, "A0", "B0"), ...kill(20, "A0", "B0")], 1, WITH_BOTS);
    expect(brief.bots[0]?.ratio).toBe(2);
    expect(brief.bots[2]?.ratio).toBe(0);
  });

  it("names the weapons a bot killed with, most kills first", () => {
    const events = [
      ...kill(10, "A0", "B0", { weaponId: "rare" }),
      ...kill(20, "A0", "B0", { weaponId: "common" }),
      ...kill(30, "A0", "B0", { weaponId: "common" }),
    ];
    const brief = roundBrief(events, 1, WITH_BOTS);
    expect(brief.bots[0]?.weapons.map((w) => w.weaponId)).toEqual(["common", "rare"]);
    expect(brief.bots[0]?.weapons[0]?.kills).toBe(2);
    expect(brief.bots[1]?.weapons).toEqual([]);
  });

  it("reads the contact share of each bot from its own counters", () => {
    const brief = roundBrief([], 1, WITH_BOTS);
    expect(brief.bots[0]?.contactShare).toBeCloseTo(0.4, 10);
    expect(brief.bots[1]?.contactShare).toBeCloseTo(0.1, 10);
    expect(brief.bots[2]?.contactShare).toBeCloseTo(0.5, 10);
  });

  it("counts a kill from behind against the bot that made it", () => {
    const brief = roundBrief(kill(10, "A0", "B0", { targetAware: false }), 1, WITH_BOTS);
    expect(brief.bots[0]?.unawareKills).toBe(1);
    expect(brief.unawareKills).toBe(1);
  });

  it("gives an empty list when the caller gave no bots", () => {
    // A role and a team cannot be read from the event log.
    expect(roundBrief(kill(10, "A0", "B0"), 1, OPTIONS).bots).toEqual([]);
  });
});
