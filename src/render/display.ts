/**
 * The arena display (dev-guide Section 7.18). Browser only.
 *
 * Milestone M1 draws a static map. The arena fills the space that it gets: the
 * display calculates the font size from the size of the container, so the same
 * arena fits a desktop screen and a phone screen. The target grid size for each
 * device is an open decision (Section 2.3). The decision comes before M7.
 */
import { Display } from "rot-js";
import { Tile, cellIndex, type ArenaMap, type PickupKind } from "../arena/types.js";
import type { Cell } from "../core/types.js";
import { DISPLAY_BG, PICKUP_STYLES, TILE_STYLES, type GlyphStyle } from "./theme.js";

/** One thing that the display draws on top of a tile, for example a bot. */
export interface EntityGlyph {
  cell: Cell;
  style: GlyphStyle;
}

export interface ArenaDisplayOptions {
  minFontSize?: number;
  maxFontSize?: number;
  fontFamily?: string;
}

const DEFAULTS = {
  minFontSize: 5,
  maxFontSize: 26,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export class ArenaDisplay {
  private readonly display: Display;
  private readonly canvas: HTMLElement;
  private readonly options: Required<ArenaDisplayOptions>;
  private readonly pickupByIndex = new Map<number, PickupKind>();
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private entities: readonly EntityGlyph[] = [];
  private entityCells: number[] = [];

  constructor(
    private readonly container: HTMLElement,
    private map: ArenaMap,
    options: ArenaDisplayOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.display = new Display({
      width: map.width,
      height: map.height,
      fontSize: this.options.maxFontSize,
      fontFamily: this.options.fontFamily,
      forceSquareRatio: false,
      bg: DISPLAY_BG,
    });
    this.canvas = this.display.getContainer() as HTMLElement;
    this.canvas.style.display = "block";
    this.canvas.style.margin = "0 auto";
    this.container.append(this.canvas);
    this.indexPickups();

    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.scheduleFit());
      this.observer.observe(this.container);
    }
    this.fit();
  }

  /** Replace the map and redraw. */
  setMap(map: ArenaMap): void {
    this.map = map;
    this.display.setOptions({ width: map.width, height: map.height });
    this.indexPickups();
    this.entities = [];
    this.entityCells = [];
    this.fit();
  }

  /**
   * Replace the things that the display draws on top of the tiles.
   *
   * The display redraws the cells of the last list and then the cells of the
   * new list. It does not redraw the full map, because a tick changes only a
   * few cells.
   */
  setEntities(entities: readonly EntityGlyph[]): void {
    for (const index of this.entityCells) {
      this.drawTile(index % this.map.width, Math.floor(index / this.map.width));
    }
    this.entities = entities;
    this.entityCells = [];
    this.drawEntities();
  }

  /** The canvas element of the display. */
  get element(): HTMLElement {
    return this.canvas;
  }

  /** Set the font size to the largest size that fits the container, then draw. */
  fit(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const wanted = this.display.computeFontSize(width, height);
    const fontSize = Math.max(
      this.options.minFontSize,
      Math.min(this.options.maxFontSize, Math.floor(wanted)),
    );
    if (this.display.getOptions().fontSize !== fontSize) {
      this.display.setOptions({ fontSize });
    }
    this.draw();
  }

  /** Draw every cell of the map, and then the entities. */
  draw(): void {
    const { map } = this;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) this.drawTile(x, y);
    }
    this.entityCells = [];
    this.drawEntities();
  }

  private drawTile(x: number, y: number): void {
    const style = this.styleAt(x, y);
    this.display.draw(x, y, style.char, style.fg, style.bg === "" ? DISPLAY_BG : style.bg);
  }

  private drawEntities(): void {
    for (const entity of this.entities) {
      const { x, y } = entity.cell;
      if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) continue;
      const { style } = entity;
      const bg = style.bg === "" ? DISPLAY_BG : style.bg;
      this.display.draw(x, y, style.char, style.fg, bg);
      this.entityCells.push(cellIndex(this.map, x, y));
    }
  }

  /** Stop watching the container and remove the canvas. */
  destroy(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.canvas.remove();
  }

  private styleAt(x: number, y: number): GlyphStyle {
    const tile = (this.map.tiles[cellIndex(this.map, x, y)] ?? Tile.Wall) as Tile;
    if (tile === Tile.Pickup) {
      const kind = this.pickupByIndex.get(cellIndex(this.map, x, y));
      if (kind !== undefined) return PICKUP_STYLES[kind];
    }
    return TILE_STYLES[tile] ?? TILE_STYLES[Tile.Wall];
  }

  private indexPickups(): void {
    this.pickupByIndex.clear();
    for (const pickup of this.map.pickups) {
      this.pickupByIndex.set(cellIndex(this.map, pickup.cell.x, pickup.cell.y), pickup.kind);
    }
  }

  /** Fit one time per animation frame. A resize can fire many times. */
  private scheduleFit(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.fit();
    });
  }
}
