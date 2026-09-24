/**
 * The arena stage (dev-guide Section 7.18). Browser only.
 *
 * Two canvases lie one on the other, at the same size and on the same grid:
 *
 *   grid canvas  walls, floor, hazards, pickups, shots, bots
 *   vfx canvas   tracers, beams, blasts, sparks, gore
 *
 * One animation frame drives both. The VFX canvas takes the shake of a blast
 * and the grid canvas does not, so the effects jolt and the map holds still.
 *
 * The stage sizes the cells from the container, so the same arena fills a
 * desktop screen and a phone screen (Section 2.3). Every value that the two
 * canvases share — the cell size in device pixels — comes from here.
 */
import { NeonGrid, type ArenaView, type WallFill } from "./neonGrid.js";
import { DEFAULT_THEME, INTENSITY, type NeonTheme } from "./neonThemes.js";
import { VfxLayer } from "./vfxLayer.js";

export interface NeonStageOptions {
  /** The shape of a cell. The glyph sizes were chosen against 20 by 22. */
  cellAspect?: number;
  minCellH?: number;
  maxCellH?: number;
  font?: string;
  scanlines?: boolean;
  intensity?: number;
  seed?: number | string;
  /** How much of the ground takes the contrast hue of the palette. */
  wallFill?: WallFill;
}

const DEFAULTS = {
  cellAspect: 20 / 22,
  minCellH: 6,
  maxCellH: 30,
  font: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  scanlines: true,
  intensity: INTENSITY.punchy,
  wallFill: "mass",
} as const;

export class NeonStage {
  private readonly root: HTMLElement;
  private readonly gridCanvas: HTMLCanvasElement;
  private readonly vfxCanvas: HTMLCanvasElement;
  private readonly grid: NeonGrid;
  readonly vfx: VfxLayer;
  private readonly options: Required<Omit<NeonStageOptions, "seed">>;
  private observer: ResizeObserver | null = null;
  private pending = 0;
  private theme: NeonTheme = DEFAULT_THEME;
  private intensityValue: number;
  private cols = 1;
  private rows = 1;
  /** The size of one cell in device pixels. Both canvases use it. */
  private cellW = 20;
  private cellH = 22;

  constructor(
    private readonly container: HTMLElement,
    options: NeonStageOptions = {},
  ) {
    this.options = {
      cellAspect: options.cellAspect ?? DEFAULTS.cellAspect,
      minCellH: options.minCellH ?? DEFAULTS.minCellH,
      maxCellH: options.maxCellH ?? DEFAULTS.maxCellH,
      font: options.font ?? DEFAULTS.font,
      scanlines: options.scanlines ?? DEFAULTS.scanlines,
      intensity: options.intensity ?? DEFAULTS.intensity,
      wallFill: options.wallFill ?? DEFAULTS.wallFill,
    };
    this.intensityValue = this.options.intensity;

    this.root = document.createElement("div");
    this.root.className = "neon-stage";
    this.gridCanvas = document.createElement("canvas");
    this.gridCanvas.className = "neon-grid";
    this.vfxCanvas = document.createElement("canvas");
    this.vfxCanvas.className = "neon-vfx";
    this.root.append(this.gridCanvas, this.vfxCanvas);
    this.container.append(this.root);

    this.grid = new NeonGrid(this.gridCanvas, {
      cellW: this.cellW,
      cellH: this.cellH,
      font: this.options.font,
      scanlines: this.options.scanlines,
      wallFill: this.options.wallFill,
    });
    this.vfx = new VfxLayer(this.vfxCanvas, {
      cellW: this.cellW,
      cellH: this.cellH,
      font: this.options.font,
      theme: () => this.theme,
      intensity: () => this.intensityValue,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    });

    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.scheduleFit());
      this.observer.observe(this.container);
    }
  }

  /** The palette of the match. */
  setTheme(theme: NeonTheme): void {
    this.theme = theme;
    this.root.style.setProperty("--neon-bg", theme.bg);
    this.root.style.setProperty("--neon-a", theme.teamA);
    this.root.style.setProperty("--neon-b", theme.teamB);
  }

  getTheme(): NeonTheme {
    return this.theme;
  }

  setIntensity(value: number): void {
    this.intensityValue = value;
  }

  setWallFill(fill: WallFill): void {
    this.grid.setWallFill(fill);
  }

  /** Set the size of the grid in cells, and fit the canvases to it. */
  setSize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.vfx.clear();
    // A new arena means a new shape, so the pocket mask of the last one goes.
    this.grid.invalidate();
    this.fit();
  }

  /** The canvas that holds the grid. The tests and the layout read it. */
  get element(): HTMLElement {
    return this.root;
  }

  /** Size the two canvases to the largest cell that the container holds. */
  fit(): void {
    const ratio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const boxW = Math.max(1, this.container.clientWidth);
    const boxH = Math.max(1, this.container.clientHeight);
    const byHeight = boxH / this.rows;
    const byWidth = boxW / this.cols / this.options.cellAspect;
    const cssCellH = Math.max(
      this.options.minCellH,
      Math.min(this.options.maxCellH, Math.floor(Math.min(byHeight, byWidth))),
    );
    this.cellH = Math.max(1, Math.round(cssCellH * ratio));
    this.cellW = Math.max(1, Math.round(cssCellH * this.options.cellAspect * ratio));

    const pw = this.cols * this.cellW;
    const ph = this.rows * this.cellH;
    for (const canvas of [this.gridCanvas, this.vfxCanvas]) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${pw / ratio}px`;
      canvas.style.height = `${ph / ratio}px`;
    }
    this.grid.setCellSize(this.cellW, this.cellH);
    this.vfx.setCellSize(this.cellW, this.cellH);
  }

  /** Draw one frame: the grid first, then the effects on top. */
  draw(view: ArenaView, now: number, dtMs: number): void {
    if (view.width !== this.cols || view.height !== this.rows) {
      this.setSize(view.width, view.height);
    }
    this.grid.draw(view, this.theme, now);
    this.vfx.frame(dtMs);
  }

  destroy(): void {
    if (this.pending !== 0) cancelAnimationFrame(this.pending);
    this.pending = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.root.remove();
  }

  /** Fit one time per animation frame. A resize can fire many times. */
  private scheduleFit(): void {
    if (this.pending !== 0) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.fit();
    });
  }
}
