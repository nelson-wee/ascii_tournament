/**
 * Does one cell see another? (dev-guide Section 7.35.2)
 *
 * The rule the simulation shoots by, stated once for the arena layer. `clearLine`
 * in `sim/attacks.ts` answers the same question for two positions mid-flight;
 * this one answers it for two cells on the grid, which is what a measurement of
 * the ground needs.
 *
 * Only a wall blocks. Low cover is a shooting position, not a screen
 * (Section 7.32.3).
 *
 * **The walk is integer arithmetic, and that is the whole point.** The first
 * version sampled with floats and took `Math.floor`, and it was not symmetric
 * under the half turn that every arena is built with: a sample that lands
 * exactly on a cell boundary floors one way going left and the other way going
 * right. That put 90 to 340 cells of every arena at a different conflict score
 * from their own mirror image, by as much as 0.059, which is a side bias with
 * extra steps.
 */
import { Tile, tileAt, type ArenaMap } from "./types.js";
import type { Cell } from "../core/types.js";

/**
 * The cell or cells a sample touches, as an exact rational `n / den`.
 *
 * A sample that lands inside a cell touches that one cell. A sample that lands
 * exactly on the boundary touches **both** neighbours, and the line counts as
 * blocked if either is a wall. That rule is symmetric: the pair of cells either
 * side of a boundary maps to the pair either side of the mirrored boundary, so
 * the two directions cannot disagree.
 */
function touchesWall(map: ArenaMap, nx: number, ny: number, den: number): boolean {
  const qx = Math.floor(nx / den);
  const qy = Math.floor(ny / den);
  const onX = nx % den === 0;
  const onY = ny % den === 0;
  for (const x of onX ? [qx - 1, qx] : [qx]) {
    for (const y of onY ? [qy - 1, qy] : [qy]) {
      if (tileAt(map, x, y) === Tile.Wall) return true;
    }
  }
  return false;
}

/**
 * True when nothing blocks the straight line between two cell centres.
 *
 * It walks at two samples a cell, the rate `clearLine` uses, so what this counts
 * as visible is what a weapon can shoot along.
 */
export function cellSeesCell(map: ArenaMap, from: Cell, to: Cell): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.ceil(Math.hypot(dx, dy) * 2);
  if (steps <= 1) return true;

  // The sample at step `i` sits at `(2 * from + 1) * steps + 2 * d * i` over
  // `2 * steps`. Every term is an integer, so mirroring the two cells negates
  // the numerator exactly and the walk reads the mirrored cells exactly.
  const den = 2 * steps;
  const baseX = (2 * from.x + 1) * steps;
  const baseY = (2 * from.y + 1) * steps;
  for (let i = 1; i < steps; i += 1) {
    if (touchesWall(map, baseX + 2 * dx * i, baseY + 2 * dy * i, den)) return false;
  }
  return true;
}
