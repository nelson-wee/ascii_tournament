/**
 * Attack types (dev-guide Sections 7.6 and 7.20.3).
 *
 * Seven ways for a shot to reach a target:
 *
 *   hitscan     arrives at once, one target
 *   line        arrives at once, every bot on the line
 *   cone        arrives at once, an area in front of the shooter
 *   projectile  crosses the arena, one target
 *   burst       crosses the arena, area damage where it lands
 *   ricochet    crosses the arena and turns off a wall
 *   tile        crosses the arena and leaves hazard tiles where it lands
 *
 * An area type does not roll to hit. That is the point of it: a bot that holds
 * one cell cannot dodge an area (Section 7.20.1).
 */
import { Tile, cellIndex, isWalkable, tileAt } from "../arena/types.js";
import type { Cell, Vec2 } from "../core/types.js";
import type { Weapon } from "../weapons/types.js";
import { applyDot, damageBot, type DamageContext } from "./damage.js";
import { botCell, posCell, type BotState, type Projectile, type SimState } from "./state.js";

/** How far a projectile steps at one time when it looks for a collision. */
const STEP = 0.34;
/** How near a projectile must come to a bot to hit it. */
const HIT_RADIUS = 0.5;

function contextOf(weapon: Weapon, source: DamageContext["source"], crit = false): DamageContext {
  return {
    weaponId: weapon.id,
    weaponArchetype: weapon.archetype,
    attackType: weapon.attackType,
    source,
    crit,
  };
}

/** True if a wall stands between two points. Area damage does not pass a wall. */
export function clearLine(state: SimState, from: Vec2, to: Vec2): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return true;
  const steps = Math.ceil(distance / STEP);
  for (let i = 1; i < steps; i += 1) {
    const x = from.x + (dx * i) / steps;
    const y = from.y + (dy * i) / steps;
    if (tileAt(state.map, Math.floor(x), Math.floor(y)) === Tile.Wall) return false;
  }
  return true;
}

/** Every live enemy of a team, nearest first. */
function enemiesOf(state: SimState, teamId: string): BotState[] {
  return state.bots.filter((bot) => bot.alive && bot.teamId !== teamId);
}

/**
 * Area damage around a point (Section 7.6). A wall blocks it.
 * The damage falls from the centre to the edge.
 */
export function applyAreaDamage(
  state: SimState,
  shooter: BotState,
  centre: Vec2,
  radius: number,
  damage: number,
  weapon: Weapon,
  crit = false,
): void {
  if (radius <= 0) return;
  for (const target of enemiesOf(state, shooter.teamId)) {
    const distance = Math.hypot(target.pos.x - centre.x, target.pos.y - centre.y);
    if (distance > radius) continue;
    if (!clearLine(state, centre, target.pos)) continue;
    const share = 1 - (distance / radius) * 0.5;
    damageBot(state, shooter, target, damage * share, contextOf(weapon, "area", crit));
    applyDot(target, weapon, shooter.id);
  }
}

/** Area damage in a cone in front of the shooter. It fades with the distance. */
export function applyConeDamage(
  state: SimState,
  shooter: BotState,
  aimAngle: number,
  weapon: Weapon,
): void {
  // `rangeMax` is the real reach of the cone: the generator already applied
  // `shape.coneRangeFactor`. A second cut here made a cone declare 2.2 times
  // the range it had, and the AI read the declared one (Section 3.5 of the M8
  // weapon analysis).
  const reach = weapon.rangeMax;
  for (const target of enemiesOf(state, shooter.teamId)) {
    const dx = target.pos.x - shooter.pos.x;
    const dy = target.pos.y - shooter.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance > reach || distance < 1e-9) continue;
    let offset = Math.atan2(dy, dx) - aimAngle;
    while (offset > Math.PI) offset -= Math.PI * 2;
    while (offset < -Math.PI) offset += Math.PI * 2;
    if (Math.abs(offset) > weapon.coneHalfAngle) continue;
    if (!clearLine(state, shooter.pos, target.pos)) continue;
    // A cone hits hardest at the mouth and fades to nothing at its reach.
    const share = 1 - distance / reach;
    damageBot(state, shooter, target, weapon.damage * share, contextOf(weapon, "area"));
    applyDot(target, weapon, shooter.id);
  }
}

/**
 * A shot that arrives at once and passes through every bot on its line.
 * A wall stops it.
 */
export function applyLineDamage(
  state: SimState,
  shooter: BotState,
  aimAngle: number,
  weapon: Weapon,
  crit: boolean,
): void {
  const damage = weapon.damage * (crit ? state.config.critMultiplier : 1);
  const targets = enemiesOf(state, shooter.teamId)
    .map((target) => {
      const dx = target.pos.x - shooter.pos.x;
      const dy = target.pos.y - shooter.pos.y;
      return { target, distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
    })
    .filter((entry) => entry.distance <= weapon.rangeMax)
    .sort((a, b) => a.distance - b.distance);

  for (const entry of targets) {
    let offset = entry.angle - aimAngle;
    while (offset > Math.PI) offset -= Math.PI * 2;
    while (offset < -Math.PI) offset += Math.PI * 2;
    // The bot must stand on the line, inside half a cell at its distance.
    if (Math.abs(Math.sin(offset)) * entry.distance > HIT_RADIUS) continue;
    if (!clearLine(state, shooter.pos, entry.target.pos)) continue;
    damageBot(state, shooter, entry.target, damage, contextOf(weapon, "shot", crit));
    applyDot(entry.target, weapon, shooter.id);
  }
}

/**
 * How many enemies one shot catches, if the bot aims at `aim` (Section 7.8).
 *
 * The AI reads this so that an area weapon is worth aiming, not only worth
 * carrying. Multi-hits happened on 36 % of burst landings and 30 % of line
 * landings while nothing in the code ever tried for one (Section 0.3 of the M8
 * weapon analysis): they were accidents.
 *
 * It repeats the geometry of the damage code above. That is on purpose: if the
 * two ever part, the AI aims at a shot the simulation does not fire, which is
 * the fault that Section 7.20.13 keeps finding.
 */
export function areaTargetsIfAimedAt(
  state: SimState,
  shooter: BotState,
  weapon: Weapon,
  aim: Vec2,
): number {
  const aimAngle = Math.atan2(aim.y - shooter.pos.y, aim.x - shooter.pos.x);
  const enemies = enemiesOf(state, shooter.teamId);
  let caught = 0;

  for (const target of enemies) {
    const dx = target.pos.x - shooter.pos.x;
    const dy = target.pos.y - shooter.pos.y;
    const distance = Math.hypot(dx, dy);

    switch (weapon.attackType) {
      case "cone": {
        if (distance > weapon.rangeMax || distance < 1e-9) continue;
        if (Math.abs(wrapAngle(Math.atan2(dy, dx) - aimAngle)) > weapon.coneHalfAngle) continue;
        if (!clearLine(state, shooter.pos, target.pos)) continue;
        caught += 1;
        break;
      }
      case "line": {
        if (distance > weapon.rangeMax) continue;
        const offset = wrapAngle(Math.atan2(dy, dx) - aimAngle);
        if (Math.abs(Math.sin(offset)) * distance > HIT_RADIUS) continue;
        if (!clearLine(state, shooter.pos, target.pos)) continue;
        caught += 1;
        break;
      }
      case "burst":
      case "tile": {
        if (Math.hypot(target.pos.x - aim.x, target.pos.y - aim.y) > weapon.aoeRadius) continue;
        if (!clearLine(state, aim, target.pos)) continue;
        caught += 1;
        break;
      }
      default:
        return 1;
    }
  }
  return Math.max(1, caught);
}

/** Put an angle into the range from minus pi to pi. */
function wrapAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

/** Put a shot into the arena. */
export function spawnProjectile(
  state: SimState,
  shooter: BotState,
  aimAngle: number,
  weapon: Weapon,
  crit = false,
): void {
  const speed = weapon.projectileSpeed ?? 1;
  state.projectiles.push({
    id: state.nextProjectileId,
    shooterId: shooter.id,
    teamId: shooter.teamId,
    weapon,
    crit,
    health: weapon.projectileHealth ?? 0,
    homingTurnRate: weapon.homingTurnRate ?? 0,
    pos: { x: shooter.pos.x, y: shooter.pos.y },
    velocity: { x: Math.cos(aimAngle) * speed, y: Math.sin(aimAngle) * speed },
    rangeLeft: weapon.rangeMax,
    bouncesLeft: weapon.ricochetBounces,
  });
  state.nextProjectileId += 1;
}

/**
 * The angle to fire a projectile at, to meet a moving target.
 *
 * A shot flies 4 to 9 ticks at the distance the arena fights at, and a bot
 * crosses 1 to 2 cells in that time against a hit radius of half a cell. So a
 * shot at the target's present position misses a moving target by default, not
 * by chance (Section 7.20.15). One step of iteration is enough: the flight time
 * changes little when the lead is a cell or two.
 */
export function leadAngle(shooter: BotState, target: BotState, weapon: Weapon): number {
  const speed = weapon.projectileSpeed ?? 0;
  const dx = target.pos.x - shooter.pos.x;
  const dy = target.pos.y - shooter.pos.y;
  if (speed <= 0) return Math.atan2(dy, dx);

  const ticks = Math.hypot(dx, dy) / speed;
  const aimX = target.pos.x + target.velocity.x * ticks;
  const aimY = target.pos.y + target.velocity.y * ticks;
  return Math.atan2(aimY - shooter.pos.y, aimX - shooter.pos.x);
}

/** Make hazard tiles around a point (Section 7.6). */
export function createHazard(
  state: SimState,
  shooter: BotState,
  centre: Vec2,
  weapon: Weapon,
): void {
  if (weapon.hazardTicks <= 0) return;
  const radius = Math.max(0, weapon.hazardRadius);
  const cell = posCell(centre);
  const reach = Math.ceil(radius);
  const damagePerTick = weapon.hazardDamagePerTick;
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (Math.hypot(dx, dy) > radius) continue;
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (!isWalkable(tileAt(state.map, x, y))) continue;
      state.hazards.set(cellIndex(state.map, x, y), {
        expiryTick: state.tick + weapon.hazardTicks,
        damagePerTick,
        ownerId: shooter.id,
        teamId: shooter.teamId,
        weaponId: weapon.id,
        weaponArchetype: weapon.archetype,
      });
    }
  }
  state.bus.emit("HazardCreated", state.tick, state.roundNumber, {
    shooterId: shooter.id,
    cell,
    radius,
    ticks: weapon.hazardTicks,
  });
}

/** What a projectile does when it stops. */
function onImpact(state: SimState, projectile: Projectile, at: Vec2, hit: BotState | null): void {
  const { weapon } = projectile;
  const shooter = state.bots.find((bot) => bot.id === projectile.shooterId);
  if (!shooter) return;

  // A projectile carries the critical hit that its shot rolled. Without this
  // the budget charged `critChance` for an effect that never happened
  // (Section 7.20.15).
  const damage = weapon.damage * (projectile.crit ? state.config.critMultiplier : 1);

  if (weapon.attackType === "burst") {
    applyAreaDamage(state, shooter, at, weapon.aoeRadius, damage, weapon, projectile.crit);
    return;
  }
  if (weapon.attackType === "tile") {
    if (hit) {
      damageBot(state, shooter, hit, damage, contextOf(weapon, "shot", projectile.crit));
      applyDot(hit, weapon, shooter.id);
    }
    createHazard(state, shooter, at, weapon);
    return;
  }
  if (hit) {
    damageBot(state, shooter, hit, damage, contextOf(weapon, "shot", projectile.crit));
    applyDot(hit, weapon, shooter.id);
  }
}

/**
 * Turn a homing shot toward the enemy it is nearest to (Section 7.20.18).
 *
 * The turn rate is what makes a Redeemer dodgeable: it follows, but it cannot
 * follow a bot that breaks hard around cover. A shot with no turn rate flies
 * straight, which is every other weapon.
 */
function steerProjectile(state: SimState, projectile: Projectile): void {
  if (projectile.homingTurnRate <= 0) return;
  const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
  if (speed < 1e-9) return;

  let best: BotState | null = null;
  let bestDistance = Infinity;
  for (const bot of enemiesOf(state, projectile.teamId)) {
    const distance = Math.hypot(bot.pos.x - projectile.pos.x, bot.pos.y - projectile.pos.y);
    if (distance >= bestDistance) continue;
    if (!clearLine(state, projectile.pos, bot.pos)) continue;
    best = bot;
    bestDistance = distance;
  }
  if (!best) return;

  const wanted = Math.atan2(best.pos.y - projectile.pos.y, best.pos.x - projectile.pos.x);
  const now = Math.atan2(projectile.velocity.y, projectile.velocity.x);
  let offset = wanted - now;
  while (offset > Math.PI) offset -= Math.PI * 2;
  while (offset < -Math.PI) offset += Math.PI * 2;
  const turn = Math.max(-projectile.homingTurnRate, Math.min(projectile.homingTurnRate, offset));
  const heading = now + turn;
  projectile.velocity = { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed };
}

/**
 * Damage a shot that is in the air. It detonates where it flies when its own
 * health runs out (Section 7.20.18).
 *
 * This is what makes a Redeemer a decision for the other team and not only for
 * the bot that fired it: scatter, shoot it down, or push while it flies.
 */
export function damageProjectile(state: SimState, projectile: Projectile, damage: number): boolean {
  if (projectile.health <= 0) return false;
  projectile.health -= damage;
  if (projectile.health > 0) return false;

  state.bus.emit("HazardCreated", state.tick, state.roundNumber, {
    shooterId: projectile.shooterId,
    cell: posCell(projectile.pos),
    radius: projectile.weapon.aoeRadius,
    ticks: 0,
    reason: "projectileDestroyed",
  });
  onImpact(state, projectile, projectile.pos, null);
  state.projectiles = state.projectiles.filter((other) => other !== projectile);
  return true;
}

/** Every shot in the air that a bot can shoot down, nearest first. */
export function interceptableProjectiles(state: SimState, bot: BotState): Projectile[] {
  return state.projectiles
    .filter((projectile) => projectile.health > 0 && projectile.teamId !== bot.teamId)
    .map((projectile) => ({
      projectile,
      distance: Math.hypot(projectile.pos.x - bot.pos.x, projectile.pos.y - bot.pos.y),
    }))
    .filter((entry) => entry.distance <= bot.weapon.rangeMax)
    .filter((entry) => clearLine(state, bot.pos, entry.projectile.pos))
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.projectile);
}

/** The live enemy that a projectile touches at a point, or `null`. */
function botAt(state: SimState, projectile: Projectile, at: Vec2): BotState | null {
  for (const bot of state.bots) {
    if (!bot.alive || bot.teamId === projectile.teamId) continue;
    if (Math.hypot(bot.pos.x - at.x, bot.pos.y - at.y) <= HIT_RADIUS) return bot;
  }
  return null;
}

/**
 * Move every projectile by one tick.
 *
 * A projectile stops at a wall, at a bot, or when it runs out of range. A
 * `ricochet` projectile turns off the wall instead, while it has a bounce left.
 */
export function updateProjectiles(state: SimState): void {
  const left: Projectile[] = [];

  for (const projectile of state.projectiles) {
    steerProjectile(state, projectile);
    const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
    if (speed < 1e-9) continue;
    const steps = Math.max(1, Math.ceil(speed / STEP));
    let alive = true;

    for (let step = 0; step < steps && alive; step += 1) {
      const next: Vec2 = {
        x: projectile.pos.x + projectile.velocity.x / steps,
        y: projectile.pos.y + projectile.velocity.y / steps,
      };
      projectile.rangeLeft -= speed / steps;

      const bot = botAt(state, projectile, next);
      if (bot) {
        onImpact(state, projectile, next, bot);
        alive = false;
        break;
      }

      const cell: Cell = posCell(next);
      if (!isWalkable(tileAt(state.map, cell.x, cell.y))) {
        if (projectile.bouncesLeft > 0) {
          // Turn the shot off the wall: flip the axis that it crossed.
          const hitX = !isWalkable(tileAt(state.map, cell.x, posCell(projectile.pos).y));
          if (hitX) projectile.velocity.x = -projectile.velocity.x;
          else projectile.velocity.y = -projectile.velocity.y;
          projectile.bouncesLeft -= 1;
          continue;
        }
        onImpact(state, projectile, projectile.pos, null);
        alive = false;
        break;
      }

      projectile.pos = next;
      if (projectile.rangeLeft <= 0) {
        onImpact(state, projectile, projectile.pos, null);
        alive = false;
      }
    }

    if (alive) left.push(projectile);
  }

  state.projectiles = left;
}

/** Damage every bot that stands on a hazard tile, and drop the old tiles. */
export function applyHazards(state: SimState): void {
  if (state.hazards.size === 0) return;
  for (const [index, hazard] of state.hazards) {
    if (state.tick >= hazard.expiryTick) state.hazards.delete(index);
  }
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    const cell = botCell(bot);
    const hazard = state.hazards.get(cellIndex(state.map, cell.x, cell.y));
    if (!hazard || hazard.teamId === bot.teamId) continue;
    const owner = state.bots.find((other) => other.id === hazard.ownerId);
    if (!owner) continue;
    damageBot(state, owner, bot, hazard.damagePerTick, {
      weaponId: hazard.weaponId,
      weaponArchetype: hazard.weaponArchetype,
      attackType: "tile",
      source: "hazard",
    });
  }
}

/** Apply the damage over time on every bot, and drop the effects that ended. */
export function applyDots(state: SimState): void {
  for (const bot of state.bots) {
    if (!bot.alive || bot.dots.length === 0) continue;
    const left = [];
    for (const dot of bot.dots) {
      const source = state.bots.find((other) => other.id === dot.sourceId);
      if (source) {
        damageBot(state, source, bot, dot.damagePerTick, {
          weaponId: dot.weaponId,
          weaponArchetype: dot.weaponArchetype,
          attackType: "dot",
          source: "dot",
        });
        state.bus.emit("DotTick", state.tick, state.roundNumber, {
          botId: bot.id,
          sourceId: dot.sourceId,
          damage: dot.damagePerTick,
        });
      }
      dot.ticksLeft -= 1;
      if (dot.ticksLeft > 0 && bot.alive) left.push(dot);
    }
    bot.dots = left;
  }
}
