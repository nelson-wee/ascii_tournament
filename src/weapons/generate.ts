/**
 * Weapon generation (dev-guide Sections 7.3 and 7.20.2 to 7.20.4).
 *
 * Order:
 *   1. Roll the role trait.
 *   2. Roll the attack type, with the weights of that trait.
 *   3. Roll the stats inside the ranges of the trait, shaped by the attack type.
 *   4. Calculate the DPS profile at close, mid, and long range.
 *   5. Price every attribute and scale the damage to fit the power budget.
 *   6. Derive the archetype label.
 *
 * The archetype is a label, not an input. The AI never reads it: it reads the
 * DPS profile (Section 7.8).
 */
import { loadBaselineWeapon, loadWeaponRoles } from "../core/data.js";
import type { Rng } from "../core/rng.js";
import type { WeaponRoles } from "../core/schemas.js";
import {
  RANGE_BANDS,
  ROLE_TRAITS,
  isProjectileType,
  type Archetype,
  type AttackType,
  type BandValues,
  type DpsProfile,
  type RoleTrait,
  type Weapon,
} from "./types.js";

type Range = readonly [number, number];

function rollRange(rng: Rng, range: Range): number {
  return rng.float(range[0], range[1]);
}

function rollIntRange(rng: Rng, range: Range): number {
  return rng.int(Math.round(range[0]), Math.round(range[1]));
}

/** Take one key of a weighted table. */
function rollWeighted<T extends string>(rng: Rng, weights: Readonly<Record<string, number>>): T {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) throw new Error("A weighted table has no entry above zero.");
  let roll = rng.float(0, total);
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key as T;
  }
  return (entries[entries.length - 1] as [string, number])[0] as T;
}

/**
 * How many targets one shot is expected to touch (Section 7.20.3).
 *
 * A single-target shot touches one. An area or a line touches more, and the
 * DPS profile must say so: the AI selects a weapon by its DPS profile
 * (Section 7.8), and the budget prices the same number. If the two disagree,
 * the AI takes a weapon that the budget calls weak, or it leaves the value
 * that the budget charged for.
 */
function expectedTargets(draft: Omit<WeaponDraft, "perDamageDps" | "flatDps">, tables: WeaponRoles): number {
  const { value } = tables;
  if (draft.attackType === "burst") {
    return 1 + Math.min(value.aoeTargetsMax, draft.aoeRadius * value.aoeTargetsPerRadius);
  }
  if (draft.attackType === "cone") {
    return 1 + Math.min(value.coneTargetsMax, draft.coneHalfAngle * value.coneTargetsPerRadian);
  }
  if (draft.attackType === "line") return 1 + value.lineTargets;
  return 1;
}

/**
 * The damage per second that does not come from the shot itself: damage over
 * time, and the hazard tiles. It does not change with the damage of a shot.
 */
function flatDpsOf(
  draft: Omit<WeaponDraft, "perDamageDps" | "flatDps">,
  tables: WeaponRoles,
  ticksPerSecond: number,
): number {
  const { value } = tables;
  const fireIntervalSeconds = draft.fireIntervalTicks / ticksPerSecond;
  let dps = 0;
  if (draft.dotDamage > 0 && draft.dotTicks > 0) {
    // Several shots stack their damage over time, but not without a limit.
    const perShot = draft.dotDamage * draft.dotTicks;
    dps += Math.min(perShot / fireIntervalSeconds, draft.dotDamage * ticksPerSecond * value.dotStackCap);
  }
  if (draft.hazardTicks > 0) {
    const hazardDamage = draft.hazardDamagePerTick * draft.hazardTicks;
    dps += (hazardDamage * value.hazardOccupancy) / fireIntervalSeconds;
  }
  return dps;
}

/** The DPS at one range band, per point of damage. */
function dpsPerDamage(
  band: keyof BandValues,
  roleMultiplier: BandValues,
  attackMultiplier: BandValues,
  fireIntervalTicks: number,
  ticksPerSecond: number,
  targets: number,
  accuracyFactor: number,
): number {
  const shotsPerSecond = ticksPerSecond / fireIntervalTicks;
  return shotsPerSecond * roleMultiplier[band] * attackMultiplier[band] * targets * accuracyFactor;
}

export interface WeaponDraft {
  role: RoleTrait;
  attackType: AttackType;
  fireIntervalTicks: number;
  rangeMax: number;
  ammoMax: number;
  critChance: number;
  critConditions: string[];
  projectileSpeed: number | null;
  aoeRadius: number;
  coneHalfAngle: number;
  ricochetBounces: number;
  dotDamage: number;
  dotTicks: number;
  hazardTicks: number;
  hazardRadius: number;
  hazardDamagePerTick: number;
  ammoPickupShare: number;
  reactionByBand: BandValues;
  /** The DPS per point of damage, per band. It holds the expected targets. */
  perDamageDps: BandValues;
  /** The DPS that does not come from the damage of a shot. */
  flatDps: number;
}

/**
 * The cost of everything that does not depend on the damage.
 * A cost that is a discount lowers the total, so a slow weapon may hit harder.
 */
/**
 * The mean of a band value, weighted by how often the arena fires in each band
 * (Section 7.20.15).
 *
 * A flat mean of three bands prices a weapon for a fight that does not happen:
 * the arena fires 1 % of its shots past the mid band, so a marksman paid 9 of
 * its 100 points for reach it never used.
 */
export function bandMean(values: BandValues, tables: WeaponRoles): number {
  const share = tables.value.bandShare;
  const total = share.close + share.mid + share.long;
  if (total <= 0) return (values.close + values.mid + values.long) / 3;
  return (values.close * share.close + values.mid * share.mid + values.long * share.long) / total;
}

export function fixedCost(draft: WeaponDraft, tables: WeaponRoles): number {
  const { budget } = tables;
  const meanReaction = bandMean(draft.reactionByBand, tables);
  let cost = 0;
  // Reach past the distance the arena uses is worth less, not nothing: the
  // long band is 1 % of shots, and a weapon that covers it still covers it.
  const inside = Math.min(draft.rangeMax, budget.rangeValueCapCells);
  const tail = Math.max(0, draft.rangeMax - budget.rangeValueCapCells);
  cost += (inside + tail * budget.rangeValueTailShare) * budget.rangeWeight;
  cost += draft.critChance * budget.critWeight;
  // A line and a ricochet reach past a wall or a corner. The DPS profile does
  // not hold that, so the budget charges for it here.
  cost += draft.attackType === "line" ? budget.lineWeight : 0;
  cost += draft.ricochetBounces * budget.ricochetWeight;
  cost += draft.ammoMax * budget.ammoWeight;
  cost -= meanReaction * budget.reactionDiscount;
  // The area, the damage over time, and the hazard are inside the DPS profile.
  cost += draft.flatDps * budget.dpsWeight;
  return cost;
}

/** The full cost of a weapon at a damage value. */
export function costOf(draft: WeaponDraft, damage: number, tables: WeaponRoles): number {
  const meanDps = bandMean(draft.perDamageDps, tables) * damage;
  return fixedCost(draft, tables) + meanDps * tables.budget.dpsWeight;
}

/** The full DPS profile of a draft at a damage value. */
export function dpsProfileOf(draft: WeaponDraft, damage: number): BandValues {
  return {
    close: draft.perDamageDps.close * damage + draft.flatDps,
    mid: draft.perDamageDps.mid * damage + draft.flatDps,
    long: draft.perDamageDps.long * damage + draft.flatDps,
  };
}

/** Derive the label of a weapon (Section 7.20.4). The first rule that matches wins. */
export function archetypeOf(role: RoleTrait | null, attackType: AttackType): Archetype {
  if (role === null) return "baseline";
  if (attackType === "tile") return "denial";
  if (attackType === "cone" || attackType === "burst") return "splash";
  if (role === "sniper") return "marksman";
  if (role === "assault") return "assault";
  if (role === "precise") return "precision";
  if (role === "heavy") return "heavy";
  return "versatile";
}

function buildDraft(rng: Rng, role: RoleTrait, tables: WeaponRoles, ticksPerSecond: number): WeaponDraft {
  const roleData = tables.roles[role];
  if (!roleData) throw new Error(`data/weapon-roles.json has no role "${role}"`);
  const attackType = rollWeighted<AttackType>(rng, roleData.attackTypeWeights);
  const attackData = tables.attackTypes[attackType];
  if (!attackData) throw new Error(`data/weapon-roles.json has no attack type "${attackType}"`);
  const { shape } = tables;

  // The attack type shifts the range, the magazine, and the cadence. An area
  // type reaches less far, holds fewer shots, and fires more slowly. Without
  // this the budget pays for an area with damage alone, and an area weapon
  // keeps the range and the magazine of a plain shot.
  const fireIntervalTicks = Math.max(
    1,
    Math.round(rollIntRange(rng, roleData.fireIntervalTicks as Range) * attackData.intervalFactor),
  );
  // A cone takes its own reach factor here, and not at damage time, so that
  // `rangeMax` is the distance the weapon really covers. The AI reads it to
  // decide whether it can fire, and the budget prices it.
  const coneReach = attackType === "cone" ? shape.coneRangeFactor : 1;
  const rangeMax = rollRange(rng, roleData.rangeMax as Range) * attackData.rangeFactor * coneReach;
  const ammoMax = Math.max(
    1,
    Math.round(rollIntRange(rng, roleData.ammoMax as Range) * attackData.ammoFactor),
  );
  const critChance = rollRange(rng, roleData.critChance as Range);

  const aoeRadius =
    attackType === "burst" || attackType === "tile" ? rollRange(rng, shape.aoeRadius as Range) : 0;
  const coneHalfAngle =
    attackType === "cone"
      ? (rollRange(rng, shape.coneHalfAngleDegrees as Range) * Math.PI) / 180
      : 0;
  const ricochetBounces =
    attackType === "ricochet" ? rollIntRange(rng, shape.ricochetBounces as Range) : 0;
  const hazardTicks = attackType === "tile" ? rollIntRange(rng, shape.hazardTicks as Range) : 0;
  const hazardRadius = attackType === "tile" ? rollRange(rng, shape.hazardRadius as Range) : 0;
  const hasDot = rng.bool(shape.dotChance);
  const dotDamage = hasDot ? rollRange(rng, shape.dotDamage as Range) : 0;
  const dotTicks = hasDot ? rollIntRange(rng, shape.dotTicks as Range) : 0;

  const reactionByBand: BandValues = {
    close: rollIntRange(rng, roleData.reactionByBand.close as Range) + attackData.reactionAdd,
    mid: rollIntRange(rng, roleData.reactionByBand.mid as Range) + attackData.reactionAdd,
    long: rollIntRange(rng, roleData.reactionByBand.long as Range) + attackData.reactionAdd,
  };

  const hazardDamagePerTick =
    attackType === "tile" ? rollRange(rng, shape.hazardDamagePerTick as Range) : 0;

  const partial = {
    role,
    attackType,
    fireIntervalTicks,
    rangeMax,
    ammoMax,
    critChance,
    critConditions: [...roleData.critConditions],
    projectileSpeed: isProjectileType(attackType) ? rollRange(rng, shape.projectileSpeed as Range) : null,
    aoeRadius,
    coneHalfAngle,
    ricochetBounces,
    dotDamage,
    dotTicks,
    hazardTicks,
    hazardRadius,
    hazardDamagePerTick,
    ammoPickupShare: rollRange(rng, shape.ammoPickupShare as Range),
    reactionByBand,
  };

  const targets = expectedTargets(partial, tables);
  // A cone fades to nothing at its reach, so a shot that lands delivers only a
  // share of its damage. The DPS profile must hold that, or the AI reads a
  // number that the simulation never pays out.
  const accuracy =
    attackData.accuracyFactor * (attackType === "cone" ? tables.value.coneFadeShare : 1);
  const perDamageDps: BandValues = {
    close: dpsPerDamage("close", roleData.bandMultiplier, attackData.bandMultiplier, fireIntervalTicks, ticksPerSecond, targets, accuracy),
    mid: dpsPerDamage("mid", roleData.bandMultiplier, attackData.bandMultiplier, fireIntervalTicks, ticksPerSecond, targets, accuracy),
    long: dpsPerDamage("long", roleData.bandMultiplier, attackData.bandMultiplier, fireIntervalTicks, ticksPerSecond, targets, accuracy),
  };

  return { ...partial, perDamageDps, flatDps: flatDpsOf(partial, tables, ticksPerSecond) };
}

export interface WeaponTier {
  name: string;
  budgetFactor: number;
  weight: number;
}

export interface GenerateOptions {
  ticksPerSecond?: number;
  tables?: WeaponRoles;
  /** How many drafts to try before it gives up on a role. */
  maxTries?: number;
  /** Force a tier. The set generator uses it to give a run a clear ranking. */
  tier?: WeaponTier;
}

/** Take a tier from the weighted list. */
export function pickTier(rng: Rng, tables: WeaponRoles): WeaponTier {
  const list = tables.tiers.list;
  const total = list.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = rng.float(0, total);
  for (const tier of list) {
    roll -= tier.weight;
    if (roll <= 0) return tier;
  }
  return list[list.length - 1] as WeaponTier;
}

/**
 * Make one weapon of a role, or `null` if no draft of that role fits the
 * budget after `maxTries`.
 *
 * Step 5 of Section 7.3: the damage scales so that the cost lands on the
 * budget target. A draft whose damage would fall outside the range of its role
 * is rejected, which is step 7.
 */
/**
 * Does a weapon beat the fallback that every bot already carries?
 *
 * A weapon on a point of the arena has to be worth the walk (Section 7.12).
 * The baseline reaches every band and never runs dry, so it wins against any
 * weapon that is merely equal: the arena-style batch found the baseline above
 * five of the six generated archetypes, which is not a fallback (Section 7.3).
 *
 * Two of the lines are promises about the shape of a role, not its level:
 *
 * - an **assault** weapon hits harder than the baseline in the band that it is
 *   built for;
 * - a **precise** weapon fires sooner and answers sooner than the baseline.
 */
export function beatsBaseline(
  role: RoleTrait,
  fireIntervalTicks: number,
  reactionByBand: BandValues,
  profile: DpsProfile,
  tables: WeaponRoles,
  baseline: Weapon = loadBaselineWeapon(),
): boolean {
  const { floor } = tables;
  const baseMean = bandMean(baseline.dpsProfile, tables);
  if (bandMean(profile, tables) < baseMean * floor.meanDpsMargin) return false;

  if (role === "assault") {
    const best = Math.max(profile.close, profile.mid, profile.long);
    if (best < baseMean * floor.assaultBestBandMargin) return false;
  }

  if (role === "precise") {
    if (fireIntervalTicks > baseline.fireIntervalTicks * floor.preciseFireIntervalShare) {
      return false;
    }
    for (const band of RANGE_BANDS) {
      if (reactionByBand[band] > baseline.reactionByBand[band] * floor.preciseReactionShare) {
        return false;
      }
    }
  }

  return true;
}

export function generateWeapon(
  rng: Rng,
  role: RoleTrait,
  index: number,
  options: GenerateOptions = {},
): Weapon | null {
  const tables = options.tables ?? loadWeaponRoles();
  const ticksPerSecond = options.ticksPerSecond ?? 20;
  const maxTries = options.maxTries ?? 24;
  const roleData = tables.roles[role];
  if (!roleData) throw new Error(`data/weapon-roles.json has no role "${role}"`);
  const damageRange = roleData.damage as Range;

  // The tier sets the budget of this weapon. A run then holds a clear ranking
  // instead of five weapons of the same power.
  const tier = options.tier ?? pickTier(rng, tables);
  const target = tables.budget.target * tier.budgetFactor;

  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const draft = buildDraft(rng, role, tables, ticksPerSecond);
    const meanPerDamage = bandMean(draft.perDamageDps, tables);
    if (meanPerDamage <= 0) continue;

    // Solve for the damage that puts the cost on the budget of the tier.
    const wanted = (target - fixedCost(draft, tables)) / (meanPerDamage * tables.budget.dpsWeight);
    if (!Number.isFinite(wanted) || wanted < damageRange[0] || wanted > damageRange[1]) continue;

    const damage = Math.round(wanted * 10) / 10;
    const budgetUsed = costOf(draft, damage, tables);
    if (Math.abs(budgetUsed - target) > tables.budget.tolerance) continue;

    // A weapon from the ground has to beat the weapon already in the hands of
    // the bot, or the walk to the point bought nothing (Section 7.3).
    const profile = dpsProfileOf(draft, damage);
    if (!beatsBaseline(role, draft.fireIntervalTicks, draft.reactionByBand, profile, tables)) {
      continue;
    }

    const attackData = tables.attackTypes[draft.attackType];
    const word = attackData?.word ?? "Arm";
    const roleWord = rng.pick(roleData.nameWords);
    return {
      id: `${role}-${draft.attackType}-${index}`,
      // The name generator of Section 7.19 replaces this at M11. TBD
      name: `${roleWord} ${word}`,
      archetype: archetypeOf(role, draft.attackType),
      role,
      tier: tier.name,
      attackType: draft.attackType,
      damage,
      fireIntervalTicks: draft.fireIntervalTicks,
      rangeMax: Math.round(draft.rangeMax * 10) / 10,
      projectileSpeed: draft.projectileSpeed,
      aoeRadius: draft.aoeRadius,
      coneHalfAngle: draft.coneHalfAngle,
      ricochetBounces: draft.ricochetBounces,
      dotDamage: draft.dotDamage,
      dotTicks: draft.dotTicks,
      hazardTicks: draft.hazardTicks,
      hazardRadius: draft.hazardRadius,
      hazardDamagePerTick: draft.hazardDamagePerTick,
      critChance: draft.critChance,
      critConditions: draft.critConditions,
      ammoMax: draft.ammoMax,
      ammoPerPickup: Math.max(1, Math.round(draft.ammoMax * draft.ammoPickupShare)),
      traits: [],
      reactionByBand: draft.reactionByBand,
      dpsProfile: profile,
      budgetUsed,
    };
  }
  return null;
}

/**
 * The weapon set of a run (Section 7.3).
 *
 * The first weapon is the fixed baseline. The others cover the role traits in
 * turn, in a random order, which is the role coverage rule of Section 7.3.
 */
export function generateWeaponSet(rng: Rng, count = 5, options: GenerateOptions = {}): Weapon[] {
  const weapons: Weapon[] = [loadBaselineWeapon()];
  if (count <= 1) return weapons;

  const tables = options.tables ?? loadWeaponRoles();
  const order: RoleTrait[] = [];
  while (order.length < count - 1) order.push(...rng.shuffle(ROLE_TRAITS));

  // A run holds a clear ranking: the best tier one time, the next one time, and
  // the rest at the lowest tier. The player can then build tactics around the
  // best weapon of the run, and a weapon is worth taking or leaving.
  const byFactor = [...tables.tiers.list].sort((a, b) => b.budgetFactor - a.budgetFactor);
  const lowest = byFactor[byFactor.length - 1] as WeaponTier;
  const wanted: WeaponTier[] = [];
  for (let i = 0; i < count - 1; i += 1) wanted.push((byFactor[i] ?? lowest) as WeaponTier);

  for (let index = 0; weapons.length < count; index += 1) {
    const role = order[index % order.length] as RoleTrait;
    const tier = options.tier ?? (wanted[weapons.length - 1] as WeaponTier);
    const weapon = generateWeapon(rng, role, index, { ...options, tier });
    if (weapon !== null) weapons.push(weapon);
    else if (index > count * 40) {
      throw new Error(`Weapon generation could not fill the set of ${count}.`);
    }
  }
  return weapons;
}
