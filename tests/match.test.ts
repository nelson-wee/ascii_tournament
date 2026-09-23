/**
 * Matches, roles, and team tactics (dev-guide Sections 7.4 and 7.11, M8).
 */
import { describe, expect, it } from "vitest";
import { loadTestArena } from "../src/arena/index.js";
import { loadDefaultTactics, loadRoles } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng } from "../src/core/rng.js";
import { generateWeaponSet } from "../src/weapons/generate.js";
import {
  createRoundState,
  createSimState,
  rollSpawnTable,
  runMatch,
  simConfigFromTuning,
  ROLES,
  type MatchPlan,
  type Role,
} from "../src/sim/index.js";

const config = simConfigFromTuning();

function weaponsFor(seed: number) {
  return generateWeaponSet(createRng(seed, "weapons"), config.weaponsPerRun, {
    ticksPerSecond: config.ticksPerSecond,
  });
}

function matchOptions(seed = 1, bus = new EventBus()) {
  return { map: loadTestArena(), weapons: weaponsFor(seed), seed, bus };
}

describe("runMatch", () => {
  it("plays a best-of-3 and names a winner", () => {
    const result = runMatch(matchOptions(1));
    expect(result.rounds.length).toBeGreaterThanOrEqual(config.roundWinsToWinMatch);
    expect(result.rounds.length).toBeLessThanOrEqual(config.maxRounds);
    expect(result.winnerTeamId).not.toBeNull();
    expect(result.roundWins[result.winnerTeamId!]).toBeGreaterThanOrEqual(
      config.roundWinsToWinMatch,
    );
  });

  it("stops as soon as a team has the rounds it needs", () => {
    const result = runMatch(matchOptions(2));
    const winner = result.winnerTeamId;
    if (winner === null) return;
    const loser = winner === "A" ? "B" : "A";
    // No round is played after the match is decided.
    expect(result.roundWins[winner]).toBe(config.roundWinsToWinMatch);
    expect(result.roundWins[loser]).toBeLessThan(config.roundWinsToWinMatch);
  });

  it("says the match started and ended", () => {
    const bus = new EventBus();
    runMatch(matchOptions(3, bus));
    expect(bus.filter("MatchStart")).toHaveLength(1);
    expect(bus.filter("MatchEnd")).toHaveLength(1);
    expect(bus.filter("RoundStart").length).toBe(bus.filter("RoundEnd").length);
  });

  it("keeps the same spawn table for every round", () => {
    // Section 2.2: one spawn table per match.
    const bus = new EventBus();
    const result = runMatch(matchOptions(4, bus));
    const start = bus.filter("MatchStart")[0];
    expect(start?.data["spawnTable"]).toEqual(result.spawnTable.slots);
  });

  it("gives the same result for the same seed", () => {
    const first = runMatch(matchOptions(5));
    const second = runMatch(matchOptions(5));
    expect(second.roundWins).toEqual(first.roundWins);
    expect(second.rounds.map((round) => round.score)).toEqual(
      first.rounds.map((round) => round.score),
    );
  });

  it("asks for the tactics before every round", () => {
    const seen: number[] = [];
    const result = runMatch({
      ...matchOptions(6),
      getTactics: (roundNumber) => {
        seen.push(roundNumber);
        return {};
      },
    });
    expect(seen).toEqual(result.rounds.map((_round, index) => index + 1));
  });

  it("lets the plan change the tactics between rounds", () => {
    const bold = { ...loadDefaultTactics(), aggression: 0.95 };
    const shy = { ...loadDefaultTactics(), aggression: 0.05 };
    const plan = (tactics: typeof bold): MatchPlan => ({ A: { tactics } });

    const boldBus = new EventBus();
    runMatch({ ...matchOptions(7, boldBus), getTactics: () => plan(bold) });
    const changedBus = new EventBus();
    runMatch({
      ...matchOptions(7, changedBus),
      getTactics: (roundNumber) => plan(roundNumber === 1 ? bold : shy),
    });

    // Round 1 is the same in both matches, and the rounds after it are not.
    const shots = (bus: EventBus, round: number): number =>
      bus.log.filter((event) => event.type === "Shot" && event.roundNumber === round).length;
    expect(shots(changedBus, 1)).toBe(shots(boldBus, 1));
    expect(shots(changedBus, 2)).not.toBe(shots(boldBus, 2));
  });
});

describe("createRoundState", () => {
  it("gives the bots the tactics and the roles of the plan", () => {
    const options = matchOptions(8);
    const spawnTable = rollSpawnTable(options.map, options.weapons, createRng(8, "weapons"));
    const roles: Role[] = ["skirmisher", "skirmisher", "tank"];
    const bold = { ...loadDefaultTactics(), aggression: 0.95 };
    const state = createRoundState(
      { ...options, spawnTable },
      2,
      { A: { tactics: bold, roles } },
      spawnTable,
      config,
      new EventBus(),
    );
    const teamA = state.bots.filter((bot) => bot.teamId === "A");
    expect(teamA.map((bot) => bot.role)).toEqual(roles);
    expect(teamA.every((bot) => bot.tactics.aggression === 0.95)).toBe(true);
    expect(state.roundNumber).toBe(2);
  });

  it("gives a different seed to each round of a match", () => {
    const options = matchOptions(9);
    const spawnTable = rollSpawnTable(options.map, options.weapons, createRng(9, "weapons"));
    const first = createRoundState({ ...options, spawnTable }, 1, {}, spawnTable, config, new EventBus());
    const second = createRoundState({ ...options, spawnTable }, 2, {}, spawnTable, config, new EventBus());
    // The state holds no seed, so the streams stand for it: a round takes a
    // sub-seed from the match seed, so it can replay alone (Section 7.1).
    expect(second.rng.next()).not.toBe(first.rng.next());
  });

  it("resets health, armor, and the pickups every round", () => {
    const options = matchOptions(10);
    const spawnTable = rollSpawnTable(options.map, options.weapons, createRng(10, "weapons"));
    const state = createRoundState({ ...options, spawnTable }, 3, {}, spawnTable, config, new EventBus());
    expect(state.bots.every((bot) => bot.health === config.healthMax)).toBe(true);
    expect(state.bots.every((bot) => bot.armor === 0 && bot.shield === 0)).toBe(true);
    expect(state.pickups.every((pickup) => pickup.ready)).toBe(true);
    expect(state.score).toEqual({ A: 0, B: 0 });
  });
});

describe("roles", () => {
  it("gives every role a tactics preset and behavior weights", () => {
    const data = loadRoles();
    for (const role of ROLES) {
      expect(data.roles[role]).toBeDefined();
      expect(Object.keys(data.roles[role]!.behavior).length).toBeGreaterThan(0);
    }
  });

  it("gives a team one of each role when the plan names none", () => {
    const state = createSimState({ map: loadTestArena(), seed: 1, bus: new EventBus() });
    const teamA = state.bots.filter((bot) => bot.teamId === "A");
    expect(new Set(teamA.map((bot) => bot.role)).size).toBe(teamA.length);
  });

  it("gives a role its own tactics when the plan sets none", () => {
    const state = createSimState({ map: loadTestArena(), seed: 1, bus: new EventBus() });
    const data = loadRoles();
    for (const bot of state.bots) {
      expect(bot.tactics.holdPosition).toBe(data.roles[bot.role]?.tactics.holdPosition);
    }
  });

  it("makes the overwatch role hold its ground more than the skirmisher", () => {
    // Section 7.11: the overwatch holds a sightline, the skirmisher roams.
    const data = loadRoles();
    expect(data.roles.overwatch!.tactics.holdPosition).toBeGreaterThan(
      data.roles.skirmisher!.tactics.holdPosition,
    );
    expect(data.roles.overwatch!.behavior["holdPosition"]!).toBeGreaterThan(
      data.roles.skirmisher!.behavior["holdPosition"]!,
    );
  });

  it("gives the team its team tactics", () => {
    const state = createSimState({ map: loadTestArena(), seed: 1, bus: new EventBus() });
    const defaults = loadRoles().teamTacticsDefault;
    expect(state.teamTactics.A).toEqual(defaults);
    expect(state.teamTactics.B).toEqual(defaults);
  });
});
