/**
 * The tick runner and the speed control (dev-guide Sections 7.4 and 7.18).
 * Browser only.
 *
 * The simulation uses a fixed tick. The runner decides how many ticks run in
 * one animation frame. The display speed does not change the result of the
 * simulation (Section 4.4).
 *
 * "Skip to end of round" needs the round end condition of Milestone M3.
 */

/** 0 = paused. */
export const SPEEDS = [0, 1, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export interface SimRunnerOptions {
  ticksPerSecond: number;
  onTick: () => void;
  onRender: () => void;
  /** The highest number of ticks in one frame. It stops a slow tab from freezing. */
  maxTicksPerFrame?: number;
  initialSpeed?: Speed;
}

export class SimRunner {
  private speed: Speed;
  private frame = 0;
  private lastTime = 0;
  private accumulator = 0;
  private readonly maxTicksPerFrame: number;

  constructor(private readonly options: SimRunnerOptions) {
    this.speed = options.initialSpeed ?? 1;
    this.maxTicksPerFrame = options.maxTicksPerFrame ?? 240;
  }

  getSpeed(): Speed {
    return this.speed;
  }

  /** Set the speed. 0 pauses the simulation. */
  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.accumulator = 0;
    this.lastTime = 0;
  }

  /** Run one tick. Use it while the simulation is paused. */
  stepOnce(): void {
    this.options.onTick();
    this.options.onRender();
  }

  start(): void {
    if (this.frame !== 0) return;
    this.lastTime = 0;
    this.accumulator = 0;
    this.frame = requestAnimationFrame((time) => this.onFrame(time));
  }

  stop(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private onFrame(time: number): void {
    this.frame = requestAnimationFrame((next) => this.onFrame(next));

    if (this.lastTime === 0) this.lastTime = time;
    // A long pause (a hidden tab) must not make a burst of ticks.
    const elapsedSeconds = Math.min(time - this.lastTime, 250) / 1000;
    this.lastTime = time;

    if (this.speed > 0) {
      this.accumulator += elapsedSeconds * this.options.ticksPerSecond * this.speed;
      let ticks = 0;
      while (this.accumulator >= 1 && ticks < this.maxTicksPerFrame) {
        this.options.onTick();
        this.accumulator -= 1;
        ticks += 1;
      }
      if (ticks >= this.maxTicksPerFrame) this.accumulator = 0;
    }

    this.options.onRender();
  }
}
