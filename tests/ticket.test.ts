import { describe, expect, it } from "vitest";
import { buildId, codeVersion, dataFingerprint } from "../src/core/build.js";
import {
  createSession,
  matchSeedOf,
  matchSeedsOf,
  nextMatch,
} from "../src/meta/session.js";
import {
  describeTicket,
  formatTicket,
  makeTicket,
  parseTicket,
  ticketWarning,
} from "../src/meta/ticket.js";

describe("the build id", () => {
  it("names a commit, and marks a tree that has changes in it", () => {
    // vitest reads `vite.config.ts`, so a test sees the same commit that a
    // build would write in. A tree with changes gets a trailing `+`.
    expect(codeVersion()).toMatch(/^(dev|[0-9a-f]+\+?)$/);
  });

  it("gives the same data fingerprint every time", () => {
    expect(dataFingerprint()).toBe(dataFingerprint());
    expect(dataFingerprint()).toMatch(/^[0-9a-z]+$/);
  });

  it("puts the code and the data in the build id, and keeps the + mark", () => {
    expect(buildId()).toBe(`${codeVersion()}.${dataFingerprint()}`);
    // Cutting the commit short here once took the `+` off a dirty tree.
    if (codeVersion().endsWith("+")) expect(buildId()).toContain("+");
  });
});

describe("parseTicket", () => {
  it("reads a bare number as a seed", () => {
    const ticket = parseTicket("1758800000");
    expect(ticket?.seed).toBe(1758800000);
    expect(ticket?.matchNumber).toBe(1);
    expect(ticket?.style).toBeNull();
    expect(ticket?.mode).toBe("tournament");
  });

  it("takes the fragment of an address as it comes", () => {
    const ticket = parseTicket("#seed=12&match=3&style=cavern&mode=test");
    expect(ticket?.seed).toBe(12);
    expect(ticket?.matchNumber).toBe(3);
    expect(ticket?.style).toBe("cavern");
    expect(ticket?.mode).toBe("test");
  });

  it("reads a seed override in base 36", () => {
    const ticket = parseTicket("seed=12&weapons=zz");
    expect(ticket?.overrides.weapons).toBe(35 * 36 + 35);
    expect(ticket?.overrides.arena).toBeUndefined();
  });

  it("gives null without a seed, because a ticket names one match", () => {
    expect(parseTicket("")).toBeNull();
    expect(parseTicket("match=2&style=bastion")).toBeNull();
    expect(parseTicket("hello")).toBeNull();
  });

  it("falls back rather than fail on a field it does not know", () => {
    const ticket = parseTicket("seed=7&style=moon&mode=sideways&match=0");
    expect(ticket?.style).toBeNull();
    expect(ticket?.mode).toBe("tournament");
    // A match number starts at 1, whatever the text said.
    expect(ticket?.matchNumber).toBe(1);
  });
});

describe("formatTicket", () => {
  it("writes and reads back the same ticket", () => {
    const one = parseTicket("seed=999&match=4&style=openfield&mode=test&spawn=1a2b3c");
    expect(one).not.toBeNull();
    const two = parseTicket(formatTicket(one!));
    expect(two).toEqual({ ...one, build: one!.build });
  });

  it("leaves out a seed that the match seed already gives", () => {
    const seed = matchSeedOf(500, 2);
    const ticket = makeTicket({
      seed: 500,
      matchNumber: 2,
      style: "bastion",
      mode: "test",
      seeds: matchSeedsOf(seed),
      defaults: matchSeedsOf(seed),
    });
    expect(ticket.overrides).toEqual({});
    expect(formatTicket(ticket)).toBe(`seed=500&match=2&style=bastion&mode=test&build=${buildId()}`);
  });

  it("carries only the seed that was changed", () => {
    const seed = matchSeedOf(500, 2);
    const defaults = matchSeedsOf(seed);
    const ticket = makeTicket({
      seed: 500,
      matchNumber: 2,
      style: "bastion",
      mode: "test",
      seeds: { ...defaults, weapons: 42 },
      defaults,
    });
    expect(ticket.overrides).toEqual({ weapons: 42 });
    expect(formatTicket(ticket)).toContain("weapons=16");
    expect(formatTicket(ticket)).not.toContain("arena=");
  });
});

describe("ticketWarning", () => {
  it("says nothing about a ticket from this build", () => {
    const ticket = makeTicket({ seed: 1, matchNumber: 1, style: null, mode: "test" });
    expect(ticketWarning(ticket)).toBeNull();
  });

  it("warns that a ticket from another build gives a different match", () => {
    const ticket = parseTicket("seed=1&build=abcd1234.zzz");
    expect(ticket).not.toBeNull();
    const warning = ticketWarning(ticket!);
    expect(warning).toContain("different match");
  });

  it("warns when a ticket names no build at all", () => {
    const ticket = parseTicket("seed=1");
    expect(ticketWarning(ticket!)).toContain("does not name a build");
  });
});

describe("describeTicket", () => {
  it("names the ground and what was changed", () => {
    expect(describeTicket(parseTicket("seed=1&style=cavern&match=2")!)).toBe("cavern, match 2");
    expect(describeTicket(parseTicket("seed=1&style=cavern&weapons=5")!)).toBe(
      "cavern, match 1, new weapons",
    );
    expect(describeTicket(parseTicket("seed=1")!)).toBe("every style, match 1");
  });
});

describe("the three seeds of a match", () => {
  const session = () =>
    createSession({ mode: "test", seed: 20260926, style: "bastion", weaponsPerRun: 5 });

  it("gives the same match twice from the same seed", () => {
    const one = nextMatch(session());
    const two = nextMatch(session());
    expect(two.arena.name).toBe(one.arena.name);
    expect(two.weapons.map((w) => w.id)).toEqual(one.weapons.map((w) => w.id));
    expect(two.spawnTable.slots).toEqual(one.spawnTable.slots);
    expect(two.seeds).toEqual(one.seeds);
  });

  it("keeps the ground when only the weapons seed changes", () => {
    // This is the point of three seeds (Section 7.23): a player holds a layout
    // and tries a different loadout on it.
    const base = nextMatch(session());
    const rerolled = nextMatch(session(), { weapons: 12345 });

    expect(rerolled.arena.name).toBe(base.arena.name);
    expect(rerolled.arena.width).toBe(base.arena.width);
    expect(rerolled.arena.tiles).toEqual(base.arena.tiles);
    expect(rerolled.weapons.map((w) => w.id)).not.toEqual(base.weapons.map((w) => w.id));
  });

  it("keeps the ground and the weapons when only the spawn table changes", () => {
    const base = nextMatch(session());
    const rerolled = nextMatch(session(), { spawnTable: 999 });

    expect(rerolled.arena.tiles).toEqual(base.arena.tiles);
    expect(rerolled.weapons.map((w) => w.id)).toEqual(base.weapons.map((w) => w.id));
    // The same weapons on different points, which is a different match to play.
    expect(rerolled.spawnTable.slots).not.toEqual(base.spawnTable.slots);
  });

  it("changes the ground when only the arena seed changes", () => {
    const base = nextMatch(session());
    const other = nextMatch(session(), { arena: 777 });
    expect(other.arena.tiles).not.toEqual(base.arena.tiles);
    // The weapons do not move with the ground.
    expect(other.weapons.map((w) => w.id)).toEqual(base.weapons.map((w) => w.id));
  });

  it("names the seeds it used, so a ticket can carry them", () => {
    const setup = nextMatch(session(), { weapons: 4242 });
    expect(setup.seeds.weapons).toBe(4242);
    expect(setup.seeds.arena).toBe(matchSeedsOf(setup.seed).arena);
    expect(setup.style).toBe("bastion");
  });
});

describe("run.json", () => {
  it("names the commit, the data and the seed of a batch", async () => {
    // No batch runs here. The file is the other half of the key that a seed in
    // `rounds.csv` needs (Section 7.23), so the test reads its shape only.
    const { makeRunInfo } = await import("../src/cli/runInfo.js");
    const info = makeRunInfo({ seed: 4242, rounds: 120, config: { arenas: ["test"] } });

    expect(info.seed).toBe(4242);
    expect(info.rounds).toBe(120);
    expect(info.config).toEqual({ arenas: ["test"] });
    expect(info.dataFingerprint).toBe(dataFingerprint());
    expect(info.commit).toMatch(/^(dev|[0-9a-f]+\+?)$/);
    expect(Number.isFinite(Date.parse(info.ranAt))).toBe(true);
    expect(info.note).toContain("commit");
  });
});
