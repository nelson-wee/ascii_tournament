import { describe, expect, it } from "vitest";
import { loadBaselineWeapon, loadWeaponRoles } from "../src/core/data.js";
import { createRng } from "../src/core/rng.js";
import { archetypeOf, generateWeapon, generateWeaponSet } from "../src/weapons/generate.js";
import {
  ATTACK_TYPES,
  ROLE_TRAITS,
  bandOfDistance,
  isProjectileType,
  type RoleTrait,
  type Weapon,
} from "../src/weapons/types.js";

function meanDps(weapon: Weapon): number {
  return (weapon.dpsProfile.close + weapon.dpsProfile.mid + weapon.dpsProfile.long) / 3;
}

/** Every weapon of many sets. */
function manyWeapons(sets = 40): Weapon[] {
  const all: Weapon[] = [];
  for (let seed = 1; seed <= sets; seed += 1) {
    all.push(...generateWeaponSet(createRng(seed, "weapons"), 5).slice(1));
  }
  return all;
}

describe("the power budget", () => {
  it("puts every generated weapon inside the budget of its tier", () => {
    // The acceptance test of Milestone M6 (Section 7.3, step 7).
    const { budget, tiers } = loadWeaponRoles();
    const weapons = manyWeapons();
    expect(weapons.length).toBeGreaterThan(100);
    for (const weapon of weapons) {
      const tier = tiers.list.find((entry) => entry.name === weapon.tier);
      expect(tier, `${weapon.id} has an unknown tier "${weapon.tier}"`).toBeDefined();
      const target = budget.target * tier!.budgetFactor;
      expect(
        Math.abs(weapon.budgetUsed - target),
        `${weapon.id} costs ${weapon.budgetUsed.toFixed(1)} against a target of ${target.toFixed(1)}`,
      ).toBeLessThanOrEqual(budget.tolerance);
    }
  });

  it("gives a run a clear ranking of tiers", () => {
    // A run should not hold five weapons of the same power.
    const { tiers } = loadWeaponRoles();
    const best = [...tiers.list].sort((a, b) => b.budgetFactor - a.budgetFactor)[0]!;
    for (let seed = 1; seed <= 12; seed += 1) {
      const set = generateWeaponSet(createRng(seed, "weapons"), 5).slice(1);
      const names = set.map((weapon) => weapon.tier);
      expect(names, `seed ${seed} has no ${best.name} weapon`).toContain(best.name);
      expect(new Set(names).size, `seed ${seed} has one tier only`).toBeGreaterThan(1);
      // The best weapon of a run must really be the strongest.
      const budgets = set.map((weapon) => weapon.budgetUsed);
      expect(Math.max(...budgets)).toBeGreaterThan(Math.min(...budgets) * 1.15);
    }
  });

  it("keeps the damage inside the range of its role", () => {
    const { roles } = loadWeaponRoles();
    for (const weapon of manyWeapons()) {
      const role = roles[weapon.role as RoleTrait];
      expect(role, `no role data for ${weapon.role}`).toBeDefined();
      expect(weapon.damage).toBeGreaterThanOrEqual(role!.damage[0] - 0.06);
      expect(weapon.damage).toBeLessThanOrEqual(role!.damage[1] + 0.06);
    }
  });

  it("gives every weapon a DPS profile above zero at its best band", () => {
    for (const weapon of manyWeapons()) {
      expect(Math.max(weapon.dpsProfile.close, weapon.dpsProfile.mid, weapon.dpsProfile.long))
        .toBeGreaterThan(0);
    }
  });
});

describe("generateWeaponSet", () => {
  it("puts the baseline weapon first", () => {
    const set = generateWeaponSet(createRng(1, "weapons"), 5);
    expect(set[0]?.id).toBe(loadBaselineWeapon().id);
    expect(set).toHaveLength(5);
  });

  it("gives the same set for the same seed", () => {
    expect(generateWeaponSet(createRng(7, "weapons"), 5)).toEqual(
      generateWeaponSet(createRng(7, "weapons"), 5),
    );
  });

  it("gives a different set for a different seed", () => {
    const a = generateWeaponSet(createRng(1, "weapons"), 5).map((w) => w.id).join();
    const b = generateWeaponSet(createRng(2, "weapons"), 5).map((w) => w.id).join();
    expect(a).not.toBe(b);
  });

  it("covers the role traits over a set", () => {
    // Section 7.3: the set must give some role coverage.
    const roles = new Set(generateWeaponSet(createRng(3, "weapons"), 5).slice(1).map((w) => w.role));
    expect(roles.size).toBeGreaterThanOrEqual(3);
  });

  it("gives only the baseline when the count is one", () => {
    expect(generateWeaponSet(createRng(1, "weapons"), 1)).toHaveLength(1);
  });

  it("uses only known roles and attack types", () => {
    for (const weapon of manyWeapons()) {
      expect(ROLE_TRAITS).toContain(weapon.role);
      expect(ATTACK_TYPES).toContain(weapon.attackType);
    }
  });

  it("gives a projectile speed to every attack type that needs one", () => {
    for (const weapon of manyWeapons()) {
      expect(weapon.projectileSpeed !== null).toBe(isProjectileType(weapon.attackType));
    }
  });
});

describe("the archetype label", () => {
  it("follows the rules of Section 7.20.4", () => {
    expect(archetypeOf(null, "hitscan")).toBe("baseline");
    expect(archetypeOf("precise", "tile")).toBe("denial");
    expect(archetypeOf("sniper", "burst")).toBe("splash");
    expect(archetypeOf("heavy", "cone")).toBe("splash");
    expect(archetypeOf("sniper", "hitscan")).toBe("marksman");
    expect(archetypeOf("assault", "line")).toBe("assault");
    expect(archetypeOf("precise", "hitscan")).toBe("precision");
    expect(archetypeOf("heavy", "projectile")).toBe("heavy");
  });

  it("lets the attack type win over the role", () => {
    // A tile weapon holds ground, whatever role rolled it.
    for (const role of ROLE_TRAITS) {
      expect(archetypeOf(role, "tile")).toBe("denial");
      expect(archetypeOf(role, "burst")).toBe("splash");
    }
  });

  it("matches the label on every generated weapon", () => {
    for (const weapon of manyWeapons()) {
      expect(weapon.archetype).toBe(archetypeOf(weapon.role, weapon.attackType));
    }
  });
});

describe("the shape of a role", () => {
  /** The mean weapon of one role, over many rolls. */
  function meanOf(role: RoleTrait): { close: number; mid: number; long: number; react: number } {
    const rng = createRng(11, "weapons");
    const list: Weapon[] = [];
    for (let i = 0; list.length < 40 && i < 900; i += 1) {
      const weapon = generateWeapon(rng, role, i);
      if (weapon) list.push(weapon);
    }
    expect(list.length, `${role} made too few weapons`).toBeGreaterThan(10);
    const sum = list.reduce(
      (acc, w) => ({
        close: acc.close + w.dpsProfile.close,
        mid: acc.mid + w.dpsProfile.mid,
        long: acc.long + w.dpsProfile.long,
        react: acc.react + (w.reactionByBand.close - w.reactionByBand.long),
      }),
      { close: 0, mid: 0, long: 0, react: 0 },
    );
    return {
      close: sum.close / list.length,
      mid: sum.mid / list.length,
      long: sum.long / list.length,
      react: sum.react / list.length,
    };
  }

  it("makes an assault weapon strong and fast at close range", () => {
    const assault = meanOf("assault");
    expect(assault.close).toBeGreaterThan(assault.long);
    // Its reaction at close range is faster than at long range.
    expect(assault.react).toBeLessThan(0);
  });

  it("makes a sniper weapon strong and fast at long range", () => {
    const sniper = meanOf("sniper");
    expect(sniper.long).toBeGreaterThan(sniper.close);
    expect(sniper.react).toBeGreaterThan(0);
  });

  it("gives a heavy weapon a slow reaction", () => {
    const rng = createRng(5, "weapons");
    const heavy: Weapon[] = [];
    const assault: Weapon[] = [];
    for (let i = 0; i < 400 && (heavy.length < 20 || assault.length < 20); i += 1) {
      const h = generateWeapon(rng, "heavy", i);
      if (h) heavy.push(h);
      const a = generateWeapon(rng, "assault", i);
      if (a) assault.push(a);
    }
    const mean = (list: Weapon[]): number =>
      list.reduce(
        (sum, w) => sum + (w.reactionByBand.close + w.reactionByBand.mid + w.reactionByBand.long) / 3,
        0,
      ) / list.length;
    expect(mean(heavy)).toBeGreaterThan(mean(assault));
  });

  it("makes a cone weapon fade at long range", () => {
    const cones = manyWeapons().filter((w) => w.attackType === "cone");
    expect(cones.length).toBeGreaterThan(0);
    for (const cone of cones) {
      expect(cone.coneHalfAngle).toBeGreaterThan(0);
      expect(cone.dpsProfile.long).toBeLessThan(cone.dpsProfile.close * 0.6);
    }

    // Damage over time and a hazard tile are the same in every band, so they
    // put a floor under the long band. A cone with neither fades to almost
    // nothing.
    const plain = cones.filter((w) => w.dotDamage === 0 && w.hazardTicks === 0);
    expect(plain.length).toBeGreaterThan(0);
    for (const cone of plain) {
      expect(cone.dpsProfile.long).toBeLessThan(cone.dpsProfile.close * 0.1);
    }
  });
});

describe("the baseline weapon", () => {
  it("stays a viable fallback and not the best choice", () => {
    // Section 7.3: the baseline must be viable. It must not beat the weapons
    // that spend a full budget, or a bot never takes anything else.
    const baseline = loadBaselineWeapon();
    const generated = manyWeapons().map(meanDps).sort((a, b) => a - b);
    const median = generated[Math.floor(generated.length / 2)] as number;
    const base = meanDps(baseline);
    expect(base).toBeLessThan(median);
    expect(base).toBeGreaterThan(median * 0.45);
  });

  it("is a hitscan weapon with no area and no role", () => {
    const baseline = loadBaselineWeapon();
    expect(baseline.attackType).toBe("hitscan");
    expect(baseline.role).toBeNull();
    expect(baseline.archetype).toBe("baseline");
    expect(baseline.aoeRadius).toBe(0);
  });
});

describe("bandOfDistance", () => {
  it("splits the distance into three bands", () => {
    expect(bandOfDistance(4, 8, 20)).toBe("close");
    expect(bandOfDistance(8, 8, 20)).toBe("close");
    expect(bandOfDistance(12, 8, 20)).toBe("mid");
    expect(bandOfDistance(30, 8, 20)).toBe("long");
  });
});
