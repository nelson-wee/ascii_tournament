import { beforeEach, describe, expect, it } from "vitest";
import { DataValidationError, clearDataCache, loadTuning, parseData } from "../src/core/data.js";
import { TuningSchema } from "../src/core/schemas.js";
import rawTuning from "../data/tuning.json";

describe("loadTuning", () => {
  beforeEach(() => {
    clearDataCache();
  });

  it("loads and validates data/tuning.json", () => {
    const tuning = loadTuning();
    expect(tuning.schemaVersion).toBe(1);
    expect(tuning.simulation.ticksPerSecond).toBeGreaterThan(0);
    expect(tuning.simulation.aiDecisionIntervalTicks).toBeGreaterThan(0);
  });

  it("holds the locked values of Section 2.2", () => {
    const tuning = loadTuning();
    expect(tuning.match.teamSize).toBe(3);
    expect(tuning.match.maxRounds).toBe(3);
    expect(tuning.match.roundWinsToWinMatch).toBe(2);
  });

  it("caches the result", () => {
    expect(loadTuning()).toBe(loadTuning());
    const first = loadTuning();
    clearDataCache();
    expect(loadTuning()).not.toBe(first);
  });

  it("names every placeholder number in the tbd list", () => {
    // Dev guide Section 0.5: mark each placeholder value. JSON has no
    // comments, so the file lists the keys instead.
    const tuning = loadTuning();
    for (const path of tuning.tbd) {
      const value = path
        .split(".")
        .reduce<unknown>(
          (node, key) => (node as Record<string, unknown> | undefined)?.[key],
          tuning as unknown,
        );
      expect(value, `tbd names a key that is missing: ${path}`).toBeDefined();
    }
  });
});

describe("TuningSchema", () => {
  it("rejects an unknown key", () => {
    const value = { ...rawTuning, mystery: 1 };
    expect(() => parseData("test", TuningSchema, value)).toThrow(DataValidationError);
  });

  it("rejects a value that is not a positive integer", () => {
    const value = { ...rawTuning, simulation: { ...rawTuning.simulation, ticksPerSecond: 0 } };
    expect(() => parseData("test", TuningSchema, value)).toThrow(DataValidationError);
  });

  it("rejects more round wins than rounds", () => {
    const value = { ...rawTuning, match: { ...rawTuning.match, roundWinsToWinMatch: 4 } };
    expect(() => parseData("test", TuningSchema, value)).toThrow(DataValidationError);
  });

  it("reports the file and the failing key", () => {
    const value = { ...rawTuning, round: { ...rawTuning.round, scoreLimit: -1 } };
    try {
      parseData("data/tuning.json", TuningSchema, value);
      expect.unreachable("parseData must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
      const failure = error as DataValidationError;
      expect(failure.file).toBe("data/tuning.json");
      expect(failure.issues.join(" ")).toContain("round.scoreLimit");
    }
  });
});
