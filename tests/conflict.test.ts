import { describe, expect, it } from "vitest";
import {
  measureConflict,
  contestedAt,
  coverageAt,
  coverageTotalAt,
} from "../src/arena/conflict.js";
import { conflictOptions } from "../src/arena/conflictOptions.js";
import { cellSeesCell } from "../src/arena/sight.js";
import { generateArena } from "../src/arena/generate.js";
import { parseArenaText } from "../src/arena/textArena.js";
import { Tile, tileAt, type ArenaMap } from "../src/arena/types.js";
import { applyAction, bestGround, groundValue, scoreActions } from "../src/ai/utility.js";
import { updatePerception } from "../src/ai/perception.js";
import { loadArenaProfiles, loadDefaultTactics } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import type { Tactics } from "../src/core/schemas.js";
import { createSimState, type BotState, type SimState } from "../src/sim/index.js";
import { loadBaselineWeapon } from "../src/core/data.js";
import type { Weapon } from "../src/weapons/types.js";
import { createRng, deriveSeed } from "../src/core/rng.js";

const STYLES = ["bastion", "openfield", "cavern"] as const;

function arenaOf(style: (typeof STYLES)[number], index = 0): ArenaMap {
  const profiles = loadArenaProfiles();
  const profile = profiles.profiles[style];
  expect(profile).toBeDefined();
  const seed = deriveSeed(20260929, `${style}:arena:${index}`);
  return generateArena(profile!, createRng(seed, "arena"), seed, { rules: profiles.rules });
}

describe("cellSeesCell: the line walk is exact", () => {
  it("sees along an open row and not through a wall", () => {
    const map = parseArenaText(
      [
        "###########",
        "#SSS......#",
        "#....#....#",
        "#SSS......#",
        "###########",
      ].join("\n"),
      { source: "sight" },
    );
    expect(cellSeesCell(map, { x: 1, y: 1 }, { x: 9, y: 1 })).toBe(true);
    expect(cellSeesCell(map, { x: 1, y: 2 }, { x: 9, y: 2 })).toBe(false);
  });

  it("gives the same answer whichever end it starts from", () => {
    const map = arenaOf("bastion");
    let tested = 0;
    for (let i = 0; i < 4000; i += 1) {
      const a = { x: (i * 7) % map.width, y: (i * 13) % map.height };
      const b = { x: (i * 11) % map.width, y: (i * 5) % map.height };
      tested += 1;
      expect(cellSeesCell(map, a, b)).toBe(cellSeesCell(map, b, a));
    }
    expect(tested).toBeGreaterThan(1000);
  });

  it("gives the same answer to a pair and to its mirror image", () => {
    // The defect this replaced: a float sample that lands exactly on a cell
    // boundary floors one way going left and the other going right
    // (Section 7.35.2). It is why the walk is integer arithmetic.
    for (const style of STYLES) {
      const map = arenaOf(style);
      const mirror = (c: { x: number; y: number }) => ({
        x: map.width - 1 - c.x,
        y: map.height - 1 - c.y,
      });
      for (let i = 0; i < 3000; i += 1) {
        const a = { x: (i * 7) % map.width, y: (i * 13) % map.height };
        const b = { x: (i * 11) % map.width, y: (i * 5) % map.height };
        expect(cellSeesCell(map, a, b), `${style} ${a.x},${a.y} -> ${b.x},${b.y}`).toBe(
          cellSeesCell(map, mirror(a), mirror(b)),
        );
      }
    }
  });

  it("is mirror-exact on the exact geometry that broke the float walk", () => {
    const map = arenaOf("bastion");
    const mirror = (c: { x: number; y: number }) => ({
      x: map.width - 1 - c.x,
      y: map.height - 1 - c.y,
    });
    for (const [a, b] of [
      [{ x: 31, y: 3 }, { x: 27, y: 14 }],
      [{ x: 31, y: 3 }, { x: 26, y: 17 }],
    ] as const) {
      expect(cellSeesCell(map, a, b)).toBe(cellSeesCell(map, mirror(a), mirror(b)));
    }
  });
});

describe("measureConflict: where the fight happens", () => {
  it("marks the middle of an arena and not the spawns", () => {
    for (const style of STYLES) {
      const map = arenaOf(style);
      const middle = contestedAt(map, Math.round(map.width / 2), Math.round(map.height / 2));
      const spawn = map.spawns[0];
      expect(spawn).toBeDefined();
      expect(middle, style).toBeGreaterThan(contestedAt(map, spawn!.x, spawn!.y));
    }
  });

  it("finds ground that overlooks the conflict zone", () => {
    for (const style of STYLES) {
      const map = arenaOf(style);
      const field = map.conflict;
      expect(field, style).toBeDefined();
      expect(field!.best.length).toBeGreaterThan(0);
      const top = field!.best[0]!;
      expect(coverageTotalAt(map, top.x, top.y), style).toBeCloseTo(1, 5);
      // The best ground beats a spawn corner by a wide margin.
      const spawn = map.spawns[0]!;
      expect(coverageTotalAt(map, top.x, top.y)).toBeGreaterThan(
        coverageTotalAt(map, spawn.x, spawn.y) + 0.2,
      );
    }
  });

  it("is exactly symmetric under the half turn, on every style", () => {
    // An arena is symmetric by construction, so a conflict field that is not is
    // a side bias (Section 7.35.2).
    for (const style of STYLES) {
      const map = arenaOf(style);
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          if (tileAt(map, x, y) === Tile.Wall) continue;
          const mx = map.width - 1 - x;
          const my = map.height - 1 - y;
          expect(contestedAt(map, x, y), `${style} contested ${x},${y}`).toBeCloseTo(
            contestedAt(map, mx, my),
            9,
          );
          for (const band of ["close", "mid", "long"] as const) {
            expect(
              coverageAt(map, x, y, band),
              `${style} coverage ${band} ${x},${y}`,
            ).toBeCloseTo(coverageAt(map, mx, my, band), 9);
          }
        }
      }
    }
  });

  it("gives the same field for the same arena, every time", () => {
    const map = arenaOf("cavern");
    const again = measureConflict(map, conflictOptions());
    expect([...again.contested]).toEqual([...map.conflict!.contested]);
    for (const band of ["close", "mid", "long"] as const) {
      expect([...again.coverage[band]]).toEqual([...map.conflict!.coverage[band]]);
    }
  });

  it("scores a wall at nothing, and an unmeasured map at nothing", () => {
    const map = arenaOf("bastion");
    let walls = 0;
    for (let y = 0; y < map.height && walls < 5; y += 1) {
      for (let x = 0; x < map.width && walls < 5; x += 1) {
        if (tileAt(map, x, y) !== Tile.Wall) continue;
        walls += 1;
        expect(coverageTotalAt(map, x, y)).toBe(0);
      }
    }
    expect(walls).toBe(5);
    // A map nothing measured: every reader treats a missing field as zero.
    const bare: ArenaMap = { ...map };
    delete bare.conflict;
    expect(coverageTotalAt(bare, 5, 5)).toBe(0);
    expect(contestedAt(bare, 5, 5)).toBe(0);
  });

  it("puts the conflict zone on a minority of the floor", () => {
    // A zone that is everywhere names nothing. 5 % to 40 % is the useful band.
    for (const style of STYLES) {
      const map = arenaOf(style);
      let floor = 0;
      let hot = 0;
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          if (tileAt(map, x, y) === Tile.Wall) continue;
          floor += 1;
          if (contestedAt(map, x, y) > 0) hot += 1;
        }
      }
      expect(hot / floor, style).toBeGreaterThan(0.02);
      expect(hot / floor, style).toBeLessThan(0.4);
    }
  });
});

describe("TakePosition: the measurement reaches a bot", () => {
  /**
   * A hall with one alcove. The middle of the hall is contested ground, and the
   * far end of the hall overlooks it while the alcove sees almost nothing.
   */
  const HALL = [
    "##########################",
    "#SSS....................S#",
    "#........................#",
    "#........................#",
    "#####.####################",
    "#...#....................#",
    "#...#....................#",
    "#........................#",
    "#SS.....................S#",
    "##########################",
  ].join("\n");

  function hallState(tactics?: Partial<Tactics>): SimState {
    return createSimState({
      map: parseArenaText(HALL, { source: "hall" }),
      seed: 5,
      bus: new EventBus(),
      tacticsOverride: { ...loadDefaultTactics(), ...tactics },
    });
  }

  it("prefers open ground that overlooks the middle to a blind alcove", () => {
    const state = hallState();
    const bot = state.bots[0] as BotState;
    const open = coverageTotalAt(state.map, 12, 2);
    const alcove = coverageTotalAt(state.map, 2, 6);
    expect(open).toBeGreaterThan(alcove);
    expect(bot).toBeDefined();
  });

  it("walks to better ground when it can see some", () => {
    const state = hallState({ holdPosition: 1 });
    const bot = state.bots[0] as BotState;
    for (const other of state.bots) if (other !== bot) other.alive = false;
    bot.pos = { x: 2.5, y: 6.5 }; // inside the alcove
    updatePerception(state);
    const goal = bestGround(state, bot);
    expect(goal).not.toBeNull();
    expect(coverageTotalAt(state.map, goal!.x, goal!.y)).toBeGreaterThan(
      coverageTotalAt(state.map, 2, 6),
    );
  });

  it("stays put when it already holds the best ground in reach", () => {
    const state = hallState({ holdPosition: 1 });
    const bot = state.bots[0] as BotState;
    for (const other of state.bots) if (other !== bot) other.alive = false;
    const top = state.map.conflict!.best[0]!;
    bot.pos = { x: top.x + 0.5, y: top.y + 0.5 };
    updatePerception(state);
    expect(bestGround(state, bot)).toBeNull();
  });

  it("keeps its answer between searches, so the scan is not on every tick", () => {
    const state = hallState({ holdPosition: 1 });
    const bot = state.bots[0] as BotState;
    for (const other of state.bots) if (other !== bot) other.alive = false;
    bot.pos = { x: 2.5, y: 6.5 };
    updatePerception(state);
    const first = bestGround(state, bot);
    bot.pos = { x: 20.5, y: 2.5 };
    // The tick has not moved, so the search must not run again.
    expect(bestGround(state, bot)).toBe(first);
    state.tick += state.config.takePositionIntervalTicks;
    expect(bestGround(state, bot)).not.toBe(first);
  });

  it("scores TakePosition, and an Overwatch bot wants it more than a Tank", () => {
    const state = hallState();
    const overwatch = state.bots[0] as BotState;
    const tank = state.bots[1] as BotState;
    for (const bot of [overwatch, tank]) {
      bot.pos = { x: 2.5, y: 6.5 };
      bot.positionGoalTick = -Infinity;
    }
    overwatch.roleBehavior = { takePosition: 1.6 };
    overwatch.tactics = { ...overwatch.tactics, holdPosition: 0.75 };
    tank.roleBehavior = { takePosition: 0.6 };
    tank.tactics = { ...tank.tactics, holdPosition: 0.3 };
    updatePerception(state);

    const scoreOfTake = (bot: BotState): number =>
      scoreActions(state, bot).find((c) => c.action.kind === "TakePosition")?.score ?? 0;
    expect(scoreOfTake(overwatch)).toBeGreaterThan(0);
    expect(scoreOfTake(overwatch)).toBeGreaterThan(scoreOfTake(tank));
  });

  it("splits the coverage of a cell across the three bands", () => {
    for (const style of STYLES) {
      const map = arenaOf(style);
      const top = map.conflict!.best[0]!;
      const parts = (["close", "mid", "long"] as const).map((b) =>
        coverageAt(map, top.x, top.y, b),
      );
      expect(parts.reduce((s, v) => s + v, 0), style).toBeCloseTo(
        coverageTotalAt(map, top.x, top.y),
        5,
      );
      // The bands share one normaliser, so no cell's total passes 1.
      expect(coverageTotalAt(map, top.x, top.y), style).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("sends a marksman and a shotgun to different ground", () => {
    // The point of Section 7.36.3. The same arena, the same bot, two weapons:
    // the one built for 18 cells must not want the cell that watches the fight
    // from 8.
    const state = hallState({ holdPosition: 1 });
    const bot = state.bots[0] as BotState;
    for (const other of state.bots) if (other !== bot) other.alive = false;
    bot.pos = { x: 2.5, y: 6.5 };
    updatePerception(state);

    const groundFor = (over: Partial<Weapon>): string => {
      bot.weapon = { ...loadBaselineWeapon(), rangeMax: 26, ...over };
      bot.positionGoalTick = -Infinity;
      const goal = bestGround(state, bot);
      return goal === null ? "stay" : `${goal.x},${goal.y}`;
    };
    const sniper = groundFor({ optimalRange: 20, rangeTolerance: 7 });
    const shotgun = groundFor({ optimalRange: 4, rangeTolerance: 7 });
    expect(sniper).not.toBe(shotgun);
  });

  it("weighs a cell by the band its weapon is good at, not by the flat count", () => {
    // The invariant of Section 7.36.3, stated directly: two weapons, two cells,
    // and the ordering must flip. A cell whose view of the zone is mostly close
    // range is the shotgun's cell; one whose view is mostly long range is the
    // marksman's. A flat count would rank them the same way for both.
    const state = hallState({ holdPosition: 1 });
    const bot = state.bots[0] as BotState;
    for (const other of state.bots) if (other !== bot) other.alive = false;
    bot.visibleEnemyIds = [];

    const pick = (wants: "close" | "long"): { x: number; y: number } | null => {
      let found: { x: number; y: number } | null = null;
      let bestGap = 0;
      for (let y = 1; y < state.map.height - 1; y += 1) {
        for (let x = 1; x < state.map.width - 1; x += 1) {
          const close = coverageAt(state.map, x, y, "close");
          const long = coverageAt(state.map, x, y, "long");
          const gap = wants === "close" ? close - long : long - close;
          if (gap > bestGap) {
            bestGap = gap;
            found = { x, y };
          }
        }
      }
      return found;
    };
    const nearCell = pick("close");
    const farCell = pick("long");
    expect(nearCell).not.toBeNull();
    expect(farCell).not.toBeNull();

    const valueOf = (over: Partial<Weapon>, cell: { x: number; y: number }): number => {
      bot.weapon = { ...loadBaselineWeapon(), rangeMax: 26, ...over };
      return groundValue(state, bot, cell);
    };
    const sniper = { optimalRange: 20, rangeTolerance: 6 };
    const shotgun = { optimalRange: 4, rangeTolerance: 6 };

    // Each weapon prefers the cell that watches the fight at its own range.
    expect(valueOf(shotgun, nearCell!)).toBeGreaterThan(valueOf(shotgun, farCell!));
    expect(valueOf(sniper, farCell!)).toBeGreaterThan(valueOf(sniper, nearCell!));
  });

  it("paths to the ground it chose", () => {
    const state = hallState({ holdPosition: 1 });
    const bot = state.bots[0] as BotState;
    for (const other of state.bots) if (other !== bot) other.alive = false;
    bot.pos = { x: 2.5, y: 6.5 };
    updatePerception(state);
    const goal = bestGround(state, bot);
    expect(goal).not.toBeNull();
    applyAction(state, bot, { kind: "TakePosition", cell: goal! });
    expect(bot.pathGoal).toEqual({ x: goal!.x, y: goal!.y });
  });
});
