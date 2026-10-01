import { describe, expect, it } from "vitest";
import { loadDefaultTactics, loadRoles, loadTuning, loadWeaponRoles } from "../src/core/data.js";
import { TacticsSchema, type Tactics } from "../src/core/schemas.js";
import { parseArenaText } from "../src/arena/index.js";
import { archetypeOf } from "../src/weapons/generate.js";
import { ATTACK_TYPES, ROLE_TRAITS } from "../src/weapons/types.js";
import { EventBus } from "../src/core/events.js";
import {
  createSimState,
  rangeWeight,
  topRange,
  weaponWeight,
  ROLES,
  type BotState,
  type Role,
} from "../src/sim/index.js";

const ROOM = [
  "###############",
  "#SSS.......SSS#",
  "#.............#",
  "#.............#",
  "###############",
].join("\n");

function room() {
  return parseArenaText(ROOM, { source: "room" });
}

function stateWithRoles(roles: readonly Role[]) {
  return createSimState({
    map: room(),
    seed: 4,
    bus: new EventBus(),
    roles: { A: roles, B: roles },
  });
}

describe("the roles own the tactics (Section 7.26)", () => {
  it("gives each bot the tactics of its own role", () => {
    // This is the whole change. Before it, a caller that passed tactics threw
    // the role preset away, and every caller passed them, so a tank and an
    // overwatch differed only by six action weights.
    const state = stateWithRoles(["tank", "overwatch", "skirmisher"]);
    const [tank, overwatch, skirmisher] = state.bots as [BotState, BotState, BotState];

    expect(topRange(tank.tactics)).toBe("close");
    expect(topRange(overwatch.tactics)).toBe("long");
    expect(topRange(skirmisher.tactics)).toBe("mid");
    expect(tank.tactics.aggression).not.toBe(overwatch.tactics.aggression);
    expect(overwatch.tactics.holdPosition).toBeGreaterThan(skirmisher.tactics.holdPosition);
  });

  it("gives two bots of the same role the same tactics", () => {
    const state = stateWithRoles(["tank", "tank", "overwatch"]);
    const [one, two, other] = state.bots as [BotState, BotState, BotState];
    expect(one.tactics).toEqual(two.tactics);
    expect(one.tactics).not.toEqual(other.tactics);
  });

  it("throws the role presets away when a caller asks for an override", () => {
    // A batch that measures presets needs this, and its name now says what it
    // does. A composition means nothing while it is set.
    const flat = { ...loadDefaultTactics(), aggression: 0.42 };
    const state = createSimState({
      map: room(),
      seed: 4,
      bus: new EventBus(),
      roles: { A: ["tank", "overwatch", "skirmisher"], B: ["tank", "overwatch", "skirmisher"] },
      tacticsOverride: flat,
    });
    for (const bot of state.bots) {
      expect(bot.tactics.aggression).toBe(0.42);
      expect(topRange(bot.tactics)).toBe(topRange(flat));
    }
  });
});

describe("the role rankings that the design asks for", () => {
  const roles = loadRoles().roles;

  it("ranks the bands as the design says", () => {
    expect(roles["tank"]?.tactics.rangePref).toEqual(["close", "mid", "long"]);
    expect(roles["overwatch"]?.tactics.rangePref).toEqual(["long", "mid", "close"]);
    expect(roles["skirmisher"]?.tactics.rangePref).toEqual(["mid", "close", "long"]);
  });

  it("gives every role a weapon ranking, not one favourite", () => {
    // A run offers five weapons, so one favourite archetype was silent about
    // four of them.
    //
    // Two is the floor and not three (Section 7.48.7). `weaponWeight` gives an
    // unlisted archetype 1.00, which is the BOTTOM of its scale, so listing an
    // archetype can only ever reward it. A role cannot say "I rank these four
    // and all of them are bad" -- naming them raises them. Overwatch has two
    // archetypes above 17 % of its shots at long range and the other four are
    // under it, so its list is those two.
    for (const name of ROLES) {
      const list = roles[name]?.tactics.weaponPref ?? [];
      expect(list.length, name).toBeGreaterThanOrEqual(2);
      expect(new Set(list).size, name).toBe(list.length);
    }
  });

  it("never lists an archetype the generator cannot make (Section 7.48.7)", () => {
    // `versatile` sat in all three lists and `archetypeOf` can never return it,
    // because every role trait matches an earlier rule. A dead entry is not
    // harmless: it takes a rank, so it dilutes every archetype above it.
    const real = new Set<string>();
    for (const role of ROLE_TRAITS) {
      for (const type of ATTACK_TYPES) real.add(archetypeOf(role, type));
    }
    const overwatch = roles["overwatch"]?.tactics.weaponPref ?? [];
    for (const archetype of overwatch) {
      expect(real.has(archetype), `overwatch wants ${archetype} and nothing makes it`).toBe(true);
    }
  });

  it("ranks every archetype that fires in its band above every one that does not", () => {
    // Section 7.49.2: the band share decides the ORDER, and it is not a filter.
    // Truncating each list to its measured members made the roles worse --
    // `weaponWeight` gives an unlisted archetype 1.00, the floor, so a short
    // list says "I am indifferent" rather than "I do not want these", which
    // lowers what an unknown weapon point is worth and keeps the bot on the
    // starting rifle.
    //
    // So the rule is a partition and not a membership test. It still rejects
    // what matters: a marksman above a splash weapon on the tank's list, or a
    // heavy above a precision weapon on the overwatch's.
    const share = loadWeaponRoles().value.bandShareByArchetype;
    for (const name of ROLES) {
      const tactics = roles[name]?.tactics;
      const band = tactics?.rangePref[0];
      expect(band, name).toBeDefined();
      const pref = tactics?.weaponPref ?? [];
      const fits = (archetype: string): boolean => (share[archetype]?.[band!] ?? 0) >= 0.3;
      const lastFitting = pref.reduce((last, a, i) => (fits(a) ? i : last), -1);
      const firstMiss = pref.findIndex((a) => !fits(a));
      expect(lastFitting, `${name} lists nothing that fires ${band}`).toBeGreaterThanOrEqual(0);
      if (firstMiss >= 0) {
        expect(
          firstMiss,
          `${name} fights ${band} and ranks ${pref[firstMiss]} above ${pref[lastFitting]}`,
        ).toBeGreaterThan(lastFitting);
      }
    }
  });

  it("heads each list with an archetype that fires in the role's own band", () => {
    // This used to name three archetypes: tank wants heavy, overwatch wants
    // marksman, skirmisher wants assault. Two of the three were a guess, and
    // the measurement of Section 7.49 disagrees with both.
    //
    // The rule the test was protecting is the one worth holding: a role must not
    // prefer a weapon that does not fight where the role fights. It reads the
    // MEASURED shares in `value.bandShareByArchetype`, so it stays true as the
    // measurement moves and it still rejects the cases that matter -- a marksman
    // heading the tank's list (5.7 % of its shots close) or a denial weapon on
    // the overwatch list (0.5 % long).
    const share = loadWeaponRoles().value.bandShareByArchetype;
    for (const name of ROLES) {
      const tactics = roles[name]?.tactics;
      const band = tactics?.rangePref[0];
      expect(band, name).toBeDefined();
      // The first two, which carry the role's identity: 1.60 and about 1.50
      // against 1.10 at the tail.
      for (const archetype of (tactics?.weaponPref ?? []).slice(0, 2)) {
        const row = share[archetype];
        expect(row, `${name} wants ${archetype} and nothing measured it`).toBeDefined();
        expect(
          row![band!],
          `${name} fights ${band} and reaches for ${archetype}, which fires ${((row![band!] ?? 0) * 100).toFixed(1)} % of its shots there`,
        ).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it("gives the hazard archetype to the only role that walks into a hazard", () => {
    // `hazardAvoidBelowTolerance` is 0.5. A tank at 0.7 paths through a hazard;
    // a skirmisher at 0.4 and an overwatch at 0.2 path around one. A denial
    // weapon lays hazards, so its owner has to be willing to fight among them
    // (Section 7.49).
    const limit = loadTuning().ai.hazardAvoidBelowTolerance;
    for (const name of ROLES) {
      const tactics = roles[name]?.tactics;
      if (!tactics?.weaponPref.includes("denial")) continue;
      expect(tactics.hazardTolerance, `${name} wants denial and avoids hazards`)
        .toBeGreaterThanOrEqual(limit);
    }
    // And the role that can take it, has it.
    expect(roles["tank"]?.tactics.weaponPref).toContain("denial");
  });
});

describe("rangeWeight", () => {
  const tactics: Tactics = { ...loadDefaultTactics(), rangePref: ["long", "mid", "close"] };

  it("keeps the old weight for the favourite band", () => {
    // One favourite band used to be worth `1 + bias`. The head of the ranking
    // still is, so the tuning constant means what it meant.
    expect(rangeWeight(tactics, "long", 0.25)).toBeCloseTo(1.25, 10);
  });

  it("leaves the middle band neutral and pushes the last one down", () => {
    expect(rangeWeight(tactics, "mid", 0.25)).toBe(1);
    expect(rangeWeight(tactics, "close", 0.25)).toBeCloseTo(1 / 1.25, 10);
  });

  it("falls to neutral when the bias is zero", () => {
    for (const band of ["close", "mid", "long"] as const) {
      expect(rangeWeight(tactics, band, 0)).toBe(1);
    }
  });
});

describe("weaponWeight", () => {
  const ranked: Tactics = {
    ...loadDefaultTactics(),
    weaponPref: ["heavy", "splash", "assault", "versatile"],
  };

  it("gives the head of the list the whole bonus", () => {
    expect(weaponWeight(ranked, "heavy", 0.6)).toBeCloseTo(1.6, 10);
  });

  it("gives less to each place after it, and never less than neutral", () => {
    const heavy = weaponWeight(ranked, "heavy", 0.6);
    const splash = weaponWeight(ranked, "splash", 0.6);
    const assault = weaponWeight(ranked, "assault", 0.6);
    const versatile = weaponWeight(ranked, "versatile", 0.6);
    expect(heavy).toBeGreaterThan(splash);
    expect(splash).toBeGreaterThan(assault);
    expect(assault).toBeGreaterThan(versatile);
    expect(versatile).toBeGreaterThan(1);
  });

  it("gives nothing to an archetype the list leaves out", () => {
    // A role can be silent about a weapon instead of ranking every one.
    expect(weaponWeight(ranked, "marksman", 0.6)).toBe(1);
  });

  it("matches the old one-favourite weight for a list of one", () => {
    const single: Tactics = { ...loadDefaultTactics(), weaponPref: ["marksman"] };
    expect(weaponWeight(single, "marksman", 0.6)).toBeCloseTo(1.6, 10);
    expect(weaponWeight(single, "heavy", 0.6)).toBe(1);
  });

  it("gives nothing to anything when the list is empty", () => {
    const none = { ...loadDefaultTactics(), weaponPref: [] };
    expect(weaponWeight(none, "heavy", 0.6)).toBe(1);
  });
});

describe("the tactics schema holds the shape of a ranking", () => {
  const base = loadDefaultTactics();

  it("takes a ranking that names each band one time", () => {
    expect(TacticsSchema.safeParse({ ...base, rangePref: ["long", "close", "mid"] }).success).toBe(
      true,
    );
  });

  it("refuses a ranking that repeats a band or leaves one out", () => {
    expect(TacticsSchema.safeParse({ ...base, rangePref: ["mid", "mid", "long"] }).success).toBe(
      false,
    );
    expect(TacticsSchema.safeParse({ ...base, rangePref: ["mid", "long"] }).success).toBe(false);
  });

  it("refuses a weapon ranking that repeats an archetype", () => {
    expect(
      TacticsSchema.safeParse({ ...base, weaponPref: ["heavy", "heavy"] }).success,
    ).toBe(false);
  });

  it("takes an empty weapon ranking, which means no preference", () => {
    expect(TacticsSchema.safeParse({ ...base, weaponPref: [] }).success).toBe(true);
  });
});
