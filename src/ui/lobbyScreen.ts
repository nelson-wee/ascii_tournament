/**
 * The match lobby (dev-guide Section 7.25). Browser only, test mode only.
 *
 * Between two matches a tournament gives a player no choice: new ground, and
 * the weapons that the session pinned. Test mode is for asking a question, and
 * a question needs a control. The lobby holds one, and it holds three:
 *
 *     ground        keep · reroll · a seed
 *     weapons       keep · reroll · a seed
 *     spawn table   keep · reroll · a seed
 *
 * **Keep one and reroll another, and the lobby is an experiment.** Hold a
 * layout and change the guns, and the difference belongs to the guns. Hold both
 * and change only where the items lie, and the difference belongs to the spawn
 * table. That is the same instrument that Section 7.20.26 used to find the side
 * bias, in the hands of the player.
 *
 * It opens **before** the tactics screen, because a player sets tactics for the
 * ground and the guns they can see.
 */
import { describeArena } from "../arena/metrics.js";
import type { MatchSeeds, MatchSetup } from "../meta/session.js";
import type { Screen } from "./menu.js";

/** Which of the three a control belongs to. */
const PARTS = ["arena", "weapons", "spawnTable"] as const;
type Part = (typeof PARTS)[number];

const PART_TEXT: Readonly<Record<Part, { title: string; help: string }>> = {
  arena: { title: "Ground", help: "The layout, the cover and the pickup points." },
  weapons: { title: "Weapons", help: "The set that both teams can pick up in this match." },
  spawnTable: {
    title: "Spawn table",
    help: "Which item lies on which point. The ground and the guns stay as they are.",
  },
};

export interface LobbyOptions {
  container: HTMLElement;
  /** The match that this lobby builds. It starts at 1. */
  matchNumber: number;
  /** The seeds the lobby opens on. */
  seeds: MatchSeeds;
  /**
   * Build a match from a set of seeds, so the lobby can show what a reroll
   * gave before the player takes it.
   */
  build: (seeds: MatchSeeds) => MatchSetup;
  /** Make a new seed for one part. It comes from the session stream. */
  reroll: (part: Part) => number;
  /** The player pressed "start the match". */
  onStart: (seeds: MatchSeeds) => void;
}

function base36(value: number): string {
  return (value >>> 0).toString(36);
}

/** Read a base-36 or base-10 seed. `null` when the text is not one. */
function readSeed(text: string): number | null {
  const body = text.trim();
  if (body === "") return null;
  const value = /^[0-9]+$/.test(body) ? Number(body) : Number.parseInt(body, 36);
  return Number.isFinite(value) ? value >>> 0 : null;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = primary ? "start" : "choice";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

/** The weapons of a set, in one short line each. */
function weaponLines(setup: MatchSetup): string[] {
  // The first weapon is the baseline that every bot already carries, so no
  // point offers it (Section 7.3). It is still in the set, and a player who
  // reads this list must not look for it on the ground.
  return setup.weapons.map((weapon, index) => {
    const tail = index === 0 ? " (carried by every bot)" : "";
    return `${weapon.name} — ${weapon.archetype}, ${weapon.tier}${tail}`;
  });
}

export function openLobbyScreen(options: LobbyOptions): Screen {
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-label", "match lobby");

  const title = document.createElement("h2");
  title.textContent = `Match ${options.matchNumber} — lobby`;
  const lead = document.createElement("p");
  lead.className = "dim";
  lead.textContent =
    "Keep one and reroll another, and the difference belongs to the one you changed.";
  screen.append(title, lead);

  let seeds: MatchSeeds = { ...options.seeds };
  let setup = options.build(seeds);

  // The body that each part draws into. The lobby rebuilds the match on every
  // change, so the player sees what they are about to start.
  const bodies: Record<Part, HTMLElement> = {
    arena: document.createElement("div"),
    weapons: document.createElement("div"),
    spawnTable: document.createElement("div"),
  };
  const seedFields: Record<Part, HTMLInputElement> = {
    arena: document.createElement("input"),
    weapons: document.createElement("input"),
    spawnTable: document.createElement("input"),
  };

  function drawArena(): void {
    const body = bodies.arena;
    body.replaceChildren();
    const name = document.createElement("b");
    name.textContent = `${setup.arena.profile.style} ${setup.arena.width}×${setup.arena.height}`;
    const words = document.createElement("p");
    words.className = "dim";
    words.textContent = describeArena(setup.arena.metrics).join(" ");
    body.append(name, words);
  }

  function drawWeapons(): void {
    const body = bodies.weapons;
    body.replaceChildren();
    const list = document.createElement("ul");
    list.className = "lobby-weapons";
    for (const line of weaponLines(setup)) {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    }
    body.append(list);
  }

  function drawSpawnTable(): void {
    const body = bodies.spawnTable;
    body.replaceChildren();
    const counts = new Map<string, number>();
    for (const point of setup.arena.pickups) {
      const item = setup.spawnTable.slots[point.slotId] ?? point.kind;
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    const words = document.createElement("p");
    words.className = "dim";
    words.textContent = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([item, count]) => `${count}× ${item}`)
      .join("  ·  ");
    body.append(words);
  }

  const draw: Record<Part, () => void> = {
    arena: drawArena,
    weapons: drawWeapons,
    spawnTable: drawSpawnTable,
  };

  /**
   * Take a new set of seeds.
   *
   * A new ground rolls a new spawn table for it, because a table belongs to the
   * points of one arena. Every part redraws, because the arena decides what the
   * weapons lie on.
   */
  function apply(next: MatchSeeds): void {
    seeds = next;
    setup = options.build(seeds);
    for (const part of PARTS) {
      draw[part]();
      seedFields[part].value = base36(seeds[part]);
    }
  }

  for (const part of PARTS) {
    const group = document.createElement("div");
    group.className = "menu-group";
    const heading = document.createElement("h3");
    heading.textContent = PART_TEXT[part].title;
    const help = document.createElement("p");
    help.className = "dim";
    help.textContent = PART_TEXT[part].help;
    group.append(heading, help, bodies[part]);

    const row = document.createElement("div");
    row.className = "menu-row";
    const field = seedFields[part];
    field.type = "text";
    field.className = "ticket-input";
    field.spellcheck = false;
    field.setAttribute("aria-label", `${PART_TEXT[part].title} seed`);

    const note = document.createElement("p");
    note.className = "dim ticket-note";

    row.append(
      field,
      button("Reroll", () => {
        note.textContent = "";
        apply({ ...seeds, [part]: options.reroll(part) });
      }),
      button("Load", () => {
        const value = readSeed(field.value);
        if (value === null) {
          note.textContent = "That is not a seed. Type a number.";
          field.value = base36(seeds[part]);
          return;
        }
        note.textContent = "";
        apply({ ...seeds, [part]: value });
      }),
    );
    group.append(row, note);
    screen.append(group);
  }

  const go = document.createElement("div");
  go.className = "menu-styles";
  go.append(button(`Start match ${options.matchNumber}`, () => options.onStart(seeds), true));
  screen.append(go);

  apply(seeds);
  options.container.append(screen);
  return { close: () => screen.remove() };
}
