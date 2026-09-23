/**
 * The weapon VFX overlay (dev-guide Section 7.18). Browser only.
 *
 * The layer knows nothing about the simulation. It takes cells and colors, and
 * it draws. The caller reads the event bus and calls `shot`, `spark`, `death`
 * and `spawnIn`; the layer holds a short list of live effects and draws them
 * once per animation frame.
 *
 * Every position is a FRACTIONAL cell coordinate, so a shot can sit between
 * two cells. Every time is in milliseconds of wall clock, so the look of an
 * effect does not change with the speed of the simulation.
 *
 * The scatter of a pellet or a piece of gore comes from a stream of its own.
 * It is a display decision and it may not touch a stream that the simulation
 * reads (Section 7.1).
 */
import { createRng } from "../core/rng.js";
import type { NeonTheme } from "./neonThemes.js";

export interface Cell {
  x: number;
  y: number;
}

/** The only weapon fields that the visuals read. Each one may be absent. */
export interface WeaponVisualHints {
  /** Cells per tick. */
  projectileSpeed?: number | undefined;
  /** Cells. More than 1.5 makes the shot a rocket. */
  aoeRadius?: number | undefined;
  /** Radians. */
  coneHalfAngle?: number | undefined;
  /** Cells. */
  rangeMax?: number | undefined;
}

export type Family = "tracer" | "beam" | "rocket" | "cone";

/** Attack type to visual family. An unknown type falls through to a tracer. */
export const FAMILY: Readonly<Record<string, Family>> = {
  hitscan: "beam",
  line: "beam",
  projectile: "tracer",
  burst: "tracer",
  ricochet: "tracer",
  tile: "rocket",
  cone: "cone",
};

const EMBER_GLYPHS = ["✳", "*", "×"] as const;
const GORE_GLYPHS = ["·", ",", "˙", "×", "⁘"] as const;
/** The highest number of live effects. The oldest go first over the limit. */
const MAX_ITEMS = 400;
const ORIGIN: Cell = { x: 0, y: 0 };

interface Item {
  /** The kind of effect. `drawOne` switches on it. */
  k: string;
  /** How long the effect lasts, in ms. */
  life: number;
  /** Age over life. 1 means that the effect is finished. */
  t: number;
  from?: Cell | undefined;
  to?: Cell | undefined;
  at?: Cell | undefined;
  ang?: number | undefined;
  len?: number | undefined;
  half?: number | undefined;
  reach?: number | undefined;
  aoe?: number | undefined;
  r?: number | undefined;
  n?: number | undefined;
  color?: string | undefined;
  ch?: string | undefined;
  /** True after a rocket has detonated, so it detonates one time only. */
  burst?: boolean | undefined;
}

export interface VfxOptions {
  cellW: number;
  cellH: number;
  theme: () => NeonTheme;
  intensity?: () => number;
  font?: string;
  /** The seed of the scatter. The same seed gives the same shape of blast. */
  seed?: number | string;
}

export class VfxLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private items: Item[] = [];
  /** Not null while `step` runs. A blast adds its children from inside it. */
  private spawnBuffer: Item[] | null = null;
  private shake = 0;
  private cw: number;
  private ch: number;
  private readonly theme: () => NeonTheme;
  private readonly intensity: () => number;
  private fontFamily: string;
  private readonly rng: { next(): number };

  constructor(canvas: HTMLCanvasElement, options: VfxOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("VfxLayer: the canvas gave no 2d context");
    this.ctx = ctx;
    this.cw = options.cellW;
    this.ch = options.cellH;
    this.theme = options.theme;
    this.intensity = options.intensity ?? ((): number => 1);
    this.fontFamily = options.font ?? "'JetBrains Mono', ui-monospace, monospace";
    this.rng = createRng(options.seed ?? "vfx", "vfx");
  }

  /** Change the pixel size of one cell. The stage calls it after a resize. */
  setCellSize(cellW: number, cellH: number): void {
    this.cw = cellW;
    this.ch = cellH;
  }

  setFont(font: string): void {
    this.fontFamily = font;
  }

  private px(x: number): number {
    return x * this.cw + this.cw / 2;
  }

  private py(y: number): number {
    return y * this.ch + this.ch / 2;
  }

  private font(size: number): string {
    return `${size}px ${this.fontFamily}`;
  }

  /**
   * Add one effect.
   *
   * A blast spawns its embers from inside the sweep that removes finished
   * effects. Pushing into the list while the sweep reads it drops them without
   * a sign, which looks like "a rocket sometimes does not explode". The buffer
   * holds them until the sweep ends.
   */
  private add(item: Omit<Item, "t">): void {
    const full: Item = { ...item, t: 0 };
    if (this.spawnBuffer !== null) {
      this.spawnBuffer.push(full);
      return;
    }
    this.items.push(full);
    if (this.items.length > MAX_ITEMS) this.items.shift();
  }

  // ---- the event entry points --------------------------------------------

  /** One shot, from cell to cell. The attack type picks the visual family. */
  shot(args: {
    from: Cell;
    to: Cell;
    attackType?: string | undefined;
    weapon?: WeaponVisualHints | undefined;
    color: string;
  }): void {
    const { from, to, color } = args;
    const weapon = args.weapon ?? {};
    let family: Family = FAMILY[args.attackType ?? ""] ?? "tracer";
    // A wide blast reads as a rocket, whatever the attack type says.
    if ((weapon.aoeRadius ?? 0) > 1.5) family = "rocket";

    const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const ang = Math.atan2(to.y - from.y, to.x - from.x);

    if (family === "beam") {
      this.add({ k: "beam", life: 300, from, ang, len: distance, color });
    } else if (family === "rocket") {
      this.add({
        k: "rocket",
        life: Math.max(260, (distance / (weapon.projectileSpeed ?? 0.7)) * 50),
        from,
        to,
        ang,
        color,
        aoe: weapon.aoeRadius ?? 3,
      });
    } else if (family === "cone") {
      this.cone(from, ang, weapon.coneHalfAngle ?? 0.4, Math.min(weapon.rangeMax ?? 10, 11), color);
    } else {
      this.add({
        k: "tracer",
        life: Math.max(130, (distance / (weapon.projectileSpeed ?? 1.6)) * 50),
        from,
        to,
        ang,
        color,
      });
    }
    this.add({ k: "muzzle", life: 140, from, ang, color });
  }

  /**
   * The spread of a cone.
   *
   * The wedge is what a viewer reads as a spread. The pellets alone read as
   * noise, so the layer draws both.
   */
  private cone(from: Cell, ang: number, half: number, reach: number, color: string): void {
    const count = Math.round(9 * this.intensity());
    for (let i = 0; i < count; i += 1) {
      this.add({
        k: "pellet",
        life: 220 + this.rng.next() * 140,
        from,
        color,
        ang: ang + (this.rng.next() * 2 - 1) * half,
        reach: reach * (0.5 + this.rng.next() * 0.5),
      });
    }
    this.add({ k: "coneflash", life: 200, from, ang, half, reach, color });
  }

  /** A hit. The damage sets how many sparks fly. */
  spark(at: Cell | null, damage = 8): void {
    if (!at) return;
    this.add({
      k: "spark",
      life: 240,
      at,
      n: Math.round(Math.min(7, 3 + damage / 8) * this.intensity()),
    });
  }

  /** A death: a flash, and gore that stays on the ground for some seconds. */
  death(at: Cell | null, color: string): void {
    if (!at) return;
    this.add({ k: "flash", life: 340, at, color, r: 2.4 });
    const count = Math.round(10 * this.intensity());
    for (let i = 0; i < count; i += 1) {
      const angle = this.rng.next() * Math.PI * 2;
      const radius = this.rng.next() * 2.6;
      this.add({
        k: "gore",
        life: 2600 + this.rng.next() * 1800,
        color,
        at: { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius * 0.7 },
        ch: GORE_GLYPHS[Math.floor(this.rng.next() * GORE_GLYPHS.length)] ?? "·",
      });
    }
  }

  /** A bot arrives on a spawn cell. */
  spawnIn(at: Cell | null, color: string): void {
    if (at) this.add({ k: "flash", life: 420, at, color, r: 1.8 });
  }

  /** A shake of the screen. Call it when an area attack lands. */
  kick(n: number): void {
    this.shake = Math.min(9, this.shake + n);
  }

  /** Age the effects and draw them. Call it one time per animation frame. */
  frame(dtMs: number): void {
    this.step(dtMs);
    this.draw();
  }

  get liveCount(): number {
    return this.items.length;
  }

  /** Drop every effect. The stage calls it between rounds. */
  clear(): void {
    this.items = [];
    this.shake = 0;
  }

  // ---- internals ---------------------------------------------------------

  private step(dt: number): void {
    for (const item of this.items) item.t += dt / item.life;
    this.spawnBuffer = [];
    const keep: Item[] = [];
    for (const item of this.items) {
      if (item.t < 1) {
        keep.push(item);
        continue;
      }
      if (item.k === "rocket" && item.burst !== true) this.explode(item);
    }
    const spawned = this.spawnBuffer;
    this.spawnBuffer = null;
    this.items = keep.concat(spawned);
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
  }

  private explode(item: Item): void {
    const aoe = item.aoe ?? 3;
    this.add({ k: "boom", life: 480, at: item.to, color: item.color, aoe });
    const count = Math.round(14 * this.intensity());
    for (let i = 0; i < count; i += 1) {
      this.add({
        k: "ember",
        life: 380 + this.rng.next() * 420,
        at: item.to,
        ang: this.rng.next() * Math.PI * 2,
        reach: aoe * (0.4 + this.rng.next() * 0.8),
        ch: EMBER_GLYPHS[Math.floor(this.rng.next() * EMBER_GLYPHS.length)] ?? "*",
      });
    }
    this.kick(4);
    item.burst = true;
  }

  private draw(): void {
    const { ctx } = this;
    const intensity = this.intensity();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // Only this canvas shakes. A shake of the grid too reads as a broken
    // display, not as a blast.
    this.shake *= 0.86;
    if (this.shake > 0.15) {
      ctx.translate((this.rng.next() - 0.5) * this.shake, (this.rng.next() - 0.5) * this.shake);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const item of this.items) this.drawOne(item, intensity);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawOne(item: Item, intensity: number): void {
    const { ctx } = this;
    const t = Math.min(1, item.t);
    const fade = 1 - t;
    const color = item.color ?? this.theme().teamA;
    const glow = (paint: string, blur: number): void => {
      ctx.shadowColor = paint;
      ctx.shadowBlur = blur * intensity;
      ctx.fillStyle = paint;
      ctx.strokeStyle = paint;
    };

    switch (item.k) {
      case "muzzle": {
        const from = item.from ?? ORIGIN;
        const ang = item.ang ?? 0;
        ctx.globalAlpha = fade;
        glow("#fffbe6", 16);
        ctx.font = this.font(13 + fade * 5);
        ctx.fillText(
          "✦",
          this.px(from.x) + Math.cos(ang) * this.cw * 0.5,
          this.py(from.y) + Math.sin(ang) * this.ch * 0.5,
        );
        break;
      }
      case "tracer": {
        const from = item.from ?? ORIGIN;
        const to = item.to ?? from;
        ctx.font = this.font(14);
        for (let i = 0; i < 4; i += 1) {
          const step = Math.max(0, t - i * 0.09);
          ctx.globalAlpha = (1 - i * 0.22) * (0.35 + fade * 0.65);
          glow(i === 0 ? "#fff6cf" : color, 12 - i * 2);
          ctx.fillText(
            i === 0 ? "•" : ":",
            this.px(from.x + (to.x - from.x) * step),
            this.py(from.y + (to.y - from.y) * step),
          );
        }
        break;
      }
      case "beam": {
        const from = item.from ?? ORIGIN;
        ctx.save();
        ctx.translate(this.px(from.x), this.py(from.y));
        ctx.rotate(item.ang ?? 0);
        const end = (item.len ?? 1) * this.cw;
        // The alpha snaps bright and falls away slowly. That is what a viewer
        // reads as an instant shot.
        ctx.globalAlpha = Math.pow(fade, 0.6);
        glow(color, 18);
        ctx.lineWidth = 1.6 + fade * 2.2;
        ctx.beginPath();
        ctx.moveTo(this.cw * 0.4, 0);
        ctx.lineTo(end, 0);
        ctx.stroke();
        ctx.globalAlpha = Math.pow(fade, 0.6) * 0.9;
        glow("#ffffff", 10);
        ctx.font = this.font(15);
        for (let d = this.cw * 0.9; d < end; d += this.cw * 0.82) ctx.fillText("═", d, 0);
        ctx.restore();
        break;
      }
      case "pellet": {
        const from = item.from ?? ORIGIN;
        const ang = item.ang ?? 0;
        const reach = (item.reach ?? 1) * t;
        ctx.globalAlpha = fade;
        glow(color, 10);
        ctx.font = this.font(13);
        ctx.fillText(
          t > 0.6 ? "∴" : "*",
          this.px(from.x + Math.cos(ang) * reach),
          this.py(from.y + Math.sin(ang) * reach),
        );
        break;
      }
      case "coneflash": {
        const from = item.from ?? ORIGIN;
        const reach = item.reach ?? 1;
        ctx.save();
        ctx.translate(this.px(from.x), this.py(from.y));
        ctx.rotate(item.ang ?? 0);
        ctx.globalAlpha = fade * 0.3;
        ctx.shadowBlur = 0;
        const wedge = ctx.createLinearGradient(0, 0, reach * this.cw, 0);
        wedge.addColorStop(0, color);
        wedge.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = wedge;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, reach * this.cw * (0.5 + t * 0.5), -(item.half ?? 0.4), item.half ?? 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case "rocket": {
        const from = item.from ?? ORIGIN;
        const to = item.to ?? from;
        ctx.font = this.font(15);
        ctx.globalAlpha = 1;
        glow("#ffd9a0", 16);
        ctx.fillText(
          "●",
          this.px(from.x + (to.x - from.x) * t),
          this.py(from.y + (to.y - from.y) * t),
        );
        ctx.font = this.font(12);
        for (let i = 1; i <= 5; i += 1) {
          const step = Math.max(0, t - i * 0.055);
          ctx.globalAlpha = (1 - i * 0.17) * 0.5;
          glow(i < 3 ? "#ff8a3d" : "#6b6f82", 8);
          ctx.fillText(
            i < 3 ? "▒" : "░",
            this.px(from.x + (to.x - from.x) * step),
            this.py(from.y + (to.y - from.y) * step),
          );
        }
        break;
      }
      case "boom": {
        const at = item.at ?? ORIGIN;
        const radius = Math.max(1, (item.aoe ?? 3) * this.cw * (0.35 + t * 0.9));
        const cx = this.px(at.x);
        const cy = this.py(at.y);
        ctx.shadowBlur = 0;
        const ball = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        ball.addColorStop(0, `rgba(255,255,230,${0.8 * fade})`);
        ball.addColorStop(0.35, `rgba(255,150,60,${0.5 * fade})`);
        ball.addColorStop(1, "rgba(255,60,20,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = ball;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = fade * 0.9;
        glow("#ffb04d", 14);
        ctx.lineWidth = 1.5 + fade * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.82, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "ember": {
        const at = item.at ?? ORIGIN;
        const ang = item.ang ?? 0;
        const reach = (item.reach ?? 1) * Math.pow(t, 0.6);
        ctx.globalAlpha = fade;
        glow(t < 0.5 ? "#ffd27a" : "#ff6a3d", 9);
        ctx.font = this.font(13);
        ctx.fillText(
          item.ch ?? "*",
          this.px(at.x + Math.cos(ang) * reach),
          this.py(at.y + Math.sin(ang) * reach * 0.8),
        );
        break;
      }
      case "spark": {
        const at = item.at ?? ORIGIN;
        const count = Math.max(1, item.n ?? 3);
        ctx.font = this.font(12);
        for (let i = 0; i < count; i += 1) {
          const angle = (i / count) * Math.PI * 2 + count;
          const radius = t * 1.1;
          ctx.globalAlpha = fade;
          glow(i % 2 ? "#ffffff" : "#ffe08a", 10);
          ctx.fillText(
            "✧",
            this.px(at.x + Math.cos(angle) * radius),
            this.py(at.y + Math.sin(angle) * radius * 0.75),
          );
        }
        break;
      }
      case "flash": {
        const at = item.at ?? ORIGIN;
        const radius = Math.max(1, (item.r ?? 2) * this.cw * (0.4 + t));
        const cx = this.px(at.x);
        const cy = this.py(at.y);
        ctx.shadowBlur = 0;
        const ball = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        ball.addColorStop(0, `rgba(255,255,255,${0.7 * fade})`);
        ball.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = ball;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "gore": {
        const at = item.at ?? ORIGIN;
        ctx.globalAlpha = Math.min(0.8, fade * 1.4) * 0.8;
        glow(color, 5);
        ctx.font = this.font(12);
        ctx.fillText(item.ch ?? "·", this.px(at.x), this.py(at.y));
        break;
      }
      default:
        break;
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
