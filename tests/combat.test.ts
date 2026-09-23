import { describe, expect, it } from "vitest";
import { updatePerception } from "../src/ai/perception.js";
import { parseArenaText } from "../src/arena/index.js";
import { EventBus } from "../src/core/events.js";
import { loadBaselineWeapon } from "../src/core/data.js";
import { killFeedLine, killFeedLines } from "../src/report/killFeed.js";
import {
  cellCenter,
  createSimState,
  effectiveReaction,
  hitChance,
  isInCover,
  rangeBandOf,
  respawn,
  selectTarget,
  tryFire,
  type BotState,
  type SimState,
} from "../src/sim/index.js";

/** An open corridor. Team A spawns on the left, team B on the right. */
const RANGE = [
  "#############################################",
  "#SSS..,....................................S#",
  "#........................................SS.#",
  "#############################################",
].join("\n");

function rangeState(seed = 1, bus = new EventBus()): SimState {
  return createSimState({ map: parseArenaText(RANGE, { source: "range" }), seed, bus });
}

/** Put two bots face to face and update the perception. */
function face(state: SimState, distance: number): [BotState, BotState] {
  const a = state.bots[0] as BotState;
  const b = state.bots[3] as BotState;
  a.pos = cellCenter({ x: 2, y: 1 });
  b.pos = cellCenter({ x: 2 + distance, y: 1 });
  updatePerception(state);
  return [a, b];
}

describe("the baseline weapon", () => {
  it("is a hitscan weapon with no area damage", () => {
    const weapon = loadBaselineWeapon();
    expect(weapon.attackType).toBe("hitscan");
    expect(weapon.projectileSpeed).toBeNull();
    expect(weapon.aoeRadius).toBe(0);
    expect(weapon.archetype).toBe("baseline");
    expect(weapon.damage).toBeGreaterThan(0);
  });
});

describe("rangeBandOf", () => {
  it("uses the bands of the tuning file", () => {
    const state = rangeState();
    const { rangeBandCloseMax, rangeBandMidMax } = state.config;
    expect(rangeBandOf(state, 1)).toBe("close");
    expect(rangeBandOf(state, rangeBandCloseMax)).toBe("close");
    expect(rangeBandOf(state, rangeBandCloseMax + 0.1)).toBe("mid");
    expect(rangeBandOf(state, rangeBandMidMax)).toBe("mid");
    expect(rangeBandOf(state, rangeBandMidMax + 0.1)).toBe("long");
  });
});

describe("hitChance", () => {
  it("falls with the distance", () => {
    const state = rangeState();
    const [a, b] = face(state, 3);
    const close = hitChance(state, a, b);
    b.pos = cellCenter({ x: 2 + 25, y: 1 });
    const far = hitChance(state, a, b);
    expect(far).toBeLessThan(close);
  });

  it("falls when the target moves", () => {
    // Section 7.20.5: the dodge rises over several ticks of movement, so a bot
    // that has moved without a break is harder to hit than one that just
    // started.
    const state = rangeState();
    const [a, b] = face(state, 5);
    b.movingTicks = 0;
    const still = hitChance(state, a, b);
    b.movingTicks = 1;
    const twitch = hitChance(state, a, b);
    b.movingTicks = state.config.dodgeRampTicks;
    const running = hitChance(state, a, b);
    expect(twitch).toBeLessThan(still);
    expect(running).toBeLessThan(twitch);
  });

  it("stays inside [minHitChance, 1]", () => {
    const state = rangeState();
    const [a, b] = face(state, 5);
    for (const distance of [1, 5, 10, 20, 30, 40]) {
      b.pos = cellCenter({ x: 2 + distance, y: 1 });
      for (const moved of [true, false]) {
        b.movedLastTick = moved;
        const chance = hitChance(state, a, b);
        expect(chance).toBeGreaterThanOrEqual(state.config.minHitChance);
        expect(chance).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("selectTarget", () => {
  it("selects the nearest visible enemy", () => {
    const state = rangeState();
    const a = state.bots[0] as BotState;
    const near = state.bots[3] as BotState;
    const far = state.bots[4] as BotState;
    a.pos = cellCenter({ x: 2, y: 1 });
    near.pos = cellCenter({ x: 8, y: 1 });
    far.pos = cellCenter({ x: 20, y: 1 });
    updatePerception(state);
    expect(selectTarget(state, a)?.id).toBe(near.id);
  });

  it("ignores an enemy outside the weapon range", () => {
    const state = rangeState();
    const [a, b] = face(state, 5);
    b.pos = cellCenter({ x: 2 + a.weapon.rangeMax + 5, y: 1 });
    updatePerception(state);
    expect(selectTarget(state, a)).toBeNull();
  });

  it("ignores a dead enemy", () => {
    const state = rangeState();
    const [a, b] = face(state, 5);
    b.alive = false;
    updatePerception(state);
    expect(selectTarget(state, a)).toBeNull();
  });
});

describe("tryFire", () => {
  it("waits for the reaction time before the first shot", () => {
    // Section 7.20.7: the reaction is the attribute of the bot plus the
    // reaction of its weapon at this range band.
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const [a, b] = face(state, 5);
    const band = rangeBandOf(state, Math.abs(b.pos.x - a.pos.x));
    const reaction = effectiveReaction(a, band);
    expect(reaction).toBeGreaterThan(a.attributes.reactionTicks);
    for (let i = 0; i < reaction; i += 1) tryFire(state, a);
    expect(bus.filter("Shot")).toHaveLength(0);
    tryFire(state, a);
    expect(bus.filter("Shot")).toHaveLength(1);
  });

  it("waits for the weapon cooldown between two shots", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const [a, b] = face(state, 5);
    const band = rangeBandOf(state, Math.abs(b.pos.x - a.pos.x));
    for (let i = 0; i <= effectiveReaction(a, band); i += 1) tryFire(state, a);
    expect(bus.filter("Shot")).toHaveLength(1);
    expect(a.fireCooldownTicks).toBe(a.weapon.fireIntervalTicks);
    tryFire(state, a);
    expect(bus.filter("Shot")).toHaveLength(1);
  });

  it("does not fire with no target", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const a = state.bots[0] as BotState;
    for (const bot of state.bots.slice(3)) bot.alive = false;
    updatePerception(state);
    for (let i = 0; i < 20; i += 1) tryFire(state, a);
    expect(bus.filter("Shot")).toHaveLength(0);
  });

  it("does not fire when it is dead", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const [a] = face(state, 5);
    a.alive = false;
    for (let i = 0; i < 20; i += 1) tryFire(state, a);
    expect(bus.filter("Shot")).toHaveLength(0);
  });

  it("takes health from the target and kills it", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const [a, b] = face(state, 2);
    const startHealth = b.health;

    let guard = 0;
    while (b.alive && guard < 4000) {
      a.fireCooldownTicks = 0;
      tryFire(state, a);
      guard += 1;
    }
    expect(b.alive).toBe(false);
    expect(b.health).toBe(0);
    expect(bus.filter("Hit").length).toBeGreaterThan(0);
    expect(startHealth).toBeGreaterThan(0);

    const kills = bus.filter("Kill");
    expect(kills).toHaveLength(1);
    expect(bus.filter("Death")).toHaveLength(1);
    expect(state.score[a.teamId]).toBe(1);
  });

  it("gives the Kill event the full context of Section 6.8", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const [a, b] = face(state, 2);
    let guard = 0;
    while (b.alive && guard < 4000) {
      a.fireCooldownTicks = 0;
      tryFire(state, a);
      guard += 1;
    }
    const kill = bus.filter("Kill")[0];
    expect(kill).toBeDefined();
    for (const key of [
      "killerId",
      "victimId",
      "weaponArchetype",
      "rangeBand",
      "killerInCover",
      "targetAware",
      "killerHealth",
      "multiKillCount",
    ]) {
      expect(kill?.data, `the Kill event has no ${key}`).toHaveProperty(key);
    }
    expect(kill?.data["killerId"]).toBe(a.id);
    expect(kill?.data["victimId"]).toBe(b.id);
    expect(kill?.data["rangeBand"]).toBe("close");
    expect(kill?.data["multiKillCount"]).toBe(1);
  });

  it("counts a multi-kill inside the window", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const a = state.bots[0] as BotState;
    a.pos = cellCenter({ x: 2, y: 1 });
    for (const [index, victim] of state.bots.slice(3).entries()) {
      victim.pos = cellCenter({ x: 4 + index, y: 1 });
    }
    updatePerception(state);
    let guard = 0;
    while (state.bots.slice(3).some((bot) => bot.alive) && guard < 20000) {
      a.fireCooldownTicks = 0;
      updatePerception(state);
      tryFire(state, a);
      guard += 1;
    }
    const counts = bus.filter("Kill").map((event) => event.data["multiKillCount"]);
    expect(counts).toEqual([1, 2, 3]);
  });
});

describe("isInCover", () => {
  it("is true on a low cover tile", () => {
    const state = rangeState();
    const a = state.bots[0] as BotState;
    a.pos = cellCenter({ x: 6, y: 1 });
    expect(isInCover(state, a)).toBe(true);
    a.pos = cellCenter({ x: 8, y: 1 });
    expect(isInCover(state, a)).toBe(false);
  });
});

describe("respawn", () => {
  it("puts a dead bot back on a spawn cell of its team with full health", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const a = state.bots[0] as BotState;
    a.alive = false;
    a.health = 0;
    a.pos = cellCenter({ x: 20, y: 1 });
    respawn(state, a);
    expect(a.alive).toBe(true);
    expect(a.health).toBe(state.config.healthMax);
    expect(a.path).toHaveLength(0);
    const cell = { x: Math.floor(a.pos.x), y: Math.floor(a.pos.y) };
    expect(state.map.spawns.slice(0, 3)).toContainEqual(cell);
    expect(bus.filter("Spawn").length).toBeGreaterThan(6);
  });
});

describe("killFeedLine", () => {
  it("builds a line from a Kill event", () => {
    const bus = new EventBus();
    bus.emit("Kill", 10, 1, {
      killerId: "A0",
      victimId: "B1",
      weaponArchetype: "baseline",
      rangeBand: "long",
      targetAware: true,
      multiKillCount: 1,
    });
    expect(killFeedLine(bus.log[0]!)).toBe("A0 killed B1 with a baseline weapon at long range");
  });

  it("names a kill on an unaware target and a multi-kill", () => {
    const bus = new EventBus();
    bus.emit("Kill", 10, 1, {
      killerId: "A0",
      victimId: "B1",
      weaponArchetype: "precision",
      rangeBand: "close",
      targetAware: false,
      multiKillCount: 2,
    });
    expect(killFeedLine(bus.log[0]!)).toBe(
      "A0 killed B1 with a precision weapon at close range from behind (×2)",
    );
  });

  it("gives null for any other event", () => {
    const bus = new EventBus();
    bus.emit("Shot", 1, 1, {});
    expect(killFeedLine(bus.log[0]!)).toBeNull();
  });

  it("gives the newest lines only", () => {
    const bus = new EventBus();
    for (let i = 0; i < 12; i += 1) {
      bus.emit("Kill", i, 1, { killerId: `A${i}`, victimId: "B0", rangeBand: "mid" });
    }
    const lines = killFeedLines(bus.log, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("A11");
  });
});
