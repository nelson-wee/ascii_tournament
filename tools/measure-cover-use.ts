/**
 * Do bots use cover, and do they flank a target that has it?
 * (dev-guide Sections 7.45.3 and 7.45.4)
 *
 * The mechanic of Section 7.32 can be correct and still be ignored, so this asks
 * two questions of a real round rather than of the arithmetic:
 *
 * - **Use.** While a bot is in contact, how much cover does it hold against the
 *   enemy it sees, against how much the cells around it were offering? Higher
 *   means the bot went to the shielded cell.
 * - **Flank.** When a bot dies, how much cover did it have from the bearing it
 *   was actually shot from, against its mean over every bearing an attacker
 *   could really have fired from — walkable, with a clear line? **Lower means
 *   the attacker came round the cover.**
 *
 * The bearing filter is the part that matters. Counting bearings that face a
 * wall drags the mean down for nothing and invents a flanking result on exactly
 * the styles that have the most walls.
 *
 * It runs rounds but no batch, and writes nothing.
 *
 *     npx tsx tools/measure-cover-use.ts [rounds-per-style]
 */
import { generateArena } from "../src/arena/generate.js";
import { tileAt, isWalkable } from "../src/arena/types.js";
import { cellSeesCell } from "../src/arena/sight.js";
import { loadArenaProfiles, loadDefaultTactics } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng, deriveSeed } from "../src/core/rng.js";
import { generateWeaponSet } from "../src/weapons/generate.js";
import {
  botCell, coverSaveAt, createSimState, distanceBetween, simConfigFromTuning, step,
} from "../src/sim/index.js";

const ROUNDS = Number(process.argv[2] ?? 12);
const config = simConfigFromTuning();
const profiles = loadArenaProfiles();
const ROLES = ["overwatch", "tank", "skirmisher"] as const;

for (const style of ["bastion", "cavern", "openfield"] as const) {
  let heldSum = 0, heldN = 0;       // cover a bot actually has, while in contact
  let availSum = 0, availN = 0;     // cover it could have had, on cells near it
  let bearings = 0, bearingN = 0;
  let killCover = 0, killN = 0;     // victim's cover at the moment it died
  let ringCover = 0, ringN = 0;     // victim's mean cover over all 8 bearings
  for (let r = 0; r < ROUNDS; r += 1) {
    const seed = deriveSeed(777 + r, `${style}:arena`);
    const map = generateArena(profiles.profiles[style]!, createRng(seed, "arena"), seed, { rules: profiles.rules });
    const weapons = generateWeaponSet(createRng(deriveSeed(seed, "weapons"), "weapons"), 5);
    const bus = new EventBus();
    const state = createSimState({ map, seed, config, bus, weapons, roles: [...ROLES], tacticsOverride: loadDefaultTactics() });
    const seen = new Set<number>();
    for (let t = 0; t < 1500 && state.outcome === null; t += 1) {
      step(state);
      for (const bot of state.bots) {
        if (!bot.alive || bot.visibleEnemyIds.length === 0) continue;
        const foe = state.bots.find((b) => b.id === bot.visibleEnemyIds[0]);
        if (!foe?.alive) continue;
        const here = botCell(bot), from = botCell(foe);
        const d = distanceBetween(bot, foe);
        heldSum += coverSaveAt(state, here, from, d); heldN += 1;
        // what was on offer within 3 cells
        for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) {
          const c = { x: here.x + dx, y: here.y + dy };
          if (!isWalkable(tileAt(map, c.x, c.y))) continue;
          availSum += coverSaveAt(state, c, from, d); availN += 1;
        }
      }
      // kills this tick
      for (const e of bus.filter("Kill")) {
        if (seen.has(e.tick * 1000 + Number(String(e.data["victimId"]).slice(1)))) continue;
        if (e.tick !== state.tick) continue;
        seen.add(e.tick * 1000 + Number(String(e.data["victimId"]).slice(1)));
        const cov = e.data["targetCover"];
        const dist = e.data["distance"];
        if (typeof cov !== "number" || typeof dist !== "number") continue;
        killCover += cov; killN += 1;
        // the same victim cell, seen from all eight bearings at the same range
        const victim = state.bots.find((b) => b.id === e.data["victimId"]);
        if (!victim) continue;
        const at = botCell(victim);
        let ring = 0, n = 0;
        for (let i = 0; i < 16; i += 1) {
          const a = (i * Math.PI) / 8;
          const c = { x: Math.round(at.x + Math.cos(a) * dist), y: Math.round(at.y + Math.sin(a) * dist) };
          // Only a bearing an attacker could really have fired from: a cell it
          // can stand on, with a clear line to the victim. A bearing into a wall
          // scores no cover and would drag the mean down for nothing.
          if (!isWalkable(tileAt(map, c.x, c.y))) continue;
          if (!cellSeesCell(map, c, at)) continue;
          ring += coverSaveAt(state, at, c, dist); n += 1;
        }
        if (n > 0) { ringCover += ring / n; ringN += 1; bearings += n; bearingN += 1; }
      }
    }
  }
  console.log(`${style.padEnd(10)} in contact: cover held ${(heldSum/Math.max(1,heldN)).toFixed(4)}  vs on offer nearby ${(availSum/Math.max(1,availN)).toFixed(4)}` +
    `   |  at the kill: victim cover ${(killCover/Math.max(1,killN)).toFixed(4)}  vs its mean over 8 bearings ${(ringCover/Math.max(1,ringN)).toFixed(4)}   (${killN} kills, ${(bearings/Math.max(1,bearingN)).toFixed(1)} of 16 bearings shootable)`);
}
