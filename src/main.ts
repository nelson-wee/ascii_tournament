/**
 * Browser entry point.
 *
 * Milestone M2 runs six bots (3v3) on the static test arena. The bots move to
 * random pickup points with A*. The speed controls drive the fixed tick loop.
 * Perception and combat arrive with Milestone M3.
 */
import { loadTestArena } from "./arena/index.js";
import { Tile } from "./arena/types.js";
import { loadTuning } from "./core/data.js";
import { ArenaDisplay, type EntityGlyph } from "./render/display.js";
import { SimRunner, type Speed } from "./render/runner.js";
import { PICKUP_STYLES, TEAM_STYLES, TILE_STYLES } from "./render/theme.js";
import { botCell, createSimState, simConfigFromTuning, step } from "./sim/index.js";
import { createSpeedControls } from "./ui/speedControls.js";

const INITIAL_SPEED: Speed = 1;
const SEED = 1; // The run generator gives the seed from Milestone M11.

function showError(error: unknown): void {
  const box = document.createElement("pre");
  box.className = "error";
  box.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  document.querySelector("#arena")?.replaceChildren(box);
}

function buildLegend(): string {
  const items: [string, string, string][] = [
    [TILE_STYLES[Tile.Wall].char, "wall", TILE_STYLES[Tile.Wall].fg],
    [TILE_STYLES[Tile.CoverLow].char, "cover", TILE_STYLES[Tile.CoverLow].fg],
    [TILE_STYLES[Tile.Hazard].char, "hazard", TILE_STYLES[Tile.Hazard].fg],
    [TILE_STYLES[Tile.Spawn].char, "spawn", TILE_STYLES[Tile.Spawn].fg],
    [PICKUP_STYLES.weapon.char, "weapon", PICKUP_STYLES.weapon.fg],
    [PICKUP_STYLES.armor.char, "armor", PICKUP_STYLES.armor.fg],
    [PICKUP_STYLES.health.char, "health", PICKUP_STYLES.health.fg],
    [PICKUP_STYLES.powerup.char, "powerup", PICKUP_STYLES.powerup.fg],
    [PICKUP_STYLES.ammo.char, "ammo", PICKUP_STYLES.ammo.fg],
    [TEAM_STYLES["A"]!.char, "team A", TEAM_STYLES["A"]!.fg],
    [TEAM_STYLES["B"]!.char, "team B", TEAM_STYLES["B"]!.fg],
  ];
  return items
    .map(([glyph, label, color]) => `<b style="color:${color}">${glyph}</b> ${label}`)
    .join(" ");
}

try {
  const arenaHost = document.querySelector<HTMLElement>("#arena");
  const meta = document.querySelector<HTMLElement>("#meta");
  const legend = document.querySelector<HTMLElement>("#legend");
  const controls = document.querySelector<HTMLElement>("#controls");
  const statusHost = document.querySelector<HTMLElement>("#status");
  if (!arenaHost || !meta || !legend || !controls || !statusHost) {
    throw new Error("index.html is missing #arena, #meta, #legend, #controls, or #status");
  }
  // A narrowed binding for the closures below.
  const statusEl: HTMLElement = statusHost;

  const tuning = loadTuning();
  const arena = loadTestArena();
  const config = simConfigFromTuning(tuning);
  const state = createSimState({ map: arena, seed: SEED, config });
  const display = new ArenaDisplay(arenaHost, arena);

  function entities(): EntityGlyph[] {
    return state.bots.map((bot) => ({
      cell: botCell(bot),
      style: TEAM_STYLES[bot.teamId] ?? TEAM_STYLES["A"]!,
    }));
  }

  function render(): void {
    display.setEntities(entities());
    statusEl.textContent = `tick ${state.tick}`;
  }

  const runner = new SimRunner({
    ticksPerSecond: config.ticksPerSecond,
    initialSpeed: INITIAL_SPEED,
    onTick: () => step(state),
    onRender: render,
  });

  createSpeedControls({
    container: controls,
    initialSpeed: INITIAL_SPEED,
    onSpeed: (speed) => runner.setSpeed(speed),
    onStep: () => runner.stepOnce(),
  });

  meta.textContent = [
    `M2 — ${arena.name}`,
    `${arena.width}×${arena.height}`,
    `${state.bots.length} bots`,
    `${arena.pickups.length} pickups`,
    `${config.ticksPerSecond} ticks/s`,
  ].join("  ·  ");
  legend.innerHTML = buildLegend();

  render();
  runner.start();
} catch (error) {
  showError(error);
}
