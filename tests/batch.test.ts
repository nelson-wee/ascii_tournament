import { emptyTempo } from "../src/report/tempo.js";
import { describe, expect, it } from "vitest";
import { loadTestArena, parseArenaText } from "../src/arena/index.js";
import { loadDefaultTactics } from "../src/core/data.js";
import { BatchConfigSchema } from "../src/core/schemas.js";
import { parseData, DataValidationError } from "../src/core/data.js";
import type { Tactics } from "../src/core/schemas.js";
import {
  planRounds,
  runBatch,
  runPlannedRound,
  type BatchArena,
} from "../src/report/batchRunner.js";
import { simConfigFromTuning } from "../src/sim/index.js";
import {
  archetypeBandShareOf,
  archetypesOf,
  bandShareOf,
  standardError,
  summarize,
  winRate,
  type RoundRecord,
} from "../src/report/batchStats.js";
import {
  formatReport,
  matchupsCsv,
  presetsCsv,
  roundsCsv,
} from "../src/report/batchTables.js";

const SMALL = ["############", "#SSS....SSS#", "#..W..A..H.#", "############"].join("\n");

function arenas(): BatchArena[] {
  return [{ name: "test-arena", map: loadTestArena() }];
}

function smallArena(): BatchArena {
  return { name: "small", map: parseArenaText(SMALL, { source: "small" }) };
}

function presets(): Record<string, Tactics> {
  const base = loadDefaultTactics();
  return {
    bold: { ...base, aggression: 0.9 },
    shy: { ...base, aggression: 0.1 },
  };
}

function record(over: Partial<RoundRecord> = {}): RoundRecord {
  return {
    seed: 1,
    arena: "a",
    teamA: "bold",
    teamB: "shy",
    compA: "standard",
    compB: "standard",
    winner: "A",
    reason: "scoreLimit",
    ticks: 1000,
    scoreA: 15,
    scoreB: 10,
    shots: 100,
    hits: 40,
    unawareKills: 5,
    killsByArchetype: { baseline: 25 },
    shotsByWeapon: { "baseline-rifle": 100 },
    killsByBand: { close: 10, mid: 10, long: 5 },
    shotsByBand: { close: 50, mid: 35, long: 15 },
    hitsByBand: { close: 25, mid: 12, long: 3 },
    damageByBand: { close: 500, mid: 240, long: 60 },
    shotsByArchetypeBand: {
      "marksman|close": 5,
      "marksman|mid": 15,
      "marksman|long": 30,
      "splash|close": 45,
      "splash|mid": 20,
      "splash|long": 5,
    },
    damageByArchetype: { marksman: 300, splash: 500 },
    killDistanceSum: 200,
    killsByRole: { tank: 8, overwatch: 9, skirmisher: 8 },
    deathsByRole: { tank: 8, overwatch: 9, skirmisher: 8 },
    shotsByRole: { tank: 40, overwatch: 20, skirmisher: 40 },
    hitsByRole: { tank: 18, overwatch: 8, skirmisher: 14 },
    damageByRole: { tank: 300, overwatch: 260, skirmisher: 240 },
    pickupsByKind: { weapon: 12, health: 6, armor: 4, powerup: 2, ammo: 8 },
    weaponArchetypes: ["assault", "baseline", "marksman", "precision"],
    tempo: emptyTempo(),
    ...over,
  };
}

describe("planRounds", () => {
  it("covers every arena and every pair of presets", () => {
    const planned = planRounds({ arenas: arenas(), presets: presets(), rounds: 4, seed: 1 });
    expect(planned).toHaveLength(4);
    const cells = planned.map((round) => `${round.teamA}|${round.teamB}`);
    expect(new Set(cells).size).toBe(4);
    expect(cells).toContain("bold|bold");
    expect(cells).toContain("bold|shy");
    expect(cells).toContain("shy|bold");
    expect(cells).toContain("shy|shy");
  });

  it("spreads the rounds evenly over the cells", () => {
    const planned = planRounds({ arenas: arenas(), presets: presets(), rounds: 40, seed: 1 });
    const counts = new Map<string, number>();
    for (const round of planned) {
      const key = `${round.teamA}|${round.teamB}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([10, 10, 10, 10]);
  });

  it("gives every round its own seed", () => {
    const planned = planRounds({ arenas: arenas(), presets: presets(), rounds: 40, seed: 1 });
    expect(new Set(planned.map((round) => round.seed)).size).toBe(40);
  });

  it("is deterministic", () => {
    const options = { arenas: arenas(), presets: presets(), rounds: 12, seed: 5 };
    expect(planRounds(options).map((round) => round.seed)).toEqual(
      planRounds(options).map((round) => round.seed),
    );
  });

  it("changes with the batch seed", () => {
    const a = planRounds({ arenas: arenas(), presets: presets(), rounds: 8, seed: 1 });
    const b = planRounds({ arenas: arenas(), presets: presets(), rounds: 8, seed: 2 });
    expect(a.map((round) => round.seed)).not.toEqual(b.map((round) => round.seed));
  });

  it("gives nothing with no arena", () => {
    expect(planRounds({ arenas: [], presets: presets(), rounds: 10, seed: 1 })).toHaveLength(0);
  });
});

describe("runPlannedRound", () => {
  it("makes a full record", () => {
    const [round] = planRounds({ arenas: arenas(), presets: presets(), rounds: 1, seed: 3 });
    const result = runPlannedRound(round!, presets());
    expect(result.arena).toBe("test-arena");
    expect(result.ticks).toBeGreaterThan(0);
    expect(result.shots).toBeGreaterThan(0);
    expect(result.hits).toBeGreaterThan(0);
    expect(result.scoreA + result.scoreB).toBeGreaterThan(0);
    const killTotal = Object.values(result.killsByArchetype).reduce((sum, n) => sum + n, 0);
    expect(killTotal).toBe(result.scoreA + result.scoreB);
    // M6 gives every round a generated weapon set, so more than one weapon fires.
    expect(Object.keys(result.shotsByWeapon).length).toBeGreaterThan(0);
    expect(["A", "B", null]).toContain(result.winner);
  });

  it("gives the same record every time", () => {
    const [round] = planRounds({ arenas: arenas(), presets: presets(), rounds: 1, seed: 3 });
    expect(runPlannedRound(round!, presets())).toEqual(runPlannedRound(round!, presets()));
  });

  it("does not depend on the order of the rounds", () => {
    const planned = planRounds({ arenas: arenas(), presets: presets(), rounds: 4, seed: 9 });
    const forward = planned.map((round) => runPlannedRound(round, presets()));
    const backward = [...planned].reverse().map((round) => runPlannedRound(round, presets()));
    expect(backward.reverse()).toEqual(forward);
  });

  it("throws for an unknown preset", () => {
    const [round] = planRounds({ arenas: arenas(), presets: presets(), rounds: 1, seed: 3 });
    expect(() => runPlannedRound({ ...round!, teamA: "missing" }, presets())).toThrow(/preset/);
  });
});

describe("shots and hits by role (Section 7.39)", () => {
  const compositions = {
    // Two roles only, and three seats, so every counter has a home and the
    // totals are easy to hold to account.
    mixed: ["overwatch", "tank", "tank"],
  } as const;

  function oneRound(): ReturnType<typeof runPlannedRound> {
    const [round] = planRounds({
      arenas: arenas(),
      presets: presets(),
      compositions,
      rounds: 1,
      seed: 4,
    });
    // The compositions must reach the runner too, or it falls back to the
    // default one and the roles in the record are not the roles that played.
    return runPlannedRound(round!, presets(), simConfigFromTuning(), compositions);
  }

  it("counts every shot fired against some role", () => {
    const result = oneRound();
    const shotTotal = Object.values(result.shotsByRole).reduce((sum, n) => sum + n, 0);
    expect(shotTotal).toBe(result.shots);
    expect(result.shots).toBeGreaterThan(0);
  });

  it("counts only the damage a shot delivered, never a burn or a hazard tick", () => {
    // `hits` counts every damage event of the round, burns and hazard tiles
    // included. `hitsByRole` counts the ones a shot delivered, so it is a share
    // of `hits` and never the whole of it (Section 7.39.2). Without this the
    // ratio would call a weapon with a long burn accurate.
    const result = oneRound();
    const hitTotal = Object.values(result.hitsByRole).reduce((sum, n) => sum + n, 0);
    expect(hitTotal).toBeGreaterThan(0);
    expect(hitTotal).toBeLessThanOrEqual(result.hits);
  });

  it("names only the roles the composition fielded", () => {
    const result = oneRound();
    for (const role of Object.keys(result.shotsByRole)) {
      expect(["overwatch", "tank"]).toContain(role);
    }
    for (const role of Object.keys(result.hitsByRole)) {
      expect(["overwatch", "tank"]).toContain(role);
    }
  });

  it("gives every fielded role some shots, so nothing is silently dropped", () => {
    const result = oneRound();
    expect(result.shotsByRole["overwatch"] ?? 0).toBeGreaterThan(0);
    expect(result.shotsByRole["tank"] ?? 0).toBeGreaterThan(0);
  });

  it("answers the two questions Section 7.38.4 could not", () => {
    const result = oneRound();
    // Shots a seat: does the role shoot less? Two Tank seats a team against one
    // Overwatch seat, and both teams field the same composition.
    const overwatchShots = (result.shotsByRole["overwatch"] ?? 0) / 2;
    const tankShots = (result.shotsByRole["tank"] ?? 0) / 4;
    expect(overwatchShots).toBeGreaterThan(0);
    expect(tankShots).toBeGreaterThan(0);
    // Hits over shots: does it miss more? Both are real ratios, not placeholders.
    const landed = (role: string): number =>
      (result.hitsByRole[role] ?? 0) / Math.max(1, result.shotsByRole[role] ?? 0);
    expect(landed("overwatch")).toBeGreaterThan(0);
    expect(landed("tank")).toBeGreaterThan(0);
  });

  it("records the damage a role dealt, which kills do not", () => {
    const result = oneRound();
    const total = Object.values(result.damageByRole).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(0);
    for (const role of ["overwatch", "tank"]) {
      expect(result.damageByRole[role] ?? 0).toBeGreaterThan(0);
    }
  });

  it("carries all three into the rounds CSV", () => {
    const csv = roundsCsv([record()]);
    const header = csv.split("\n")[0] ?? "";
    for (const column of [
      "shots_role_tank",
      "shots_role_overwatch",
      "hits_role_tank",
      "hits_role_overwatch",
      "damage_role_tank",
      "damage_role_overwatch",
    ]) {
      expect(header).toContain(column);
    }
    const row = csv.split("\n")[1] ?? "";
    expect(row.split(",")).toContain("40");
    expect(row.split(",")).toContain("18");
  });
});

describe("shots, hits and damage by band (Section 7.46)", () => {
  const compositions = { mixed: ["overwatch", "tank", "tank"] } as const;

  function oneRound(): ReturnType<typeof runPlannedRound> {
    const [round] = planRounds({
      arenas: arenas(),
      presets: presets(),
      compositions,
      rounds: 1,
      seed: 4,
    });
    return runPlannedRound(round!, presets(), simConfigFromTuning(), compositions);
  }

  it("names only the three real bands, never an unknown one", () => {
    const result = oneRound();
    for (const counts of [result.shotsByBand, result.hitsByBand, result.damageByBand]) {
      for (const band of Object.keys(counts)) {
        expect(["close", "mid", "long"]).toContain(band);
      }
    }
  });

  it("counts shots in a band for every shot but an intercept", () => {
    // Every `Shot` event carries its band, so the two totals agree except for
    // the shots aimed at a projectile, which damage no bot and so belong to no
    // band the DPS profile is paid for.
    const result = oneRound();
    const total = Object.values(result.shotsByBand).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(result.shots);
  });

  it("leaves a burn and a hazard tick out of the band damage", () => {
    // `damageByRole` counts every source; `damageByBand` cannot, because a
    // burn has no range. So the band total is a share of the role total and
    // never the whole of it.
    const result = oneRound();
    const byBand = Object.values(result.damageByBand).reduce((sum, n) => sum + n, 0);
    const byRole = Object.values(result.damageByRole).reduce((sum, n) => sum + n, 0);
    expect(byBand).toBeGreaterThan(0);
    expect(byBand).toBeLessThanOrEqual(byRole + 1e-9);
  });

  it("agrees with the hits a shot delivered, which is the same set", () => {
    // `hitsByBand` and `hitsByRole` both count the `shot` and `area` sources,
    // so the two totals are the same number read two ways. If they part, one of
    // them is counting something its name does not say.
    const result = oneRound();
    const byBand = Object.values(result.hitsByBand).reduce((sum, n) => sum + n, 0);
    const byRole = Object.values(result.hitsByRole).reduce((sum, n) => sum + n, 0);
    expect(byBand).toBe(byRole);
  });

  it("fires more often than it finishes, in every band it fought in", () => {
    // The point of the measure: a kill is one blow out of the several a band
    // took, so kills are a coarse read of where a round fought.
    const result = oneRound();
    const shots = Object.values(result.shotsByBand).reduce((sum, n) => sum + n, 0);
    const kills = Object.values(result.killsByBand).reduce((sum, n) => sum + n, 0);
    expect(shots).toBeGreaterThan(kills);
  });
});

describe("bands and damage by archetype (Section 7.46.4)", () => {
  const compositions = { mixed: ["overwatch", "tank", "tank"] } as const;

  function oneRound(): ReturnType<typeof runPlannedRound> {
    const [round] = planRounds({
      arenas: arenas(),
      presets: presets(),
      compositions,
      rounds: 1,
      seed: 4,
    });
    return runPlannedRound(round!, presets(), simConfigFromTuning(), compositions);
  }

  it("splits every shot by archetype as well as band", () => {
    // The two counts are the same shots read two ways, so they must agree. If
    // they part, one of them is dropping a shot silently.
    const result = oneRound();
    const flat = Object.values(result.shotsByBand).reduce((sum, n) => sum + n, 0);
    const split = Object.values(result.shotsByArchetypeBand).reduce((sum, n) => sum + n, 0);
    expect(split).toBe(flat);
    expect(split).toBeGreaterThan(0);
  });

  it("keys the split `archetype|band`, with a real band every time", () => {
    const result = oneRound();
    for (const key of Object.keys(result.shotsByArchetypeBand)) {
      const [archetype, band] = key.split("|");
      expect(archetype).toBeTruthy();
      expect(["close", "mid", "long"]).toContain(band);
    }
  });

  it("gives damage by archetype, which only `Kill` could answer before", () => {
    const result = oneRound();
    const total = Object.values(result.damageByArchetype).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(0);
    // Every source counts, so this is the role total read by weapon instead.
    const byRole = Object.values(result.damageByRole).reduce((sum, n) => sum + n, 0);
    expect(total).toBeCloseTo(byRole, 6);
  });

  it("deals damage only with an archetype that fired, or a hazard tile", () => {
    // A hazard tile keeps burning after its owner swapped the weapon, and the
    // baseline is in every hand at the spawn, so damage can name an archetype
    // that fired no shot THIS round. Nothing else may appear.
    const result = oneRound();
    const fired = new Set(
      Object.keys(result.shotsByArchetypeBand).map((key) => key.split("|")[0] ?? ""),
    );
    for (const archetype of Object.keys(result.damageByArchetype)) {
      expect(fired.has(archetype) || archetype === "denial" || archetype === "baseline").toBe(true);
    }
    expect(fired.size).toBeGreaterThan(1);
  });
});

describe("archetypeBandShareOf", () => {
  it("reads one archetype out of the table, normalised", () => {
    const summary = summarize([record()]);
    const marksman = archetypeBandShareOf(summary.shotsByArchetypeBand, "marksman");
    expect(marksman.shots).toBe(50);
    expect(marksman.close).toBeCloseTo(0.1, 10);
    expect(marksman.long).toBeCloseTo(0.6, 10);
  });

  it("shows the specialist gap that one global share cannot hold", () => {
    // This is the whole finding of Section 7.46.4 in one assertion: two
    // archetypes in the same round fire in different bands, so a single
    // `value.bandShare` must misprice at least one of them.
    const summary = summarize([record()]);
    const marksman = archetypeBandShareOf(summary.shotsByArchetypeBand, "marksman");
    const splash = archetypeBandShareOf(summary.shotsByArchetypeBand, "splash");
    expect(splash.close).toBeGreaterThan(marksman.close * 3);
    expect(marksman.long).toBeGreaterThan(splash.long * 3);
  });

  it("reads zero shots for an archetype that never fired", () => {
    const summary = summarize([record()]);
    expect(archetypeBandShareOf(summary.shotsByArchetypeBand, "denial").shots).toBe(0);
  });

  it("lists every archetype in the table and nothing else", () => {
    const summary = summarize([record()]);
    expect(archetypesOf(summary.shotsByArchetypeBand)).toEqual(["marksman", "splash"]);
  });
});

describe("bandShareOf", () => {
  it("normalises the three bands to one", () => {
    const share = bandShareOf(new Map([["close", 3], ["mid", 1]]));
    expect(share.close).toBeCloseTo(0.75, 10);
    expect(share.mid).toBeCloseTo(0.25, 10);
    expect(share.long).toBe(0);
  });

  it("drops an unknown band instead of folding it into a real one", () => {
    // A band named anything else is a defect upstream. Adding it to `close`
    // would hide the defect and move the number the budget reads.
    const share = bandShareOf(new Map([["close", 1], ["mid", 1], ["nonsense", 98]]));
    expect(share.close).toBeCloseTo(0.5, 10);
    expect(share.mid).toBeCloseTo(0.5, 10);
  });

  it("reads zero for an empty measure rather than dividing by nothing", () => {
    const share = bandShareOf(new Map());
    expect(share).toEqual({ close: 0, mid: 0, long: 0 });
  });
});

describe("runBatch", () => {
  it("runs every planned round and reports progress", () => {
    const seen: number[] = [];
    const records = runBatch({
      arenas: [smallArena()],
      presets: presets(),
      rounds: 4,
      seed: 2,
      onProgress: (done) => seen.push(done),
    });
    expect(records).toHaveLength(4);
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe("summarize", () => {
  it("counts a win, a loss, and a draw for both teams", () => {
    const summary = summarize([
      record({ winner: "A" }),
      record({ winner: "B" }),
      record({ winner: null }),
    ]);
    expect(summary.rounds).toBe(3);
    expect(summary.byPreset.get("bold")).toEqual({ rounds: 3, wins: 1, losses: 1, draws: 1 });
    expect(summary.byPreset.get("shy")).toEqual({ rounds: 3, wins: 1, losses: 1, draws: 1 });
  });

  it("counts a draw as half a win", () => {
    expect(winRate({ rounds: 4, wins: 1, losses: 1, draws: 2 })).toBeCloseTo(0.5, 10);
    expect(winRate({ rounds: 0, wins: 0, losses: 0, draws: 0 })).toBe(0);
  });

  it("gives the standard error of a win rate", () => {
    // Section 7.2.1: 100 rounds at 50 % give a standard error of 5 %.
    expect(standardError({ rounds: 100, wins: 50, losses: 50, draws: 0 })).toBeCloseTo(0.05, 3);
    expect(standardError({ rounds: 400, wins: 200, losses: 200, draws: 0 })).toBeCloseTo(0.025, 3);
  });

  it("adds up the kills by archetype and the shots by weapon", () => {
    const summary = summarize([
      record({ killsByArchetype: { baseline: 10, precision: 2 }, shotsByWeapon: { rifle: 50 } }),
      record({ killsByArchetype: { baseline: 5 }, shotsByWeapon: { rifle: 20, cannon: 5 } }),
    ]);
    expect(summary.killsByArchetype.get("baseline")).toBe(15);
    expect(summary.killsByArchetype.get("precision")).toBe(2);
    expect(summary.shotsByWeapon.get("rifle")).toBe(70);
    expect(summary.shotsByWeapon.get("cannon")).toBe(5);
  });

  it("gives the mean ticks, kills, shots, and the hit rate", () => {
    const summary = summarize([
      record({ ticks: 1000, scoreA: 15, scoreB: 5, shots: 100, hits: 40 }),
      record({ ticks: 2000, scoreA: 10, scoreB: 10, shots: 200, hits: 60 }),
    ]);
    expect(summary.meanTicks).toBe(1500);
    expect(summary.meanKills).toBe(20);
    expect(summary.meanShots).toBe(150);
    expect(summary.hitsPerShot).toBeCloseTo(100 / 300, 10);
  });

  it("counts the rounds per end reason", () => {
    const summary = summarize([
      record({ reason: "scoreLimit" }),
      record({ reason: "timeLimit" }),
      record({ reason: "timeLimit" }),
    ]);
    expect(summary.byReason.get("timeLimit")).toBe(2);
    expect(summary.byReason.get("scoreLimit")).toBe(1);
  });

  it("marks a round with very few kills", () => {
    // Section 7.2.1: a round with almost no kill is a defect.
    const summary = summarize(
      [record({ scoreA: 1, scoreB: 0 }), record({ scoreA: 15, scoreB: 9 })],
      { scoreLimit: 15, lowKillShare: 0.5 },
    );
    expect(summary.lowKillRounds).toBe(1);
  });

  it("reports a preset that wins on every arena", () => {
    // Section 7.16: one doctrine that wins everywhere is a balance failure.
    const rounds: RoundRecord[] = [];
    for (const arena of ["a", "b"]) {
      for (let i = 0; i < 10; i += 1) {
        rounds.push(record({ arena, teamA: "strong", teamB: "weak", winner: "A" }));
      }
    }
    const summary = summarize(rounds, { balanceFailureRate: 0.6 });
    expect(summary.balanceFailures).toHaveLength(1);
    expect(summary.balanceFailures[0]).toContain("strong");
  });

  it("reports no failure when the presets are even", () => {
    const rounds = [
      record({ teamA: "x", teamB: "y", winner: "A" }),
      record({ teamA: "x", teamB: "y", winner: "B" }),
    ];
    expect(summarize(rounds).balanceFailures).toHaveLength(0);
  });

  it("names the reports that need a later milestone", () => {
    const summary = summarize([record()]);
    expect(summary.missingReports.join(" ")).toMatch(/M10/);
    expect(summary.missingReports.join(" ")).toMatch(/M11/);
  });

  it("adds the four band measures over the batch (Section 7.46)", () => {
    // `killsByBand` sat in the round record from M5 and reached no total, so
    // the geometric prior in `value.bandShare` had nothing to answer to. This
    // is the aggregation that was missing.
    const summary = summarize([record(), record()]);
    expect(summary.byBand.shots.get("close")).toBe(100);
    expect(summary.byBand.shots.get("long")).toBe(30);
    expect(summary.byBand.hits.get("mid")).toBe(24);
    expect(summary.byBand.damage.get("close")).toBeCloseTo(1000, 6);
    expect(summary.byBand.kills.get("long")).toBe(10);
  });

  it("turns the band totals into the share the power budget reads", () => {
    const summary = summarize([record()]);
    const share = bandShareOf(summary.byBand.shots);
    expect(share.close).toBeCloseTo(0.5, 10);
    expect(share.mid).toBeCloseTo(0.35, 10);
    expect(share.long).toBeCloseTo(0.15, 10);
  });

  it("handles an empty batch", () => {
    const summary = summarize([]);
    expect(summary.rounds).toBe(0);
    expect(summary.meanTicks).toBe(0);
    expect(summary.hitsPerShot).toBe(0);
    expect(bandShareOf(summary.byBand.shots)).toEqual({ close: 0, mid: 0, long: 0 });
  });
});

describe("the report tables", () => {
  const summary = summarize([
    record({ teamA: "bold", teamB: "shy", winner: "A" }),
    record({ teamA: "shy", teamB: "bold", winner: "A" }),
  ]);

  it("holds every table of Section 7.16", () => {
    const text = formatReport(summary);
    for (const heading of [
      "WIN RATE",
      "MATCHUPS",
      "ROUND END",
      "KILLS BY WEAPON ARCHETYPE",
      "RANGE BANDS",
      "WEAPON USE",
      "NOT MEASURED YET",
    ]) {
      expect(text, `the report has no ${heading}`).toContain(heading);
    }
  });

  it("shows the standard error beside every win rate", () => {
    expect(formatReport(summary)).toMatch(/\d+\.\d % ±\d+\.\d/);
  });

  it("says when no balance failure was found", () => {
    expect(formatReport(summary)).toContain("no failure found");
  });

  it("prints all four band measures, not kills alone (Section 7.46)", () => {
    const text = formatReport(summary);
    const band = text.slice(text.indexOf("RANGE BANDS"));
    for (const row of ["shots", "hits", "damage", "kills"]) {
      expect(band, `the band table has no ${row} row`).toContain(row);
    }
    // The shots row is the one `value.bandShare` answers to, so it must read
    // the share and not the count.
    expect(band).toContain("50.0 %");
  });
});

describe("the CSV files", () => {
  const records = [
    record({ seed: 1, winner: "A" }),
    record({ seed: 2, winner: null, killsByArchetype: { precision: 3 } }),
  ];

  it("writes one row per round, plus the header", () => {
    const lines = roundsCsv(records).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("seed,arena,teamA,teamB,compA,compB,winner,reason,ticks");
    expect(lines[0]).toContain("unawareKills");
    expect(lines[0]).toContain("kills_baseline");
    expect(lines[0]).toContain("kills_precision");
    expect(lines[2]).toContain("draw");
  });

  it("carries the nine band columns (Section 7.46)", () => {
    const lines = roundsCsv(records).trim().split("\n");
    const header = lines[0]!.split(",");
    for (const column of [
      "shotsClose", "shotsMid", "shotsLong",
      "hitsClose", "hitsMid", "hitsLong",
      "damageClose", "damageMid", "damageLong",
    ]) {
      expect(header, `the CSV has no ${column}`).toContain(column);
    }
    const row = lines[1]!.split(",");
    expect(row[header.indexOf("shotsClose")]).toBe("50");
    expect(row[header.indexOf("damageLong")]).toBe("60.0");
  });

  it("gives a zero for an archetype that a round did not use", () => {
    const lines = roundsCsv(records).trim().split("\n");
    const header = lines[0]!.split(",");
    const baseline = header.indexOf("kills_baseline");
    expect(lines[2]!.split(",")[baseline]).toBe("0");
  });

  it("writes the matchups and the presets", () => {
    const summary = summarize(records);
    expect(matchupsCsv(summary).split("\n")[0]).toBe(
      "arena,teamA,teamB,rounds,wins,losses,draws,winRate,standardError",
    );
    expect(presetsCsv(summary)).toContain("(all)");
  });

  it("puts quotes around a value that holds a comma", () => {
    const lines = roundsCsv([record({ arena: "a,b" })]).trim().split("\n");
    expect(lines[1]).toContain('"a,b"');
  });
});

describe("the batch configuration", () => {
  const good = {
    rounds: 10,
    seed: 1,
    arenas: ["data/arenas/test-arena.txt"],
    presets: { balanced: loadDefaultTactics() },
    outDir: "out",
  };

  it("accepts a good file", () => {
    expect(parseData("test", BatchConfigSchema, good).rounds).toBe(10);
  });

  it("rejects a file with no arena", () => {
    expect(() => parseData("test", BatchConfigSchema, { ...good, arenas: [] })).toThrow(
      DataValidationError,
    );
  });

  it("rejects a round count of zero", () => {
    expect(() => parseData("test", BatchConfigSchema, { ...good, rounds: 0 })).toThrow(
      DataValidationError,
    );
  });

  it("rejects a preset with a bad field", () => {
    const presetsValue = { bad: { ...loadDefaultTactics(), aggression: 5 } };
    expect(() => parseData("test", BatchConfigSchema, { ...good, presets: presetsValue })).toThrow(
      DataValidationError,
    );
  });
});

describe("role compositions", () => {
  const compositions = {
    rush: ["skirmisher", "skirmisher", "tank"],
    turtle: ["overwatch", "overwatch", "tank"],
  } as const;

  it("crosses every pair of compositions with every pair of presets", () => {
    const planned = planRounds({
      arenas: arenas(),
      presets: presets(),
      compositions,
      rounds: 16,
      seed: 1,
    });
    const cells = planned.map(
      (round) => `${round.teamA}|${round.teamB}|${round.compA}|${round.compB}`,
    );
    expect(new Set(cells).size).toBe(16);
  });

  it("names the standard composition when the batch gives none", () => {
    const [round] = planRounds({ arenas: arenas(), presets: presets(), rounds: 1, seed: 1 });
    expect(round!.compA).toBe("standard");
    expect(round!.compB).toBe("standard");
  });

  it("gives the bots the roles of their composition", () => {
    const [round] = planRounds({
      arenas: arenas(),
      presets: presets(),
      compositions,
      rounds: 1,
      seed: 1,
    });
    const record = runPlannedRound(round!, presets(), undefined, compositions);
    expect(record.compA).toBe(round!.compA);
    expect(record.compB).toBe(round!.compB);
  });

  it("gives a different result for a different composition", () => {
    // The acceptance test of M8.
    const [round] = planRounds({
      arenas: arenas(),
      presets: presets(),
      compositions,
      rounds: 1,
      seed: 4,
    });
    const rush = runPlannedRound({ ...round!, compA: "rush", compB: "rush" }, presets(), undefined, compositions);
    const turtle = runPlannedRound({ ...round!, compA: "turtle", compB: "turtle" }, presets(), undefined, compositions);
    expect(turtle.ticks).not.toBe(rush.ticks);
  });

  it("counts the wins of each composition", () => {
    const summary = summarize([
      record({ compA: "rush", compB: "turtle", winner: "A" }),
      record({ compA: "rush", compB: "turtle", winner: "B" }),
      record({ compA: "turtle", compB: "rush", winner: "A" }),
    ]);
    expect(summary.compositions).toEqual(["rush", "turtle"]);
    expect(summary.byComposition.get("rush")).toMatchObject({ rounds: 3, wins: 1, losses: 2 });
    expect(summary.byComposition.get("turtle")).toMatchObject({ rounds: 3, wins: 2, losses: 1 });
    expect(summary.byCompositionMatchup.get("rush|turtle")).toMatchObject({
      rounds: 2,
      wins: 1,
      losses: 1,
    });
  });

  it("shows the composition table only when there is more than one", () => {
    const one = formatReport(summarize([record()]));
    expect(one).not.toContain("WIN RATE: role composition");
    const two = formatReport(
      summarize([record({ compA: "rush", compB: "turtle", winner: "A" }), record()]),
    );
    expect(two).toContain("WIN RATE: role composition");
    expect(two).toContain("COMPOSITION MATCHUPS");
  });
});
