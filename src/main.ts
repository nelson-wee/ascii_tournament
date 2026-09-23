/**
 * Browser entry point.
 *
 * The main menu picks a mode (Section 7.20.20): a tournament, where matches
 * follow each other on a new arena each time, or a test arena of one style.
 * A match is best of 3 (Section 7.4). Between rounds the tactics screen opens
 * and the player sets the tactics and the roles of team A. Between matches the
 * match-over screen shows the result and describes the ground ahead.
 */
import { Tile } from "./arena/types.js";
import { loadDefaultTactics, loadTuning } from "./core/data.js";
import { EventBus } from "./core/events.js";
import type { Tactics } from "./core/schemas.js";
import {
  createSession,
  nextMatch,
  recordMatch,
  sessionTally,
  type MatchSetup,
  type Session,
} from "./meta/session.js";
import { feedLines } from "./report/killFeed.js";
import { ArenaDisplay, type EntityGlyph } from "./render/display.js";
import { SimRunner, type Speed } from "./render/runner.js";
import {
  PICKUP_STYLES,
  PROJECTILE_STYLE,
  REDEEMER_PROJECTILE_STYLE,
  TEAM_STYLES,
  TILE_STYLES,
  facingChar,
} from "./render/theme.js";
import {
  botCell,
  createRoundState,
  DEFAULT_ROLES,
  readyPickupCells,
  simConfigFromTuning,
  step,
  TEAM_IDS,
  type MatchPlan,
  type Role,
  type RoundOutcome,
  type SimState,
  type TeamId,
} from "./sim/index.js";
import { openMainMenu, openMatchOverScreen, type MenuChoice, type Screen } from "./ui/menu.js";
import { createSpeedControls } from "./ui/speedControls.js";
import { openTacticsScreen } from "./ui/tacticsScreen.js";

const INITIAL_SPEED: Speed = 1;
const KILL_FEED_LINES = 8;
/** The seed of a session. Milestone M11 takes it from the run generator. */
const SEED = Math.floor(Date.now() / 1000);

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
  const metaEl: HTMLElement = meta;
  const statusEl: HTMLElement = statusHost;
  const scoreEl: HTMLElement = scoreHost;
  const feedEl: HTMLElement = feedHost;
  const stageEl: HTMLElement = stageHost;

  const config = simConfigFromTuning(loadTuning());
  legend.innerHTML = buildLegend(config.directionalVision);

  // ------------------------------------------------------------------------
  // The state of the match on the screen. It is replaced on every new match.
  // ------------------------------------------------------------------------
  let session: Session | null = null;
  let setup: MatchSetup | null = null;
  let display: ArenaDisplay | null = null;
  let bus = new EventBus();
  let state: SimState | null = null;
  let plan: MatchPlan = {};
  let rounds: RoundOutcome[] = [];
  let roundWins: Record<TeamId, number> = { A: 0, B: 0 };
  let matchWinner: TeamId | null = null;
  let roundNumber = 1;
  let screen: Screen | null = null;

  function closeScreen(): void {
    screen?.close();
    screen = null;
  }

  function entities(): EntityGlyph[] {
    if (!state) return [];
    const bots: EntityGlyph[] = state.bots
      .filter((bot) => bot.alive)
      .map((bot) => {
        const team = TEAM_STYLES[bot.teamId] ?? TEAM_STYLES["A"]!;
        const char = config.directionalVision ? facingChar(bot.facing) : team.char;
        return { cell: botCell(bot), style: { ...team, char } };
      });

    // A shot in the air is drawn under the bots: a Redeemer is a decision for
    // the other team, so a viewer has to see it coming (Section 7.20.18).
    const shots: EntityGlyph[] = state.projectiles.map((projectile) => ({
      cell: { x: Math.floor(projectile.pos.x), y: Math.floor(projectile.pos.y) },
      style:
        projectile.weapon.archetype === "redeemer"
          ? REDEEMER_PROJECTILE_STYLE
          : PROJECTILE_STYLE,
    }));
    return [...shots, ...bots];
  }

  function render(): void {
    if (!state || !display) return;
    display.setReadyPickups(readyPickupCells(state));
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

  // ------------------------------------------------------------------------
  // The match loop
  // ------------------------------------------------------------------------

  /** Build the arena and the first round of the next match of the session. */
  function startMatch(): void {
    if (!session) return;
    setup = nextMatch(session);
    bus = new EventBus();
    rounds = [];
    roundWins = { A: 0, B: 0 };
    matchWinner = null;
    roundNumber = 1;
    plan = {
      A: { tactics: plan.A?.tactics ?? loadDefaultTactics(), roles: [...(plan.A?.roles ?? DEFAULT_ROLES)] },
      B: { tactics: loadDefaultTactics(), roles: [...DEFAULT_ROLES] },
    };

    if (display) display.setMap(setup.arena);
    else display = new ArenaDisplay(arenaHost as HTMLElement, setup.arena);

    bus.emit("MatchStart", 0, 0, {
      matchId: `match-${setup.seed}`,
      arena: setup.arena.name,
      weapons: setup.weapons.map((weapon) => weapon.id),
      spawnTable: setup.spawnTable.slots,
    });

    state = createRoundState(matchOptions(), roundNumber, plan, setup.spawnTable, config, bus);
    metaEl.textContent = [
      `${session.mode === "tournament" ? "Tournament" : "Test"} · match ${setup.matchNumber}`,
      `${setup.arena.profile.style} ${setup.arena.width}×${setup.arena.height}`,
      `best of ${config.maxRounds}`,
      setup.weapons.map((weapon) => weapon.archetype).join("/"),
    ].join("  ·  ");

    speedControls.setEnabled(true);
    speedControls.setSpeed(INITIAL_SPEED);
    runner.setSpeed(INITIAL_SPEED);
    render();
  }

  function matchOptions() {
    const current = setup;
    if (!current) throw new Error("no match is set up");
    return {
      map: current.arena,
      weapons: current.weapons,
      seed: current.seed,
      spawnTable: current.spawnTable,
    };
  }

  /** Close the round, and open the tactics screen or end the match. */
  function endRound(): void {
    if (!state || !setup || !session) return;
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
        matchId: `match-${setup.seed}`,
        winnerTeamId: matchWinner,
        roundWins: { ...roundWins },
        rounds: rounds.length,
      });
      render();
      endMatch();
      return;
    }

    render();
    openBetweenRounds();
  }

  /**
   * The match is over. A session does not stop on a win or a loss: it writes
   * the result down, builds the next arena, and shows what it looks like.
   */
  function endMatch(): void {
    const current = session;
    const played = setup;
    if (!current || !played) return;
    recordMatch(current, played, matchWinner, roundWins);

    // The next arena is built now, so the screen can describe the ground ahead.
    const ahead = nextMatch(current);
    screen = openMatchOverScreen({
      container: stageEl,
      mode: current.mode,
      matchNumber: played.matchNumber,
      winnerTeamId: matchWinner,
      roundWins: { ...roundWins },
      tally: sessionTally(current),
      nextArenaName: `${ahead.arena.profile.style} ${ahead.arena.width}×${ahead.arena.height}`,
      nextMetrics: ahead.arena.metrics,
      onNext: () => {
        closeScreen();
        startMatch();
      },
      onMenu: () => {
        closeScreen();
        showMenu();
      },
    });
  }

  /** The between-round screen of Section 7.4. */
  function openBetweenRounds(): void {
    screen = openTacticsScreen({
      container: stageEl,
      teamId: "A",
      tactics: plan.A?.tactics ?? loadDefaultTactics(),
      roles: plan.A?.roles ?? DEFAULT_ROLES,
      rounds,
      roundWins,
      nextRoundNumber: roundNumber + 1,
      onStart: (tactics: Tactics, roles: Role[]) => {
        closeScreen();
        plan.A = { tactics, roles };
        roundNumber += 1;
        if (!setup) return;
        state = createRoundState(matchOptions(), roundNumber, plan, setup.spawnTable, config, bus);
        speedControls.setEnabled(true);
        speedControls.setSpeed(INITIAL_SPEED);
        runner.setSpeed(INITIAL_SPEED);
        render();
      },
    });
  }

  // ------------------------------------------------------------------------
  // The menu
  // ------------------------------------------------------------------------

  function showMenu(): void {
    runner.setSpeed(0);
    speedControls.setEnabled(false);
    // `render` reads `state`. Clearing it stops the last match writing over the
    // panel while the menu is open.
    state = null;
    setup = null;
    statusEl.textContent = "Pick a mode.";
    metaEl.textContent = `main menu  ·  seed ${SEED}`;
    scoreEl.textContent = "";
    feedEl.replaceChildren();
    screen = openMainMenu({
      container: stageEl,
      seed: SEED,
      onStart: (choice: MenuChoice) => {
        closeScreen();
        session = createSession({
          mode: choice.mode,
          seed: choice.seed,
          style: choice.style,
          weaponsPerRun: config.weaponsPerRun,
          ticksPerSecond: config.ticksPerSecond,
        });
        plan = {};
        startMatch();
      },
    });
  }

  const runner = new SimRunner({
    ticksPerSecond: config.ticksPerSecond,
    initialSpeed: INITIAL_SPEED,
    onTick: () => {
      if (!state) return;
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
      if (!state) return;
      runner.setSpeed(0);
      // The time limit bounds this loop.
      while (state.outcome === null) step(state);
      endRound();
    },
  });

  showMenu();
  runner.start();
} catch (error) {
  showError(error);
}
