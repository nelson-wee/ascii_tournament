/**
 * A session of matches (dev-guide Sections 7.15 and 7.20.20).
 *
 * A session chains matches so the game never stops. It is not the run of
 * Section 7.15: it has no opponent doctrines, no adaptation record, and no end.
 */
import { describe, expect, it } from "vitest";
import {
  createSession,
  nextMatch,
  nextStyle,
  recordMatch,
  sessionTally,
  SESSION_MODES,
  type Session,
} from "../src/meta/session.js";
import { checkArenaFairness } from "../src/arena/index.js";
import { EventBus } from "../src/core/events.js";
import { createRoundState, runRound, simConfigFromTuning } from "../src/sim/index.js";

function session(over: Partial<Parameters<typeof createSession>[0]> = {}): Session {
  return createSession({ mode: "tournament", seed: 11, ...over });
}

describe("createSession", () => {
  it("knows both modes and starts at match 1", () => {
    for (const mode of SESSION_MODES) {
      const created = session({ mode });
      expect(created.mode).toBe(mode);
      expect(created.matchNumber).toBe(1);
      expect(created.matchWins).toEqual({ A: 0, B: 0 });
      expect(created.history).toEqual([]);
    }
  });

  it("refuses a session with no arena style", () => {
    expect(() => session({ styles: [] })).toThrow(/style/);
  });
});

describe("nextStyle", () => {
  it("takes the styles in turn for a tournament", () => {
    const created = session({ styles: ["bastion", "openfield", "cavern"] });
    const seen: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      seen.push(nextStyle(created));
      created.matchNumber += 1;
    }
    expect(seen).toEqual([
      "bastion",
      "openfield",
      "cavern",
      "bastion",
      "openfield",
      "cavern",
      "bastion",
    ]);
  });

  it("holds one style for a test session", () => {
    const created = session({ mode: "test", style: "cavern" });
    for (let i = 0; i < 4; i += 1) {
      expect(nextStyle(created)).toBe("cavern");
      created.matchNumber += 1;
    }
  });
});

describe("nextMatch", () => {
  it("builds an arena, a weapon set, and a spawn table", () => {
    const created = session();
    const setup = nextMatch(created);
    expect(setup.matchNumber).toBe(1);
    expect(setup.arena.profile.style).toBe("bastion");
    expect(setup.weapons).toHaveLength(created.weaponsPerRun);
    expect(Object.keys(setup.spawnTable.slots).length).toBe(setup.arena.pickups.length);
    expect(checkArenaFairness(setup.arena).failures).toEqual([]);
  });

  it("does not advance the session on its own", () => {
    // A match that is abandoned must not skip a number.
    const created = session();
    nextMatch(created);
    nextMatch(created);
    expect(created.matchNumber).toBe(1);
  });

  it("gives the same session for the same seed, and a different one for another", () => {
    const first = nextMatch(session({ seed: 3 }));
    const same = nextMatch(session({ seed: 3 }));
    const other = nextMatch(session({ seed: 4 }));
    expect([...same.arena.tiles]).toEqual([...first.arena.tiles]);
    expect(same.weapons.map((weapon) => weapon.id)).toEqual(first.weapons.map((w) => w.id));
    expect([...other.arena.tiles]).not.toEqual([...first.arena.tiles]);
  });

  it("gives a new arena to every match of a session", () => {
    const created = session();
    const first = nextMatch(created);
    recordMatch(created, first, "A", { A: 2, B: 0 });
    const second = nextMatch(created);
    expect(second.matchNumber).toBe(2);
    expect(second.arena.name).not.toBe(first.arena.name);
    expect([...second.arena.tiles]).not.toEqual([...first.arena.tiles]);
  });
});

describe("recordMatch", () => {
  it("counts a win and moves on, whoever won", () => {
    const created = session();
    for (const winner of ["A", "B", "A"] as const) {
      const setup = nextMatch(created);
      recordMatch(created, setup, winner, { A: 2, B: 1 });
    }
    expect(created.matchNumber).toBe(4);
    expect(created.matchWins).toEqual({ A: 2, B: 1 });
    expect(created.history).toHaveLength(3);
    expect(created.history[0]!.style).toBe("bastion");
    expect(created.history[1]!.style).toBe("openfield");
  });

  it("counts a drawn match for neither team", () => {
    const created = session();
    recordMatch(created, nextMatch(created), null, { A: 1, B: 1 });
    expect(created.matchWins).toEqual({ A: 0, B: 0 });
    expect(sessionTally(created)).toContain("1 drawn");
  });

  it("says nothing was played before the first match", () => {
    expect(sessionTally(session())).toContain("No match");
  });
});

describe("a session plays", () => {
  it("runs a round of the first match of every mode", () => {
    for (const mode of SESSION_MODES) {
      const created = session({ mode, style: mode === "test" ? "openfield" : null });
      const setup = nextMatch(created);
      const bus = new EventBus();
      const state = createRoundState(
        { map: setup.arena, weapons: setup.weapons, seed: setup.seed },
        1,
        {},
        setup.spawnTable,
        simConfigFromTuning(),
        bus,
      );
      const result = runRound(state);
      expect(result.outcome).not.toBeNull();
      expect(bus.filter("Kill").length).toBeGreaterThan(0);
    }
  });
});
