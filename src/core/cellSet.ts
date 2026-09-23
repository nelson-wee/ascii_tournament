/**
 * A set of grid cell indices with no allocation.
 *
 * Perception fills a set of visible cells for every bot on every tick. A
 * `Set<number>` allocates on each `add`, and the simulation then spends most
 * of its time in the garbage collector. This class keeps one array of stamps:
 * `clear` raises the current stamp, so it costs one step and not one step per
 * cell.
 */
export class CellSet {
  private readonly stamps: Uint32Array;
  private current = 1;
  private count = 0;

  constructor(readonly capacity: number) {
    this.stamps = new Uint32Array(capacity);
  }

  /** The number of cells in the set. */
  get size(): number {
    return this.count;
  }

  /** Remove every cell. */
  clear(): void {
    this.count = 0;
    this.current += 1;
    if (this.current === 0xffffffff) {
      this.stamps.fill(0);
      this.current = 1;
    }
  }

  add(index: number): void {
    if (index < 0 || index >= this.capacity || this.stamps[index] === this.current) return;
    this.stamps[index] = this.current;
    this.count += 1;
  }

  has(index: number): boolean {
    return index >= 0 && index < this.capacity && this.stamps[index] === this.current;
  }
}
