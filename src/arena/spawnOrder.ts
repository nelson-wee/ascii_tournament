/**
 * The order of the spawn cells (dev-guide Section 7.2.1).
 *
 * A team takes a block of the spawn list: team A takes the first `teamSize`
 * cells, team B the next. The slot inside that block gives a bot its role, so
 * the pairing of the slots decides whether the two teams start the same fight.
 *
 * A scan of the map collects the cells from the top left to the bottom right.
 * On an arena with 180-degree rotational symmetry that scan gives the second
 * block in the reverse order of the first: the slot 0 of team B stands where
 * the slot 2 of team A stands, turned around. The arena is then symmetric and
 * the match is not, which measured 5.75 points of win rate on the test arena.
 *
 * So the list is reordered here: the cell of slot i of every later team is the
 * one nearest to the turned-around cell of slot i of the first team. On a
 * symmetric arena that is the exact partner. On any other arena it is the
 * closest thing to it, and nothing breaks.
 */
import type { Cell } from "../core/types.js";

function distance(a: Cell, b: Cell): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Reorder the spawn cells so that the slots of the teams face each other.
 *
 * It keeps every cell, and it keeps the blocks: it only sorts inside a block.
 * With fewer cells than two full teams it gives the list back unchanged.
 */
export function orderSpawnsForFairness(
  spawns: readonly Cell[],
  width: number,
  height: number,
  teamSize: number,
): Cell[] {
  const teams = Math.floor(spawns.length / teamSize);
  if (teamSize < 1 || teams < 2) return [...spawns];

  const ordered = [...spawns];
  const first = ordered.slice(0, teamSize);

  for (let team = 1; team < teams; team += 1) {
    const start = team * teamSize;
    const block = ordered.slice(start, start + teamSize);
    const taken = new Array<boolean>(block.length).fill(false);

    for (const [slot, anchor] of first.entries()) {
      // The cell of the same slot of the first team, turned half a turn.
      const target: Cell = { x: width - 1 - anchor.x, y: height - 1 - anchor.y };
      let bestIndex = -1;
      let bestDistance = Infinity;
      for (const [index, cell] of block.entries()) {
        if (taken[index]) continue;
        const value = distance(cell, target);
        if (value < bestDistance) {
          bestDistance = value;
          bestIndex = index;
        }
      }
      if (bestIndex < 0) break;
      taken[bestIndex] = true;
      ordered[start + slot] = block[bestIndex] as Cell;
    }
  }

  return ordered;
}
