/**
 * Browser entry point.
 *
 * Milestone M8 plays a full best-of-3 match (Section 7.4): six bots in three
 * roles (Section 7.11) fight over pickups and power-ups (Section 7.12) with
 * generated weapons (Section 7.3). Between rounds the tactics screen opens and
 * the player sets the tactics and the roles of team A. The side panel shows
 * the score, the round wins, the timer, and the kill feed.
 */
import { loadTestArena } from "./arena/index.js";
import { Tile } from "./arena/types.js";
import { loadDefaultTactics, loadTuning } from "./core/data.js";
import { EventBus } from "./core/events.js";
import { createRng, deriveSeed } from "./core/rng.js";
import type { Tactics } from "./core/schemas.js";
import { generateWeaponSet } from "./weapons/generate.js";
import { feedLines } from "./report/killFeed.js";
import { ArenaDisplay, type EntityGlyph } from "./render/display.js";
import { SimRunner, type Speed } from "./render/runner.js";
import { PICKUP_STYLES, TEAM_STYLES, TILE_STYLES, facingChar } from "./render/theme.js";
import {
  botCell,
  createRoundState,
  DEFAULT_ROLES,
  rollSpawnTable,
  simConfigFromTuning,
  step,
  TEAM_IDS,
  type MatchPlan,
  type Role,
  type RoundOutcome,
  type SimState,
  type TeamId,
} from "./sim/index.js";
import { createSpeedControls } from "./ui/speedControls.js";
import { openTacticsScreen } from "./ui/tacticsScreen.js";

const INITIAL_SPEED: Speed = 1;
const SEED = 1; // The run generator gives the seed from Milestone M11.
const KILL_FEED_LINES = 8;

function showError(error: unknown): void {
  const box = document.createElement("pre");
  box.className = "error";
  box.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  document.querySelector("#arena")?.replaceChildren(box);
}

function buildLegend(directional: boolean): string {
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
    [directional ? "→" : TEAM_STYLES["A"]!.char, "team A", TEAM_STYLES["A"]!.fg],
    [directional ? "→" : TEAM_STYLES["B"]!.char, "team B", TEAM_STYLES["B"]!.fg],
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

function outcomeText(outcome: RoundOutcome): string {
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
  const stageHost = document.querySelector<HTMLElement>("#stage");
  if (
    !arenaHost ||
    !meta ||
    !legend ||
    !controls ||
    !statusHost ||
    !scoreHost ||
    !feedHost ||
    !stageHost
  ) {
    throw new Error("index.html is missing one of the elements that main.ts needs");
  }
  // Narrowed bindings for the closures below.
  const statusEl: HTMLElement = statusHost;
  const scoreEl: HTMLElement = scoreHost;
  const feedEl: HTMLElement = feedHost;
  const stageEl: HTMLElement = stageHost;

  const tuning = loadTuning();
  const arena = loadTestArena();
  const config = simConfigFromTuning(tuning);
  const weapons = generateWeaponSet(
    createRng(deriveSeed(SEED, "weapons"), "weapons"),
    config.weaponsPerRun,
    { ticksPerSecond: config.ticksPerSecond },
  );
  // One spawn table for every round of the match (Section 2.2).
  const spawnTable = rollSpawnTable(arena, weapons, createRng(SEED, "weapons"));
  const display = new ArenaDisplay(arenaHost, arena);

  // The match state that the rounds share. `runMatch` runs a match to its end
  // in one call, which a display cannot do, so the browser keeps the same
  // bookkeeping here and steps one round at a time.
  const bus = new EventBus();
  const matchOptions = { map: arena, weapons, seed: SEED, spawnTable };
  const plan: MatchPlan = {
    A: { tactics: loadDefaultTactics(), roles: [...DEFAULT_ROLES] },
    B: { tactics: loadDefaultTactics(), roles: [...DEFAULT_ROLES] },
  };
  const rounds: RoundOutcome[] = [];
  const roundWins: Record<TeamId, number> = { A: 0, B: 0 };
  let matchWinner: TeamId | null = null;
  let roundNumber = 1;

  bus.emit("MatchStart", 0, 0, {
    matchId: `match-${SEED}`,
    arena: arena.name,
    weapons: weapons.map((weapon) => weapon.id),
    spawnTable: spawnTable.slots,
  });

  let state = createRoundState(matchOptions, roundNumber, plan, spawnTable, config, bus);

  function entities(): EntityGlyph[] {
    return state.bots
      .filter((bot) => bot.alive)
      .map((bot) => {
        const team = TEAM_STYLES[bot.teamId] ?? TEAM_STYLES["A"]!;
        // With directional vision on, the glyph shows the way that the bot
        // looks (Section 7.20.6). With it off, the facing means nothing.
        const char = config.directionalVision ? facingChar(bot.facing) : team.char;
        return { cell: botCell(bot), style: { ...team, char } };
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
      `<span class="dim">· rounds ${roundWins[teamA]}–${roundWins[teamB]}</span>`,
    ].join(" ");

    feedEl.replaceChildren();
    for (const line of feedLines(bus.log, KILL_FEED_LINES)) {
      const item = document.createElement("li");
      item.textContent = line.text;
      if (line.kind !== "kill") item.className = `announce ${line.kind}`;
      feedEl.append(item);
    }

    if (matchWinner !== null) {
      statusEl.textContent = `Team ${matchWinner} wins the match ${roundWins.A}–${roundWins.B}`;
    } else if (state.outcome !== null) {
      statusEl.textContent = outcomeText(state.outcome);
    } else if (state.suddenDeath) {
      statusEl.textContent = `round ${state.roundNumber}  ·  SUDDEN DEATH  ·  next kill wins`;
    } else {
      statusEl.textContent = `round ${state.roundNumber}  ·  ${timeLeft(state)} left  ·  tick ${state.tick}`;
    }
    statusEl.classList.toggle("urgent", state.suddenDeath && state.outcome === null);
  }

  /** Close the round, and open the tactics screen or end the match. */
  function endRound(): void {
    const outcome = state.outcome;
    if (outcome === null) return;
    rounds.push(outcome);
    if (outcome.winnerTeamId !== null) roundWins[outcome.winnerTeamId] += 1;

    for (const teamId of TEAM_IDS) {
      if (roundWins[teamId] >= config.roundWinsToWinMatch) matchWinner = teamId;
    }
    if (matchWinner === null && rounds.length >= config.maxRounds) {
      const [first, second] = TEAM_IDS;
      if (roundWins[first] > roundWins[second]) matchWinner = first;
      else if (roundWins[second] > roundWins[first]) matchWinner = second;
    }

    runner.setSpeed(0);
    speedControls.setEnabled(false);

    if (matchWinner !== null || rounds.length >= config.maxRounds) {
      bus.emit("MatchEnd", state.tick, rounds.length, {
        matchId: `match-${SEED}`,
        winnerTeamId: matchWinner,
        roundWins: { ...roundWins },
        rounds: rounds.length,
      });
      render();
      return;
    }

    render();
    openBetweenRounds();
  }

  /** The between-round screen of Section 7.4. */
  function openBetweenRounds(): void {
    const screen = openTacticsScreen({
      container: stageEl,
      teamId: "A",
      tactics: plan.A?.tactics ?? loadDefaultTactics(),
      roles: plan.A?.roles ?? DEFAULT_ROLES,
      rounds,
      roundWins,
      nextRoundNumber: roundNumber + 1,
      onStart: (tactics: Tactics, roles: Role[]) => {
        screen.close();
        plan.A = { tactics, roles };
        roundNumber += 1;
        state = createRoundState(matchOptions, roundNumber, plan, spawnTable, config, bus);
        speedControls.setEnabled(true);
        speedControls.setSpeed(INITIAL_SPEED);
        runner.setSpeed(INITIAL_SPEED);
        render();
      },
    });
  }

  const runner = new SimRunner({
    ticksPerSecond: config.ticksPerSecond,
    initialSpeed: INITIAL_SPEED,
    onTick: () => {
      step(state);
      if (state.outcome !== null) endRound();
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
      endRound();
    },
  });

  meta.textContent = [
    `M8 — ${arena.name}`,
    `${arena.width}×${arena.height}`,
    `best of ${config.maxRounds}`,
    `${config.ticksPerSecond} ticks/s`,
    weapons.map((weapon) => weapon.archetype).join("/"),
  ].join("  ·  ");
  legend.innerHTML = buildLegend(config.directionalVision);

  render();
  runner.start();
} catch (error) {
  showError(error);
}
