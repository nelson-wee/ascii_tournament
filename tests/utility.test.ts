import { describe, expect, it } from "vitest";
import { findPath } from "../src/ai/navigation.js";
import { updatePerception } from "../src/ai/perception.js";
import {
  actionLabel,
  applyAction,
  bandDistance,
  bestWeaponAt,
  decide,
  noteReachedPickup,
  scoreActions,
  type Action,
} from "../src/ai/utility.js";
import { loadTestArena, parseArenaText, Tile, tileAt } from "../src/arena/index.js";
import { loadBaselineWeapon, loadDefaultTactics } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import type { Tactics } from "../src/core/schemas.js";
import {
  botCell,
  cellCenter,
  createSimState,
  hitChance,
  runRound,
  step,
  type BotState,
  type SimState,
} from "../src/sim/index.js";

const ROOM = [
  "###############",
  "#SSS......WSSS#",
  "#..A.......^..#",
  "#..........H..#",
  "###############",
].join("\n");

function roomState(tactics?: Partial<Tactics>, seed = 1): SimState {
  return createSimState({
    map: parseArenaText(ROOM, { source: "room" }),
    seed,
    tactics: { ...loadDefaultTactics(), ...tactics },
  });
}

function arenaState(tactics?: Partial<Tactics>, seed = 1, bus = new EventBus()): SimState {
  return createSimState({
    map: loadTestArena(),
    seed,
    bus,
    tactics: { ...loadDefaultTactics(), ...tactics },
  });
}

/** Put a bot and an enemy `distance` cells apart, then update the perception. */
function face(state: SimState, distance: number): [BotState, BotState] {
  const bot = state.bots[0] as BotState;
  const enemy = state.bots[3] as BotState;
  bot.pos = cellCenter({ x: 2, y: 1 });
  enemy.pos = cellCenter({ x: 2 + distance, y: 1 });
  updatePerception(state);
  return [bot, enemy];
}

function scoreOf(state: SimState, bot: BotState, kind: Action["kind"]): number {
  return scoreActions(state, bot).find((candidate) => candidate.action.kind === kind)?.score ?? 0;
}

describe("actionLabel", () => {
  it("names the action and its parameter", () => {
    expect(actionLabel({ kind: "Engage", targetId: "B1" })).toBe("Engage(B1)");
    expect(actionLabel({ kind: "SeekPickup", slotId: "armor:0" })).toBe("SeekPickup(armor:0)");
    expect(actionLabel({ kind: "Reposition", band: "long" })).toBe("Reposition(long)");
    expect(actionLabel({ kind: "Retreat" })).toBe("Retreat");
  });
});

describe("scoreActions", () => {
  it("offers Engage for a visible enemy inside the weapon range", () => {
    const state = roomState();
    const [bot] = face(state, 4);
    const engage = scoreActions(state, bot).find((c) => c.action.kind === "Engage");
    expect(engage).toBeDefined();
    expect((engage?.action as { targetId: string }).targetId).toBe("B0");
  });

  it("offers Chase for a remembered enemy that is out of sight", () => {
    const state = roomState();
    const [bot, enemy] = face(state, 4);
    expect(bot.lastSeen.has(enemy.id)).toBe(true);
    // Every enemy leaves the sight of the bot. Only the memory is left.
    for (const other of state.bots.slice(3)) other.alive = false;
    expect(enemy.alive).toBe(false);
    updatePerception(state);
    expect(scoreOf(state, bot, "Chase")).toBeGreaterThan(0);
    expect(scoreOf(state, bot, "Engage")).toBe(0);
  });

  it("never offers an action with a score of zero", () => {
    const state = roomState();
    const [bot] = face(state, 4);
    for (const candidate of scoreActions(state, bot)) {
      expect(candidate.score).toBeGreaterThan(0);
    }
  });
});

describe("tactics change the weights", () => {
  it("aggression raises Engage and lowers Retreat", () => {
    const high = roomState({ aggression: 0.95 });
    const low = roomState({ aggression: 0.05 });
    const [highBot] = face(high, 4);
    const [lowBot] = face(low, 4);
    expect(scoreOf(high, highBot, "Engage")).toBeGreaterThan(scoreOf(low, lowBot, "Engage"));

    highBot.health = high.config.healthMax * 0.1;
    lowBot.health = low.config.healthMax * 0.1;
    expect(scoreOf(low, lowBot, "Retreat")).toBeGreaterThan(scoreOf(high, highBot, "Retreat"));
  });

  it("retreatThreshold decides when Retreat appears", () => {
    const state = roomState({ retreatThreshold: 0.5 });
    const [bot] = face(state, 4);
    bot.health = state.config.healthMax * 0.8;
    expect(scoreOf(state, bot, "Retreat")).toBe(0);
    bot.health = state.config.healthMax * 0.2;
    expect(scoreOf(state, bot, "Retreat")).toBeGreaterThan(0);
  });

  it("holdPosition raises HoldPosition and lowers SeekPickup", () => {
    const holding = roomState({ holdPosition: 0.9 });
    const roaming = roomState({ holdPosition: 0.0 });
    const holdBot = holding.bots[0] as BotState;
    const roamBot = roaming.bots[0] as BotState;
    expect(scoreOf(holding, holdBot, "HoldPosition")).toBeGreaterThan(
      scoreOf(roaming, roamBot, "HoldPosition"),
    );
    expect(scoreOf(roaming, roamBot, "SeekPickup")).toBeGreaterThan(
      scoreOf(holding, holdBot, "SeekPickup"),
    );
  });

  it("itemControl raises SeekPickup", () => {
    const keen = roomState({ itemControl: 1 });
    const cold = roomState({ itemControl: 0 });
    expect(scoreOf(keen, keen.bots[0] as BotState, "SeekPickup")).toBeGreaterThan(
      scoreOf(cold, cold.bots[0] as BotState, "SeekPickup"),
    );
  });

  it("preferredRange sets the band of Reposition", () => {
    for (const band of ["close", "mid", "long"] as const) {
      const state = roomState({ preferredRange: band });
      const [bot] = face(state, 4);
      const action = scoreActions(state, bot).find((c) => c.action.kind === "Reposition")?.action;
      if (action?.kind === "Reposition") expect(action.band).toBe(band);
    }
  });

  it("gives every band its own distance", () => {
    const state = roomState();
    expect(bandDistance(state, "close")).toBeLessThan(bandDistance(state, "mid"));
    expect(bandDistance(state, "mid")).toBeLessThan(bandDistance(state, "long"));
  });

  it("evasion lowers the accuracy of the bot itself", () => {
    const calm = roomState({ evasion: 0 });
    const jumpy = roomState({ evasion: 1 });
    const [calmBot, calmEnemy] = face(calm, 5);
    const [jumpyBot, jumpyEnemy] = face(jumpy, 5);
    expect(hitChance(jumpy, jumpyBot, jumpyEnemy)).toBeLessThan(hitChance(calm, calmBot, calmEnemy));
  });

  it("hazardTolerance decides if a path crosses a hazard tile", () => {
    const state = roomState();
    const map = state.map;
    const hazard = { x: 11, y: 2 };
    expect(tileAt(map, hazard.x, hazard.y)).toBe(Tile.Hazard);
    const through = findPath(map, { x: 11, y: 1 }, { x: 11, y: 3 }, { avoidHazard: false });
    const around = findPath(map, { x: 11, y: 1 }, { x: 11, y: 3 }, { avoidHazard: true });
    expect(through).not.toBeNull();
    expect(around).not.toBeNull();
    const crosses = (path: typeof through): boolean =>
      (path ?? []).some((cell) => cell.x === hazard.x && cell.y === hazard.y);
    expect(crosses(through)).toBe(true);
    expect(crosses(around)).toBe(false);
  });
});

describe("bestWeaponAt", () => {
  it("selects by the DPS profile, not by an id", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const baseline = loadBaselineWeapon();
    const sniper = {
      ...baseline,
      id: "test-sniper",
      archetype: "precision" as const,
      rangeMax: 60,
      dpsProfile: { close: 5, mid: 30, long: 90 },
    };
    bot.weapons = [baseline, sniper];
    expect(bestWeaponAt(state, bot, 2).id).toBe(baseline.id);
    expect(bestWeaponAt(state, bot, 40).id).toBe(sniper.id);
  });

  it("ignores a weapon that cannot reach", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const shortGun = { ...loadBaselineWeapon(), id: "short", rangeMax: 3, dpsProfile: { close: 999, mid: 999, long: 999 } };
    bot.weapons = [loadBaselineWeapon(), shortGun];
    expect(bestWeaponAt(state, bot, 20).id).not.toBe("short");
  });

  it("gives the preferred archetype a bias", () => {
    const state = roomState({ weaponRolePref: "precision" });
    const bot = state.bots[0] as BotState;
    const baseline = loadBaselineWeapon();
    const precision = { ...baseline, id: "precision-gun", archetype: "precision" as const };
    bot.weapons = [baseline, precision];
    expect(bestWeaponAt(state, bot, 10).id).toBe("precision-gun");
  });
});

describe("decide", () => {
  it("selects the action with the highest score", () => {
    const state = roomState({ aggression: 1, holdPosition: 0 });
    const [bot] = face(state, 4);
    expect(decide(state, bot).action.kind).toBe("Engage");
  });

  it("keeps the current action unless a new one is clearly better", () => {
    const state = roomState();
    const [bot] = face(state, 4);
    const first = decide(state, bot);
    bot.action = first.action;
    // The margin protects the current action from a small change of score.
    const second = decide(state, bot);
    expect(actionLabel(second.action)).toBe(actionLabel(first.action));
    expect(state.config.hysteresisMargin).toBeGreaterThan(1);
  });

  it("gives Idle when no action scores", () => {
    const state = roomState({ itemControl: 0, holdPosition: 0 });
    const bot = state.bots[0] as BotState;
    // Remove every reason to act.
    state.map = { ...state.map, pickups: [] };
    for (const other of state.bots) if (other !== bot) other.alive = false;
    updatePerception(state);
    expect(decide(state, bot).action.kind).toBe("Idle");
  });
});

describe("applyAction", () => {
  it("SeekPickup sets a path and the goal", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const pickup = state.map.pickups[0]!;
    applyAction(state, bot, { kind: "SeekPickup", slotId: pickup.slotId });
    expect(bot.goalSlotId).toBe(pickup.slotId);
    expect(bot.path.length).toBeGreaterThan(0);
  });

  it("HoldPosition clears the path", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    bot.path = [{ x: 5, y: 1 }];
    applyAction(state, bot, { kind: "HoldPosition", cell: botCell(bot) });
    expect(bot.path).toHaveLength(0);
  });

  it("Retreat walks to a spawn cell of its own team", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    bot.pos = cellCenter({ x: 9, y: 3 });
    applyAction(state, bot, { kind: "Retreat" });
    const last = bot.path[bot.path.length - 1];
    expect(state.map.spawns.slice(0, 3)).toContainEqual(last);
  });

  it("SwitchWeapon puts the weapon in the hands of the bot", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const other = { ...loadBaselineWeapon(), id: "other-gun" };
    bot.weapons = [bot.weapon, other];
    applyAction(state, bot, { kind: "SwitchWeapon", weaponId: "other-gun" });
    expect(bot.weapon.id).toBe("other-gun");
  });

  it("Follow walks toward a teammate", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const mate = state.bots[1] as BotState;
    bot.pos = cellCenter({ x: 2, y: 1 });
    mate.pos = cellCenter({ x: 10, y: 3 });
    applyAction(state, bot, { kind: "Follow", teammateId: mate.id });
    expect(bot.path[bot.path.length - 1]).toEqual(botCell(mate));
  });
});

describe("noteReachedPickup", () => {
  it("remembers a reached point and drops the goal", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const pickup = state.map.pickups[0]!;
    bot.goalSlotId = pickup.slotId;
    bot.action = { kind: "SeekPickup", slotId: pickup.slotId };
    bot.pos = cellCenter(pickup.cell);
    noteReachedPickup(state, bot);
    expect(bot.visitedSlotIds).toContain(pickup.slotId);
    expect(bot.goalSlotId).toBeNull();
    expect(bot.action.kind).toBe("Idle");
  });

  it("always keeps one free point", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    for (const pickup of state.map.pickups) {
      bot.goalSlotId = pickup.slotId;
      bot.pos = cellCenter(pickup.cell);
      noteReachedPickup(state, bot);
    }
    expect(bot.visitedSlotIds.length).toBeLessThan(state.map.pickups.length);
  });
});

describe("the decision timer", () => {
  it("decides only when the timer is at zero", () => {
    const bus = new EventBus();
    const state = arenaState({}, 1, bus);
    const interval = state.config.aiDecisionIntervalTicks;
    const bot = state.bots[0] as BotState;
    bot.decisionCooldownTicks = interval;
    const before = bot.actionScore;
    for (let i = 0; i < interval + 2; i += 1) step(state);
    expect(bot.decisionCooldownTicks).toBeLessThanOrEqual(interval);
    expect(bot.actionScore).not.toBe(before);
  });

  it("spreads the first decision of the bots over the ticks", () => {
    const state = arenaState();
    const cooldowns = state.bots.map((bot) => bot.decisionCooldownTicks);
    expect(new Set(cooldowns).size).toBeGreaterThan(1);
  });
});

describe("aggression changes the result of a round", () => {
  it("makes a bolder team shoot more and win", () => {
    // The acceptance test of Milestone M4. One round is noisy, so this sums
    // several rounds: the question is whether aggression changes the result,
    // not whether it changes one round by a set amount.
    const base = loadDefaultTactics();
    const shots = { A: 0, B: 0 };
    const score = { A: 0, B: 0 };

    for (const seed of [4, 5, 6, 7]) {
      const bus = new EventBus();
      const result = runRound(
        createSimState({
          map: loadTestArena(),
          seed,
          bus,
          tactics: {
            A: { ...base, aggression: 0.95 },
            B: { ...base, aggression: 0.05 },
          },
        }),
      );
      for (const event of bus.filter("Shot")) {
        const team = String(event.data["shooterId"])[0] as "A" | "B";
        shots[team] += 1;
      }
      score.A += result.outcome.score["A"];
      score.B += result.outcome.score["B"];
    }

    expect(shots.A).toBeGreaterThan(shots.B);
    expect(score.A).toBeGreaterThan(score.B);
  });

  it("gives a different event stream for different tactics", () => {
    const base = loadDefaultTactics();
    const busBold = new EventBus();
    const busShy = new EventBus();
    runRound(
      createSimState({ map: loadTestArena(), seed: 8, bus: busBold, tactics: { ...base, aggression: 1 } }),
    );
    runRound(
      createSimState({ map: loadTestArena(), seed: 8, bus: busShy, tactics: { ...base, aggression: 0 } }),
    );
    expect(busBold.log.length).not.toBe(busShy.log.length);
  });

  it("stays deterministic with the same tactics and the same seed", () => {
    const base = loadDefaultTactics();
    const first = new EventBus();
    const second = new EventBus();
    for (const bus of [first, second]) {
      runRound(
        createSimState({ map: loadTestArena(), seed: 12, bus, tactics: { ...base, aggression: 0.7 } }),
      );
    }
    expect(JSON.stringify(second.log)).toBe(JSON.stringify(first.log));
  });
});
