/**
 * The neon glyph grid (dev-guide Section 7.18). Browser only.
 *
 * The grid reads an `ArenaView`. It imports nothing from the simulation, so a
 * change in the simulation cannot break the look, and a change in the look
 * cannot change a match (Section 4.1).
 *
 * The grid repaints every cell every frame. At 60x30 that is cheap. Do not
 * make it clever before a measurement asks for it.
 *
 * Where the glow goes:
 * - Walls are most of the glyphs, so they get no glow at all. Only a wall face
 *   that touches open space is drawn lit. That one rule is what makes the map
 *   read as neon tube, and it holds the cost of a frame flat.
 * - A thing that moves glows: a bot, a pickup, a hazard, a shot.
 */
import {
  PICKUP_GLYPHS,
  type NeonTheme,
  type PickupKind,
  type TileKind,
} from "./neonThemes.js";

export interface GridBot {
  id: string;
  teamId: "A" | "B";
  /** Health over full health, 0 to 1. */
  hp01: number;
  /** The cell now. */
  x: number;
  y: number;
  /** The cell at the start of the tick. The draw reads it for the glide. */
  prevX: number;
  prevY: number;
  alive: boolean;
  /** The glyph of the bot. The caller passes a facing arrow if it has one. */
  glyph?: string | undefined;
}

/** A shot that is crossing the arena now. It is not a VFX effect. */
export interface GridShot {
  x: number;
  y: number;
  glyph: string;
  color: string;
}

export interface ArenaView {
  width: number;
  height: number;
  tileAt(x: number, y: number): TileKind;
  pickups(): { x: number; y: number; kind: PickupKind }[];
  bots(): GridBot[];
  shots(): GridShot[];
  /** How far the frame is through the current tick, 0 to 1. */
  interp: number;
}

/**
 * How much of the ground takes the contrast hue of the palette.
 *
 * `off` leaves the geometry as it was. `mass` paints the wall inside a block,
 * `pockets` paints the floor that no bot can reach, and `both` does the two.
 */
export type WallFill = "off" | "mass" | "pockets" | "both";

export interface GridOptions {
  cellW: number;
  cellH: number;
  font?: string;
  scanlines?: boolean;
  wallFill?: WallFill;
}

/** The cell height that the glyph sizes below were chosen against. */
const BASE_CELL_H = 22;

export class NeonGrid {
  private readonly ctx: CanvasRenderingContext2D;
  private cw: number;
  private ch: number;
  private fontFamily: string;
  private scanlines: boolean;
  private wallFill: WallFill;
  /** Which floor cells no bot can reach. It is built one time per arena. */
  private pocketMask: Uint8Array | null = null;
  private maskWidth = 0;
  private maskHeight = 0;

  constructor(canvas: HTMLCanvasElement, options: GridOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("NeonGrid: the canvas gave no 2d context");
    this.ctx = ctx;
    this.cw = options.cellW;
    this.ch = options.cellH;
    this.fontFamily = options.font ?? "'JetBrains Mono', ui-monospace, monospace";
    this.scanlines = options.scanlines ?? true;
    this.wallFill = options.wallFill ?? "mass";
  }

  setWallFill(fill: WallFill): void {
    this.wallFill = fill;
  }

  /**
   * Forget the pocket mask. Call it when the arena changes.
   *
   * A hazard tile does not need this: a hazard is ground that a bot can walk
   * on, so it belongs to the same region that it belonged to before.
   */
  invalidate(): void {
    this.pocketMask = null;
  }

  /**
   * Which cells belong to a part of the floor that is sealed off.
   *
   * A flood fill over every cell that is not a wall. The largest region is the
   * arena; anything else is a pocket that no bot reaches. It costs one pass
   * over the grid, and the answer holds until the arena changes.
   */
  private pockets(view: ArenaView): Uint8Array {
    const { width, height } = view;
    if (this.pocketMask !== null && this.maskWidth === width && this.maskHeight === height) {
      return this.pocketMask;
    }
    const total = width * height;
    const region = new Int32Array(total).fill(-1);
    const sizes: number[] = [];
    const queue = new Int32Array(total);

    for (let start = 0; start < total; start += 1) {
      if (region[start] !== -1) continue;
      const sx = start % width;
      const sy = (start - sx) / width;
      if (view.tileAt(sx, sy) === "wall") continue;

      const label = sizes.length;
      let head = 0;
      let tail = 0;
      queue[tail] = start;
      tail += 1;
      region[start] = label;
      let size = 0;
      while (head < tail) {
        const index = queue[head] as number;
        head += 1;
        size += 1;
        const x = index % width;
        const y = (index - x) / width;
        const steps: [number, number][] = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];
        for (const [nx, ny] of steps) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (region[next] !== -1) continue;
          if (view.tileAt(nx, ny) === "wall") continue;
          region[next] = label;
          queue[tail] = next;
          tail += 1;
        }
      }
      sizes.push(size);
    }

    let main = -1;
    let best = -1;
    for (const [label, size] of sizes.entries()) {
      if (size > best) {
        best = size;
        main = label;
      }
    }

    const mask = new Uint8Array(total);
    for (let index = 0; index < total; index += 1) {
      const label = region[index] as number;
      mask[index] = label >= 0 && label !== main ? 1 : 0;
    }
    this.pocketMask = mask;
    this.maskWidth = width;
    this.maskHeight = height;
    return mask;
  }

  setCellSize(cellW: number, cellH: number): void {
    this.cw = cellW;
    this.ch = cellH;
  }

  setFont(font: string): void {
    this.fontFamily = font;
  }

  setScanlines(on: boolean): void {
    this.scanlines = on;
  }

  private px(x: number): number {
    return x * this.cw + this.cw / 2;
  }

  private py(y: number): number {
    return y * this.ch + this.ch / 2;
  }

  /** A glyph size that follows the cell size, so a phone gets the same look. */
  private font(size: number): string {
    return `${Math.max(6, size * (this.ch / BASE_CELL_H))}px ${this.fontFamily}`;
  }

  /** @param now Monotonic ms. It drives the hazard and pickup animation. */
  draw(view: ArenaView, theme: NeonTheme, now: number): void {
    const { ctx } = this;
    const { width, height } = view;
    const pw = width * this.cw;
    const ph = height * this.ch;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, pw, ph);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;

    // The contrast hue of the palette, for the ground alone. The alpha stays
    // low on purpose: the hue carries the read, and a stronger fill makes a
    // bot hard to follow.
    const contrast = theme.contrast ?? theme.hazard;
    const fillMass = this.wallFill === "mass" || this.wallFill === "both";
    const fillPockets = this.wallFill === "pockets" || this.wallFill === "both";
    const pockets = fillPockets ? this.pockets(view) : null;

    ctx.font = this.font(17);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (view.tileAt(x, y) !== "wall") continue;
        const exposed =
          view.tileAt(x, y - 1) !== "wall" ||
          view.tileAt(x, y + 1) !== "wall" ||
          view.tileAt(x - 1, y) !== "wall" ||
          view.tileAt(x + 1, y) !== "wall";

        if (!exposed && fillMass) {
          // The wall inside a block: it is the shape of the arena, and it is
          // the one place a second hue can go without hiding anything.
          ctx.globalAlpha = 0.17;
          ctx.fillStyle = contrast;
          ctx.fillRect(x * this.cw, y * this.ch, this.cw, this.ch);
          ctx.globalAlpha = 0.5;
          ctx.fillText("\u2593", this.px(x), this.py(y));
          ctx.globalAlpha = 1;
          continue;
        }

        ctx.fillStyle = theme.wallBg;
        ctx.fillRect(x * this.cw, y * this.ch, this.cw, this.ch);
        ctx.fillStyle = exposed ? theme.wallLit : theme.wall;
        ctx.globalAlpha = exposed ? 0.95 : 0.32;
        ctx.fillText("#", this.px(x), this.py(y));
        ctx.globalAlpha = 1;
      }
    }

    // Floor that no bot can reach. It reads as part of the geometry, not as
    // ground to fight over.
    if (pockets !== null) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (pockets[y * width + x] !== 1) continue;
          ctx.globalAlpha = 0.13;
          ctx.fillStyle = contrast;
          ctx.fillRect(x * this.cw, y * this.ch, this.cw, this.ch);
          ctx.globalAlpha = 0.55;
          ctx.fillText("\u2592", this.px(x), this.py(y));
          ctx.globalAlpha = 1;
        }
      }
    }

    // The grain of the floor, the cover, and the spawn pads. The floor grain
    // is low, but not absent: without it the arena reads as empty, and above
    // this it takes attention away from the bots.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = view.tileAt(x, y);
        if (tile === "wall" || tile === "hazard") continue;
        // A sealed pocket was already drawn, in the contrast hue.
        if (pockets !== null && pockets[y * width + x] === 1) continue;
        if (tile === "floor") {
          ctx.fillStyle = theme.floorChar;
          ctx.globalAlpha = 0.55;
          ctx.fillText("·", this.px(x), this.py(y));
        } else if (tile === "cover") {
          ctx.fillStyle = theme.cover;
          ctx.globalAlpha = 0.85;
          ctx.fillText("▖", this.px(x), this.py(y));
        } else if (tile === "spawn") {
          ctx.fillStyle = theme.spawn;
          ctx.globalAlpha = 0.6;
          ctx.fillText("○", this.px(x), this.py(y));
        }
        ctx.globalAlpha = 1;
      }
    }

    // Hazards. Each cell has a phase of its own, so a pool does not pulse in
    // one beat, which reads as a flashing block and not as a liquid.
    ctx.shadowColor = theme.hazard;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (view.tileAt(x, y) !== "hazard") continue;
        const phase = Math.sin(now / 260 + x * 0.7 + y * 1.1) * 0.5 + 0.5;
        ctx.fillStyle = theme.hazardBg;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x * this.cw, y * this.ch, this.cw, this.ch);
        ctx.globalAlpha = 0.5 + phase * 0.5;
        ctx.shadowBlur = 4 + phase * 9;
        ctx.fillStyle = theme.hazard;
        ctx.fillText(
          phase > 0.62 ? "≋" : "≈",
          this.px(x),
          this.py(y) + (phase - 0.5) * 1.6,
        );
        ctx.globalAlpha = 1;
      }
    }
    ctx.shadowBlur = 0;

    for (const pickup of view.pickups()) {
      const style = PICKUP_GLYPHS[pickup.kind] ?? PICKUP_GLYPHS.ammo;
      const pulse = Math.sin(now / 420 + pickup.x * 0.4 + pickup.y * 0.9) * 0.5 + 0.5;
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 5 + pulse * 8;
      ctx.fillStyle = style.color;
      ctx.font = this.font(pickup.kind === "ammo" ? 13 : 16);
      ctx.fillText(style.ch, this.px(pickup.x), this.py(pickup.y));
    }
    ctx.shadowBlur = 0;

    // A shot that is in the air goes under the bots. A Redeemer is a decision
    // for the other team, so a viewer has to see it coming (Section 7.20.18).
    ctx.font = this.font(15);
    for (const shot of view.shots()) {
      ctx.shadowColor = shot.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = shot.color;
      ctx.fillText(shot.glyph, this.px(shot.x), this.py(shot.y));
    }
    ctx.shadowBlur = 0;

    ctx.font = this.font(17);
    for (const bot of view.bots()) {
      if (!bot.alive) continue;
      const color = bot.teamId === "B" ? theme.teamB : theme.teamA;
      // The simulation steps 20 times a second and the display draws 60 times.
      // Without this the bots step from cell to cell and the eye reads a stall.
      const ix = bot.prevX + (bot.x - bot.prevX) * view.interp;
      const iy = bot.prevY + (bot.y - bot.prevY) * view.interp;
      const cx = this.px(ix);
      const cy = this.py(iy);
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = color;
      ctx.fillText(bot.glyph ?? "@", cx, cy);
      ctx.shadowBlur = 0;
      const share = Math.max(0, Math.min(1, bot.hp01));
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = share > 0.5 ? color : "#ff4d4d";
      ctx.fillRect(cx - this.cw * 0.34, cy + this.ch * 0.36, this.cw * 0.68 * share, 2);
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;

    // The ambient passes, in this order: haze, scanlines, vignette.
    const haze = ctx.createRadialGradient(pw / 2, ph / 2, 40, pw / 2, ph / 2, pw * 0.62);
    haze.addColorStop(0, theme.glow);
    haze.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, pw, ph);

    if (this.scanlines) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#000";
      for (let y = 0; y < ph; y += 3) ctx.fillRect(0, y, pw, 1);
      ctx.globalAlpha = 1;
    }

    const vignette = ctx.createRadialGradient(
      pw / 2,
      ph / 2,
      ph * 0.45,
      pw / 2,
      ph / 2,
      pw * 0.72,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,.6)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, pw, ph);
  }
}
