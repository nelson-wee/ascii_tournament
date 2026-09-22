import { describe, expect, it } from "vitest";
import {
  arcOf,
  blocksSight,
  canSee,
  canTarget,
  hasLineOfSight,
  isUnaware,
  noteIncomingFire,
  seesInPeriphery,
  updateFacing,
  updatePerception,
} from "../src/ai/perception.js";
import { parseArenaText } from "../src/arena/index.js";
import { cellIndex } from "../src/arena/types.js";
import {
  angleTo,
  cellCenter,
  createSimState,
  peripheralHalfAngle,
  type BotState,
  type SimState,
} from "../src/sim/index.js";

/** A room with a wall in the middle. Team A on the left, team B on the right. */
const SPLIT = [
  "###########",
  "#S.......S#",
  "#S...#...S#",
  "#S...#...S#",
  "###########",
].join("\n");

function splitState(): SimState {
  return createSimState({ map: parseArenaText(SPLIT, { source: "split" }), seed: 1 });
}

describe("blocksSight", () => {
  const map = parseArenaText(SPLIT, { source: "split" });

  it("blocks sight on a wall", () => {
    expect(blocksSight(map, 0, 0)).toBe(true);
    expect(blocksSight(map, 5, 2)).toBe(true);
  });

  it("does not block sight on a floor cell", () => {
    expect(blocksSight(map, 2, 1)).toBe(false);
  });
});

describe("updatePerception", () => {
  it("sees an enemy with a clear line", () => {
    const state = splitState();
    const [a0] = state.bots;
    const b0 = state.bots[3];
    if (!a0 || !b0) throw new Error("no bots");
    // Put both on the open top row.
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    updatePerception(state);
    expect(a0.visibleEnemyIds).toContain(b0.id);
    expect(canSee(state, a0, b0)).toBe(true);
  });

  it("does not see an enemy behind a wall", () => {
    const state = splitState();
    const [a0] = state.bots;
    const b0 = state.bots[3];
    if (!a0 || !b0) throw new Error("no bots");
    a0.pos = cellCenter({ x: 4, y: 3 });
    b0.pos = cellCenter({ x: 6, y: 3 });
    updatePerception(state);
    expect(a0.visibleEnemyIds).not.toContain(b0.id);
    expect(canSee(state, a0, b0)).toBe(false);
  });

  it("never lists a teammate", () => {
    const state = splitState();
    updatePerception(state);
    for (const bot of state.bots) {
      for (const id of bot.visibleEnemyIds) {
        expect(state.bots.find((other) => other.id === id)?.teamId).not.toBe(bot.teamId);
      }
    }
  });

  it("sees its own cell", () => {
    const state = splitState();
    const [a0] = state.bots;
    if (!a0) throw new Error("no bot");
    a0.pos = cellCenter({ x: 2, y: 1 });
    updatePerception(state);
    expect(a0.visibleCells.has(cellIndex(state.map, 2, 1))).toBe(true);
  });

  it("remembers the last seen position and forgets it later", () => {
    const state = splitState();
    const [a0] = state.bots;
    const b0 = state.bots[3];
    if (!a0 || !b0) throw new Error("no bots");
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    updatePerception(state);
    expect(a0.lastSeen.get(b0.id)?.cell).toEqual({ x: 8, y: 1 });

    // The enemy hides behind the wall.
    b0.pos = cellCenter({ x: 6, y: 3 });
    a0.pos = cellCenter({ x: 4, y: 3 });
    state.tick = state.config.memoryTicks;
    updatePerception(state);
    expect(a0.lastSeen.has(b0.id), "the memory must hold inside the window").toBe(true);

    state.tick = state.config.memoryTicks * 2 + 2;
    updatePerception(state);
    expect(a0.lastSeen.has(b0.id), "the memory must expire").toBe(false);
  });

  it("gives a dead bot no sight, and hides a dead bot", () => {
    const state = splitState();
    const [a0] = state.bots;
    const b0 = state.bots[3];
    if (!a0 || !b0) throw new Error("no bots");
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });

    b0.alive = false;
    updatePerception(state);
    expect(b0.visibleCells.size).toBe(0);
    expect(b0.visibleEnemyIds).toHaveLength(0);
    expect(a0.visibleEnemyIds).not.toContain(b0.id);
  });
});

describe("isUnaware", () => {
  it("is false when the target can see the attacker", () => {
    const state = splitState();
    const [a0] = state.bots;
    const b0 = state.bots[3];
    if (!a0 || !b0) throw new Error("no bots");
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    updatePerception(state);
    expect(isUnaware(state, a0, b0)).toBe(false);
  });

  it("is true when the target looks the other way", () => {
    const state = splitState();
    const [a0] = state.bots;
    const b0 = state.bots[3];
    if (!a0 || !b0) throw new Error("no bots");
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    // A0 stands to the west of B0, and B0 looks east.
    a0.facing = 0;
    b0.facing = 0;
    updatePerception(state);
    expect(isUnaware(state, a0, b0)).toBe(true);
  });
});

describe("the vision arcs (Section 7.20.6)", () => {
  /** Put `other` at `degrees` from the facing of `bot`, at a short distance. */
  function place(bot: BotState, other: BotState, degrees: number, distance = 4): void {
    const angle = bot.facing + (degrees * Math.PI) / 180;
    other.pos = {
      x: bot.pos.x + Math.cos(angle) * distance,
      y: bot.pos.y + Math.sin(angle) * distance,
    };
  }

  function facing(state: SimState): [BotState, BotState] {
    const a0 = state.bots[0] as BotState;
    const b0 = state.bots[3] as BotState;
    // The open top row, so that no wall blocks the line.
    a0.pos = cellCenter({ x: 5, y: 1 });
    a0.facing = 0;
    for (const bot of state.bots) if (bot !== a0 && bot !== b0) bot.alive = false;
    return [a0, b0];
  }

  it("sees an enemy straight ahead in the focus arc", () => {
    const state = splitState();
    const [a0, b0] = facing(state);
    place(a0, b0, 0, 3);
    updatePerception(state);
    expect(arcOf(state, a0, b0)).toBe("focus");
    expect(a0.visibleEnemyIds).toContain(b0.id);
    expect(canTarget(a0, b0)).toBe(true);
  });

  it("puts an enemy just inside the focus edge in the focus arc", () => {
    const state = splitState();
    const [a0, b0] = facing(state);
    const halfAngle = (state.config.focusHalfAngle * 180) / Math.PI;
    place(a0, b0, halfAngle - 2, 3);
    updatePerception(state);
    expect(arcOf(state, a0, b0)).toBe("focus");
  });

  it("puts an enemy past the focus edge in the peripheral arc", () => {
    const state = splitState();
    const [a0, b0] = facing(state);
    const halfAngle = (state.config.focusHalfAngle * 180) / Math.PI;
    place(a0, b0, halfAngle + 5, 3);
    updatePerception(state);
    expect(arcOf(state, a0, b0)).toBe("peripheral");
  });

  it("is blind behind the bot", () => {
    const state = splitState();
    const [a0, b0] = facing(state);
    place(a0, b0, 180, 3);
    updatePerception(state);
    expect(arcOf(state, a0, b0)).toBe("blind");
    expect(a0.visibleEnemyIds).toHaveLength(0);
    expect(a0.peripheralEnemyIds).toHaveLength(0);
    expect(canSee(state, a0, b0)).toBe(false);
  });

  it("needs the peripheral delay before it notices a side contact", () => {
    const state = splitState();
    const [a0, b0] = facing(state);
    const halfAngle = (state.config.focusHalfAngle * 180) / Math.PI;
    place(a0, b0, halfAngle + 5, 3);

    for (let tick = 1; tick < state.config.peripheralDelayTicks; tick += 1) {
      state.tick = tick;
      updatePerception(state);
      expect(a0.peripheralEnemyIds, `tick ${tick} noticed too early`).toHaveLength(0);
      expect(canSee(state, a0, b0)).toBe(false);
    }
    state.tick = state.config.peripheralDelayTicks;
    updatePerception(state);
    expect(seesInPeriphery(a0, b0)).toBe(true);
    expect(canSee(state, a0, b0)).toBe(true);
    // It knows that the enemy is there, but it cannot fire yet.
    expect(canTarget(a0, b0)).toBe(false);
  });

  it("forgets the delay when the contact breaks", () => {
    const state = splitState();
    const [a0, b0] = facing(state);
    const halfAngle = (state.config.focusHalfAngle * 180) / Math.PI;
    place(a0, b0, halfAngle + 5, 3);
    state.tick = 1;
    updatePerception(state);
    expect(a0.peripheralTicks.get(b0.id)).toBe(1);

    place(a0, b0, 180, 3);
    state.tick = 2;
    updatePerception(state);
    expect(a0.peripheralTicks.has(b0.id)).toBe(false);
  });

  it("gives a bot with more awareness a wider peripheral arc", () => {
    const state = splitState();
    const [a0] = facing(state);
    a0.attributes.awareness = 0;
    const narrow = peripheralHalfAngle(state, a0);
    a0.attributes.awareness = 1;
    expect(peripheralHalfAngle(state, a0)).toBeGreaterThan(narrow);
  });

  it("still needs a line of sight inside the arc", () => {
    const state = splitState();
    const a0 = state.bots[0] as BotState;
    const b0 = state.bots[3] as BotState;
    // The wall of the map stands between the two bots.
    a0.pos = cellCenter({ x: 4, y: 3 });
    b0.pos = cellCenter({ x: 6, y: 3 });
    a0.facing = angleTo(a0, b0.pos.x, b0.pos.y);
    updatePerception(state);
    expect(hasLineOfSight(state, a0, b0)).toBe(false);
    expect(arcOf(state, a0, b0)).toBe("blind");
  });
});

describe("updateFacing", () => {
  /** Turn a bot until it settles, or give up. Returns the ticks that it took. */
  function turnUntilSettled(state: SimState, bot: BotState, limit = 100): number {
    for (let tick = 0; tick < limit; tick += 1) {
      const before = bot.facing;
      updateFacing(state, bot, { x: 0, y: 0 });
      if (Math.abs(bot.facing - before) < 1e-9) return tick;
    }
    return limit;
  }

  it("turns no further than its turn rate in one tick", () => {
    const state = splitState();
    const a0 = state.bots[0] as BotState;
    const b0 = state.bots[3] as BotState;
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    a0.facing = Math.PI; // It looks the other way.
    updatePerception(state);
    a0.targetId = b0.id;
    a0.lastSeen.set(b0.id, { cell: { x: 8, y: 1 }, tick: 0 });

    const before = a0.facing;
    updateFacing(state, a0, { x: 0, y: 0 });
    expect(Math.abs(a0.facing - before)).toBeLessThanOrEqual(state.config.turnRatePerTick + 1e-9);
    expect(a0.facing).not.toBe(before);
  });

  it("needs several ticks to turn around", () => {
    // This is what gives a flank its value.
    const state = splitState();
    const a0 = state.bots[0] as BotState;
    const b0 = state.bots[3] as BotState;
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    a0.facing = Math.PI;
    a0.lastSeen.set(b0.id, { cell: { x: 8, y: 1 }, tick: 0 });
    for (const bot of state.bots.slice(3)) bot.alive = false;

    const ticks = turnUntilSettled(state, a0);
    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeCloseTo(Math.PI / state.config.turnRatePerTick, 0);
  });

  it("turns toward the target that the bot aims at", () => {
    const state = splitState();
    const a0 = state.bots[0] as BotState;
    const b0 = state.bots[3] as BotState;
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    a0.facing = 0;
    updatePerception(state);
    a0.targetId = b0.id;
    a0.facing = Math.PI;
    turnUntilSettled(state, a0);
    expect(a0.facing).toBeCloseTo(angleTo(a0, b0.pos.x, b0.pos.y), 6);
  });

  it("turns toward an enemy that it only knows from its memory", () => {
    const state = splitState();
    const a0 = state.bots[0] as BotState;
    const b0 = state.bots[3] as BotState;
    a0.pos = cellCenter({ x: 2, y: 1 });
    a0.facing = Math.PI;
    for (const bot of state.bots.slice(3)) bot.alive = false;
    a0.lastSeen.set(b0.id, { cell: { x: 8, y: 1 }, tick: 0 });
    turnUntilSettled(state, a0);
    expect(Math.abs(a0.facing)).toBeLessThan(0.1);
  });

  it("turns the way that it moves when it knows of no enemy", () => {
    const state = splitState();
    const a0 = state.bots[0] as BotState;
    a0.facing = 0;
    for (const bot of state.bots.slice(3)) bot.alive = false;
    a0.lastSeen.clear();
    for (let i = 0; i < 100; i += 1) updateFacing(state, a0, { x: 0, y: 1 });
    expect(a0.facing).toBeCloseTo(Math.PI / 2, 6);
  });

  it("keeps its facing when it does not move and knows of no enemy", () => {
    const state = splitState();
    const a0 = state.bots[0] as BotState;
    a0.facing = 1.23;
    for (const bot of state.bots.slice(3)) bot.alive = false;
    a0.lastSeen.clear();
    updateFacing(state, a0, { x: 0, y: 0 });
    expect(a0.facing).toBe(1.23);
  });
});

describe("noteIncomingFire", () => {
  it("tells a bot where a shot came from, even from behind", () => {
    const state = splitState();
    const a0 = state.bots[0] as BotState;
    const b0 = state.bots[3] as BotState;
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    a0.facing = Math.PI;
    updatePerception(state);
    expect(canSee(state, a0, b0)).toBe(false);

    noteIncomingFire(state, a0, b0);
    expect(a0.lastSeen.has(b0.id)).toBe(true);
    // The memory is enough to turn the bot around, over several ticks.
    for (let i = 0; i < 100; i += 1) updateFacing(state, a0, { x: 0, y: 0 });
    expect(Math.abs(a0.facing)).toBeLessThan(0.1);
  });
});
