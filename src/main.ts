/**
 * Browser entry point.
 *
 * The main menu picks a mode (Section 7.20.20): a tournament, where matches
 * follow each other on a new arena each time, or a test arena of one style.
 * A match is best of 3 (Section 7.4). Between rounds the tactics screen opens
 * and the player sets the tactics and the roles of team A. Between matches the
 * match-over screen shows the result and describes the ground ahead.
 *
 * The arena draws on two canvases (Section 7.18): the grid below and the
 * effects above. This file is the one place that joins the two sides. It reads
 * the state of the round through `SimArenaView` and it reads the event bus for
 * the effects, so the display never reaches into a system of the simulation.
 */
import { loadDefaultTactics, loadTuning } from "./core/data.js";
import { EventBus, type GameEvent } from "./core/events.js";
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
import { SimArenaView, eventCell } from "./render/arenaView.js";
import { NeonStage } from "./render/neonStage.js";
import {
  PICKUP_GLYPHS,
  themeForMatch,
  DEFAULT_THEME,
  type NeonTheme,
} from "./render/neonThemes.js";
import { SimRunner, type Frame, type Speed } from "./render/runner.js";
import type { WeaponVisualHints } from "./render/vfxLayer.js";
import {
  createRoundState,
  DEFAULT_ROLES,
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
import { createBotStatus } from "./ui/botStatus.js";
import { createSpeedControls } from "./ui/speedControls.js";
import { openTacticsScreen } from "./ui/tacticsScreen.js";

const INITIAL_SPEED: Speed = 1;
const KILL_FEED_LINES = 8;
/** The seed of a session. Milestone M11 takes it from the run generator. */
const SEED = Math.floor(Date.now() / 1000);
/** The id that an interception shot carries in place of a bot id. */
const PROJECTILE_PREFIX = "projectile:";

function showError(error: unknown): void {
  const box = document.createElement("pre");
  box.className = "error";
  box.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  document.querySelector("#arena")?.replaceChildren(box);
}

/** The legend takes its colors from the palette of the match. */
function buildLegend(theme: NeonTheme, directional: boolean): string {
  const items: [string, string, string][] = [
    ["#", "wall", theme.wallLit],
    ["▖", "cover", theme.cover],
    ["≈", "hazard", theme.hazard],
    ["○", "spawn", theme.spawn],
    [PICKUP_GLYPHS.weapon.ch, "weapon", PICKUP_GLYPHS.weapon.color],
    [PICKUP_GLYPHS.armor.ch, "armor", PICKUP_GLYPHS.armor.color],
    [PICKUP_GLYPHS.health.ch, "health", PICKUP_GLYPHS.health.color],
    [PICKUP_GLYPHS.powerup.ch, "powerup", PICKUP_GLYPHS.powerup.color],
    [PICKUP_GLYPHS.ammo.ch, "ammo", PICKUP_GLYPHS.ammo.color],
    [directional ? "→" : "@", "team A", theme.teamA],
    [directional ? "→" : "@", "team B", theme.teamB],
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

/** The four weapon numbers that an event carries for the display. */
function visualHints(value: unknown): WeaponVisualHints {
  if (typeof value !== "object" || value === null) return {};
  const data = value as Record<string, unknown>;
  const read = (key: string): number | undefined => {
    const field = data[key];
    return typeof field === "number" ? field : undefined;
  };
  return {
    projectileSpeed: read("projectileSpeed"),
    aoeRadius: read("aoeRadius"),
    coneHalfAngle: read("coneHalfAngle"),
    rangeMax: read("rangeMax"),
  };
}

function readString(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

try {
  const arenaHost = document.querySelector<HTMLElement>("#arena");
  const meta = document.querySelector<HTMLElement>("#meta");
  const legend = document.querySelector<HTMLElement>("#legend");
  const controls = document.querySelector<HTMLElement>("#controls");
  const statusHost = document.querySelector<HTMLElement>("#status");
  const scoreHost = document.querySelector<HTMLElement>("#score");
  const feedHost = document.querySelector<HTMLElement>("#feed");
  const botsHost = document.querySelector<HTMLElement>("#bots");
  const stageHost = document.querySelector<HTMLElement>("#stage");
  if (
    !arenaHost ||
    !meta ||
    !legend ||
    !controls ||
    !statusHost ||
    !scoreHost ||
    !feedHost ||
    !botsHost ||
    !stageHost
  ) {
    throw new Error("index.html is missing one of the elements that main.ts needs");
  }
  const metaEl: HTMLElement = meta;
  const legendEl: HTMLElement = legend;
  const statusEl: HTMLElement = statusHost;
  const scoreEl: HTMLElement = scoreHost;
  const feedEl: HTMLElement = feedHost;
  const botStatus = createBotStatus({ container: botsHost });
  const stageEl: HTMLElement = stageHost;

  const config = simConfigFromTuning(loadTuning());

  const stage = new NeonStage(arenaHost, { seed: SEED });
  const view = new SimArenaView({ directional: config.directionalVision });
  stage.setTheme(DEFAULT_THEME);
  legendEl.innerHTML = buildLegend(DEFAULT_THEME, config.directionalVision);

  // ------------------------------------------------------------------------
  // The state of the match on the screen. It is replaced on every new match.
  // ------------------------------------------------------------------------
  let session: Session | null = null;
  let setup: MatchSetup | null = null;
  let bus = new EventBus();
  let state: SimState | null = null;
  let plan: MatchPlan = {};
  let rounds: RoundOutcome[] = [];
  let roundWins: Record<TeamId, number> = { A: 0, B: 0 };
  let matchWinner: TeamId | null = null;
  let roundNumber = 1;
  let screen: Screen | null = null;
  /** The number of events that the kill feed has drawn. It saves a rebuild. */
  let drawnEvents = -1;

  function closeScreen(): void {
    screen?.close();
    screen = null;
  }

  function teamColor(teamId: "A" | "B" | null): string {
    const theme = stage.getTheme();
    return teamId === "B" ? theme.teamB : theme.teamA;
  }

  // ------------------------------------------------------------------------
  // The effects (Section 7.18). Each one answers an event: the display reads
  // what happened, it does not ask a system what it is doing.
  // ------------------------------------------------------------------------

  /** The cell of the thing that a shot points at. It can be another shot. */
  function targetCell(targetId: string | null): { x: number; y: number } | null {
    if (targetId === null) return null;
    if (targetId.startsWith(PROJECTILE_PREFIX)) {
      const id = Number(targetId.slice(PROJECTILE_PREFIX.length));
      return Number.isFinite(id) ? view.cellOfProjectile(id) : null;
    }
    return view.cellOfBot(targetId);
  }

  function onShot(event: GameEvent): void {
    const shooterId = readString(event.data, "shooterId");
    if (shooterId === null) return;
    const from = view.cellOfBot(shooterId);
    const to = targetCell(readString(event.data, "targetId"));
    if (!from || !to) return;
    stage.vfx.shot({
      from,
      to,
      attackType: readString(event.data, "attackType") ?? undefined,
      weapon: visualHints(event.data["visual"]),
      color: teamColor(view.teamOfBot(shooterId)),
    });
  }

  function onHit(event: GameEvent): void {
    const targetId = readString(event.data, "targetId");
    if (targetId === null) return;
    const damage = event.data["damage"];
    stage.vfx.spark(view.cellOfBot(targetId), typeof damage === "number" ? damage : 8);
  }

  function onDeath(event: GameEvent): void {
    const teamId = readString(event.data, "teamId");
    stage.vfx.death(eventCell(event.data["cell"]), teamColor(teamId === "B" ? "B" : "A"));
  }

  function onSpawn(event: GameEvent): void {
    const teamId = readString(event.data, "teamId");
    stage.vfx.spawnIn(eventCell(event.data["cell"]), teamColor(teamId === "B" ? "B" : "A"));
  }

  /** Listen to the bus of the match. A new match makes a new bus. */
  function listen(): void {
    bus.on("Shot", onShot);
    bus.on("Hit", onHit);
    bus.on("Death", onDeath);
    bus.on("Spawn", onSpawn);
  }

  // ------------------------------------------------------------------------
  // The frame
  // ------------------------------------------------------------------------

  /** The score, the bot status, the kill feed and the status line. */
  function updatePanel(): void {
    if (!state) {
      botStatus.update(null, stage.getTheme());
      return;
    }
    const theme = stage.getTheme();
    botStatus.update(state, theme);
    const [teamA, teamB] = TEAM_IDS;
    scoreEl.innerHTML = [
      `<span style="color:${theme.teamA}">A ${state.score[teamA]}</span>`,
      `<span class="dim">—</span>`,
      `<span style="color:${theme.teamB}">${state.score[teamB]} B</span>`,
      `<span class="dim">to ${state.config.scoreLimit}</span>`,
      `<span class="dim">· rounds ${roundWins[teamA]}–${roundWins[teamB]}</span>`,
    ].join(" ");

    // The feed only changes when an event arrives, so it is not rebuilt at the
    // rate of the screen.
    if (bus.log.length !== drawnEvents) {
      drawnEvents = bus.log.length;
      feedEl.replaceChildren();
      for (const line of feedLines(bus.log, KILL_FEED_LINES)) {
        const item = document.createElement("li");
        item.textContent = line.text;
        if (line.kind !== "kill") item.className = `announce ${line.kind}`;
        feedEl.append(item);
      }
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

  /** One animation frame: the panel, the grid, then the effects on top. */
  function onFrame(frame: Frame): void {
    view.interp = frame.interp;
    updatePanel();
    stage.draw(view, frame.now, frame.dt);
  }

  /** Start a round and point the display at it. */
  function beginRound(): void {
    if (!setup) return;
    state = createRoundState(matchOptions(), roundNumber, plan, setup.spawnTable, config, bus);
    stage.vfx.clear();
    view.setState(state);
    drawnEvents = -1;
    speedControls.setEnabled(true);
    speedControls.setSpeed(INITIAL_SPEED);
    runner.setSpeed(INITIAL_SPEED);
    updatePanel();
  }

  // ------------------------------------------------------------------------
  // The match loop
  // ------------------------------------------------------------------------

  /** Build the arena and the first round of the next match of the session. */
  function startMatch(): void {
    if (!session) return;
    setup = nextMatch(session);
    bus = new EventBus();
    listen();
    rounds = [];
    roundWins = { A: 0, B: 0 };
    matchWinner = null;
    roundNumber = 1;
    plan = {
      A: { tactics: plan.A?.tactics ?? loadDefaultTactics(), roles: [...(plan.A?.roles ?? DEFAULT_ROLES)] },
      B: { tactics: loadDefaultTactics(), roles: [...DEFAULT_ROLES] },
    };

    // A match gets its own palette from the seed of the session, so a run has
    // a look of its own and a replay of the run looks the same (Section 7.1).
    const theme = themeForMatch(session.seed, setup.matchNumber);
    stage.setTheme(theme);
    stage.setSize(setup.arena.width, setup.arena.height);
    legendEl.innerHTML = buildLegend(theme, config.directionalVision);

    bus.emit("MatchStart", 0, 0, {
      matchId: `match-${setup.seed}`,
      arena: setup.arena.name,
      weapons: setup.weapons.map((weapon) => weapon.id),
      spawnTable: setup.spawnTable.slots,
    });

    metaEl.textContent = [
      `${session.mode === "tournament" ? "Tournament" : "Test"} · match ${setup.matchNumber}`,
      `${setup.arena.profile.style} ${setup.arena.width}×${setup.arena.height}`,
      `best of ${config.maxRounds}`,
      theme.name,
    ].join("  ·  ");

    beginRound();
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
      updatePanel();
      endMatch();
      return;
    }

    updatePanel();
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
        beginRound();
      },
    });
  }

  // ------------------------------------------------------------------------
  // The menu
  // ------------------------------------------------------------------------

  function showMenu(): void {
    runner.setSpeed(0);
    speedControls.setEnabled(false);
    // The panel reads `state`. Clearing it stops the last match writing over
    // the panel while the menu is open.
    state = null;
    setup = null;
    view.setState(null);
    stage.vfx.clear();
    statusEl.textContent = "Pick a mode.";
    metaEl.textContent = `main menu  ·  seed ${SEED}`;
    scoreEl.textContent = "";
    feedEl.replaceChildren();
    drawnEvents = -1;
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
      // The cells of the bots before the step are what the glide reads from.
      view.beginTick();
      step(state);
      view.endTick();
      if (state.outcome !== null) endRound();
    },
    onRender: onFrame,
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
      // The whole round ran in one frame. The effects of it never had a frame
      // to draw in, so they go, and the arena is left as the round left it.
      stage.vfx.clear();
      view.setState(state);
      endRound();
    },
  });

  showMenu();
  runner.start();
} catch (error) {
  showError(error);
}
