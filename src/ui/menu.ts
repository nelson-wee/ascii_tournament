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
import {
  describeTicket,
  formatTicket,
  parseTicket,
  ticketWarning,
  type ReplayTicket,
} from "../meta/ticket.js";
import { loadTickets, removeTicket, type SavedTicket } from "./ticketStore.js";

/**
 * What the menu gives back. It is a replay ticket, so a match that a player
 * started by hand and a match that a player opened from a link are the same
 * thing to the game (Section 7.23).
 */
export type MenuChoice = ReplayTicket;

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
  /** Filled into the replay box when the menu opens. */
  initialTicket?: string;
}

/** A ticket for a match that a player started from the menu, not from a link. */
function freshTicket(mode: SessionMode, style: ArenaStyle | null, seed: number): ReplayTicket {
  return { seed, matchNumber: 1, style, mode, overrides: {}, build: null };
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
      options.onStart(freshTicket("tournament", null, options.seed)),
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
        options.onStart(freshTicket("test", style, options.seed)),
      ),
    );
  }
  test.append(styles);
  screen.append(test);

  screen.append(replayGroup(options));

  return { close: () => screen.remove() };
}

/**
 * The replay box: a seed or a ticket, and the tickets that were saved before.
 *
 * A ticket names one match exactly, and its three seeds are independent, so a
 * player can keep the ground and change only the weapons (Section 7.23).
 */
function replayGroup(options: MainMenuOptions): HTMLElement {
  const group = document.createElement("div");
  group.className = "menu-group";
  const title = document.createElement("h3");
  title.textContent = "Replay";
  const text = document.createElement("p");
  text.className = "dim";
  text.textContent =
    "Type a seed, or paste a ticket. A ticket names one match exactly. Add weapons= or spawn= to a ticket to keep the ground and change only the loadout.";
  group.append(title, text);

  const row = document.createElement("div");
  row.className = "menu-row";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "ticket-input";
  input.spellcheck = false;
  input.placeholder = `seed=${options.seed}&match=1&style=bastion&mode=test`;
  input.value = options.initialTicket ?? "";
  input.setAttribute("aria-label", "seed or replay ticket");
  const note = document.createElement("p");
  note.className = "dim ticket-note";

  const open = (): void => {
    const ticket = parseTicket(input.value);
    if (ticket === null) {
      note.textContent = "That is not a seed or a ticket. Type a number, or paste a whole ticket.";
      input.focus();
      return;
    }
    options.onStart(ticket);
  };

  const describe = (): void => {
    const ticket = parseTicket(input.value);
    if (ticket === null) {
      note.textContent = "";
      return;
    }
    // A ticket from another build still runs. It gives a different match, and
    // the player must know which of the two they are looking at.
    note.textContent = ticketWarning(ticket) ?? describeTicket(ticket);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") open();
  });
  input.addEventListener("input", describe);
  // A prefilled box fires no input event, and a ticket that came from an
  // address is exactly the one a reader most needs described.
  describe();

  row.append(input, button("Open", open, true));
  group.append(row, note);

  const saved = loadTickets();
  if (saved.length > 0) group.append(savedList(saved, options.onStart));
  return group;
}

/** The saved tickets, newest first. Each row opens or forgets one. */
function savedList(saved: readonly SavedTicket[], onStart: (choice: MenuChoice) => void): HTMLElement {
  const list = document.createElement("ul");
  list.className = "tickets";
  list.setAttribute("aria-label", "saved matches");

  const draw = (rows: readonly SavedTicket[]): void => {
    list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement("li");
      const name = document.createElement("b");
      name.textContent = row.label === "" ? describeTicket(row.ticket) : row.label;
      const where = document.createElement("span");
      where.className = "dim";
      where.textContent = formatTicket(row.ticket);
      const actions = document.createElement("span");
      actions.className = "ticket-actions";
      actions.append(
        button("Open", () => onStart(row.ticket)),
        button("Forget", () => draw(removeTicket(row.ticket))),
      );
      item.append(name, where, actions);
      list.append(item);
    }
  };

  draw(saved);
  return list;
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
  /**
   * The ticket of the match that just ended, so a player can keep a match that
   * was worth keeping (Section 7.23). Absent when there is nothing to save.
   */
  ticket?: ReplayTicket;
  onSave?: (ticket: ReplayTicket, label: string) => void;
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

  const { ticket, onSave } = options;
  if (ticket && onSave) screen.append(saveRow(ticket, onSave));

  const buttons = document.createElement("div");
  buttons.className = "menu-styles";
  buttons.append(
    button(options.mode === "tournament" ? "Start the next match" : "New test arena", options.onNext, true),
    button("Main menu", options.onMenu),
  );
  screen.append(buttons);

  return { close: () => screen.remove() };
}

/** Keep the match that just ended, with a name that the player gives it. */
function saveRow(
  ticket: ReplayTicket,
  onSave: (ticket: ReplayTicket, label: string) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "menu-group";
  const title = document.createElement("h3");
  title.textContent = "Keep this match";
  const text = document.createElement("p");
  text.className = "dim";
  text.textContent = formatTicket(ticket);
  group.append(title, text);

  const row = document.createElement("div");
  row.className = "menu-row";
  const label = document.createElement("input");
  label.type = "text";
  label.className = "ticket-input";
  label.placeholder = "a name for it, if you want one";
  label.setAttribute("aria-label", "a name for this match");
  const done = document.createElement("p");
  done.className = "dim ticket-note";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "choice";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    onSave(ticket, label.value.trim());
    // The store can be blocked or full, and it says nothing when it is. The
    // ticket text above is the record that always works.
    done.textContent = "Saved to this browser. The ticket above works anywhere.";
    save.disabled = true;
  });

  row.append(label, save);
  group.append(row, done);
  return group;
}
