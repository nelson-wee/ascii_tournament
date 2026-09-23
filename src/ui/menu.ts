/**
 * The main menu and the between-match screen (dev-guide Section 7.18).
 * Browser only.
 *
 * Two modes (Section 7.20.20):
 *
 * - **Tournament.** Matches follow each other with no break. Each one gets a
 *   new arena, and the styles take their turn, so a session plays on every kind
 *   of ground.
 * - **Test.** One arena style, chosen by the player, with a new arena and a new
 *   weapon set on every press. It is the mode to watch a change in.
 */
import { ARENA_STYLES, type ArenaStyle } from "../arena/generate.js";
import type { ArenaMetrics } from "../arena/metrics.js";
import { describeArena } from "../arena/metrics.js";
import type { SessionMode } from "../meta/session.js";

export interface MenuChoice {
  mode: SessionMode;
  /** `null` cycles the styles. Tournament mode uses that. */
  style: ArenaStyle | null;
  seed: number;
}

export interface Screen {
  close(): void;
}

function screenBox(container: HTMLElement, title: string): HTMLElement {
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-label", title);
  const heading = document.createElement("h2");
  heading.textContent = title;
  screen.append(heading);
  container.append(screen);
  return screen;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = primary ? "start" : "choice";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

/** The style names, in words a player reads. */
const STYLE_TEXT: Readonly<Record<ArenaStyle, string>> = {
  bastion: "Bastion — rooms and corridors. Close quarters.",
  openfield: "Open field — obstacles in the open. Long fire lanes.",
  cavern: "Cavern — an organic cave. No straight lane.",
};

export interface MainMenuOptions {
  container: HTMLElement;
  seed: number;
  onStart: (choice: MenuChoice) => void;
}

/** Open the main menu. It stays until the player picks a mode. */
export function openMainMenu(options: MainMenuOptions): Screen {
  const screen = screenBox(options.container, "ASCII Bot Shooter");

  const lead = document.createElement("p");
  lead.className = "dim";
  lead.textContent =
    "You set the tactics. The bots fight. Pick a mode to start.";
  screen.append(lead);

  const tournament = document.createElement("div");
  tournament.className = "menu-group";
  const tournamentTitle = document.createElement("h3");
  tournamentTitle.textContent = "Tournament";
  const tournamentText = document.createElement("p");
  tournamentText.className = "dim";
  tournamentText.textContent =
    "Best-of-3 matches, one after another. Every match builds a new arena, and the three styles take their turn. A match that is lost is followed by the next one.";
  tournament.append(
    tournamentTitle,
    tournamentText,
    button("Start a tournament", () =>
      options.onStart({ mode: "tournament", style: null, seed: options.seed }),
    true),
  );
  screen.append(tournament);

  const test = document.createElement("div");
  test.className = "menu-group";
  const testTitle = document.createElement("h3");
  testTitle.textContent = "Test arena";
  const testText = document.createElement("p");
  testText.className = "dim";
  testText.textContent =
    "One style, a new arena and a new weapon set on every press. Use it to watch a change.";
  test.append(testTitle, testText);

  const styles = document.createElement("div");
  styles.className = "menu-styles";
  for (const style of ARENA_STYLES) {
    styles.append(
      button(STYLE_TEXT[style], () =>
        options.onStart({ mode: "test", style, seed: options.seed }),
      ),
    );
  }
  test.append(styles);
  screen.append(test);

  return { close: () => screen.remove() };
}

export interface MatchOverOptions {
  container: HTMLElement;
  mode: SessionMode;
  /** The match that just ended. */
  matchNumber: number;
  winnerTeamId: "A" | "B" | null;
  roundWins: Record<"A" | "B", number>;
  tally: string;
  /** The arena of the match that starts next. */
  nextArenaName: string;
  nextMetrics: ArenaMetrics;
  onNext: () => void;
  onMenu: () => void;
}

/**
 * The screen between two matches.
 *
 * It says how the last match ended, how the session stands, and what the next
 * arena looks like, so the player can set tactics for the ground ahead
 * (Section 7.2: the pre-match screen describes the arena in plain words).
 */
export function openMatchOverScreen(options: MatchOverOptions): Screen {
  const result =
    options.winnerTeamId === null
      ? `Match ${options.matchNumber} drawn`
      : `Team ${options.winnerTeamId} wins match ${options.matchNumber}`;
  const screen = screenBox(options.container, result);

  const score = document.createElement("p");
  score.textContent = `Rounds ${options.roundWins.A}–${options.roundWins.B}. ${options.tally}`;
  screen.append(score);

  const next = document.createElement("div");
  next.className = "menu-group";
  const nextTitle = document.createElement("h3");
  nextTitle.textContent =
    options.mode === "tournament" ? `Next: ${options.nextArenaName}` : `New arena: ${options.nextArenaName}`;
  const nextText = document.createElement("p");
  nextText.className = "dim";
  nextText.textContent = describeArena(options.nextMetrics).join(" ");
  next.append(nextTitle, nextText);
  screen.append(next);

  const buttons = document.createElement("div");
  buttons.className = "menu-styles";
  buttons.append(
    button(options.mode === "tournament" ? "Start the next match" : "New test arena", options.onNext, true),
    button("Main menu", options.onMenu),
  );
  screen.append(buttons);

  return { close: () => screen.remove() };
}
