import { describe, expect, it } from "vitest";
import { parseArenaText, loadTestArena } from "../src/arena/index.js";
import { EventBus } from "../src/core/events.js";
import { deriveSeed } from "../src/core/rng.js";
import {
  advanceBot,
  botCell,
  cellCenter,
  checkRoundEnd,
  createSimState,
  runRound,
  step,
  stepMany,
  type BotState,
  type SimState,
} from "../src/sim/index.js";

function arenaState(seed = 1, bus = new EventBus()): SimState {
  return createSimState({ map: loadTestArena(), seed, bus });
}

/** A short corridor with three spawn cells per team. */
const CORRIDOR = ["############", "#SSS....SSS#", "############"].join("\n");

function corridorState(seed = 1): SimState {
  return createSimState({ map: parseArenaText(CORRIDOR, { source: "corridor" }), seed });
}

describe("checkRoundEnd", () => {
  it("gives null while the round runs", () => {
    expect(checkRoundEnd(arenaState())).toBeNull();
  });

  it("ends at the score limit", () => {
    const state = arenaState();
    state.score.A = state.config.scoreLimit;
    const outcome = checkRoundEnd(state);
    expect(outcome?.reason).toBe("scoreLimit");
    expect(outcome?.winnerTeamId).toBe("A");
  });

  it("ends at the time limit and the higher score wins", () => {
    const state = arenaState();
    state.tick = state.config.timeLimitTicks;
    state.score.A = 3;
    state.score.B = 7;
    const outcome = checkRoundEnd(state);
    expect(outcome?.reason).toBe("timeLimit");
    expect(outcome?.winnerTeamId).toBe("B");
  });

  it("does not end at the time limit with an equal score", () => {
    // The round goes to sudden death instead. See tests/announcements.test.ts.
    const state = arenaState();
    state.tick = state.config.timeLimitTicks;
    state.score.A = 4;
    state.score.B = 4;
    expect(checkRoundEnd(state)).toBeNull();
  });

  it("uses the score limit before the time limit", () => {
    const state = arenaState();
    state.tick = state.config.timeLimitTicks;
    state.score.A = state.config.scoreLimit;
    state.score.B = state.config.scoreLimit + 5;
    expect(checkRoundEnd(state)?.reason).toBe("scoreLimit");
  });
});

describe("step", () => {
  it("stops after the round ends", () => {
    const state = arenaState();
    state.score.A = state.config.scoreLimit;
    step(state);
    const endTick = state.tick;
    step(state);
    step(state);
    expect(state.tick).toBe(endTick);
  });

  it("emits one RoundEnd event", () => {
    const bus = new EventBus();
    const state = arenaState(1, bus);
    state.score.A = state.config.scoreLimit;
    step(state);
    step(state);
    expect(bus.filter("RoundEnd")).toHaveLength(1);
  });

  it("respawns a dead bot after the delay", () => {
    const state = arenaState();
    const bot = state.bots[0] as BotState;
    step(state);
    bot.alive = false;
    bot.health = 0;
    bot.respawnAtTick = state.tick + state.config.respawnDelayTicks;
    stepMany(state, state.config.respawnDelayTicks - 1);
    expect(bot.alive).toBe(false);
    stepMany(state, 2);
    expect(bot.alive).toBe(true);
    expect(bot.health).toBe(state.config.healthMax);
  });
});

describe("runRound", () => {
  it("ends every round and gives a result", () => {
    for (const seed of [1, 2, 3]) {
      const bus = new EventBus();
      const result = runRound(arenaState(seed, bus));
      expect(result.outcome).not.toBeNull();
      expect(result.outcome.ticks).toBeLessThanOrEqual(3600);
      expect(bus.filter("RoundStart")).toHaveLength(1);
      expect(bus.filter("RoundEnd")).toHaveLength(1);
    }
  });

  it("reaches the score limit in most rounds", () => {
    // One round can run to the time limit. Most should not: a round that never
    // reaches the score limit is the low-kill defect of Section 7.2.1.
    let atScoreLimit = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const state = arenaState(seed);
      const result = runRound(state);
      if (result.outcome.reason !== "scoreLimit") continue;
      atScoreLimit += 1;
      const winner = result.outcome.winnerTeamId;
      expect(winner).not.toBeNull();
      expect(result.outcome.score[winner!]).toBe(state.config.scoreLimit);
    }
    expect(atScoreLimit).toBeGreaterThanOrEqual(4);
  });

  it("makes the bots see and shoot each other", () => {
    // The acceptance test of Milestone M3.
    const bus = new EventBus();
    runRound(arenaState(1, bus));
    expect(bus.filter("Shot").length).toBeGreaterThan(0);
    expect(bus.filter("Hit").length).toBeGreaterThan(0);
    expect(bus.filter("Kill").length).toBeGreaterThan(0);
    const shooters = new Set(bus.filter("Shot").map((event) => event.data["shooterId"]));
    expect(shooters.size).toBeGreaterThan(1);
  });

  it("counts one Death event per Kill event", () => {
    const bus = new EventBus();
    runRound(arenaState(5, bus));
    expect(bus.filter("Death")).toHaveLength(bus.filter("Kill").length);
  });

  it("gives the score of the outcome from the kill events", () => {
    const bus = new EventBus();
    const result = runRound(arenaState(2, bus));
    const kills = bus.filter("Kill");
    for (const teamId of ["A", "B"] as const) {
      const byTeam = kills.filter((event) => event.data["killerTeamId"] === teamId).length;
      expect(result.outcome.score[teamId]).toBe(byTeam);
    }
  });
});

describe("determinism", () => {
  it("gives the same event stream for the same seed", () => {
    // The acceptance test of Milestone M3.
    const busA = new EventBus();
    const busB = new EventBus();
    runRound(arenaState(21, busA));
    runRound(arenaState(21, busB));
    expect(JSON.stringify(busB.log)).toBe(JSON.stringify(busA.log));
  });

  it("gives a different result for a different seed", () => {
    const busA = new EventBus();
    const busB = new EventBus();
    runRound(arenaState(21, busA));
    runRound(arenaState(22, busB));
    expect(JSON.stringify(busB.log)).not.toBe(JSON.stringify(busA.log));
  });

  it("replays one round from its sub-seed", () => {
    const matchSeed = 4242;
    const busA = new EventBus();
    const busB = new EventBus();
    runRound(
      createSimState({
        map: loadTestArena(),
        seed: deriveSeed(matchSeed, "round:3"),
        roundNumber: 3,
        bus: busA,
      }),
    );
    runRound(
      createSimState({
        map: loadTestArena(),
        seed: deriveSeed(matchSeed, "round:3"),
        roundNumber: 3,
        bus: busB,
      }),
    );
    expect(JSON.stringify(busB.log)).toBe(JSON.stringify(busA.log));
  });
});

describe("collisions", () => {
  it("lets a bot pass through a teammate", () => {
    const state = corridorState();
    const mover = state.bots[0] as BotState;
    const mate = state.bots[1] as BotState;
    mover.pos = cellCenter({ x: 4, y: 1 });
    mate.pos = cellCenter({ x: 5, y: 1 });
    mover.path = [
      { x: 5, y: 1 },
      { x: 6, y: 1 },
    ];
    for (let i = 0; i < 20; i += 1) advanceBot(state, mover);
    expect(botCell(mover)).toEqual({ x: 6, y: 1 });
  });

  it("stops a bot in front of an enemy", () => {
    const state = corridorState();
    const mover = state.bots[0] as BotState;
    const enemy = state.bots[3] as BotState;
    mover.pos = cellCenter({ x: 4, y: 1 });
    enemy.pos = cellCenter({ x: 5, y: 1 });
    mover.path = [
      { x: 5, y: 1 },
      { x: 6, y: 1 },
    ];
    advanceBot(state, mover);
    expect(botCell(mover)).toEqual({ x: 4, y: 1 });
    expect(mover.blockedTicks).toBe(1);
  });

  it("drops the path after it waits too long", () => {
    const state = corridorState();
    const mover = state.bots[0] as BotState;
    const enemy = state.bots[3] as BotState;
    mover.pos = cellCenter({ x: 4, y: 1 });
    enemy.pos = cellCenter({ x: 5, y: 1 });
    mover.path = [{ x: 5, y: 1 }];
    for (let i = 0; i < state.config.repathAfterBlockedTicks; i += 1) advanceBot(state, mover);
    expect(mover.path).toHaveLength(0);
    expect(mover.blockedTicks).toBe(0);
  });

  it("passes a dead enemy", () => {
    const state = corridorState();
    const mover = state.bots[0] as BotState;
    const enemy = state.bots[3] as BotState;
    mover.pos = cellCenter({ x: 4, y: 1 });
    enemy.pos = cellCenter({ x: 5, y: 1 });
    enemy.alive = false;
    mover.path = [
      { x: 5, y: 1 },
      { x: 6, y: 1 },
    ];
    for (let i = 0; i < 20; i += 1) advanceBot(state, mover);
    expect(botCell(mover)).toEqual({ x: 6, y: 1 });
  });

  it("never lets two live enemies share a cell", () => {
    const state = arenaState(17);
    for (let tick = 0; tick < 1500 && state.outcome === null; tick += 1) {
      step(state);
      const byCell = new Map<string, string>();
      for (const bot of state.bots) {
        if (!bot.alive) continue;
        const cell = botCell(bot);
        const key = `${cell.x},${cell.y}`;
        const other = byCell.get(key);
        if (other !== undefined) {
          const otherBot = state.bots.find((candidate) => candidate.id === other);
          expect(
            otherBot?.teamId,
            `${bot.id} and ${other} share a cell at tick ${state.tick}`,
          ).toBe(bot.teamId);
        }
        byCell.set(key, bot.id);
      }
    }
  });
});
