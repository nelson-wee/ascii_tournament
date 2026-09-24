/**
 * The between-round tactics screen (dev-guide Sections 7.4 and 7.18).
 * Browser only.
 *
 * The screen opens after a round of a match ends and before the next round
 * starts. The player sets the tactics of Section 6.4 and the role of each bot
 * (Section 7.11) for their own team. The other team keeps the tactics that the
 * match gave it.
 *
 * The screen holds no simulation state: it takes a plan, it gives a plan back,
 * and the match loop does the rest.
 */
import type { Tactics } from "../core/schemas.js";
import type { Role, RoundOutcome, TeamId } from "../sim/state.js";
import { ROLES } from "../sim/state.js";
import type { RangeBand } from "../weapons/types.js";

/** Every tactics value that the screen shows, in the order it shows them. */
const SLIDERS: readonly { key: keyof Tactics; label: string; help: string }[] = [
  { key: "aggression", label: "aggression", help: "press the fight, fight at low health" },
  { key: "itemControl", label: "item control", help: "cross the arena for a pickup" },
  { key: "holdPosition", label: "hold position", help: "keep a sightline, take no items" },
  { key: "evasion", label: "evasion", help: "dodge more, aim worse" },
  { key: "hazardTolerance", label: "hazard nerve", help: "walk over a hazard tile" },
];

const RANGES: readonly RangeBand[] = ["close", "mid", "long"];

/**
 * The archetypes a player can name as the tournament weapon priority. The
 * Redeemer is not here: it is a power-up, not a weapon a run generates
 * (Section 7.20.18).
 */
type WeaponPref = NonNullable<Tactics["weaponRolePref"]>;

const WEAPON_PREFS: readonly (WeaponPref | "")[] = [
  "",
  "precision",
  "assault",
  "marksman",
  "heavy",
  "splash",
  "denial",
  "versatile",
];

export interface TacticsScreenOptions {
  container: HTMLElement;
  teamId: TeamId;
  /** The tactics that the team used in the round that just ended. */
  tactics: Tactics;
  /** The role of each bot of the team, in slot order. */
  roles: readonly Role[];
  /** The rounds of this match so far, newest last. */
  rounds: readonly RoundOutcome[];
  roundWins: Readonly<Record<TeamId, number>>;
  /** The number of the round that starts next. */
  nextRoundNumber: number;
  /** The player pressed "start the round". */
  onStart: (tactics: Tactics, roles: Role[]) => void;
}

export interface TacticsScreen {
  /** Take the screen off the page. */
  close(): void;
}

function field(label: string, help: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("label");
  row.className = "tactic";
  const name = document.createElement("span");
  name.className = "tactic-name";
  name.textContent = label;
  const hint = document.createElement("span");
  hint.className = "tactic-help dim";
  hint.textContent = help;
  row.append(name, control, hint);
  return row;
}

/**
 * Open the screen. It covers the arena until the player starts the round.
 */
export function openTacticsScreen(options: TacticsScreenOptions): TacticsScreen {
  const { container } = options;
  const tactics: Tactics = { ...options.tactics };
  const roles: Role[] = [...options.roles];

  const screen = document.createElement("section");
  screen.className = "screen";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-label", "tactics for the next round");

  const title = document.createElement("h2");
  title.textContent = `Round ${options.nextRoundNumber} — team ${options.teamId} tactics`;
  screen.append(title);

  const summary = document.createElement("p");
  summary.className = "dim";
  const played = options.rounds
    .map((round, index) => {
      const winner = round.winnerTeamId === null ? "drawn" : `team ${round.winnerTeamId}`;
      return `R${index + 1} ${winner} ${round.score.A}–${round.score.B}`;
    })
    .join("  ·  ");
  summary.textContent =
    played === ""
      ? "The match starts now."
      : `${played}  ·  rounds won A ${options.roundWins.A} — ${options.roundWins.B} B`;
  screen.append(summary);

  // The teams change ends after every round (Section 7.20.24). The player has
  // to know: the ground that the team starts on decides the first fight.
  const ends = document.createElement("p");
  ends.className = "dim";
  const side = options.nextRoundNumber % 2 === 0 ? "the far end" : "the near end";
  ends.textContent = `Teams change ends. Team ${options.teamId} starts this round at ${side}.`;
  screen.append(ends);

  const form = document.createElement("div");
  form.className = "tactics";

  for (const slider of SLIDERS) {
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "5";
    input.value = String(Math.round((tactics[slider.key] as number) * 100));
    const readout = document.createElement("output");
    readout.textContent = input.value;
    input.addEventListener("input", () => {
      const value = Number(input.value);
      readout.textContent = input.value;
      (tactics[slider.key] as number) = value / 100;
    });
    const control = document.createElement("span");
    control.className = "tactic-control";
    control.append(input, readout);
    form.append(field(slider.label, slider.help, control));
  }

  const range = document.createElement("select");
  for (const band of RANGES) {
    const option = document.createElement("option");
    option.value = band;
    option.textContent = band;
    option.selected = band === tactics.preferredRange;
    range.append(option);
  }
  range.addEventListener("change", () => {
    tactics.preferredRange = range.value as RangeBand;
  });
  form.append(field("range", "the band a bot picks its weapon for", range));

  const pref = document.createElement("select");
  for (const archetype of WEAPON_PREFS) {
    const option = document.createElement("option");
    option.value = archetype;
    option.textContent = archetype === "" ? "any" : archetype;
    option.selected = archetype === (tactics.weaponRolePref ?? "");
    pref.append(option);
  }
  pref.addEventListener("change", () => {
    tactics.weaponRolePref = pref.value === "" ? null : (pref.value as WeaponPref);
  });
  form.append(field("weapon priority", "the archetype a bot reaches for first", pref));

  roles.forEach((role, slot) => {
    const select = document.createElement("select");
    for (const candidate of ROLES) {
      const option = document.createElement("option");
      option.value = candidate;
      option.textContent = candidate;
      option.selected = candidate === role;
      select.append(option);
    }
    select.addEventListener("change", () => {
      roles[slot] = select.value as Role;
    });
    form.append(field(`bot ${slot + 1}`, "role", select));
  });

  screen.append(form);

  const start = document.createElement("button");
  start.type = "button";
  start.className = "start";
  start.textContent = `Start round ${options.nextRoundNumber}`;
  start.addEventListener("click", () => {
    options.onStart({ ...tactics }, [...roles]);
  });
  screen.append(start);

  container.append(screen);
  start.focus();

  return {
    close(): void {
      screen.remove();
    },
  };
}
