import { describe, expect, it } from "vitest";
import { updatePerception } from "../src/ai/perception.js";
import { parseArenaText } from "../src/arena/index.js";
import { loadAnnouncements } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { announcementLine, feedLines } from "../src/report/killFeed.js";
import {
  cellCenter,
  createSimState,
  effectiveReaction,
  enterSuddenDeathIfNeeded,
  checkRoundEnd,
  step,
  tryFire,
  type BotState,
  type SimState,
} from "../src/sim/index.js";

const RANGE = [
  "#############################################",
  "#SSS.......................................S#",
  "#........................................SS.#",
  "#############################################",
].join("\n");

function rangeState(seed = 1, bus = new EventBus()): SimState {
  return createSimState({ map: parseArenaText(RANGE, { source: "range" }), seed, bus });
}

/** Make `shooter` kill `victim` at once. */
function forceKill(state: SimState, shooter: BotState, victim: BotState): void {
  shooter.pos = cellCenter({ x: 2, y: 1 });
  victim.pos = cellCenter({ x: 4, y: 1 });
  victim.health = 1;
  victim.alive = true;
  updatePerception(state);
  shooter.targetId = victim.id;
  let guard = 0;
  while (victim.alive && guard < 4000) {
    shooter.fireCooldownTicks = 0;
    // Section 7.20.7: the weapon adds to the reaction of the bot.
    shooter.aimTicks = effectiveReaction(shooter, "close");
    shooter.targetId = victim.id;
    tryFire(state, shooter);
    guard += 1;
  }
  expect(victim.alive, "the victim must die").toBe(false);
}

function announcements(bus: EventBus, kind: string): Record<string, unknown>[] {
  return bus.filter("Announcement").filter((event) => event.data["kind"] === kind).map((e) => e.data);
}

describe("the announcement tables", () => {
  it("holds the classic arena shooter tiers", () => {
    const tables = loadAnnouncements();
    expect(tables.multiKill.map((tier) => tier.text)).toEqual([
      "Double Kill",
      "Multi Kill",
      "Mega Kill",
      "Ultra Kill",
      "Monster Kill",
    ]);
    expect(tables.spree.map((tier) => tier.text)).toEqual([
      "Killing Spree",
      "Rampage",
      "Dominating",
      "Unstoppable",
      "Godlike",
    ]);
    // A 3v3 round ends at 15 team kills, so the first spree step must be low
    // enough for a bot to reach it.
    expect(tables.spree[0]!.count).toBeLessThanOrEqual(4);
  });
});

describe("multi-kill announcements", () => {
  it("announces a tier when the count reaches it", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const shooter = state.bots[0] as BotState;
    for (const victim of state.bots.slice(3)) forceKill(state, shooter, victim);
    expect(shooter.multiKillCount).toBe(3);
    const texts = announcements(bus, "multiKill").map((data) => data["text"]);
    expect(texts).toEqual(["Double Kill", "Multi Kill"]);
  });

  it("does not announce when the window expired", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const shooter = state.bots[0] as BotState;
    forceKill(state, shooter, state.bots[3] as BotState);
    state.tick = state.config.multiKillWindowTicks + 10;
    forceKill(state, shooter, state.bots[4] as BotState);
    expect(shooter.multiKillCount).toBe(1);
    expect(announcements(bus, "multiKill")).toHaveLength(0);
  });
});

describe("killing spree announcements", () => {
  it("announces a spree at the first tier", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const shooter = state.bots[0] as BotState;
    const victim = state.bots[3] as BotState;
    const tier = loadAnnouncements().spree[0]!;
    for (let i = 0; i < tier.count; i += 1) {
      state.tick += state.config.multiKillWindowTicks + 5;
      forceKill(state, shooter, victim);
    }
    expect(shooter.spreeCount).toBe(tier.count);
    const spree = announcements(bus, "spree");
    expect(spree).toHaveLength(1);
    expect(spree[0]?.["text"]).toBe(tier.text);
  });

  it("announces the end of a spree and names both bots", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const shooter = state.bots[0] as BotState;
    const victim = state.bots[3] as BotState;
    const tier = loadAnnouncements().spree[0]!;

    // The victim first builds a spree of its own.
    victim.spreeCount = tier.count;
    forceKill(state, shooter, victim);

    const ended = announcements(bus, "spreeEnded");
    expect(ended).toHaveLength(1);
    expect(ended[0]?.["botId"]).toBe(victim.id);
    expect(ended[0]?.["killerId"]).toBe(shooter.id);
    expect(ended[0]?.["text"]).toBe(tier.text);
    expect(victim.spreeCount, "the death ends the spree").toBe(0);
  });

  it("says nothing when a bot with a short spree dies", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    const shooter = state.bots[0] as BotState;
    const victim = state.bots[3] as BotState;
    victim.spreeCount = 2;
    forceKill(state, shooter, victim);
    expect(announcements(bus, "spreeEnded")).toHaveLength(0);
  });
});

describe("announcement lines", () => {
  it("builds a line for every kind", () => {
    const bus = new EventBus();
    bus.emit("Announcement", 1, 1, { kind: "multiKill", botId: "A0", count: 2, text: "Double Kill" });
    bus.emit("Announcement", 2, 1, { kind: "spree", botId: "A0", count: 5, text: "Killing Spree" });
    bus.emit("Announcement", 3, 1, {
      kind: "spreeEnded",
      botId: "B1",
      killerId: "A0",
      count: 6,
      text: "Killing Spree",
    });
    bus.emit("Announcement", 4, 1, { kind: "suddenDeath", text: "Sudden Death" });

    expect(announcementLine(bus.log[0]!)).toBe("A0: Double Kill!");
    expect(announcementLine(bus.log[1]!)).toBe("A0 is on a Killing Spree!");
    expect(announcementLine(bus.log[2]!)).toBe("A0 ended B1's Killing Spree");
    expect(announcementLine(bus.log[3]!)).toBe("Sudden Death");
  });

  it("gives null for another event", () => {
    const bus = new EventBus();
    bus.emit("Kill", 1, 1, {});
    expect(announcementLine(bus.log[0]!)).toBeNull();
  });

  it("mixes kills and announcements in the feed, with their kind", () => {
    const bus = new EventBus();
    bus.emit("Kill", 1, 1, { killerId: "A0", victimId: "B0", weaponArchetype: "baseline", rangeBand: "mid" });
    bus.emit("Announcement", 1, 1, { kind: "multiKill", botId: "A0", count: 2, text: "Double Kill" });
    const lines = feedLines(bus.log, 8);
    expect(lines.map((line) => line.kind)).toEqual(["kill", "multiKill"]);
    expect(lines[1]?.text).toBe("A0: Double Kill!");
  });
});

describe("sudden death", () => {
  it("starts at the time limit with an equal score", () => {
    const bus = new EventBus();
    const state = rangeState(1, bus);
    state.tick = state.config.timeLimitTicks;
    state.score.A = 5;
    state.score.B = 5;
    enterSuddenDeathIfNeeded(state);
    expect(state.suddenDeath).toBe(true);
    expect(state.suddenDeathStartTick).toBe(state.tick);
    expect(announcements(bus, "suddenDeath")).toHaveLength(1);
  });

  it("does not start when one team leads", () => {
    const state = rangeState();
    state.tick = state.config.timeLimitTicks;
    state.score.A = 6;
    state.score.B = 5;
    enterSuddenDeathIfNeeded(state);
    expect(state.suddenDeath).toBe(false);
    expect(checkRoundEnd(state)?.reason).toBe("timeLimit");
  });

  it("gives the round to the next kill", () => {
    const state = rangeState();
    state.tick = state.config.timeLimitTicks;
    state.score.A = 5;
    state.score.B = 5;
    enterSuddenDeathIfNeeded(state);
    expect(checkRoundEnd(state)).toBeNull();

    state.score.B += 1;
    const outcome = checkRoundEnd(state);
    expect(outcome?.reason).toBe("suddenDeath");
    expect(outcome?.winnerTeamId).toBe("B");
  });

  it("ends the round in a draw only after the safety limit", () => {
    const state = rangeState();
    state.tick = state.config.timeLimitTicks;
    state.score.A = 5;
    state.score.B = 5;
    enterSuddenDeathIfNeeded(state);

    state.tick = state.suddenDeathStartTick + state.config.suddenDeathMaxTicks - 1;
    expect(checkRoundEnd(state)).toBeNull();
    state.tick = state.suddenDeathStartTick + state.config.suddenDeathMaxTicks;
    const outcome = checkRoundEnd(state);
    expect(outcome?.winnerTeamId).toBeNull();
    expect(outcome?.reason).toBe("timeLimit");
  });

  it("keeps the score limit above sudden death", () => {
    const state = rangeState();
    state.suddenDeath = true;
    state.score.A = state.config.scoreLimit;
    state.score.B = state.config.scoreLimit - 1;
    expect(checkRoundEnd(state)?.reason).toBe("scoreLimit");
  });

  it("runs the step loop into sudden death and out of it", () => {
    const bus = new EventBus();
    const state = rangeState(3, bus);
    state.tick = state.config.timeLimitTicks - 1;
    step(state);
    expect(state.suddenDeath).toBe(true);
    expect(state.outcome).toBeNull();
    state.score.A += 1;
    step(state);
    expect(state.outcome?.reason).toBe("suddenDeath");
    expect(state.outcome?.winnerTeamId).toBe("A");
  });
});
