import { describe, expect, it } from "vitest";
import {
  RNG_STREAM_NAMES,
  createRng,
  createRngStreams,
  deriveSeed,
  type RngStreamName,
} from "../src/core/rng.js";

function take(seed: number, stream: RngStreamName, count: number): number[] {
  const rng = createRngStreams(seed)[stream];
  return Array.from({ length: count }, () => rng.next());
}

describe("createRng", () => {
  it("gives the same sequence for the same seed", () => {
    const a = Array.from({ length: 50 }, () => createRng(7, "sim").next());
    const b = createRng(7, "sim");
    expect(a[0]).toBe(b.next());
    expect(Array.from({ length: 20 }, () => createRng(7, "sim").next())).toEqual(
      Array.from({ length: 20 }, () => createRng(7, "sim").next()),
    );
  });

  it("gives different sequences for different seeds", () => {
    expect(take(1, "sim", 20)).not.toEqual(take(2, "sim", 20));
  });

  it("gives values inside [0, 1)", () => {
    const rng = createRng(42, "sim");
    for (let i = 0; i < 10_000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("keeps int() inside its range and reaches both limits", () => {
    const rng = createRng(3, "sim");
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i += 1) {
      const value = rng.int(1, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });

  it("throws if int() gets an empty range", () => {
    expect(() => createRng(1, "sim").int(5, 4)).toThrow(RangeError);
  });

  it("throws if pick() gets an empty list", () => {
    expect(() => createRng(1, "sim").pick([])).toThrow(RangeError);
  });

  it("shuffles without loss of items", () => {
    const rng = createRng(9, "sim");
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(source);
    expect(shuffled).not.toBe(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffled.slice().sort((x, y) => x - y)).toEqual(source);
  });

  it("saves and restores its state", () => {
    const rng = createRng(11, "sim");
    for (let i = 0; i < 5; i += 1) rng.next();
    const state = rng.getState();
    const expected = Array.from({ length: 10 }, () => rng.next());
    rng.setState(state);
    expect(Array.from({ length: 10 }, () => rng.next())).toEqual(expected);
  });
});

describe("createRngStreams", () => {
  it("gives one stream per name", () => {
    const streams = createRngStreams(1);
    for (const name of RNG_STREAM_NAMES) {
      expect(streams[name].label).toBe(name);
    }
  });

  it("keeps the streams independent", () => {
    // Dev guide Section 7.1: a change in one system must not change the
    // results of another system. Extra calls on one stream must not move
    // the other streams.
    const control = createRngStreams(5);
    const expectedSim = Array.from({ length: 10 }, () => control.sim.next());

    const test = createRngStreams(5);
    for (let i = 0; i < 100; i += 1) test.arena.next();
    expect(Array.from({ length: 10 }, () => test.sim.next())).toEqual(expectedSim);
  });

  it("gives different values on different streams of one seed", () => {
    const streams = createRngStreams(5);
    const first = RNG_STREAM_NAMES.map((name) => streams[name].next());
    expect(new Set(first).size).toBe(RNG_STREAM_NAMES.length);
  });
});

describe("deriveSeed", () => {
  it("is deterministic and depends on the label", () => {
    expect(deriveSeed(100, "round:1")).toBe(deriveSeed(100, "round:1"));
    expect(deriveSeed(100, "round:1")).not.toBe(deriveSeed(100, "round:2"));
    expect(deriveSeed(100, "round:1")).not.toBe(deriveSeed(101, "round:1"));
  });

  it("gives a 32-bit unsigned integer", () => {
    const seed = deriveSeed(12345, "round:3");
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });

  it("makes a round sub-seed that replays alone", () => {
    const matchSeed = 777;
    const roundSeed = deriveSeed(matchSeed, "round:2");
    const first = Array.from({ length: 20 }, () => createRng(roundSeed, "sim").next());
    const second = Array.from({ length: 20 }, () =>
      createRng(deriveSeed(matchSeed, "round:2"), "sim").next(),
    );
    expect(second).toEqual(first);
  });
});

describe("fork", () => {
  it("gives a deterministic independent child stream", () => {
    const a = createRng(1, "sim").fork("bot:0");
    const b = createRng(1, "sim").fork("bot:0");
    const c = createRng(1, "sim").fork("bot:1");
    expect(a.next()).toBe(b.next());
    expect(a.label).toBe("sim/bot:0");
    expect(createRng(1, "sim").fork("bot:0").next()).not.toBe(c.next());
  });
});
