/**
 * Browser entry point.
 *
 * Milestone M3 runs one full round: six bots (3v3) see each other with FOV,
 * shoot with the baseline weapon, die, and respawn. The round ends at the
 * score limit or at the time limit. The side panel shows the score, the timer,
 * and the kill feed.
 */
import { loadTestArena } from "./arena/index.js";
import { Tile } from "./arena/types.js";
import { loadTuning } from "./core/data.js";
import { feedLines } from "./report/killFeed.js";
import { ArenaDisplay, type EntityGlyph } from "./render/display.js";
import { SimRunner, type Speed } from "./render/runner.js";
import { PICKUP_STYLES, TEAM_STYLES, TILE_STYLES, facingChar } from "./render/theme.js";
import {
  botCell,
  createSimState,
  simConfigFromTuning,
  step,
  TEAM_IDS,
  type SimState,
} from "./sim/index.js";
import { createSpeedControls } from "./ui/speedControls.js";

const INITIAL_SPEED: Speed = 1;
const SEED = 1; // The run generator gives the seed from Milestone M11.
const KILL_FEED_LINES = 8;

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
    ["\u2192", "team A (it shows the facing)", TEAM_STYLES["A"]!.fg],
    ["\u2192", "team B", TEAM_STYLES["B"]!.fg],
  ];
  return items
    .map(([glyph, label, color]) => `<b style="color:${color}">${glyph}</b> ${label}`)
    .join(" ");
}

/** mm:ss of the time that is left in the round. */
function timeLeft(state: SimState): string {
  const ticks = Math.max(0, state.config.timeLimitTicks - state.tick);
  const seconds = Math.floor(ticks / state.config.ticksPerSecond);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function outcomeText(state: SimState): string {
  const { outcome } = state;
  if (outcome === null) return "";
  const reason =
    outcome.reason === "scoreLimit"
      ? "score limit"
      : outcome.reason === "suddenDeath"
        ? "sudden death"
        : "time limit";
  if (outcome.winnerTeamId === null) return `Round drawn — ${reason}`;
  return `Team ${outcome.winnerTeamId} wins the round — ${reason}`;
}

try {
  const arenaHost = document.querySelector<HTMLElement>("#arena");
  const meta = document.querySelector<HTMLElement>("#meta");
  const legend = document.querySelector<HTMLElement>("#legend");
  const controls = document.querySelector<HTMLElement>("#controls");
  const statusHost = document.querySelector<HTMLElement>("#status");
  const scoreHost = document.querySelector<HTMLElement>("#score");
  const feedHost = document.querySelector<HTMLElement>("#feed");
  if (!arenaHost || !meta || !legend || !controls || !statusHost || !scoreHost || !feedHost) {
    throw new Error("index.html is missing one of the elements that main.ts needs");
  }
  // Narrowed bindings for the closures below.
  const statusEl: HTMLElement = statusHost;
  const scoreEl: HTMLElement = scoreHost;
  const feedEl: HTMLElement = feedHost;

  const tuning = loadTuning();
  const arena = loadTestArena();
  const config = simConfigFromTuning(tuning);
  const state = createSimState({ map: arena, seed: SEED, config });
  const display = new ArenaDisplay(arenaHost, arena);

  function entities(): EntityGlyph[] {
    return state.bots
      .filter((bot) => bot.alive)
      .map((bot) => {
        const team = TEAM_STYLES[bot.teamId] ?? TEAM_STYLES["A"]!;
        // The glyph shows the way that the bot looks (Section 7.20.6).
        return { cell: botCell(bot), style: { ...team, char: facingChar(bot.facing) } };
      });
  }

  function render(): void {
    display.setEntities(entities());

    const [teamA, teamB] = TEAM_IDS;
    scoreEl.innerHTML = [
      `<span style="color:${TEAM_STYLES[teamA]!.fg}">A ${state.score[teamA]}</span>`,
      `<span class="dim">—</span>`,
      `<span style="color:${TEAM_STYLES[teamB]!.fg}">${state.score[teamB]} B</span>`,
      `<span class="dim">to ${state.config.scoreLimit}</span>`,
    ].join(" ");

    feedEl.replaceChildren();
    for (const line of feedLines(state.bus.log, KILL_FEED_LINES)) {
      const item = document.createElement("li");
      item.textContent = line.text;
      if (line.kind !== "kill") item.className = `announce ${line.kind}`;
      feedEl.append(item);
    }

    if (state.outcome !== null) {
      statusEl.textContent = outcomeText(state);
    } else if (state.suddenDeath) {
      statusEl.textContent = `round ${state.roundNumber}  ·  SUDDEN DEATH  ·  next kill wins`;
    } else {
      statusEl.textContent = `round ${state.roundNumber}  ·  ${timeLeft(state)} left  ·  tick ${state.tick}`;
    }
    statusEl.classList.toggle("urgent", state.suddenDeath && state.outcome === null);
  }

  const runner = new SimRunner({
    ticksPerSecond: config.ticksPerSecond,
    initialSpeed: INITIAL_SPEED,
    onTick: () => {
      step(state);
      if (state.outcome !== null) {
        runner.setSpeed(0);
        speedControls.setEnabled(false);
      }
    },
    onRender: render,
  });

  const speedControls = createSpeedControls({
    container: controls,
    initialSpeed: INITIAL_SPEED,
    onSpeed: (speed) => runner.setSpeed(speed),
    onStep: () => runner.stepOnce(),
    onSkip: () => {
      runner.setSpeed(0);
      // The time limit bounds this loop.
      while (state.outcome === null) step(state);
      speedControls.setEnabled(false);
      render();
    },
  });

  meta.textContent = [
    `M4 — ${arena.name}`,
    `${arena.width}×${arena.height}`,
    `${state.bots.length} bots`,
    `${config.ticksPerSecond} ticks/s`,
  ].join("  ·  ");
  legend.innerHTML = buildLegend();

  render();
  runner.start();
} catch (error) {
  showError(error);
}
