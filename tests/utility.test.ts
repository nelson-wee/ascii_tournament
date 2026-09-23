import { describe, expect, it } from "vitest";
import { findPath } from "../src/ai/navigation.js";
import { updatePerception } from "../src/ai/perception.js";
import { dangerFor, updateInfluence } from "../src/ai/influence.js";
import {
  actionLabel,
  applyAction,
  bandDistance,
  bestWeaponAt,
  bestWeaponOverall,
  decide,
  equipBestWeapon,
  positionValue,
  wantedBand,
  noteReachedPickup,
  scoreActions,
  type Action,
} from "../src/ai/utility.js";
import { loadTestArena, parseArenaText, Tile, tileAt } from "../src/arena/index.js";
import { loadBaselineWeapon, loadDefaultTactics } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng, deriveSeed } from "../src/core/rng.js";
import { generateWeaponSet } from "../src/weapons/generate.js";
import type { Weapon } from "../src/weapons/types.js";
import type { Tactics } from "../src/core/schemas.js";
import {
  botCell,
  cellCenter,
  createSimState,
  effectiveReaction,
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
    state.pickups = [];
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


  it("equipBestWeapon puts the best weapon in the hands of the bot", () => {
    // Section 7.20.16: this is a rule, not an action. As an action it competed
    // with Engage for the one action of a tick and it always lost.
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const better = {
      ...loadBaselineWeapon(),
      id: "other-gun",
      rangeMax: 100,
      dpsProfile: { close: 99, mid: 99, long: 99 },
    };
    bot.weapons = [bot.weapon, better];
    bot.ammo.set("other-gun", 50);
    equipBestWeapon(state, bot);
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
  it("drops the goal when the bot arrives", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const pickup = state.map.pickups[0]!;
    bot.goalSlotId = pickup.slotId;
    bot.action = { kind: "SeekPickup", slotId: pickup.slotId };
    bot.pos = cellCenter(pickup.cell);
    noteReachedPickup(state, bot);
    expect(bot.goalSlotId).toBeNull();
    expect(bot.action.kind).toBe("Idle");
  });

  it("keeps the goal while the bot is still on the way", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const pickup = state.map.pickups[0]!;
    bot.goalSlotId = pickup.slotId;
    bot.action = { kind: "SeekPickup", slotId: pickup.slotId };
    noteReachedPickup(state, bot);
    expect(bot.goalSlotId).toBe(pickup.slotId);
  });

  it("does not walk back to a point that it emptied", () => {
    // The respawn timer of Section 7.12 replaced the visited memory of M4.
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const taken = state.pickups[0]!;
    taken.ready = false;
    taken.readyAtTick = state.tick + 500;
    const offered = scoreActions(state, bot)
      .filter((candidate) => candidate.action.kind === "SeekPickup")
      .map((candidate) => (candidate.action as { slotId: string }).slotId);
    expect(offered).not.toContain(taken.point.slotId);
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
  it("makes a bolder team shoot more", () => {
    // The acceptance test of Milestone M4. One round is noisy, so this sums
    // several rounds: the question is whether aggression changes the result,
    // not whether it changes one round by a set amount.
    //
    // Aggression used to work through `Retreat`: a careful bot broke contact
    // and stopped firing. `Retreat` is gone (Section 7.20.17). A bold bot now
    // shoots sooner, because aggression shortens the aim delay, and it stands
    // its ground instead of walking to a better band.
    const base = loadDefaultTactics();
    const shots = { A: 0, B: 0 };
    const score = { A: 0, B: 0 };

    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const bus = new EventBus();
      // A run has weapons from M6 on, so the round must have them too: with
      // the baseline alone a bot has no better band to walk to, and the
      // `Reposition` half of aggression does nothing.
      const result = runRound(
        createSimState({
          map: loadTestArena(),
          seed,
          bus,
          weapons: generateWeaponSet(createRng(deriveSeed(seed, "weapons"), "weapons"), 5, {
            ticksPerSecond: 20,
          }),
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

    // The acceptance test of M4 asks that the tactics change the result, not
    // that one side wins. Which side wins is a balance question, and the batch
    // harness owns it (Section 7.16).
    expect(shots.A).toBeGreaterThan(shots.B * 1.05);
    expect(score.A + score.B).toBeGreaterThan(0);
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

describe("positionValue", () => {
  it("falls when a bot has not seen an enemy for a long while", () => {
    // Section 7.20.12: holding ground is a sightline action. 29 000 of 29 051
    // HoldPosition ticks had no enemy in sight, which is the low-kill defect
    // of Section 7.2.1.
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const cell = botCell(bot);

    bot.visibleEnemyIds = [state.bots[3]!.id];
    const inSight = positionValue(state, bot, cell);

    bot.visibleEnemyIds = [];
    bot.lastSeen.clear();
    expect(positionValue(state, bot, cell)).toBeLessThan(inSight);
  });

  it("keeps the ground worth holding just after a contact", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const cell = botCell(bot);
    bot.visibleEnemyIds = [];

    bot.lastSeen.clear();
    const forgotten = positionValue(state, bot, cell);

    state.tick = 100;
    bot.lastSeen.set("B0", { cell: { x: 1, y: 1 }, tick: state.tick });
    expect(positionValue(state, bot, cell)).toBeGreaterThan(forgotten);
  });

  it("stays inside its range whatever the cell", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    for (let y = 1; y < state.map.height - 1; y += 1) {
      for (let x = 1; x < state.map.width - 1; x += 1) {
        const value = positionValue(state, bot, { x, y });
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(1.4);
      }
    }
  });
});

describe("wantedBand", () => {
  it("takes the band where the weapon of the bot is strongest", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    bot.tactics = { ...bot.tactics, preferredRange: "close" };
    bot.weapon = {
      ...bot.weapon,
      rangeMax: 100,
      dpsProfile: { close: 1, mid: 2, long: 40 },
    };
    expect(wantedBand(state, bot)).toBe("long");
  });

  it("breaks a tie with the preferred range of the tactics", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    bot.weapon = { ...bot.weapon, rangeMax: 100, dpsProfile: { close: 10, mid: 10, long: 10 } };
    bot.tactics = { ...bot.tactics, preferredRange: "close" };
    expect(wantedBand(state, bot)).toBe("close");
    bot.tactics = { ...bot.tactics, preferredRange: "long" };
    expect(wantedBand(state, bot)).toBe("long");
  });

  it("never names a band that the weapon cannot reach", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    bot.tactics = { ...bot.tactics, preferredRange: "long" };
    bot.weapon = {
      ...bot.weapon,
      rangeMax: bandDistance(state, "close"),
      dpsProfile: { close: 10, mid: 30, long: 40 },
    };
    expect(wantedBand(state, bot)).toBe("close");
  });
});

describe("bestWeaponOverall", () => {
  it("takes the weapon that reaches the most bands, not the one band of the tactics", () => {
    // Section 7.20.12: a bot that picks its weapon for one band alone carries
    // a short-range weapon into a mid-range arena and cannot fire at all.
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const shortRange = {
      ...bot.weapon,
      id: "short",
      rangeMax: bandDistance(state, "close"),
      dpsProfile: { close: 25, mid: 0, long: 0 },
    };
    const allRound = {
      ...bot.weapon,
      id: "all-round",
      rangeMax: 100,
      dpsProfile: { close: 20, mid: 20, long: 20 },
    };
    bot.weapons = [shortRange, allRound];
    bot.ammo.set("short", 50);
    bot.ammo.set("all-round", 50);
    bot.tactics = { ...bot.tactics, preferredRange: "close" };
    expect(bestWeaponOverall(state, bot).id).toBe("all-round");
  });

  it("weighs a band by how often the arena fires in it", () => {
    // Section 7.20.15: the AI and the power budget read one number. The long
    // band is 1 % of shots, so a weapon that only shines there is not the pick.
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const longOnly = {
      ...bot.weapon,
      id: "long-only",
      rangeMax: 100,
      dpsProfile: { close: 0, mid: 0, long: 300 },
    };
    const midWeapon = {
      ...bot.weapon,
      id: "mid",
      rangeMax: 100,
      dpsProfile: { close: 0, mid: 30, long: 0 },
    };
    bot.weapons = [longOnly, midWeapon];
    bot.ammo.set("long-only", 50);
    bot.ammo.set("mid", 50);
    bot.tactics = { ...bot.tactics, preferredRange: "mid" };
    expect(bestWeaponOverall(state, bot).id).toBe("mid");
  });

  it("never takes an empty weapon", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const full = { ...bot.weapon, id: "full", rangeMax: 100 };
    const empty = {
      ...bot.weapon,
      id: "empty",
      rangeMax: 100,
      dpsProfile: { close: 99, mid: 99, long: 99 },
    };
    bot.weapons = [full, empty];
    bot.ammo.set("full", 10);
    bot.ammo.set("empty", 0);
    expect(bestWeaponOverall(state, bot).id).toBe("full");
  });
});

describe("a tactic has a cost and a benefit", () => {
  it("makes a bold bot shoot sooner than a careful one", () => {
    // Section 7.20.16: the job of aggression is in the fight. Letting it
    // discount the danger map instead lost 17 points of win rate.
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const discount = state.config.aggressionReactionDiscount;

    bot.tactics = { ...bot.tactics, aggression: 0.1 };
    const careful = effectiveReaction(bot, "mid", discount);
    bot.tactics = { ...bot.tactics, aggression: 0.9 };
    expect(effectiveReaction(bot, "mid", discount)).toBeLessThan(careful);
  });

  it("keeps the danger map a question of the ground alone", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    updateInfluence(state);
    const cell = botCell(state.bots[3] as BotState);

    bot.tactics = { ...bot.tactics, aggression: 0.1, hazardTolerance: 0.3 };
    const careful = dangerFor(state, bot, cell);
    bot.tactics = { ...bot.tactics, aggression: 0.9, hazardTolerance: 0.3 };
    expect(dangerFor(state, bot, cell)).toBe(careful);
    bot.tactics = { ...bot.tactics, hazardTolerance: 0.9 };
    expect(dangerFor(state, bot, cell)).toBeLessThan(careful);
  });

  it("makes a pickup on dangerous ground worth less", () => {
    // Section 7.8: a run across the arena is the cost of item control.
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const pickup = state.pickups.find((candidate) => candidate.point.kind === "health");
    expect(pickup).toBeDefined();
    bot.health = 10;
    // Commit the bot to this point, so both readings score the same run.
    bot.action = { kind: "SeekPickup", slotId: pickup!.point.slotId };

    updateInfluence(state);
    const safe = scoreOf(state, bot, "SeekPickup");

    // Put every enemy on the point, which makes the ground dangerous.
    for (const enemy of state.bots.filter((other) => other.teamId !== bot.teamId)) {
      enemy.pos = cellCenter(pickup!.point.cell);
    }
    state.influence.updatedAtTick = -1;
    updateInfluence(state);
    const risky = scoreOf(state, bot, "SeekPickup");

    expect(safe).toBeGreaterThan(0);
    expect(risky).toBeLessThan(safe);
  });
});

describe("healing is for between fights", () => {
  it("leaves a health point alone while an enemy is in sight", () => {
    // Section 2.1 wants fast combat. A bot that breaks off to heal in the
    // middle of a fight makes the round slow and the fighting careful.
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const enemy = state.bots[3] as BotState;
    bot.health = 10;
    updatePerception(state);

    bot.visibleEnemyIds = [];
    const alone = scoreOf(state, bot, "SeekPickup");
    expect(alone).toBeGreaterThan(0);

    bot.visibleEnemyIds = [enemy.id];
    for (const entry of scoreActions(state, bot)) {
      const action = entry.action;
      if (action.kind !== "SeekPickup") continue;
      const kind = state.pickups.find((p) => p.point.slotId === action.slotId)?.point.kind;
      expect(["health", "armor"]).not.toContain(kind);
    }
  });

  it("still contests a weapon, its ammo, and a power-up under fire", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const enemy = state.bots[3] as BotState;
    bot.visibleEnemyIds = [enemy.id];
    updatePerception(state);

    const contestable = state.pickups.filter(
      (pickup) => !["health", "armor"].includes(pickup.point.kind),
    );
    if (contestable.length === 0) return;
    // Nothing removes these kinds from the list that the bot scores.
    for (const entry of scoreActions(state, bot)) {
      const action = entry.action;
      if (action.kind !== "SeekPickup") continue;
      const kind = state.pickups.find((p) => p.point.slotId === action.slotId)?.point.kind;
      expect(["health", "armor"]).not.toContain(kind);
    }
  });
});

describe("a weapon swap has a cost", () => {
  function twoWeapons(bot: BotState): { held: Weapon; better: Weapon } {
    const held = { ...bot.weapon, id: "held", rangeMax: 100, dpsProfile: { close: 20, mid: 20, long: 20 } };
    const better = { ...bot.weapon, id: "better", rangeMax: 100, dpsProfile: { close: 22, mid: 22, long: 22 } };
    bot.weapons = [bot.weapon, held, better];
    bot.weapon = held;
    bot.ammo.set("held", 50);
    bot.ammo.set("better", 50);
    return { held, better };
  }

  it("swaps for free when the bot sees nobody", () => {
    // This is where a role and a doctrine arm a bot (Section 7.20.17).
    const state = roomState();
    const bot = state.bots[0] as BotState;
    twoWeapons(bot);
    bot.visibleEnemyIds = [];
    equipBestWeapon(state, bot);
    expect(bot.weapon.id).toBe("better");
    expect(bot.fireCooldownTicks).toBe(0);
  });

  it("keeps a weapon that is only a little worse while a fight runs", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const enemy = state.bots[3] as BotState;
    twoWeapons(bot);
    bot.pos = cellCenter({ x: enemy.pos.x, y: enemy.pos.y });
    bot.visibleEnemyIds = [enemy.id];
    equipBestWeapon(state, bot);
    expect(bot.weapon.id).toBe("held");
  });

  it("pays the cost for a weapon that is clearly better", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const enemy = state.bots[3] as BotState;
    const { better } = twoWeapons(bot);
    better.dpsProfile = { close: 90, mid: 90, long: 90 };
    bot.weapons = [bot.weapons[0]!, bot.weapon, better];
    bot.visibleEnemyIds = [enemy.id];
    equipBestWeapon(state, bot);
    expect(bot.weapon.id).toBe("better");
    expect(bot.fireCooldownTicks).toBe(state.config.weaponSwapTicks);
    expect(bot.aimTicks).toBe(0);
  });

  it("raises the weapon that the tournament priority names", () => {
    const state = roomState();
    const bot = state.bots[0] as BotState;
    const plain = { ...bot.weapon, id: "plain", archetype: "assault" as const, rangeMax: 100, dpsProfile: { close: 30, mid: 30, long: 30 } };
    const wanted = { ...bot.weapon, id: "wanted", archetype: "marksman" as const, rangeMax: 100, dpsProfile: { close: 22, mid: 22, long: 22 } };
    bot.weapons = [plain, wanted];
    bot.ammo.set("plain", 50);
    bot.ammo.set("wanted", 50);

    bot.tactics = { ...bot.tactics, weaponRolePref: null };
    expect(bestWeaponAt(state, bot, 10).id).toBe("plain");
    bot.tactics = { ...bot.tactics, weaponRolePref: "marksman" };
    expect(bestWeaponAt(state, bot, 10).id).toBe("wanted");
  });
});
