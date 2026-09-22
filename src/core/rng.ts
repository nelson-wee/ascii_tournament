/**
 * Deterministic randomness (dev-guide Section 7.1).
 *
 * Rules:
 * - Do not use `Math.random()`. Do not use the global `ROT.RNG` instance.
 * - Each system uses its own stream. A change in one system must not change
 *   the results of another system.
 * - Each round gets a sub-seed from the match seed, so a round can replay alone.
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface Rng {
  /** Name of the stream. For debug output only. */
  readonly label: string;
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [minInclusive, maxInclusive]. */
  int(minInclusive: number, maxInclusive: number): number;
  /** A float in [min, max). */
  float(min: number, max: number): number;
  /** True with the given probability (0..1). */
  bool(probability: number): boolean;
  /** One item of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** A new shuffled copy of the list (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** A new independent stream, derived from this stream's seed and the label. */
  fork(label: string): Rng;
  /** A copy of the internal state. Use it to save and replay. */
  getState(): RngState;
  /** Set the internal state. */
  setState(state: RngState): void;
}

/** The named streams of a run (dev-guide Section 7.1). */
export const RNG_STREAM_NAMES = [
  "arena",
  "weapons",
  "names",
  "sim",
  "ai",
  "progression",
] as const;

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number];
export type RngStreams = Readonly<Record<RngStreamName, Rng>>;

/**
 * cyrb128: a string hash that gives four 32-bit seed values.
 * It spreads a short seed over the whole state of the generator.
 */
function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i += 1) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** sfc32: a small, fast, deterministic 32-bit generator. */
function sfc32(state: RngState): () => number {
  return function nextFloat(): number {
    state.a >>>= 0;
    state.b >>>= 0;
    state.c >>>= 0;
    state.d >>>= 0;
    let t = (state.a + state.b) | 0;
    state.a = state.b ^ (state.b >>> 9);
    state.b = (state.c + (state.c << 3)) | 0;
    state.c = (state.c << 21) | (state.c >>> 11);
    state.d = (state.d + 1) | 0;
    t = (t + state.d) | 0;
    state.c = (state.c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Make a 32-bit seed from a seed and a label. Use it for sub-seeds. */
export function deriveSeed(seed: number | string, label: string): number {
  return cyrb128(`${String(seed)}::${label}`)[0];
}

/** Make one independent stream. */
export function createRng(seed: number | string, label = "default"): Rng {
  const [a, b, c, d] = cyrb128(`${String(seed)}::${label}`);
  const state: RngState = { a, b, c, d };
  const nextFloat = sfc32(state);
  // Discard the first values. The first outputs of sfc32 are weaker.
  for (let i = 0; i < 12; i += 1) nextFloat();

  const rng: Rng = {
    label,
    next: nextFloat,
    int(minInclusive: number, maxInclusive: number): number {
      if (maxInclusive < minInclusive) {
        throw new RangeError(`rng.int: max ${maxInclusive} is below min ${minInclusive}`);
      }
      const span = maxInclusive - minInclusive + 1;
      return minInclusive + Math.floor(nextFloat() * span);
    },
    float(min: number, max: number): number {
      return min + nextFloat() * (max - min);
    },
    bool(probability: number): boolean {
      return nextFloat() < probability;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("rng.pick: the list is empty");
      const item = items[Math.floor(nextFloat() * items.length)];
      // The index is always inside the list, but the compiler cannot know this.
      return item as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(nextFloat() * (i + 1));
        const left = copy[i] as T;
        const right = copy[j] as T;
        copy[i] = right;
        copy[j] = left;
      }
      return copy;
    },
    fork(childLabel: string): Rng {
      return createRng(deriveSeed(`${a}:${b}:${c}:${d}`, childLabel), `${label}/${childLabel}`);
    },
    getState(): RngState {
      return { a: state.a, b: state.b, c: state.c, d: state.d };
    },
    setState(next: RngState): void {
      state.a = next.a >>> 0;
      state.b = next.b >>> 0;
      state.c = next.c >>> 0;
      state.d = next.d >>> 0;
    },
  };

  return rng;
}

/** Make all named streams of a run from one seed. */
export function createRngStreams(seed: number): RngStreams {
  const streams = {} as Record<RngStreamName, Rng>;
  for (const name of RNG_STREAM_NAMES) {
    streams[name] = createRng(seed, name);
  }
  return streams;
}
