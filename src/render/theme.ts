/**
 * Display glyphs and colors (dev-guide Section 7.18).
 * The final visual style and the palette are an open decision (Section 2.3),
 * so every value here is a placeholder. TBD
 */
import { Tile, type PickupKind } from "../arena/types.js";

export interface GlyphStyle {
  char: string;
  /** Foreground color. */
  fg: string;
  /** Background color. An empty string keeps the display background. */
  bg: string;
}

export const DISPLAY_BG = "#0d0f12"; // TBD

export const TILE_STYLES: Readonly<Record<Tile, GlyphStyle>> = {
  [Tile.Floor]: { char: "·", fg: "#2f3a45", bg: "" },
  [Tile.Wall]: { char: "#", fg: "#48525c", bg: "#151a1f" },
  [Tile.CoverLow]: { char: "▖", fg: "#7d6a4f", bg: "" },
  [Tile.Hazard]: { char: "≈", fg: "#c96a3a", bg: "#231613" },
  [Tile.Spawn]: { char: "○", fg: "#5a7f9a", bg: "" },
  [Tile.Pickup]: { char: "?", fg: "#c8d0d8", bg: "" },
};

export const PICKUP_STYLES: Readonly<Record<PickupKind, GlyphStyle>> = {
  weapon: { char: "†", fg: "#d9c15a", bg: "" },
  armor: { char: "◘", fg: "#7fd6a0", bg: "" },
  health: { char: "+", fg: "#d96a7a", bg: "" },
  powerup: { char: "★", fg: "#b98ad6", bg: "" },
  ammo: { char: "•", fg: "#9aa7b3", bg: "" },
};

/** Team colors (Section 7.18). The palette is an open decision. TBD */
export const TEAM_STYLES: Readonly<Record<string, GlyphStyle>> = {
  A: { char: "@", fg: "#5fb0e8", bg: "#12202b" },
  B: { char: "@", fg: "#e8845f", bg: "#2b1a12" },
};
