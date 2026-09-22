/**
 * Core geometry types (dev-guide Section 6.1).
 * Types of a later system arrive with that system's milestone.
 */

/** A grid position. */
export interface Cell {
  x: number;
  y: number;
}

/** A sub-cell position. Movement and projectiles use it. */
export interface Vec2 {
  x: number;
  y: number;
}
