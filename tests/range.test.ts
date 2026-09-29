import { describe, expect, it } from "vitest";
import { parseArenaText } from "../src/arena/textArena.js";
import {
  loadBaselineWeapon,
  loadRedeemerWeapon,
  loadTuning,
} from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng, deriveSeed } from "../src/core/rng.js";
import { createSimState, hitChance, type BotState, type SimState } from "../src/sim/index.js";
import { generateWeaponSet } from "../src/weapons/generate.js";
import {
  bandAccuracyOf,
  bandDistanceOf,
  bestBandOf,
  rangeAccuracy,
  rangeGateOf,
  type RangeBands,
  type RangeFalloff,
} from "../src/weapons/range.js";
import { RANGE_BANDS, type Weapon } from "../src/weapons/types.js";

const tuning = loadTuning();
const bands: RangeBands = {
  closeMax: tuning.combat.rangeBandCloseMax,
  midMax: tuning.combat.rangeBandMidMax,
};
const falloff: RangeFalloff = {
  distanceFalloff: tuning.combat.distanceFalloff,
  rangeFloorShare: tuning.combat.rangeFloorShare,
};
/** The furthest two bots can see each other, so the widest fight the curve meets. */
const SIGHT = tuning.perception.sightRadiusCells;

const shotgun = { optimalRange: 4, rangeTolerance: 7 };
const rifle = { optimalRange: 12, rangeTolerance: 10 };
const sniper = { optimalRange: 20, rangeTolerance: 7 };

describe("rangeAccuracy: the curve", () => {
  it("is at its best exactly at the optimal range", () => {
    for (const weapon of [shotgun, rifle, sniper]) {
      expect(rangeAccuracy(weapon, weapon.optimalRange, falloff)).toBe(1);
    }
  });

  it("is symmetric: the same deviation either side costs the same", () => {
    for (const gap of [1, 3, 5]) {
      expect(rangeAccuracy(rifle, rifle.optimalRange - gap, falloff)).toBeCloseTo(
        rangeAccuracy(rifle, rifle.optimalRange + gap, falloff),
        10,
      );
    }
  });

  it("loses exactly `distanceFalloff` at one full tolerance", () => {
    const off = rifle.optimalRange + rifle.rangeTolerance;
    expect(rangeAccuracy(rifle, off, falloff)).toBeCloseTo(1 - falloff.distanceFalloff, 10);
  });

  it("never falls below `rangeFloorShare`", () => {
    for (const distance of [0, 40, 200]) {
      expect(rangeAccuracy(sniper, distance, falloff)).toBeGreaterThanOrEqual(
        falloff.rangeFloorShare,
      );
    }
  });

  it("survives a tolerance of zero instead of dividing by it", () => {
    const broken = { optimalRange: 10, rangeTolerance: 0 };
    expect(Number.isFinite(rangeAccuracy(broken, 20, falloff))).toBe(true);
  });
});

describe("effective range is bounded at both ends", () => {
  it("makes a close-range weapon miss far away", () => {
    expect(rangeAccuracy(shotgun, 4, falloff)).toBeGreaterThan(
      rangeAccuracy(shotgun, 20, falloff),
    );
    expect(rangeAccuracy(shotgun, SIGHT, falloff)).toBe(falloff.rangeFloorShare);
  });

  it("makes a sniper miss in your face, which the old rule had backwards", () => {
    // The old rule was `distance / rangeMax`, so a sniper was at its BEST at
    // point-blank range (Section 7.33).
    expect(rangeAccuracy(sniper, 20, falloff)).toBeGreaterThan(rangeAccuracy(sniper, 2, falloff));
    expect(rangeAccuracy(sniper, 2, falloff)).toBe(falloff.rangeFloorShare);
  });

  it("makes the mid-range weapon the versatile one, without a number saying so", () => {
    // Versatility is not a stat here. It falls out of the geometry: a peak in the
    // middle of the distances an arena produces has the smallest worst deviation.
    const worst = (weapon: { optimalRange: number; rangeTolerance: number }): number => {
      let least = 1;
      for (let d = 1; d <= SIGHT; d += 1) least = Math.min(least, rangeAccuracy(weapon, d, falloff));
      return least;
    };
    expect(worst(rifle)).toBeGreaterThan(worst(shotgun));
    expect(worst(rifle)).toBeGreaterThan(worst(sniper));
    // And the specialists do bottom out, where the mid weapon does not.
    expect(worst(shotgun)).toBe(falloff.rangeFloorShare);
    expect(worst(sniper)).toBe(falloff.rangeFloorShare);
    expect(worst(rifle)).toBeGreaterThan(falloff.rangeFloorShare);
  });
});

describe("bandDistanceOf and bestBandOf", () => {
  it("puts each band's distance inside that band", () => {
    expect(bandDistanceOf("close", bands)).toBeLessThanOrEqual(bands.closeMax);
    const mid = bandDistanceOf("mid", bands);
    expect(mid).toBeGreaterThan(bands.closeMax);
    expect(mid).toBeLessThanOrEqual(bands.midMax);
    expect(bandDistanceOf("long", bands)).toBeGreaterThan(bands.midMax);
  });

  it("keeps the long band inside what a bot can see", () => {
    // A band that stands for a distance no bot can see is the defect of
    // Section 7.30.7 wearing another hat.
    expect(bandDistanceOf("long", bands)).toBeLessThanOrEqual(SIGHT);
  });

  it("names the band each weapon is built for", () => {
    expect(bestBandOf(shotgun, bands, falloff)).toBe("close");
    expect(bestBandOf(rifle, bands, falloff)).toBe("mid");
    expect(bestBandOf(sniper, bands, falloff)).toBe("long");
  });

  it("reads the curve at the three band distances and nowhere else", () => {
    const byBand = bandAccuracyOf(sniper, bands, falloff);
    for (const band of RANGE_BANDS) {
      expect(byBand[band]).toBeCloseTo(
        rangeAccuracy(sniper, bandDistanceOf(band, bands), falloff),
        10,
      );
    }
  });
});

describe("rangeGateOf: the gate comes from the curve", () => {
  it("never reaches past what a bot can see", () => {
    expect(rangeGateOf({ optimalRange: 26, rangeTolerance: 20 }, 1.5, bands, 29.9)).toBe(29.9);
  });

  it("never leaves a weapon unable to reach the close band", () => {
    expect(rangeGateOf({ optimalRange: 1, rangeTolerance: 1 }, 1.5, bands, 29.9)).toBe(
      bands.closeMax,
    );
  });

  it("puts the gate past the optimal range, not on it", () => {
    const gate = rangeGateOf(sniper, 1.5, bands, 100);
    expect(gate).toBeGreaterThan(sniper.optimalRange);
  });
});

describe("a generated weapon means what its name says", () => {
  const many: Weapon[] = [];
  for (let seed = 0; seed < 80; seed += 1) {
    for (const weapon of generateWeaponSet(createRng(deriveSeed(11, `s${seed}`), "weapons"), 5)) {
      if (weapon.role !== null) many.push(weapon);
    }
  }

  const shareBest = (archetype: string, band: string): number => {
    const mine = many.filter((weapon) => weapon.archetype === archetype);
    expect(mine.length).toBeGreaterThan(10);
    return mine.filter((weapon) => bestBandOf(weapon, bands, falloff) === band).length / mine.length;
  };

  it("builds a marksman for the long band", () => {
    expect(shareBest("marksman", "long")).toBeGreaterThan(0.9);
  });

  it("builds an assault weapon for the close band", () => {
    expect(shareBest("assault", "close")).toBeGreaterThan(0.6);
  });

  it("builds a precision weapon for the mid band", () => {
    expect(shareBest("precision", "mid")).toBeGreaterThan(0.6);
  });

  it("never disagrees with its own DPS profile by more than one band", () => {
    // The whole point of Section 7.33: the curve, the profile the budget charges
    // for, and the band the AI picks are one statement, not three.
    //
    // One band of slack, because two other things also move the profile, and
    // both are meant to. `attackTypes[*].bandMultiplier` prices how the TRAVEL of
    // the shot fares — a ricochet is worth most at mid range — and a band the
    // weapon cannot fire in scores 0. So the peak may sit one band either side of
    // where the accuracy peaks. What it may never do is sit two bands away, which
    // is the contradiction this section exists to remove: a profile that said
    // "long" while the simulation paid out "close".
    const order = { close: 0, mid: 1, long: 2 } as const;
    for (const weapon of many) {
      const best = bestBandOf(weapon, bands, falloff);
      const peak = Math.max(...RANGE_BANDS.map((band) => weapon.dpsProfile[band]));
      const peakBand = RANGE_BANDS.find((band) => weapon.dpsProfile[band] === peak) ?? "close";
      expect(Math.abs(order[peakBand] - order[best])).toBeLessThanOrEqual(1);
    }
  });

  it("earns nothing at all in a band it cannot fire in, the burn included", () => {
    let gated = 0;
    for (const weapon of many) {
      for (const band of RANGE_BANDS) {
        if (bandDistanceOf(band, bands) <= weapon.rangeMax) continue;
        gated += 1;
        expect(weapon.dpsProfile[band]).toBe(0);
      }
    }
    expect(gated).toBeGreaterThan(0);
  });
});

describe("a fixed weapon carries the same curve as a generated one", () => {
  for (const [name, weapon] of [
    ["baseline", loadBaselineWeapon()],
    ["redeemer", loadRedeemerWeapon()],
  ] as const) {
    it(`gives the ${name} an optimal range and a tolerance`, () => {
      expect(weapon.optimalRange).toBeGreaterThan(0);
      expect(weapon.rangeTolerance).toBeGreaterThan(0);
    });

    it(`keeps the ${name} DPS profile in step with its own curve`, () => {
      const byBand = bandAccuracyOf(weapon, bands, falloff);
      const bestCurve = bestBandOf(weapon, bands, falloff);
      const peak = Math.max(...RANGE_BANDS.map((band) => weapon.dpsProfile[band]));
      expect(weapon.dpsProfile[bestCurve]).toBeCloseTo(peak, 5);
      // And the ordering of the profile follows the ordering of the curve.
      const sortByCurve = [...RANGE_BANDS].sort((a, b) => byBand[b] - byBand[a]);
      const sortByDps = [...RANGE_BANDS].sort(
        (a, b) => weapon.dpsProfile[b] - weapon.dpsProfile[a],
      );
      expect(sortByDps).toEqual(sortByCurve);
    });
  }

  it("makes the baseline the most forgiving weapon of all, because everyone carries it", () => {
    const baseline = loadBaselineWeapon();
    let least = 1;
    for (let d = 1; d <= SIGHT; d += 1) {
      least = Math.min(least, rangeAccuracy(baseline, d, falloff));
    }
    expect(least).toBeGreaterThan(falloff.rangeFloorShare * 2);
  });
});

describe("the simulation reads the same curve", () => {
  const ROOM = [
    "################################",
    "#SSS...........................#",
    "#..............................#",
    "#SSS...........................#",
    "################################",
  ].join("\n");

  function pair(distance: number, weapon: Partial<Weapon>): [SimState, BotState, BotState] {
    const state = createSimState({
      map: parseArenaText(ROOM, { source: "room" }),
      seed: 3,
      bus: new EventBus(),
    });
    const a = state.bots[0] as BotState;
    const b = state.bots[3] as BotState;
    for (const bot of state.bots) if (bot !== a && bot !== b) bot.alive = false;
    a.weapon = { ...loadBaselineWeapon(), ...weapon };
    a.pos = { x: 2.5, y: 2.5 };
    b.pos = { x: 2.5 + distance, y: 2.5 };
    // A still target, so the dodge does not enter the comparison.
    b.movingTicks = 0;
    return [state, a, b];
  }

  it("gives a sniper a worse chance in your face than at its own range", () => {
    const [near, a1, b1] = pair(3, { ...sniper, rangeMax: 26 });
    const [far, a2, b2] = pair(20, { ...sniper, rangeMax: 26 });
    expect(hitChance(near, a1, b1)).toBeLessThan(hitChance(far, a2, b2));
  });

  it("gives a shotgun a worse chance across the room than in it", () => {
    const [near, a1, b1] = pair(4, { ...shotgun, rangeMax: 26 });
    const [far, a2, b2] = pair(22, { ...shotgun, rangeMax: 26 });
    expect(hitChance(far, a2, b2)).toBeLessThan(hitChance(near, a1, b1));
  });

  it("peaks at the optimal range and falls away on both sides", () => {
    const at = (distance: number): number => {
      const [state, a, b] = pair(distance, { ...rifle, rangeMax: 26 });
      return hitChance(state, a, b);
    };
    const peak = at(rifle.optimalRange);
    expect(at(rifle.optimalRange - 8)).toBeLessThan(peak);
    expect(at(rifle.optimalRange + 8)).toBeLessThan(peak);
  });
});
