/**
 * Neon arena palettes (dev-guide Section 7.18). Browser-safe, but it holds no
 * browser code: it is only data, so a test can read it.
 *
 * The keys are tile kinds and team slots, so this file replaces what
 * `render/theme.ts` supplied. The simulation must never read a value from
 * here: a color is a display decision, and the result of a match may not
 * depend on it (Section 4.1).
 */

export type TileKind = "floor" | "wall" | "cover" | "hazard" | "spawn";
export type PickupKind = "weapon" | "armor" | "health" | "powerup" | "ammo";

export interface NeonTheme {
  name: string;
  bg: string;
  floor: string;
  floorChar: string;
  /** The wall mass inside a block. It is drawn dim. */
  wall: string;
  /** The fill of a wall cell. */
  wallBg: string;
  /** A wall face that touches open space. It is drawn lit. */
  wallLit: string;
  cover: string;
  hazard: string;
  hazardBg: string;
  spawn: string;
  teamA: string;
  teamB: string;
  /** An `rgba()` haze over the centre of the arena. */
  glow: string;
}

export const NEON_THEMES: readonly NeonTheme[] = [
  { name: "Cyan/magenta neon", bg: "#04050e", floor: "#1b2748", floorChar: "#243560", wall: "#3a2b78", wallBg: "#0d0a20", wallLit: "#8b6bff", cover: "#c78bff", hazard: "#ff4fd8", hazardBg: "#240a22", spawn: "#4de3ff", teamA: "#4de3ff", teamB: "#ff3d8f", glow: "rgba(120,90,255,.14)" },
  { name: "Acid green terminal", bg: "#03080a", floor: "#12291f", floorChar: "#1b3a2b", wall: "#1d5c40", wallBg: "#07160f", wallLit: "#3dffa0", cover: "#b6ff4d", hazard: "#d6ff2f", hazardBg: "#1a2207", spawn: "#4dffd5", teamA: "#6ef7c8", teamB: "#ffb020", glow: "rgba(60,255,160,.12)" },
  { name: "Magma orange/red", bg: "#0a0405", floor: "#2a1114", floorChar: "#3d191d", wall: "#6e2029", wallBg: "#1c0709", wallLit: "#ff6a3d", cover: "#ffa83d", hazard: "#ff2f2f", hazardBg: "#2a0808", spawn: "#ffd166", teamA: "#ffcf5c", teamB: "#ff3d5a", glow: "rgba(255,90,50,.13)" },
  { name: "Violet + hot pink", bg: "#07050f", floor: "#1f1440", floorChar: "#2c1c58", wall: "#4a2a84", wallBg: "#120a26", wallLit: "#c084fc", cover: "#f0abfc", hazard: "#ff58c8", hazardBg: "#240a1e", spawn: "#5eead4", teamA: "#5eead4", teamB: "#ff70c8", glow: "rgba(180,90,255,.15)" },
  { name: "Ice blue cryo", bg: "#03070d", floor: "#102436", floorChar: "#173448", wall: "#1d4670", wallBg: "#071320", wallLit: "#7fd8ff", cover: "#a8e6ff", hazard: "#4dd2ff", hazardBg: "#08202e", spawn: "#bff0ff", teamA: "#bff0ff", teamB: "#7b8cff", glow: "rgba(80,190,255,.12)" },
  { name: "Amber industrial", bg: "#080602", floor: "#2a2008", floorChar: "#3b2e0c", wall: "#6b4f12", wallBg: "#1a1304", wallLit: "#ffc34d", cover: "#ffe08a", hazard: "#ff7a1f", hazardBg: "#26130a", spawn: "#ffd98a", teamA: "#ffc94d", teamB: "#5ad2ff", glow: "rgba(255,180,60,.11)" },
];

/** The first palette. Use it before a session starts. */
export const DEFAULT_THEME: NeonTheme = NEON_THEMES[0] as NeonTheme;

export const PICKUP_GLYPHS: Readonly<Record<PickupKind, { ch: string; color: string }>> = {
  weapon: { ch: "†", color: "#d9c15a" },
  armor: { ch: "◘", color: "#7fd6a0" },
  health: { ch: "+", color: "#d96a7a" },
  powerup: { ch: "★", color: "#b98ad6" },
  ammo: { ch: "•", color: "#9aa7b3" },
};

/**
 * The palette order of one run. The same seed gives the same look, so a replay
 * of a run looks like the run (Section 7.1).
 *
 * The shuffle is a small generator of its own, not an RNG stream: a display
 * decision must not move a stream that the simulation reads.
 */
export function pickRotation(seed: number, count = 5): number[] {
  const order = NEON_THEMES.map((_theme, index) => index);
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const left = order[i] as number;
    const right = order[j] as number;
    order[i] = right;
    order[j] = left;
  }
  return order.slice(0, Math.max(1, Math.min(count, order.length)));
}

/** The palette of one match of a run. */
export function themeForMatch(seed: number, matchNumber: number): NeonTheme {
  const rotation = pickRotation(seed);
  const index = rotation[Math.abs(matchNumber - 1) % rotation.length] ?? 0;
  return NEON_THEMES[index] ?? (NEON_THEMES[0] as NeonTheme);
}

export type Intensity = "restrained" | "punchy" | "maximalist";

/**
 * One scalar for the whole look. It multiplies the particle counts and the
 * blur, so the style changes in one place (Section 7.18).
 */
export const INTENSITY: Readonly<Record<Intensity, number>> = {
  restrained: 0.55,
  punchy: 1,
  maximalist: 1.7,
};
