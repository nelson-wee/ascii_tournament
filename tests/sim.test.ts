import { describe, expect, it } from "vitest";
import { isStepLegal } from "../src/ai/navigation.js";
import { Tile, isWalkable, loadTestArena, tileAt } from "../src/arena/index.js";
import { EventBus } from "../src/core/events.js";
import { deriveSeed } from "../src/core/rng.js";
import type { Cell } from "../src/core/types.js";
import {
  botCell,
  cellCenter,
  createSimState,
  posCell,
  simConfigFromTuning,
  step,
  stepMany,
  TEAM_IDS,
  type SimState,
} from "../src/sim/index.js";

function newState(seed = 1, bus = new EventBus()): SimState {
  return createSimState({ map: loadTestArena(), seed, bus });
}

function positions(state: SimState): string {
  return state.bots.map((bot) => `${bot.id}:${bot.pos.x.toFixed(6)},${bot.pos.y.toFixed(6)}`).join("|");
}

describe("createSimState", () => {
  it("makes three bots per team", () => {
    const state = newState();
    expect(state.bots).toHaveLength(6);
    for (const teamId of TEAM_IDS) {
      expect(state.bots.filter((bot) => bot.teamId === teamId)).toHaveLength(3);
    }
    expect(state.bots.map((bot) => bot.id)).toEqual(["A0", "A1", "A2", "B0", "B1", "B2"]);
  });

  it("puts every bot on the centre of a spawn cell", () => {
    const state = newState();
    for (const bot of state.bots) {
      const cell = botCell(bot);
      expect(tileAt(state.map, cell.x, cell.y)).toBe(Tile.Spawn);
      expect(bot.pos).toEqual(cellCenter(cell));
    }
  });

  it("gives every bot its own spawn cell", () => {
    const cells = newState().bots.map((bot) => `${botCell(bot).x},${botCell(bot).y}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("emits one Spawn event per bot", () => {
    const bus = new EventBus();
    newState(1, bus);
    expect(bus.filter("Spawn")).toHaveLength(6);
  });

  it("starts at tick 0 with no path", () => {
    const state = newState();
    expect(state.tick).toBe(0);
    for (const bot of state.bots) {
      expect(bot.path).toHaveLength(0);
      expect(bot.goalSlotId).toBeNull();
    }
  });

  it("rejects an arena with too few spawn cells", () => {
    const map = { ...loadTestArena(), spawns: [{ x: 1, y: 1 }] };
    expect(() => createSimState({ map, seed: 1 })).toThrow(/spawn cells/);
  });

  it("reads the move speed from the tuning file", () => {
    const config = simConfigFromTuning();
    expect(config.moveSpeedPerTick).toBeCloseTo(4 / 20, 10);
    expect(newState().bots[0]?.moveSpeedPerTick).toBeCloseTo(config.moveSpeedPerTick, 10);
  });
});

describe("step", () => {
  it("counts the ticks", () => {
    const state = newState();
    step(state);
    expect(state.tick).toBe(1);
    stepMany(state, 9);
    expect(state.tick).toBe(10);
  });

  it("gives every bot a goal and a path", () => {
    const state = newState();
    step(state);
    for (const bot of state.bots) {
      expect(bot.goalSlotId, `${bot.id} has no goal`).not.toBeNull();
      expect(bot.path.length).toBeGreaterThan(0);
    }
  });

  it("emits a DecisionChanged event for every new goal", () => {
    const bus = new EventBus();
    const state = newState(1, bus);
    step(state);
    const decisions = bus.filter("DecisionChanged");
    expect(decisions).toHaveLength(6);
    expect(decisions[0]?.data["action"]).toBe("SeekPickup");
  });

  it("moves the bots", () => {
    const state = newState();
    const before = positions(state);
    stepMany(state, 5);
    expect(positions(state)).not.toBe(before);
  });

  it("never moves a bot into a wall", () => {
    // The acceptance test of Milestone M2.
    const state = newState();
    for (let tick = 0; tick < 2000; tick += 1) {
      step(state);
      for (const bot of state.bots) {
        const cell = botCell(bot);
        expect(
          isWalkable(tileAt(state.map, cell.x, cell.y)),
          `${bot.id} is inside a wall at tick ${state.tick}`,
        ).toBe(true);
      }
    }
  });

  it("never moves a bot more than its speed in one tick", () => {
    // A jump of more than one step could cross a wall between two cells.
    const state = newState(7);
    const speed = state.config.moveSpeedPerTick;
    for (let tick = 0; tick < 1000; tick += 1) {
      const before = state.bots.map((bot) => ({ ...bot.pos }));
      step(state);
      for (const [index, bot] of state.bots.entries()) {
        const start = before[index] as { x: number; y: number };
        const moved = Math.hypot(bot.pos.x - start.x, bot.pos.y - start.y);
        expect(moved, `${bot.id} jumped ${moved} cells`).toBeLessThanOrEqual(speed + 1e-9);
      }
    }
  });

  it("crosses only cells that touch each other", () => {
    const state = newState(11);
    let previous = state.bots.map(botCell);
    for (let tick = 0; tick < 1000; tick += 1) {
      step(state);
      const current = state.bots.map(botCell);
      for (const [index, cell] of current.entries()) {
        const before = previous[index] as Cell;
        if (before.x === cell.x && before.y === cell.y) continue;
        expect(
          isStepLegal(state.map, before, cell),
          `${state.bots[index]?.id} made an illegal step at tick ${state.tick}`,
        ).toBe(true);
      }
      previous = current;
    }
  });

  it("reaches a goal and then selects a new one", () => {
    const state = newState(3);
    const first = state.bots[0];
    step(state);
    const firstGoal = first?.goalSlotId;
    let changed = false;
    for (let tick = 0; tick < 3000 && !changed; tick += 1) {
      step(state);
      if (first?.goalSlotId !== firstGoal) changed = true;
    }
    expect(changed, "the bot never reached its first goal").toBe(true);
  });

  it("stands on the goal cell when it arrives", () => {
    const bus = new EventBus();
    const state = newState(3, bus);
    const bot = state.bots[0];
    if (!bot) throw new Error("no bot");
    step(state);
    const goal = state.map.pickups.find((pickup) => pickup.slotId === bot.goalSlotId);
    if (!goal) throw new Error("no goal");
    while (bot.path.length > 0) step(state);
    expect(botCell(bot)).toEqual(goal.cell);
  });
});

describe("determinism", () => {
  it("gives the same result for the same seed", () => {
    const a = newState(42);
    const b = newState(42);
    stepMany(a, 500);
    stepMany(b, 500);
    expect(positions(b)).toBe(positions(a));
  });

  it("gives a different result for a different seed", () => {
    const a = newState(1);
    const b = newState(2);
    stepMany(a, 500);
    stepMany(b, 500);
    expect(positions(b)).not.toBe(positions(a));
  });

  it("gives the same event stream for the same seed", () => {
    const busA = new EventBus();
    const busB = new EventBus();
    stepMany(newState(9, busA), 400);
    stepMany(newState(9, busB), 400);
    expect(JSON.stringify(busB.log)).toBe(JSON.stringify(busA.log));
  });

  it("replays one round from its sub-seed", () => {
    const matchSeed = 1234;
    const roundSeed = deriveSeed(matchSeed, "round:2");
    const a = createSimState({ map: loadTestArena(), seed: roundSeed, roundNumber: 2 });
    const b = createSimState({ map: loadTestArena(), seed: deriveSeed(matchSeed, "round:2"), roundNumber: 2 });
    stepMany(a, 300);
    stepMany(b, 300);
    expect(positions(b)).toBe(positions(a));
  });
});

describe("cell helpers", () => {
  it("maps a position to its cell", () => {
    expect(posCell({ x: 3.5, y: 7.9 })).toEqual({ x: 3, y: 7 });
    expect(posCell(cellCenter({ x: 12, y: 4 }))).toEqual({ x: 12, y: 4 });
  });
});
