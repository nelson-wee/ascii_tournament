/**
 * Weapon types (dev-guide Section 6.3).
 *
 * Milestone M3 loads one fixed baseline weapon from a data file. The generator,
 * the power budget, the weapon traits, and the calculated DPS profile arrive
 * with Milestone M6.
 */

export type Archetype =
  | "precision"
  | "splash"
  | "burst"
  | "denial"
  | "versatile"
  | "baseline";

export type Delivery = "hitscan" | "projectile";

/** The distance bands of a DPS profile and of a kill event. */
export type RangeBand = "close" | "mid" | "long";

export interface DpsProfile {
  close: number;
  mid: number;
  long: number;
}

export interface Weapon {
  id: string;
  name: string;
  archetype: Archetype;
  delivery: Delivery;
  damage: number;
  fireIntervalTicks: number;
  rangeMax: number;
  projectileSpeed: number | null;
  /** 0 = no area damage. */
  aoeRadius: number;
  /** Damage per tick. 0 = none. */
  dotDamage: number;
  dotTicks: number;
  /** Persistent hazard tiles. 0 = none. */
  hazardTicks: number;
  critChance: number;
  /** For example "targetStationary" or "targetUnaware". */
  critConditions: string[];
  ammoMax: number;
  /** Weapon mutations. M6 adds them. */
  traits: string[];
  dpsProfile: DpsProfile;
  budgetUsed: number;
}
