import { describe, expect, it } from "vitest";
import { blocksSight, canSee, isUnaware, updatePerception } from "../src/ai/perception.js";
import { parseArenaText } from "../src/arena/index.js";
import { cellIndex } from "../src/arena/types.js";
import { createSimState, cellCenter, type SimState } from "../src/sim/index.js";

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

  it("is true when the target cannot see the attacker", () => {
    const state = splitState();
    const [a0] = state.bots;
    const b0 = state.bots[3];
    if (!a0 || !b0) throw new Error("no bots");
    a0.pos = cellCenter({ x: 2, y: 1 });
    b0.pos = cellCenter({ x: 8, y: 1 });
    updatePerception(state);
    b0.visibleCells.clear();
    expect(isUnaware(state, a0, b0)).toBe(true);
  });
});
