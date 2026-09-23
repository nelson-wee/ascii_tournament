/**
 * The glyphs that do not belong to a palette (dev-guide Section 7.18).
 *
 * The colors live in `render/neonThemes.ts`, which holds one palette per
 * match. What is left here is the shape of a glyph, which does not change with
 * the palette.
 */

/**
 * The glyph of a bot by the way that it looks (Section 7.20.6).
 * The index is the octant of the facing angle, starting at +x and turning
 * toward +y.
 */
export const FACING_CHARS = [
  "→",
  "↘",
  "↓",
  "↙",
  "←",
  "↖",
  "↑",
  "↗",
] as const;

/** The glyph for a facing in radians. */
export function facingChar(facing: number): string {
  const turn = Math.PI * 2;
  const octant = Math.round((((facing % turn) + turn) % turn) / (turn / 8)) % 8;
  return FACING_CHARS[octant] ?? "@";
}
