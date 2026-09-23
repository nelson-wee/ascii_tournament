/**
 * Arena generation (dev-guide Sections 7.2 and 7.20.19), Milestone M7.
 *
 * Three styles, three algorithms, three shapes of fight:
 *
 * - `bastion`  rooms and corridors, carved from a grid of cells. Closed, short
 *              and mid range, many corners.
 * - `openfield` one open field, bordered at the edge, with obstacles and cover
 *              dropped into it. It keeps long fire lanes on purpose.
 * - `cavern`   a cellular automaton over noise. Organic, no straight lane, a
 *              wide middle and narrow ways in.
 *
 * Every style shares one pipeline, because fairness is not a style question:
 * author one half, turn it half a turn onto the other half, connect what the
 * turn broke, place the spawns and the pickups on ground that both teams reach
 * together, measure, and reject an arena that fails a rule.
 *
 * The generator never uses `Math.random` or the global rot.js RNG. It takes the
 * `arena` stream of Section 7.1, so one seed gives one arena.
 */
import { Tile, cellIndex, isWalkable, tileAt, type ArenaMap, type PickupKind, type PickupPoint } from "./types.js";
import { checkArenaFairness, distanceField, isContested, pickupEvenness } from "./contested.js";
import { orderSpawnsForFairness } from "./spawnOrder.js";
import { measureArena, validateArena, type ArenaMetrics, type ArenaRules } from "./metrics.js";
import type { Rng } from "../core/rng.js";
import type { Cell } from "../core/types.js";

export const ARENA_STYLES = ["bastion", "openfield", "cavern"] as const;
export type ArenaStyle = (typeof ARENA_STYLES)[number];

/** The parameters of one style. Every number is a placeholder. TBD */
export interface ArenaProfile {
  id: string;
  style: ArenaStyle;
  width: number;
  height: number;
  /** Cells of low cover, as a part of the floor. */
  coverDensity: number;
  /** Cells of hazard, as a part of the floor. */
  hazardDensity: number;
  /** `bastion`: cells of the room grid across and down. */
  roomsAcross?: number | undefined;
  roomsDown?: number | undefined;
  /** `bastion`: how often a wall between two rooms opens. */
  extraDoorChance?: number | undefined;
  /** `openfield`: how many obstacles to drop, as a part of the floor. */
  obstacleDensity?: number | undefined;
  /** `openfield`: the size range of one obstacle, in cells. */
  obstacleSize?: readonly [number, number] | undefined;
  /** `cavern`: the share of wall in the starting noise. */
  noiseDensity?: number | undefined;
  /** `cavern`: how many times to smooth the noise. */
  smoothPasses?: number | undefined;
  /**
   * Rules that this style replaces. A closed style cannot meet the sightline
   * rule of an open one, and it is not meant to: the styles differ on purpose
   * (Section 7.20.19).
   */
  rules?: { [K in keyof ArenaRules]?: ArenaRules[K] | undefined } | undefined;
}

/** A generated arena carries what it was made from, and what shape it has. */
export interface GeneratedArena extends ArenaMap {
  seed: number;
  profile: ArenaProfile;
  metrics: ArenaMetrics;
  /** The rules that this arena was judged against, after the style replaced its own. */
  rules: ArenaRules;
}

export const DEFAULT_RULES: ArenaRules = {
  minFloorCycles: 20,
  maxSpawnFairness: 2,
  minLongSightline: 14,
  maxCloseSightline: 6,
  minOpenAreaRatio: 0.28,
  maxOpenAreaRatio: 0.82,
  minFloorCells: 500,
};

/** How many pickup points of each kind an arena gets, per half. */
const PICKUPS_PER_HALF: Readonly<Record<PickupKind, number>> = {
  weapon: 4,
  ammo: 2,
  health: 1,
  armor: 1,
  powerup: 1,
};

const TEAM_SIZE = 3;

// ---------------------------------------------------------------------------
// The grid that a style writes into
// ---------------------------------------------------------------------------

interface Grid {
  width: number;
  height: number;
  tiles: Uint8Array;
}

function makeGrid(width: number, height: number, fill: Tile): Grid {
  return { width, height, tiles: new Uint8Array(width * height).fill(fill) };
}

function get(grid: Grid, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return Tile.Wall;
  return (grid.tiles[y * grid.width + x] ?? Tile.Wall) as Tile;
}

function set(grid: Grid, x: number, y: number, tile: Tile): void {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  grid.tiles[y * grid.width + x] = tile;
}

/** Wall the outside edge. Every arena is closed. */
function border(grid: Grid): void {
  for (let x = 0; x < grid.width; x += 1) {
    set(grid, x, 0, Tile.Wall);
    set(grid, x, grid.height - 1, Tile.Wall);
  }
  for (let y = 0; y < grid.height; y += 1) {
    set(grid, 0, y, Tile.Wall);
    set(grid, grid.width - 1, y, Tile.Wall);
  }
}

/**
 * Turn the first half of the grid half a turn onto the second half.
 *
 * In scan order the cell `i` and the cell `total - 1 - i` are the two ends of
 * that turn, so copying the first half over the second gives exact 180-degree
 * rotational symmetry (Section 7.2.1).
 */
function symmetrise(grid: Grid): void {
  const total = grid.width * grid.height;
  for (let i = 0; i < Math.floor(total / 2); i += 1) {
    grid.tiles[total - 1 - i] = grid.tiles[i] as number;
  }
}

// ---------------------------------------------------------------------------
// Style 1: bastion — rooms and corridors
// ---------------------------------------------------------------------------

/**
 * A grid of rooms with walls between them, and a door in most walls.
 *
 * This is the shape that the hand-made test arena has: closed, many corners,
 * and a fight that happens at close and mid range.
 */
function buildBastion(grid: Grid, profile: ArenaProfile, rng: Rng): void {
  grid.tiles.fill(Tile.Wall);
  const across = profile.roomsAcross ?? 5;
  const down = profile.roomsDown ?? 3;
  const cellW = Math.floor((grid.width - 1) / across);
  const cellH = Math.floor((grid.height - 1) / down);

  const rooms: { x: number; y: number; w: number; h: number }[] = [];
  for (let ry = 0; ry < down; ry += 1) {
    for (let rx = 0; rx < across; rx += 1) {
      // The size and the position of a room are rolled apart, so the centres of
      // two rooms in a row do not line up. Rooms on one line give the arena a
      // fire lane across its whole width, and `bastion` is the closed style
      // (Section 7.20.19).
      const w = rng.int(Math.max(3, cellW - 5), Math.max(4, cellW - 2));
      const h = rng.int(Math.max(3, cellH - 4), Math.max(4, cellH - 1));
      const x = rx * cellW + 1 + rng.int(0, Math.max(0, cellW - w - 1));
      const y = ry * cellH + 1 + rng.int(0, Math.max(0, cellH - h - 1));
      rooms.push({ x, y, w, h });
      for (let dy = 0; dy < h; dy += 1) {
        for (let dx = 0; dx < w; dx += 1) set(grid, x + dx, y + dy, Tile.Floor);
      }
      // A pillar breaks the lane inside a big room.
      if (w >= 6 && h >= 5 && rng.bool(0.75)) {
        const px = x + rng.int(2, w - 3);
        const py = y + rng.int(1, h - 2);
        set(grid, px, py, Tile.Wall);
        if (rng.bool(0.5)) set(grid, px, py + 1, Tile.Wall);
      }
    }
  }

  // A door between every pair of rooms that touch, so the arena is connected,
  // plus extra doors, which are the loops of Section 7.2 step 3.
  const roomAt = (rx: number, ry: number) => rooms[ry * across + rx];
  for (let ry = 0; ry < down; ry += 1) {
    for (let rx = 0; rx < across; rx += 1) {
      const room = roomAt(rx, ry);
      if (!room) continue;
      if (rx + 1 < across) {
        const right = roomAt(rx + 1, ry);
        if (right) carveCorridor(grid, centreOf(room), centreOf(right), rng);
      }
      if (ry + 1 < down) {
        const below = roomAt(rx, ry + 1);
        if (below) carveCorridor(grid, centreOf(room), centreOf(below), rng);
      }
      // An extra door across the diagonal makes a loop.
      if (rx + 1 < across && ry + 1 < down && rng.bool(profile.extraDoorChance ?? 0.35)) {
        const diagonal = roomAt(rx + 1, ry + 1);
        if (diagonal) carveCorridor(grid, centreOf(room), centreOf(diagonal), rng);
      }
    }
  }
}

function centreOf(room: { x: number; y: number; w: number; h: number }): Cell {
  return { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
}

/** Carve an L-shaped corridor between two cells. */
function carveCorridor(grid: Grid, from: Cell, to: Cell, rng: Rng): void {
  const horizontalFirst = rng.bool(0.5);
  const corner = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  carveLine(grid, from, corner);
  carveLine(grid, corner, to);
}

function carveLine(grid: Grid, from: Cell, to: Cell): void {
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  let { x, y } = from;
  for (;;) {
    set(grid, x, y, Tile.Floor);
    if (x === to.x && y === to.y) break;
    if (x !== to.x) x += stepX;
    else if (y !== to.y) y += stepY;
  }
}

// ---------------------------------------------------------------------------
// Style 2: openfield — one open field, with obstacles dropped into it
// ---------------------------------------------------------------------------

/**
 * Start from an open field and break the sightlines, instead of carving space
 * out of rock.
 *
 * The obstacles are placed with a gap between them on purpose: the gaps are
 * the fire lanes, and they are what gives this style its long engagements.
 */
function buildOpenField(grid: Grid, profile: ArenaProfile, rng: Rng): void {
  grid.tiles.fill(Tile.Floor);
  const [minSize, maxSize] = profile.obstacleSize ?? [2, 5];
  const area = grid.width * grid.height;
  const wanted = Math.round(area * (profile.obstacleDensity ?? 0.16));

  let placed = 0;
  for (let tries = 0; tries < wanted * 8 && placed < wanted; tries += 1) {
    const w = rng.int(minSize, maxSize);
    const h = rng.int(minSize, maxSize);
    const x = rng.int(2, Math.max(2, grid.width - w - 2));
    const y = rng.int(2, Math.max(2, grid.height - h - 2));

    // Keep one cell of clearance, so no two blocks join into a long wall that
    // would cut the field in half.
    if (!areaIs(grid, x - 1, y - 1, w + 2, h + 2, Tile.Floor)) continue;
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) set(grid, x + dx, y + dy, Tile.Wall);
    }
    placed += w * h;
  }
}

function areaIs(grid: Grid, x: number, y: number, w: number, h: number, tile: Tile): boolean {
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      if (get(grid, x + dx, y + dy) !== tile) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Style 3: cavern — a cellular automaton over noise
// ---------------------------------------------------------------------------

/**
 * Noise, then smoothing: the classic cave generator.
 *
 * It gives an organic arena with no straight lane at all, a wide middle, and
 * narrow ways into it. The fight is close, and a bot can rarely see far.
 */
function buildCavern(grid: Grid, profile: ArenaProfile, rng: Rng): void {
  const density = profile.noiseDensity ?? 0.45;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      set(grid, x, y, rng.bool(density) ? Tile.Wall : Tile.Floor);
    }
  }

  for (let pass = 0; pass < (profile.smoothPasses ?? 4); pass += 1) {
    const next = makeGrid(grid.width, grid.height, Tile.Wall);
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            if (get(grid, x + dx, y + dy) === Tile.Wall) walls += 1;
          }
        }
        // The classic 4-5 rule: a cell becomes what most of its neighbours are.
        const wall = get(grid, x, y) === Tile.Wall ? walls >= 4 : walls >= 5;
        set(next, x, y, wall ? Tile.Wall : Tile.Floor);
      }
    }
    grid.tiles.set(next.tiles);
  }
}

// ---------------------------------------------------------------------------
// The shared pipeline
// ---------------------------------------------------------------------------

/** Every floor region of the grid, largest first. */
function regionsOf(grid: Grid): Cell[][] {
  const seen = new Uint8Array(grid.width * grid.height);
  const regions: Cell[][] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (seen[y * grid.width + x] === 1 || get(grid, x, y) === Tile.Wall) continue;
      const region: Cell[] = [];
      const queue: Cell[] = [{ x, y }];
      seen[y * grid.width + x] = 1;
      for (let head = 0; head < queue.length; head += 1) {
        const cell = queue[head] as Cell;
        region.push(cell);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;
          if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
          if (seen[ny * grid.width + nx] === 1 || get(grid, nx, ny) === Tile.Wall) continue;
          seen[ny * grid.width + nx] = 1;
          queue.push({ x: nx, y: ny });
        }
      }
      regions.push(region);
    }
  }
  return regions.sort((a, b) => b.length - a.length);
}

/**
 * Join every floor region to the largest one, and keep the symmetry.
 *
 * A half turn can cut a region in two, and a cellular automaton makes islands
 * on its own. Each carve is made on the first half and turned onto the second,
 * so the arena stays symmetric.
 */
function connectRegions(grid: Grid, rng: Rng): void {
  for (let round = 0; round < 12; round += 1) {
    const regions = regionsOf(grid);
    if (regions.length <= 1) return;
    const main = regions[0] as Cell[];
    const mainSet = new Set(main.map((cell) => cell.y * grid.width + cell.x));

    for (const region of regions.slice(1)) {
      // A tiny island is not worth a corridor: wall it up instead.
      if (region.length < 12) {
        for (const cell of region) set(grid, cell.x, cell.y, Tile.Wall);
        continue;
      }
      const from = region[Math.floor(region.length / 2)] as Cell;
      let to = main[0] as Cell;
      let best = Infinity;
      for (const cell of main) {
        const distance = (cell.x - from.x) ** 2 + (cell.y - from.y) ** 2;
        if (distance < best) {
          best = distance;
          to = cell;
        }
      }
      if (mainSet.size === 0) continue;
      carveCorridor(grid, from, to, rng);
    }
    border(grid);
    symmetrise(grid);
  }
}

/**
 * Scatter cover and hazard over the floor, and mirror each one.
 *
 * It writes into the first half only, and only where the cell it faces is plain
 * floor as well. A cover cell whose image is a spawn or a pickup cannot be
 * mirrored, and an arena that is symmetric everywhere but its cover is not
 * symmetric (Section 7.2.1).
 */
function scatterDetail(grid: Grid, profile: ArenaProfile, rng: Rng): void {
  const total = grid.width * grid.height;
  const pairs: Cell[] = [];
  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      const index = y * grid.width + x;
      if (index >= Math.floor(total / 2)) continue;
      if (get(grid, x, y) !== Tile.Floor) continue;
      const image = total - 1 - index;
      if ((grid.tiles[image] as Tile) !== Tile.Floor) continue;
      pairs.push({ x, y });
    }
  }

  const cover = Math.round(pairs.length * profile.coverDensity * 2);
  const hazard = Math.round(pairs.length * profile.hazardDensity * 2);
  const shuffled = rng.shuffle(pairs);
  const write = (cell: Cell, tile: Tile): void => {
    set(grid, cell.x, cell.y, tile);
    set(grid, grid.width - 1 - cell.x, grid.height - 1 - cell.y, tile);
  };
  for (let i = 0; i < cover && i < shuffled.length; i += 1) {
    write(shuffled[i] as Cell, Tile.CoverLow);
  }
  for (let i = cover; i < cover + hazard && i < shuffled.length; i += 1) {
    write(shuffled[i] as Cell, Tile.Hazard);
  }
}

/**
 * Put the spawns of team A in the first half, as far from the middle as the
 * arena allows, and give team B the cells that face them.
 */
function placeSpawns(grid: Grid, rng: Rng): Cell[] | null {
  const total = grid.width * grid.height;
  const candidates: Cell[] = [];
  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      if (get(grid, x, y) !== Tile.Floor) continue;
      if (y * grid.width + x >= Math.floor(total / 2)) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length < TEAM_SIZE) return null;

  // The corner of the first half that is furthest from the centre of the turn.
  const middle = { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
  const sorted = candidates
    .map((cell) => ({ cell, far: (cell.x - middle.x) ** 2 + (cell.y - middle.y) ** 2 }))
    .sort((a, b) => b.far - a.far)
    .map((entry) => entry.cell);

  const anchor = sorted[rng.int(0, Math.min(6, sorted.length - 1))] as Cell;
  const near = candidates
    .map((cell) => ({ cell, distance: (cell.x - anchor.x) ** 2 + (cell.y - anchor.y) ** 2 }))
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.cell)
    .filter((cell) => {
      // Keep the group loose, so three bots do not block one door.
      const far = (cell.x - anchor.x) ** 2 + (cell.y - anchor.y) ** 2;
      return far <= 36;
    });
  if (near.length < TEAM_SIZE) return null;

  const group = near.slice(0, TEAM_SIZE);
  const spawns: Cell[] = [];
  for (const cell of group) {
    set(grid, cell.x, cell.y, Tile.Spawn);
    spawns.push(cell);
  }
  for (const cell of group) {
    const image = { x: grid.width - 1 - cell.x, y: grid.height - 1 - cell.y };
    set(grid, image.x, image.y, Tile.Spawn);
    spawns.push(image);
  }
  return spawns;
}

/**
 * Place the pickup points (Section 7.2 step 5).
 *
 * The power-up and the first weapon pair go on the most contested ground, which
 * is the acceptance rule of Section 7.20.17. Everything else is spread over the
 * first half and turned onto the second, so both teams get the same offer.
 */
function placePickups(
  grid: Grid,
  spawns: readonly Cell[],
  rng: Rng,
): PickupPoint[] | null {
  const probe: ArenaMap = {
    name: "probe",
    source: "probe",
    width: grid.width,
    height: grid.height,
    tiles: grid.tiles,
    spawns: [...spawns],
    pickups: [],
  };
  const fromA = distanceField(probe, spawns.slice(0, TEAM_SIZE));
  const fromB = distanceField(probe, spawns.slice(TEAM_SIZE, TEAM_SIZE * 2));

  const total = grid.width * grid.height;
  interface Spot {
    cell: Cell;
    gap: number;
    reach: number;
  }
  const spots: Spot[] = [];
  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      if (get(grid, x, y) !== Tile.Floor) continue;
      const index = y * grid.width + x;
      if (index >= Math.floor(total / 2)) continue;
      const a = fromA[index] ?? -1;
      const b = fromB[index] ?? -1;
      if (a < 0 || b < 0) continue;
      // Never on a spawn, and never right on top of one.
      if (Math.min(a, b) < 4) continue;
      spots.push({ cell: { x, y }, gap: Math.abs(a - b), reach: Math.min(a, b) });
    }
  }
  if (spots.length < 9) return null;

  const taken: Cell[] = [];
  const points: PickupPoint[] = [];
  const counts = new Map<PickupKind, number>();

  const farEnough = (cell: Cell, gap: number): boolean =>
    taken.every((other) => (other.x - cell.x) ** 2 + (other.y - cell.y) ** 2 >= gap);

  const place = (kind: PickupKind, cell: Cell): void => {
    const index = counts.get(kind) ?? 0;
    counts.set(kind, index + 1);
    const image = { x: grid.width - 1 - cell.x, y: grid.height - 1 - cell.y };
    set(grid, cell.x, cell.y, Tile.Pickup);
    set(grid, image.x, image.y, Tile.Pickup);
    taken.push(cell);
    // The second point of a pair takes the next slot id, so the ids read in
    // scan order once the map is built.
    points.push({ cell, kind, slotId: `${kind}:${index * 2}`, respawnTicks: 0 });
    points.push({ cell: image, kind, slotId: `${kind}:${index * 2 + 1}`, respawnTicks: 0 });
  };

  // The contested ground first: the power-up, then one weapon pair.
  const contested = spots
    .filter((spot) => spot.gap <= 1)
    .sort((a, b) => b.reach - a.reach);
  if (contested.length < 2) return null;

  const powerupSpot = contested[rng.int(0, Math.min(3, contested.length - 1))] as Spot;
  place("powerup", powerupSpot.cell);
  const weaponSpot = contested
    .filter((spot) => farEnough(spot.cell, 64))
    .sort((a, b) => b.reach - a.reach)[0];
  if (!weaponSpot) return null;
  place("weapon", weaponSpot.cell);

  // The rest: spread out over the first half, nearest ground last.
  const rest = rng.shuffle(spots.filter((spot) => spot.gap > 1));
  const wanted: PickupKind[] = [];
  for (const [kind, count] of Object.entries(PICKUPS_PER_HALF) as [PickupKind, number][]) {
    const already = kind === "weapon" ? 1 : kind === "powerup" ? 1 : 0;
    for (let i = already; i < count; i += 1) wanted.push(kind);
  }

  for (const kind of wanted) {
    const spot = rest.find((candidate) => farEnough(candidate.cell, 36));
    if (!spot) continue;
    rest.splice(rest.indexOf(spot), 1);
    place(kind, spot.cell);
  }
  return points;
}

/** Build one arena, or `null` if this attempt made a bad one. */
function attempt(
  profile: ArenaProfile,
  rng: Rng,
  seed: number,
  rules: ArenaRules,
): GeneratedArena | null {
  const grid = makeGrid(profile.width, profile.height, Tile.Wall);
  if (profile.style === "bastion") buildBastion(grid, profile, rng);
  else if (profile.style === "openfield") buildOpenField(grid, profile, rng);
  else buildCavern(grid, profile, rng);

  border(grid);
  symmetrise(grid);
  border(grid);
  connectRegions(grid, rng);
  if (regionsOf(grid).length !== 1) return null;

  const spawns = placeSpawns(grid, rng);
  if (!spawns) return null;
  const pickups = placePickups(grid, spawns, rng);
  if (!pickups) return null;
  scatterDetail(grid, profile, rng);

  const ordered = orderSpawnsForFairness(spawns, grid.width, grid.height, TEAM_SIZE);
  const map: GeneratedArena = {
    name: `${profile.id}-${seed}`,
    source: `gen:${profile.style}:${seed}`,
    width: grid.width,
    height: grid.height,
    tiles: grid.tiles,
    spawns: ordered,
    pickups: pickups.sort(
      (a, b) => a.cell.y * grid.width + a.cell.x - (b.cell.y * grid.width + b.cell.x),
    ),
    seed,
    profile,
    metrics: {} as ArenaMetrics,
    rules,
  };
  map.metrics = measureArena(map, TEAM_SIZE);
  return map;
}

/** A style may replace a rule. An absent value keeps the shared one. */
function mergeRules(
  base: ArenaRules,
  over: ArenaProfile["rules"],
): ArenaRules {
  const merged: ArenaRules = { ...base };
  if (!over) return merged;
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue;
    (merged as unknown as Record<string, number>)[key] = value;
  }
  return merged;
}

export interface GenerateOptions {
  rules?: ArenaRules;
  /** How many attempts before it gives up. */
  maxAttempts?: number;
}

/**
 * Generate one arena from a profile (Section 7.2).
 *
 * It tries again on a failed rule, with a fresh sub-stream each time, so the
 * result stays a function of the seed alone.
 */
export function generateArena(
  profile: ArenaProfile,
  rng: Rng,
  seed: number,
  options: GenerateOptions = {},
): GeneratedArena {
  const rules = mergeRules(options.rules ?? DEFAULT_RULES, profile.rules);
  const maxAttempts = options.maxAttempts ?? 40;
  let lastFailures: string[] = ["no attempt was made"];

  for (let i = 0; i < maxAttempts; i += 1) {
    const map = attempt(profile, rng.fork(`attempt:${i}`), seed, rules);
    if (map) {
      const failures = [
        ...validateArena(map.metrics, rules),
        ...checkArenaFairness(map, TEAM_SIZE).failures,
      ];
      if (failures.length === 0) return map;
      lastFailures = failures;
    }
  }
  throw new Error(
    `The ${profile.style} generator could not make an arena in ${maxAttempts} tries: ${lastFailures.join("; ")}`,
  );
}

/** True if the arena passes the rules it was judged against. */
export function arenaPasses(map: GeneratedArena, rules: ArenaRules = map.rules): boolean {
  return validateArena(map.metrics, rules).length === 0;
}

/** The share of the pickup points that both teams reach together. */
export function contestedShare(map: ArenaMap): number {
  const evenness = pickupEvenness(map, TEAM_SIZE);
  if (evenness.size === 0) return 0;
  let contested = 0;
  for (const slotId of evenness.keys()) if (isContested(evenness, slotId)) contested += 1;
  return contested / evenness.size;
}

/** True if every cell of the arena matches the cell it faces. */
export function isSymmetric(map: ArenaMap): boolean {
  const total = map.width * map.height;
  for (let i = 0; i < Math.floor(total / 2); i += 1) {
    if (map.tiles[i] !== map.tiles[total - 1 - i]) return false;
  }
  return true;
}

/** Walkable floor, for the tests. */
export function floorCount(map: ArenaMap): number {
  let count = 0;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) if (isWalkable(tileAt(map, x, y))) count += 1;
  }
  return count;
}

/** The cell index helper, re-exported so a caller does not import two modules. */
export { cellIndex };
