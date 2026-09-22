/**
 * Browser entry point.
 *
 * Milestone M1 loads the hand-made test arena from a text file and draws it
 * with the rot.js display. Bots and movement arrive with Milestone M2.
 */
import { loadTestArena } from "./arena/index.js";
import { Tile } from "./arena/types.js";
import { loadTuning } from "./core/data.js";
import { ArenaDisplay } from "./render/display.js";
import { PICKUP_STYLES, TILE_STYLES } from "./render/theme.js";

function showError(error: unknown): void {
  const box = document.createElement("pre");
  box.className = "error";
  box.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  document.querySelector("#arena")?.replaceChildren(box);
}

function buildLegend(): string {
  const items: [string, string][] = [
    [TILE_STYLES[Tile.Wall].char, "wall"],
    [TILE_STYLES[Tile.Floor].char, "floor"],
    [TILE_STYLES[Tile.CoverLow].char, "low cover"],
    [TILE_STYLES[Tile.Hazard].char, "hazard"],
    [TILE_STYLES[Tile.Spawn].char, "spawn"],
    [PICKUP_STYLES.weapon.char, "weapon"],
    [PICKUP_STYLES.armor.char, "armor"],
    [PICKUP_STYLES.health.char, "health"],
    [PICKUP_STYLES.powerup.char, "powerup"],
    [PICKUP_STYLES.ammo.char, "ammo"],
  ];
  return items.map(([glyph, label]) => `<b>${glyph}</b> ${label}`).join(" ");
}

try {
  const arenaHost = document.querySelector<HTMLElement>("#arena");
  const meta = document.querySelector<HTMLElement>("#meta");
  const legend = document.querySelector<HTMLElement>("#legend");
  if (!arenaHost || !meta || !legend) {
    throw new Error("index.html is missing #arena, #meta, or #legend");
  }

  const tuning = loadTuning();
  const arena = loadTestArena();
  new ArenaDisplay(arenaHost, arena);

  meta.textContent = [
    `M1 — ${arena.name}`,
    `${arena.width}×${arena.height}`,
    `${arena.spawns.length} spawns`,
    `${arena.pickups.length} pickups`,
    `${tuning.simulation.ticksPerSecond} ticks/s`,
  ].join("  ·  ");
  legend.innerHTML = buildLegend();
} catch (error) {
  showError(error);
}
