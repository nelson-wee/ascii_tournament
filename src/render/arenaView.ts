/**
 * The bridge from the simulation to the neon grid (dev-guide Section 7.18).
 * Browser only, because it lives beside the display.
 *
 * The grid and the VFX layer know cells, colors and times. They know nothing
 * about a bot, a weapon or a pickup point. This file is the one place that
 * reads the state of a round and gives the display what it draws, so the look
 * and the simulation stay apart (Section 4.1).
 */
import { Tile, cellIndex, type ArenaMap } from "../arena/types.js";
import type { PickupKind, TileKind } from "./neonThemes.js";
import type { ArenaView, GridBot, GridShot } from "./neonGrid.js";
import { readyPickupCells, type SimState } from "../sim/index.js";
import { facingChar } from "./theme.js";

/** The map tile to the kind of cell that the palette holds a color for. */
const TILE_KINDS: Readonly<Record<Tile, TileKind>> = {
  [Tile.Floor]: "floor",
  [Tile.Wall]: "wall",
  [Tile.CoverLow]: "cover",
  [Tile.Hazard]: "hazard",
  [Tile.Spawn]: "spawn",
  // A pickup point with no item on it is floor. An empty pad that keeps its
  // glyph reads as a live item, and a viewer cannot read the arena
  // (Section 0.4 of the M8 weapon analysis).
  [Tile.Pickup]: "floor",
};

/** A jump longer than this is a respawn, not a step. The bot does not glide. */
const TELEPORT_CELLS = 2;

const REDEEMER_SHOT: Pick<GridShot, "glyph" | "color"> = { glyph: "☢", color: "#ff7a4a" };
const PLAIN_SHOT: Pick<GridShot, "glyph" | "color"> = { glyph: "•", color: "#e0d49a" };

export interface SimArenaViewOptions {
  /** True when a bot shows the way that it looks (Section 7.20.6). */
  directional: boolean;
}

/**
 * A view over one round.
 *
 * `interp` is what makes the bots glide. The simulation steps 20 times a
 * second and the display draws 60 times, so a bot that is drawn on its cell
 * alone steps and waits. The runner gives the share of the tick that has run,
 * and the grid draws the bot between its last cell and its cell now.
 */
export class SimArenaView implements ArenaView {
  interp = 0;
  private state: SimState | null = null;
  private map: ArenaMap | null = null;
  private readonly previous = new Map<string, { x: number; y: number }>();
  private ready: ReadonlySet<number> = new Set<number>();

  constructor(private readonly options: SimArenaViewOptions) {}

  /** Follow a new round. The last cells of the bots start at their cells now. */
  setState(state: SimState | null): void {
    this.state = state;
    this.map = state?.map ?? null;
    this.previous.clear();
    if (state) {
      for (const bot of state.bots) this.previous.set(bot.id, this.cellOf(bot.pos));
      this.ready = readyPickupCells(state);
    } else {
      this.ready = new Set<number>();
    }
    this.interp = 0;
  }

  /**
   * Hold the cells of the bots before the simulation steps.
   * The runner calls it, and then it calls `step`.
   */
  beginTick(): void {
    const { state } = this;
    if (!state) return;
    for (const bot of state.bots) this.previous.set(bot.id, this.cellOf(bot.pos));
  }

  /** Read the pickup points again. The runner calls it after a tick. */
  endTick(): void {
    if (this.state) this.ready = readyPickupCells(this.state);
  }

  get width(): number {
    return this.map?.width ?? 1;
  }

  get height(): number {
    return this.map?.height ?? 1;
  }

  tileAt(x: number, y: number): TileKind {
    const { map } = this;
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return "wall";
    const index = cellIndex(map, x, y);
    // A hazard that a weapon made covers the tile below it (Section 7.6).
    if (this.state?.hazards.has(index) === true) return "hazard";
    const tile = (map.tiles[index] ?? Tile.Wall) as Tile;
    return TILE_KINDS[tile] ?? "floor";
  }

  pickups(): { x: number; y: number; kind: PickupKind }[] {
    const { map } = this;
    if (!map) return [];
    const out: { x: number; y: number; kind: PickupKind }[] = [];
    for (const point of map.pickups) {
      if (!this.ready.has(cellIndex(map, point.cell.x, point.cell.y))) continue;
      out.push({ x: point.cell.x, y: point.cell.y, kind: point.kind });
    }
    return out;
  }

  bots(): GridBot[] {
    const { state } = this;
    if (!state) return [];
    const full = Math.max(1, state.config.healthMax);
    return state.bots.map((bot) => {
      const now = this.cellOf(bot.pos);
      const last = this.previous.get(bot.id) ?? now;
      const jumped = Math.abs(now.x - last.x) > TELEPORT_CELLS || Math.abs(now.y - last.y) > TELEPORT_CELLS;
      const from = jumped ? now : last;
      return {
        id: bot.id,
        teamId: bot.teamId === "B" ? "B" : "A",
        hp01: bot.health / full,
        x: now.x,
        y: now.y,
        prevX: from.x,
        prevY: from.y,
        alive: bot.alive,
        glyph: this.options.directional ? facingChar(bot.facing) : "@",
      };
    });
  }

  shots(): GridShot[] {
    const { state } = this;
    if (!state) return [];
    return state.projectiles.map((shot) => {
      const style = shot.weapon.archetype === "redeemer" ? REDEEMER_SHOT : PLAIN_SHOT;
      return { x: shot.pos.x - 0.5, y: shot.pos.y - 0.5, ...style };
    });
  }

  /** The cell of a bot, as a fractional grid coordinate. */
  cellOfBot(botId: string): { x: number; y: number } | null {
    const bot = this.state?.bots.find((candidate) => candidate.id === botId);
    if (!bot) return null;
    return this.cellOf(bot.pos);
  }

  /** The cell of a shot that is in the air. The interception VFX reads it. */
  cellOfProjectile(projectileId: number): { x: number; y: number } | null {
    const shot = this.state?.projectiles.find((candidate) => candidate.id === projectileId);
    if (!shot) return null;
    return { x: shot.pos.x - 0.5, y: shot.pos.y - 0.5 };
  }

  /** The team of a bot, or null if the id is not a bot of this round. */
  teamOfBot(botId: string): "A" | "B" | null {
    const bot = this.state?.bots.find((candidate) => candidate.id === botId);
    if (!bot) return null;
    return bot.teamId === "B" ? "B" : "A";
  }

  /**
   * The grid coordinate of a position of the simulation.
   * The centre of cell (x, y) is (x + 0.5, y + 0.5), so the grid takes half a
   * cell off: the display puts a glyph at the centre of its own cell.
   */
  private cellOf(pos: { x: number; y: number }): { x: number; y: number } {
    return { x: pos.x - 0.5, y: pos.y - 0.5 };
  }
}

/** The cell of a `Death` or `Spawn` event, which carries a whole cell. */
export function eventCell(value: unknown): { x: number; y: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const cell = value as { x?: unknown; y?: unknown };
  if (typeof cell.x !== "number" || typeof cell.y !== "number") return null;
  return { x: cell.x, y: cell.y };
}
