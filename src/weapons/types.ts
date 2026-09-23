/**
 * Weapon types (dev-guide Sections 6.3 and 7.20.2 to 7.20.4).
 *
 * A generated weapon starts from a **role trait** and an **attack type**. The
 * generator prices it against the power budget and then derives the
 * **archetype**, which is a label for the player, the reports, and the
 * `weaponRolePref` tactic. The AI reads only the DPS profile (Section 7.8).
 */

/** What shape a weapon has (Section 7.20.2). */
export type RoleTrait = "precise" | "assault" | "sniper" | "heavy";

export const ROLE_TRAITS: readonly RoleTrait[] = ["precise", "assault", "sniper", "heavy"];

/** How a shot reaches its target (Section 7.20.3). */
export type AttackType =
  | "hitscan"
  | "projectile"
  | "cone"
  | "burst"
  | "line"
  | "ricochet"
  | "tile";

export const ATTACK_TYPES: readonly AttackType[] = [
  "hitscan",
  "projectile",
  "cone",
  "burst",
  "line",
  "ricochet",
  "tile",
];

/** The attack types that are not a plain single-target shot. */
export const SPECIAL_ATTACK_TYPES: readonly AttackType[] = [
  "cone",
  "burst",
  "line",
  "ricochet",
  "tile",
];

/** True if the attack type needs a projectile that crosses the arena. */
export function isProjectileType(attackType: AttackType): boolean {
  return attackType === "projectile" || attackType === "burst" || attackType === "ricochet" || attackType === "tile";
}

/** The label of a weapon (Section 7.20.4). */
export type Archetype =
  | "precision"
  | "assault"
  | "marksman"
  | "heavy"
  | "splash"
  | "denial"
  | "versatile"
  | "baseline";

/** The distance bands of a DPS profile and of a kill event. */
export type RangeBand = "close" | "mid" | "long";

export const RANGE_BANDS: readonly RangeBand[] = ["close", "mid", "long"];

/** One number per range band. */
export interface BandValues {
  close: number;
  mid: number;
  long: number;
}

export type DpsProfile = BandValues;

export interface Weapon {
  id: string;
  name: string;
  /** The label that the generator derives (Section 7.20.4). */
  archetype: Archetype;
  /** The role trait that the generator rolled. `null` for the baseline weapon. */
  role: RoleTrait | null;
  /**
   * The power tier: how much budget the weapon spent. A run holds a clear
   * ranking, so the player can build tactics around the best weapon of a run.
   */
  tier: string;
  attackType: AttackType;
  damage: number;
  fireIntervalTicks: number;
  rangeMax: number;
  /** Cells per tick. `null` for an attack type that arrives at once. */
  projectileSpeed: number | null;
  /** 0 = no area damage. */
  aoeRadius: number;
  /** Half the width of a cone, in radians. 0 = not a cone. */
  coneHalfAngle: number;
  /** How many times a `ricochet` shot turns off a wall. */
  ricochetBounces: number;
  /** Damage per tick. 0 = none. */
  dotDamage: number;
  dotTicks: number;
  /** How long a hazard tile lasts. 0 = the weapon makes none. */
  hazardTicks: number;
  /** The radius of the hazard tiles, in cells. */
  hazardRadius: number;
  /** The damage that one hazard tile deals per tick. */
  hazardDamagePerTick: number;
  critChance: number;
  /** For example "targetStationary" or "targetUnaware". */
  critConditions: string[];
  ammoMax: number;
  /** Rounds that one universal ammo pickup gives this weapon. */
  ammoPerPickup: number;
  /** Weapon mutations of Section 7.3. They arrive later. */
  traits: string[];
  /**
   * Ticks between the sight of a target and the shot, per range band
   * (Section 7.20.7). It also sets the order of the bots inside a tick.
   */
  reactionByBand: BandValues;
  dpsProfile: DpsProfile;
  budgetUsed: number;
}

/** The range band of a distance, from the two limits. */
export function bandOfDistance(distance: number, closeMax: number, midMax: number): RangeBand {
  if (distance <= closeMax) return "close";
  if (distance <= midMax) return "mid";
  return "long";
}
