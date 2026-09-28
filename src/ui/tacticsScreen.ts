/**
 * The team screen (dev-guide Sections 7.4, 7.18 and 7.26). Browser only.
 *
 * It opens before round 1 of a match and between two rounds. The player builds
 * a team by giving each of the three bots a **role**, and the role owns that
 * bot's tactics.
 *
 * **It used to hold seven sliders, and they did nothing that could be
 * measured.** Seven continuous values over a team cannot be swept by a batch,
 * so they read as noise; worse, they were applied team-wide and threw the role
 * presets away, so a tank and an overwatch differed only by six action
 * weights. A composition is one categorical choice with ten values, which a
 * batch can sweep and a player can learn.
 *
 * The screen holds no simulation state: it takes a plan, it gives a plan back,
 * and the match loop does the rest.
 */
import type { RoundBrief } from "../report/roundBrief.js";
import { describeArena, type ArenaMetrics } from "../arena/metrics.js";
import { loadRoles } from "../core/data.js";
import type { Role, RoundOutcome, TeamId } from "../sim/state.js";
import { ROLES } from "../sim/state.js";

/** What each role is for, in the words a player reads. */
const ROLE_TEXT: Readonly<Record<string, string>> = {
  tank: "Walks in. Close range, heavy weapons, takes the items and the hazards.",
  overwatch: "Holds a sightline. Long range, marksman weapons, moves least.",
  skirmisher: "Works the middle. Dodges most, follows a teammate, takes no ground.",
};

export interface TacticsScreenOptions {
  container: HTMLElement;
  teamId: TeamId;
  /** The role of each bot of the team, in slot order. */
  roles: readonly Role[];
  /** The rounds of this match so far, newest last. */
  rounds: readonly RoundOutcome[];
  roundWins: Readonly<Record<TeamId, number>>;
  /** The number of the round that starts next. */
  nextRoundNumber: number;
  /**
   * True when the team starts this round on the near half.
   *
   * The caller works it out with `teamSideIndex`, because the half comes from
   * the round number **and** the offset that the match seed gives
   * (Section 7.20.24). The parity of the round number alone was wrong for half
   * of all matches.
   */
  startsNear: boolean;
  /** The ground, on the screen that opens before round 1 (Section 7.24). */
  arenaName?: string;
  arenaMetrics?: ArenaMetrics;
  /**
   * What the round that just ended looked like (Section 7.25).
   *
   * A score says who won. It does not say where the fighting happened, which
   * weapon did the work, or how fast the round ran, and a tactic is a guess
   * without those.
   */
  brief?: RoundBrief;
  /** The player pressed "start the round". */
  onStart: (roles: Role[]) => void;
}

export interface TacticsScreen {
  /** Take the screen off the page. */
  close(): void;
}

/** One row of a small table: a label and a value. */
function stat(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "brief-stat";
  const name = document.createElement("span");
  name.className = "dim";
  name.textContent = label;
  const text = document.createElement("b");
  text.textContent = value;
  row.append(name, text);
  return row;
}

const BAND_WORDS: Readonly<Record<string, string>> = {
  close: "close",
  mid: "mid",
  long: "long",
};

/**
 * What the last round did (Section 7.25), in two views (Section 7.27).
 *
 * **The round** says where the fighting happened, which weapons did it, and
 * how fast it ran. **By bot** says which bot did it, with its role, its kills
 * and deaths, and the weapons it killed with. The round view cannot answer
 * "does this role earn its place on this ground"; the per-bot view can, and
 * that is the question a player asks before they change a composition.
 */
function briefBlock(brief: RoundBrief): HTMLElement {
  const group = document.createElement("div");
  group.className = "menu-group";

  const head = document.createElement("div");
  head.className = "menu-row brief-head";
  const heading = document.createElement("h3");
  heading.textContent = `Round ${brief.roundNumber}: what happened`;
  head.append(heading);

  const body = document.createElement("div");
  const roundView = roundBlock(brief);
  const botView = botBlock(brief);

  let showingBots = false;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "choice";
  const draw = (): void => {
    toggle.textContent = showingBots ? "Show the round" : "Show each bot";
    toggle.setAttribute("aria-pressed", String(showingBots));
    body.replaceChildren(showingBots ? botView : roundView);
  };
  toggle.addEventListener("click", () => {
    showingBots = !showingBots;
    draw();
  });
  // A bot view with no bots would be an empty panel, so the toggle only
  // appears when the caller gave the bots.
  if (brief.bots.length > 0) head.append(toggle);

  draw();
  group.append(head, body);
  return group;
}

/** The round view: bands, rhythm, weapons and items. */
function roundBlock(brief: RoundBrief): HTMLElement {
  const wrap = document.createElement("div");

  const kills = brief.kills.A + brief.kills.B;
  const bands = document.createElement("div");
  bands.className = "brief-stats";
  for (const band of ["close", "mid", "long"]) {
    const count = brief.killsByBand[band] ?? 0;
    const share = kills === 0 ? 0 : Math.round((count / kills) * 100);
    bands.append(stat(`${BAND_WORDS[band] ?? band} kills`, `${count}  (${share} %)`));
  }
  bands.append(stat("kill every", `${brief.killGapSeconds.toFixed(1)} s`));
  bands.append(stat("a fight lasts", `${brief.timeToKillSeconds.toFixed(1)} s`));
  bands.append(stat("in contact", `${Math.round(brief.contactShare * 100)} %`));
  if (brief.unawareKills > 0) bands.append(stat("killed from behind", String(brief.unawareKills)));
  wrap.append(bands);

  if (brief.weapons.length > 0) {
    const list = document.createElement("ul");
    list.className = "brief-weapons";
    // The weapons that made a kill, most kills first. A weapon that made none
    // is not on this list, and that is itself an answer.
    for (const weapon of brief.weapons.slice(0, 6)) {
      const item = document.createElement("li");
      item.textContent =
        `${weapon.weaponId} (${weapon.archetype}) — ${weapon.kills} ` +
        `${weapon.kills === 1 ? "kill" : "kills"}, mostly at ${BAND_WORDS[weapon.band] ?? weapon.band} range`;
      list.append(item);
    }
    wrap.append(list);
  }

  const taken = Object.entries(brief.pickupsByKind).sort((a, b) => b[1] - a[1]);
  if (taken.length > 0) {
    const items = document.createElement("p");
    items.className = "dim";
    items.textContent = `items taken: ${taken.map(([kind, count]) => `${count}× ${kind}`).join("  ·  ")}`;
    wrap.append(items);
  }
  return wrap;
}

/** Kills over deaths, as a reader wants to see it. */
function ratioText(bot: RoundBrief["bots"][number]): string {
  if (bot.deaths === 0) return bot.kills === 0 ? "—" : `${bot.kills}.0`;
  return (bot.kills / bot.deaths).toFixed(2);
}

/** The per-bot view: one row a bot, team A first (Section 7.27). */
function botBlock(brief: RoundBrief): HTMLElement {
  const wrap = document.createElement("div");
  const list = document.createElement("ul");
  list.className = "brief-bots";

  for (const bot of brief.bots) {
    const item = document.createElement("li");
    item.className = bot.teamId === "B" ? "bot-row away" : "bot-row";

    const name = document.createElement("b");
    name.textContent = `${bot.botId} ${bot.role}`;
    const score = document.createElement("span");
    score.className = "brief-kd";
    score.textContent = `${bot.kills}/${bot.deaths}  (${ratioText(bot)})`;

    const where = document.createElement("span");
    where.className = "dim";
    const bands = (["close", "mid", "long"] as const)
      .map((band) => `${band[0]}${bot.byBand[band] ?? 0}`)
      .join(" ");
    const flank = bot.unawareKills > 0 ? `, ${bot.unawareKills} from behind` : "";
    where.textContent = `${bands}  ·  in contact ${Math.round(bot.contactShare * 100)} %${flank}`;

    const guns = document.createElement("span");
    guns.className = "dim";
    guns.textContent =
      bot.weapons.length === 0
        ? "no kill"
        : bot.weapons
            .slice(0, 3)
            .map((weapon) => `${weapon.weaponId} ×${weapon.kills}`)
            .join("  ·  ");

    item.append(name, score, where, guns);
    list.append(item);
  }

  const legend = document.createElement("p");
  legend.className = "dim";
  legend.textContent = "kills/deaths (ratio) · kills by band, close mid long · the weapons it killed with";
  wrap.append(list, legend);
  return wrap;
}

/**
 * What every role does, side by side (Section 7.26).
 *
 * A player cannot choose between three roles without reading them, and the
 * numbers live in `data/roles.json`, so the table reads them instead of
 * repeating them.
 */
function roleTable(): HTMLElement {
  const group = document.createElement("div");
  group.className = "menu-group";
  const heading = document.createElement("h3");
  heading.textContent = "What the roles do";
  group.append(heading);

  const roles = loadRoles().roles;
  const list = document.createElement("ul");
  list.className = "brief-weapons";
  for (const name of ROLES) {
    const data = roles[name];
    if (!data) continue;
    const item = document.createElement("li");
    const title = document.createElement("b");
    title.textContent = name;
    const body = document.createElement("span");
    body.className = "dim";
    body.textContent =
      ` — range ${data.tactics.rangePref.join(" > ")}` +
      `; weapons ${data.tactics.weaponPref.slice(0, 3).join(" > ")}` +
      `; aggression ${Math.round(data.tactics.aggression * 100)}` +
      `, holds ${Math.round(data.tactics.holdPosition * 100)}` +
      `, dodges ${Math.round(data.tactics.evasion * 100)}`;
    item.append(title, body);
    list.append(item);
  }
  group.append(list);
  return group;
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
  const roles: Role[] = [...options.roles];

  const screen = document.createElement("section");
  screen.className = "screen";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-label", "the team for the next round");

  const title = document.createElement("h2");
  title.textContent = `Round ${options.nextRoundNumber} — build team ${options.teamId}`;
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

  // The ground, before round 1. A player sets tactics for the arena ahead, and
  // before this screen opened the first round of a match ran on the tactics of
  // the match before it (Section 7.24).
  const { arenaName, arenaMetrics } = options;
  if (arenaName !== undefined) {
    const where = document.createElement("h3");
    where.textContent = arenaName;
    screen.append(where);
    if (arenaMetrics !== undefined) {
      const words = document.createElement("p");
      words.className = "dim";
      words.textContent = describeArena(arenaMetrics).join(" ");
      screen.append(words);
    }
  }

  const { brief } = options;
  if (brief !== undefined) screen.append(briefBlock(brief));

  // The teams change ends after every round (Section 7.20.24). The player has
  // to know: the ground that the team starts on decides the first fight.
  const ends = document.createElement("p");
  ends.className = "dim";
  const side = options.startsNear ? "the near end" : "the far end";
  ends.textContent = `Teams change ends. Team ${options.teamId} starts this round at ${side}.`;
  screen.append(ends);

  const form = document.createElement("div");
  form.className = "tactics";

  // A composition line, so the player reads the team as counts and not as
  // three separate answers: "2 tank · 1 overwatch" (Section 7.26).
  const composition = document.createElement("p");
  composition.className = "dim";
  const drawSummary = (): void => {
    const counts = new Map<string, number>();
    for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1);
    composition.textContent = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([role, count]) => `${count} ${role}`)
      .join("  ·  ");
  };

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
      drawSummary();
    });
    form.append(field(`bot ${slot + 1}`, ROLE_TEXT[role] ?? "role", select));
  });

  drawSummary();
  screen.append(composition, form);
  screen.append(roleTable());

  const start = document.createElement("button");
  start.type = "button";
  start.className = "start";
  start.textContent = `Start round ${options.nextRoundNumber}`;
  start.addEventListener("click", () => {
    options.onStart([...roles]);
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
