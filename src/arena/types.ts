/**
 * Arena types (dev-guide Section 6.2).
 *
 * `ArenaMap` holds the parts of an arena that a hand-made map file gives:
 * the grid, the spawn cells, and the pickup points. The generator of
 * Milestone M7 adds `seed`, `profile`, `rooms`, `links`, and `metrics` on top
 * of this type.
 */
import type { Cell } from "../core/types.js";
import type { ConflictField } from "./conflict.js";

/** The value of one grid cell. */
export enum Tile {
  Floor = 0,
  Wall = 1,
  CoverLow = 2,
  Hazard = 3,
  Spawn = 4,
  Pickup = 5,
}

export type PickupKind = "weapon" | "armor" | "health" | "powerup" | "ammo";

export interface PickupPoint {
  cell: Cell;
  kind: PickupKind;
  /** The spawn table (Section 7.12) sets the item of a weapon slot. */
  slotId: string;
  respawnTicks: number;
}

export interface ArenaMap {
  /** A name for the reports and the pre-match screen. */
  name: string;
  /** The source of the map. A file path, or the profile id of a generator. */
  source: string;
  width: number;
  height: number;
  /** width × height values of `Tile`, in row-major order. */
  tiles: Uint8Array;
  spawns: Cell[];
  pickups: PickupPoint[];
  /**
   * Where the fight happens and which ground overlooks it (Section 7.35).
   *
   * Measured once when the arena is built, and the first arena measurement that
   * a bot actually reads. Absent on a map that nothing measured, and every
   * reader treats that as zero.
   */
  conflict?: ConflictField;
}

/** The index in `tiles` of one cell. */
export function cellIndex(map: Pick<ArenaMap, "width">, x: number, y: number): number {
  return y * map.width + x;
}

/** True if the cell is inside the grid. */
export function inBounds(map: Pick<ArenaMap, "width" | "height">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** The tile of one cell. A cell outside the grid counts as a wall. */
export function tileAt(map: ArenaMap, x: number, y: number): Tile {
  if (!inBounds(map, x, y)) return Tile.Wall;
  return (map.tiles[cellIndex(map, x, y)] ?? Tile.Wall) as Tile;
}

/**
 * True if a bot can stand on the tile.
 * Low cover does not block movement. This is the value of Section 7.5. TBD
 */
export function isWalkable(tile: Tile): boolean {
  return tile !== Tile.Wall;
}
