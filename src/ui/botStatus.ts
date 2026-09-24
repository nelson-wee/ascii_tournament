/**
 * The bot status panel (dev-guide Section 7.18.6). Browser only.
 *
 * One row per bot: the weapon in its hands, the rounds left in that weapon,
 * its health, its armour and the power-ups it holds. The kill feed says what
 * already happened; this says what each bot can do next, which is what a
 * player needs before the tactics screen opens.
 *
 * The rows are built one time and only their text changes, so the panel costs
 * almost nothing at the rate of the screen.
 */
import { ammoOf, type BotState, type SimState } from "../sim/index.js";
import type { NeonTheme } from "../render/neonThemes.js";

/** A glyph per power-up of `data/pickups.json`. */
const POWERUP_GLYPHS: Readonly<Record<string, string>> = {
  doubleDamage: "⚔",
  shieldBelt: "◘",
  redeemer: "☢",
};

export interface BotStatusOptions {
  container: HTMLElement;
}

export interface BotStatusPanel {
  /** Redraw from the state of the round. `null` clears the panel. */
  update(state: SimState | null, theme: NeonTheme): void;
  destroy(): void;
}

interface Row {
  root: HTMLElement;
  name: HTMLElement;
  weapon: HTMLElement;
  ammo: HTMLElement;
  health: HTMLElement;
  bar: HTMLElement;
  armor: HTMLElement;
  powerups: HTMLElement;
}

/** Write text only when it changed. A DOM write every frame is not free. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setStyle(node: HTMLElement, key: string, value: string): void {
  if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value);
}

function makeRow(): Row {
  const root = document.createElement("li");
  root.className = "bot";
  const name = document.createElement("b");
  name.className = "bot-name";
  const weapon = document.createElement("span");
  weapon.className = "bot-weapon";
  const ammo = document.createElement("span");
  ammo.className = "bot-ammo";
  const track = document.createElement("span");
  track.className = "bot-track";
  const bar = document.createElement("i");
  bar.className = "bot-bar";
  track.append(bar);
  const health = document.createElement("span");
  health.className = "bot-health";
  const armor = document.createElement("span");
  armor.className = "bot-armor";
  const powerups = document.createElement("span");
  powerups.className = "bot-powerups";
  root.append(name, weapon, ammo, track, health, armor, powerups);
  return { root, name, weapon, ammo, health, bar, armor, powerups };
}

/** The rounds left, as text. The fallback weapon never runs dry. */
function ammoText(bot: BotState): string {
  const left = ammoOf(bot, bot.weapon);
  if (!Number.isFinite(left)) return "∞";
  return `${Math.max(0, Math.round(left))}/${bot.weapon.ammoMax}`;
}

function powerupText(bot: BotState): string {
  if (bot.powerups.size === 0) return "";
  const glyphs: string[] = [];
  for (const name of bot.powerups.keys()) glyphs.push(POWERUP_GLYPHS[name] ?? "★");
  return glyphs.join("");
}

export function createBotStatus(options: BotStatusOptions): BotStatusPanel {
  const list = document.createElement("ul");
  list.className = "bots";
  list.setAttribute("aria-label", "bot status");
  options.container.append(list);
  const rows: Row[] = [];

  const rowAt = (index: number): Row => {
    let row = rows[index];
    if (!row) {
      row = makeRow();
      rows.push(row);
      list.append(row.root);
    }
    return row;
  };

  return {
    update(state: SimState | null, theme: NeonTheme): void {
      if (!state) {
        for (const row of rows) row.root.hidden = true;
        return;
      }
      const full = Math.max(1, state.config.healthMax);

      for (const [index, bot] of state.bots.entries()) {
        const row = rowAt(index);
        row.root.hidden = false;
        const color = bot.teamId === "B" ? theme.teamB : theme.teamA;
        setStyle(row.root, "--team", color);
        row.root.classList.toggle("down", !bot.alive);

        setText(row.name, `${bot.id} ${bot.role.slice(0, 4)}`);

        if (!bot.alive) {
          // A dead bot says when it comes back, and nothing else: its weapon
          // and its armour are gone until it does (Section 7.20.17).
          const left = Math.max(0, bot.respawnAtTick - state.tick);
          const seconds = left / state.config.ticksPerSecond;
          setText(row.weapon, `down, back in ${seconds.toFixed(1)} s`);
          setText(row.ammo, "");
          setText(row.health, "");
          setText(row.armor, "");
          setText(row.powerups, "");
          setStyle(row.bar, "width", "0%");
          continue;
        }

        setText(row.weapon, bot.weapon.name);
        row.weapon.title = `${bot.weapon.archetype} · ${bot.weapon.tier}`;
        setText(row.ammo, ammoText(bot));

        const share = Math.max(0, Math.min(1, bot.health / full));
        setStyle(row.bar, "width", `${(share * 100).toFixed(0)}%`);
        setStyle(row.bar, "background", share > 0.35 ? color : "#ff4d4d");
        setText(row.health, String(Math.max(0, Math.round(bot.health))));

        const guard = Math.round(bot.armor + bot.shield);
        setText(row.armor, guard > 0 ? `◘${guard}` : "");
        setText(row.powerups, powerupText(bot));
      }

      for (let index = state.bots.length; index < rows.length; index += 1) {
        const row = rows[index];
        if (row) row.root.hidden = true;
      }
    },

    destroy(): void {
      list.remove();
      rows.length = 0;
    },
  };
}
