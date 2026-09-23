/**
 * Load a hand-made arena from a text file (dev-guide Milestone M1).
 *
 * File format:
 *
 *   name: Proving Ground          <- optional header, one `key: value` per line
 *   notes: ...
 *   ---                           <- the header ends here
 *   ##########                    <- the map, one line per row
 *   #.S....W.#
 *   ##########
 *
 * A file with no `---` line is a map with no header.
 *
 * Glyphs:
 *
 *   #  wall          .  floor        ,  low cover     ^  hazard
 *   S  spawn
 *   W  weapon        A  armor        H  health        U  powerup     M  ammo
 *
 * The parser gives each pickup a `slotId` from its kind and its order in the
 * file (row-major). The same file always gives the same slot ids.
 */
import type { Cell } from "../core/types.js";
import { Tile, type ArenaMap, type PickupKind, type PickupPoint } from "./types.js";
import { orderSpawnsForFairness } from "./spawnOrder.js";

/** Thrown when a map file is not readable. */
export class ArenaParseError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`Invalid arena file "${source}": ${message}`);
    this.name = "ArenaParseError";
  }
}

const HEADER_SEPARATOR = "---";
const HEADER_KEYS = new Set(["name", "notes"]);

const TILE_GLYPHS: Readonly<Record<string, Tile>> = {
  "#": Tile.Wall,
  ".": Tile.Floor,
  ",": Tile.CoverLow,
  "^": Tile.Hazard,
  S: Tile.Spawn,
};

const PICKUP_GLYPHS: Readonly<Record<string, PickupKind>> = {
  W: "weapon",
  A: "armor",
  H: "health",
  U: "powerup",
  M: "ammo",
};

/** The respawn time of a pickup. The value arrives with Milestone M8. TBD */
const DEFAULT_RESPAWN_TICKS = 0;

export interface ParseArenaOptions {
  /** A name for the reports. The `name` header of the file wins over it. */
  source?: string;
  /**
   * Bots per team, for the spawn order of Section 7.2.1. Section 2.2 locks it
   * at 3, so the default is 3.
   */
  teamSize?: number;
}

/** Read the optional `key: value` header. Returns the header and the map lines. */
function splitHeader(
  source: string,
  lines: string[],
): { header: Record<string, string>; mapLines: string[] } {
  const separator = lines.indexOf(HEADER_SEPARATOR);
  if (separator < 0) return { header: {}, mapLines: lines };

  const header: Record<string, string> = {};
  for (const [index, line] of lines.slice(0, separator).entries()) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon < 0) {
      throw new ArenaParseError(source, `header line ${index + 1} has no ":"`);
    }
    const key = line.slice(0, colon).trim();
    if (!HEADER_KEYS.has(key)) {
      throw new ArenaParseError(source, `unknown header key "${key}"`);
    }
    header[key] = line.slice(colon + 1).trim();
  }
  return { header, mapLines: lines.slice(separator + 1) };
}

/** Parse the text of a map file. */
export function parseArenaText(text: string, options: ParseArenaOptions = {}): ArenaMap {
  const source = options.source ?? "(inline)";
  const allLines = text.replace(/\r\n/g, "\n").split("\n");
  const { header, mapLines: rawMapLines } = splitHeader(source, allLines);

  // Remove the empty lines at the start and at the end. An empty line inside
  // the map is an error, because it makes a row of zero width.
  let start = 0;
  let end = rawMapLines.length;
  while (start < end && rawMapLines[start]?.trim() === "") start += 1;
  while (end > start && rawMapLines[end - 1]?.trim() === "") end -= 1;
  const mapLines = rawMapLines.slice(start, end);

  if (mapLines.length === 0) throw new ArenaParseError(source, "the map is empty");

  const width = mapLines[0]?.length ?? 0;
  const height = mapLines.length;
  if (width === 0) throw new ArenaParseError(source, "the first row is empty");

  const tiles = new Uint8Array(width * height);
  const spawns: Cell[] = [];
  const pickups: PickupPoint[] = [];
  const slotCounts = new Map<PickupKind, number>();

  for (let y = 0; y < height; y += 1) {
    const line = mapLines[y] ?? "";
    if (line.length !== width) {
      throw new ArenaParseError(
        source,
        `row ${y + 1} is ${line.length} cells wide, but row 1 is ${width} cells wide`,
      );
    }
    for (let x = 0; x < width; x += 1) {
      const glyph = line[x] ?? "";
      const tile = TILE_GLYPHS[glyph];
      if (tile !== undefined) {
        tiles[y * width + x] = tile;
        if (tile === Tile.Spawn) spawns.push({ x, y });
        continue;
      }
      const kind = PICKUP_GLYPHS[glyph];
      if (kind === undefined) {
        throw new ArenaParseError(source, `unknown glyph "${glyph}" at row ${y + 1}, column ${x + 1}`);
      }
      const index = slotCounts.get(kind) ?? 0;
      slotCounts.set(kind, index + 1);
      tiles[y * width + x] = Tile.Pickup;
      pickups.push({
        cell: { x, y },
        kind,
        slotId: `${kind}:${index}`,
        respawnTicks: DEFAULT_RESPAWN_TICKS,
      });
    }
  }

  if (spawns.length < 2) {
    throw new ArenaParseError(source, `the map has ${spawns.length} spawn cells, but 2 is the minimum`);
  }

  return {
    name: header["name"] ?? source,
    source,
    width,
    height,
    tiles,
    // Section 7.2.1: the slots of the two teams must face each other, or a
    // symmetric arena still gives one side the better start.
    spawns: orderSpawnsForFairness(spawns, width, height, options.teamSize ?? 3),
    pickups,
  };
}
