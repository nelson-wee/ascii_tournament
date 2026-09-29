import { describe, expect, it } from "vitest";
import { applyAction, positionValue } from "../src/ai/utility.js";
import { updatePerception } from "../src/ai/perception.js";
import { parseArenaText } from "../src/arena/index.js";
import { type ArenaMap } from "../src/arena/types.js";
import { loadBaselineWeapon, loadTuning, loadWeaponRoles } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng } from "../src/core/rng.js";
import type { Cell } from "../src/core/types.js";
import {
  coverAgainst,
  coverFromVisible,
  coverSave,
  coverSaveAt,
  createSimState,
  damageBot,
  type BotState,
  type SimState,
} from "../src/sim/index.js";
import { generateWeaponSet } from "../src/weapons/generate.js";

const WIDTH = 46;
const HEIGHT = 19;

/**
 * A long open hall with low cover exactly where a test asks for it.
 *
 * The map is built and not drawn, because these tests turn on the exact cell of
 * one cover tile and nobody can count 46 characters of a string literal.
 */
function hall(cover: readonly Cell[] = []): ArenaMap {
  const rows: string[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    let row = "";
    for (let x = 0; x < WIDTH; x += 1) {
      if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) row += "#";
      else if (cover.some((at) => at.x === x && at.y === y)) row += ",";
      else if (y === 1 && x <= 3) row += "S";
      else if (y === HEIGHT - 2 && x >= WIDTH - 4) row += "S";
      else row += ".";
    }
    rows.push(row);
  }
  return parseArenaText(rows.join("\n"), { source: "cover-hall" });
}

function hallState(cover: readonly Cell[] = [], seed = 7, bus = new EventBus()): SimState {
  return createSimState({ map: hall(cover), seed, bus });
}

/** Team A bot 0 and team B bot 0, both alive, with the rest taken off the map. */
function pair(state: SimState): [BotState, BotState] {
  const a = state.bots[0] as BotState;
  const b = state.bots[3] as BotState;
  for (const bot of state.bots) if (bot !== a && bot !== b) bot.alive = false;
  a.weapon = loadBaselineWeapon();
  b.weapon = loadBaselineWeapon();
  return [a, b];
}

/** Put a bot on the centre of a cell. */
function place(bot: BotState, at: Cell): void {
  bot.pos = { x: at.x + 0.5, y: at.y + 0.5 };
}

const ROW = 9;

describe("coverAgainst: cover is what lies between", () => {
  const map = hall([{ x: 27, y: ROW }]);
  const { cover } = loadTuning();

  it("shields a bot with the cover tile between it and the shooter", () => {
    // The shooter is west, and the cover tile is the first cell west.
    expect(coverAgainst(map, cover, { x: 28, y: ROW }, { x: 21, y: ROW })).toBeCloseTo(1, 5);
  });

  it("shields nothing from the other side, which is what makes a flank pay", () => {
    // Same bot, same cover tile, shooter east. The tile is now behind it.
    expect(coverAgainst(map, cover, { x: 28, y: ROW }, { x: 35, y: ROW })).toBe(0);
  });

  it("shields nothing from a shooter at a right angle to the cover", () => {
    expect(coverAgainst(map, cover, { x: 28, y: ROW }, { x: 28, y: 1 })).toBe(0);
  });

  it("gives the tile a bot stands on nothing, because that is a firing position", () => {
    expect(coverAgainst(map, cover, { x: 27, y: ROW }, { x: 21, y: ROW })).toBe(0);
  });

  it("is worth less the further along the line it sits", () => {
    // From x = 29 the same tile is the second cell of the line, not the first.
    const near = coverAgainst(map, cover, { x: 28, y: ROW }, { x: 21, y: ROW });
    const far = coverAgainst(map, cover, { x: 29, y: ROW }, { x: 21, y: ROW });
    expect(far).toBeCloseTo(near * cover.stepFalloff, 5);
  });

  it("finds nothing past `depthCells`", () => {
    // At depth 2 a tile 4 cells away is out of reach of the walk.
    expect(coverAgainst(map, cover, { x: 31, y: ROW }, { x: 21, y: ROW })).toBe(0);
  });

  it("stops at a wall, because a wall already stopped the shot", () => {
    const walled = hall();
    // Straight up from the top row of floor: the next cell is the outside wall.
    expect(coverAgainst(walled, cover, { x: 20, y: 1 }, { x: 20, y: -6 })).toBe(0);
  });

  it("gives an open cell nothing at all", () => {
    expect(coverAgainst(hall(), cover, { x: 28, y: ROW }, { x: 21, y: ROW })).toBe(0);
  });
});

describe("coverSaveAt: cover is worth more the further away the shooter is", () => {
  const state = hallState([{ x: 27, y: ROW }]);
  const at: Cell = { x: 28, y: ROW };
  const saveFrom = (x: number): number =>
    coverSaveAt(state, at, { x, y: ROW }, Math.abs(at.x - x));

  it("rises from close to mid to long", () => {
    const close = saveFrom(21); // 7 cells
    const mid = saveFrom(16); // 12 cells
    const long = saveFrom(8); // 20 cells
    expect(close).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(close);
    expect(long).toBeGreaterThan(mid);
  });

  it("matches the band factor of the config", () => {
    const { cover } = state.config;
    expect(saveFrom(21)).toBeCloseTo(cover.bandFactor.close, 5);
    expect(saveFrom(8)).toBeCloseTo(cover.bandFactor.long, 5);
  });

  it("never passes the band factor, however much cover is stacked up", () => {
    // Two cover tiles in a row. The shield saturates at one full screen, so the
    // band factor is the ceiling and no amount of cover passes it.
    const stacked = hallState([
      { x: 27, y: ROW },
      { x: 26, y: ROW },
    ]);
    const save = coverSaveAt(stacked, at, { x: 8, y: ROW }, 20);
    expect(save).toBeCloseTo(stacked.config.cover.bandFactor.long, 5);
  });

  it("is zero on open ground, whatever the range", () => {
    const open = hallState();
    expect(coverSaveAt(open, at, { x: 8, y: ROW }, 20)).toBe(0);
  });
});

describe("damageBot: cover stops a share of the shots", () => {
  const shot = { weaponId: "w", weaponArchetype: "marksman", attackType: "hitscan" as const };

  /** Fire `count` shots that cannot kill, and count the ones that landed. */
  function landed(state: SimState, a: BotState, b: BotState, count: number): number {
    let hits = 0;
    for (let i = 0; i < count; i += 1) {
      b.health = state.config.healthMax;
      if (damageBot(state, a, b, 1, { ...shot, source: "shot" })) hits += 1;
    }
    return hits;
  }

  it("lets every shot through on open ground", () => {
    const state = hallState();
    const [a, b] = pair(state);
    place(a, { x: 8, y: ROW });
    place(b, { x: 28, y: ROW });
    expect(landed(state, a, b, 200)).toBe(200);
  });

  it("stops the long-band share of them, through cover", () => {
    const state = hallState([{ x: 27, y: ROW }]);
    const [a, b] = pair(state);
    place(a, { x: 8, y: ROW });
    place(b, { x: 28, y: ROW });
    const save = coverSave(state, a, b);
    expect(save).toBeCloseTo(state.config.cover.bandFactor.long, 5);
    const hits = landed(state, a, b, 400);
    // 400 rolls at p = 1 - save. Three standard errors is about 7 %.
    expect(hits / 400).toBeGreaterThan(1 - save - 0.08);
    expect(hits / 400).toBeLessThan(1 - save + 0.08);
  });

  it("stops fewer at close range than at long range, through the same tile", () => {
    const state = hallState([{ x: 27, y: ROW }]);
    const [a, b] = pair(state);
    place(b, { x: 28, y: ROW });

    place(a, { x: 21, y: ROW });
    const nearHits = landed(state, a, b, 400);
    place(a, { x: 8, y: ROW });
    const farHits = landed(state, a, b, 400);
    expect(nearHits).toBeGreaterThan(farHits);
  });

  it("says so with a CoverSave event, and names the band", () => {
    const bus = new EventBus();
    const state = hallState([{ x: 27, y: ROW }], 7, bus);
    const [a, b] = pair(state);
    place(a, { x: 8, y: ROW });
    place(b, { x: 28, y: ROW });
    landed(state, a, b, 200);
    const saves = bus.filter("CoverSave");
    expect(saves.length).toBeGreaterThan(0);
    expect(saves[0]?.data["rangeBand"]).toBe("long");
    expect(saves[0]?.data["targetId"]).toBe(b.id);
  });

  it("does not shield a hazard tile or a burn, which are already on the bot", () => {
    const state = hallState([{ x: 27, y: ROW }]);
    const [a, b] = pair(state);
    place(a, { x: 8, y: ROW });
    place(b, { x: 28, y: ROW });
    for (const source of ["hazard", "dot"] as const) {
      let hits = 0;
      for (let i = 0; i < 100; i += 1) {
        b.health = state.config.healthMax;
        if (damageBot(state, a, b, 1, { ...shot, source })) hits += 1;
      }
      expect(hits).toBe(100);
    }
  });
});

describe("coverFromVisible: the enemy you are open to is the one that matters", () => {
  it("is zero with no enemy in sight, because cover against nobody is not cover", () => {
    const state = hallState([{ x: 27, y: ROW }]);
    const [, b] = pair(state);
    b.visibleEnemyIds = [];
    expect(coverFromVisible(state, b, { x: 28, y: ROW })).toBe(0);
  });

  it("takes the worst of the enemies in sight, not the mean", () => {
    const state = hallState([{ x: 27, y: ROW }]);
    const b = state.bots[3] as BotState;
    const west = state.bots[0] as BotState;
    const east = state.bots[1] as BotState;
    place(b, { x: 28, y: ROW });
    place(west, { x: 8, y: ROW }); // shielded by the cover tile
    place(east, { x: 38, y: ROW }); // no cover on that side
    b.visibleEnemyIds = [west.id, east.id];
    expect(coverFromVisible(state, b, { x: 28, y: ROW })).toBe(0);

    b.visibleEnemyIds = [west.id];
    expect(coverFromVisible(state, b, { x: 28, y: ROW })).toBeGreaterThan(0);
  });
});

describe("the AI plays around cover", () => {
  it("values a shielded cell above an open one, all else equal", () => {
    const state = hallState([{ x: 27, y: ROW }]);
    const [a, b] = pair(state);
    place(a, { x: 8, y: ROW });
    place(b, { x: 28, y: ROW });
    b.visibleEnemyIds = [a.id];
    b.lastSeen.set(a.id, { tick: state.tick, cell: { x: 8, y: ROW } });

    // `positionValue` is the function the cover term moves. `decide` answers
    // Engage while an enemy is in sight, and that score says nothing about the
    // ground the bot stands on.
    const shielded = positionValue(state, b, { x: 28, y: ROW });
    const open = positionValue(state, b, { x: 34, y: ROW });
    expect(shielded).toBeGreaterThan(open);
  });

  it("walks off the line to take the cover of its target away", () => {
    // The target sits behind cover on the straight line between the two bots.
    // Standing still keeps the shot blocked, so the bot should path to a cell
    // that is off that line.
    const state = hallState([{ x: 39, y: ROW }]);
    const [a, b] = pair(state);
    place(a, { x: 6, y: ROW });
    place(b, { x: 40, y: ROW });
    a.targetId = b.id;
    updatePerception(state);

    applyAction(state, a, { kind: "Engage", targetId: b.id });
    const goal = a.pathGoal;
    expect(goal).not.toBeNull();
    // Off the row the cover tile sits on: the bot went around it.
    expect(goal?.y).not.toBe(ROW);
  });

  it("stays on the line when the target has no cover to take", () => {
    const state = hallState();
    const [a, b] = pair(state);
    place(a, { x: 6, y: ROW });
    place(b, { x: 40, y: ROW });
    a.targetId = b.id;
    updatePerception(state);

    applyAction(state, a, { kind: "Engage", targetId: b.id });
    // With nothing to gain, `flankTurnCost` keeps the bot on the bearing it has.
    expect(a.pathGoal?.y).toBe(ROW);
  });
});

describe("a weapon cannot reach past what a bot can see", () => {
  it("clamps every generated rangeMax to the sight radius plus the headroom", () => {
    const tuning = loadTuning();
    const tables = loadWeaponRoles();
    const cap = tuning.perception.sightRadiusCells * tables.budget.rangeHeadroomShare;
    let generated = 0;
    for (let seed = 0; seed < 120; seed += 1) {
      for (const weapon of generateWeaponSet(createRng(seed, "weapons"), 5)) {
        // The baseline weapon is fixed data, not a generated draft.
        if (weapon.role === null) continue;
        generated += 1;
        expect(weapon.rangeMax).toBeLessThanOrEqual(cap + 0.05);
      }
    }
    expect(generated).toBeGreaterThan(200);
  });

  it("prices reach up to the sight radius, so the cap is not paying for nothing", () => {
    const tuning = loadTuning();
    const tables = loadWeaponRoles();
    expect(tables.budget.rangeValueCapCells).toBe(tuning.perception.sightRadiusCells);
  });
});
