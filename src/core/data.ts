/**
 * Data loading (dev-guide Sections 3 and 4.5).
 *
 * The data files are JSON. Vite and Node both import JSON directly, so the
 * same loader works in the browser, in the tests, and in the batch harness.
 * Every file passes through its zod schema before any system reads it.
 */
import announcementsJson from "../../data/announcements.json";
import pickupsJson from "../../data/pickups.json";
import rolesJson from "../../data/roles.json";
import tacticsJson from "../../data/tactics.json";
import weaponRolesJson from "../../data/weapon-roles.json";
import tuningJson from "../../data/tuning.json";
import baselineWeaponJson from "../../data/weapons/baseline.json";
import type { Weapon } from "../weapons/types.js";
import {
  AnnouncementsSchema,
  TacticsFileSchema,
  TuningSchema,
  WeaponSchema,
  type Announcements,
  type Tactics,
  type Tuning,
  type WeaponRoles,
  WeaponRolesSchema,
  type Pickups,
  PickupsSchema,
  type Roles,
  RolesSchema,
} from "./schemas.js";

/** Thrown when a data file does not match its schema. */
export class DataValidationError extends Error {
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`Invalid data file "${file}":\n  ${issues.join("\n  ")}`);
    this.name = "DataValidationError";
  }
}

/** Parse a value with a schema, or throw a `DataValidationError`. */
export function parseData<T>(
  file: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (result.success && result.data !== undefined) return result.data;
  const error = result.error as { issues?: { path: (string | number)[]; message: string }[] };
  const issues = (error.issues ?? []).map(
    (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  throw new DataValidationError(file, issues.length > 0 ? issues : ["unknown validation error"]);
}

let tuningCache: Tuning | null = null;
let baselineWeaponCache: Weapon | null = null;
let announcementsCache: Announcements | null = null;
let tacticsCache: Tactics | null = null;
let weaponRolesCache: WeaponRoles | null = null;
let pickupsCache: Pickups | null = null;
let rolesCache: Roles | null = null;

/** The global tuning numbers. The result is cached after the first call. */
export function loadTuning(): Tuning {
  tuningCache ??= parseData("data/tuning.json", TuningSchema, tuningJson);
  return tuningCache;
}

/**
 * The fixed baseline weapon (Section 7.3). It must stay a viable fallback.
 * The generated weapons arrive with Milestone M6.
 */
export function loadBaselineWeapon(): Weapon {
  baselineWeaponCache ??= parseData(
    "data/weapons/baseline.json",
    WeaponSchema,
    baselineWeaponJson,
  ) as Weapon;
  return baselineWeaponCache;
}

/** The kill announcement tables (Section 7.17). */
export function loadAnnouncements(): Announcements {
  announcementsCache ??= parseData(
    "data/announcements.json",
    AnnouncementsSchema,
    announcementsJson,
  );
  return announcementsCache;
}

/** The default tactics preset (Section 6.4). The role presets arrive with M8. */
export function loadDefaultTactics(): Tactics {
  tacticsCache ??= parseData("data/tactics.json", TacticsFileSchema, tacticsJson).default;
  return tacticsCache;
}

/** The role traits and the attack types of the weapon generator (Section 7.20.2). */
export function loadWeaponRoles(): WeaponRoles {
  weaponRolesCache ??= parseData("data/weapon-roles.json", WeaponRolesSchema, weaponRolesJson);
  return weaponRolesCache;
}

/** What a pickup point gives (Section 7.12). */
export function loadPickups(): Pickups {
  pickupsCache ??= parseData("data/pickups.json", PickupsSchema, pickupsJson);
  return pickupsCache;
}

/** The role presets of Section 7.11. */
export function loadRoles(): Roles {
  rolesCache ??= parseData("data/roles.json", RolesSchema, rolesJson);
  return rolesCache;
}

/** Forget the cached data files. The tests use this. */
export function clearDataCache(): void {
  tuningCache = null;
  baselineWeaponCache = null;
  announcementsCache = null;
  tacticsCache = null;
  weaponRolesCache = null;
  pickupsCache = null;
  rolesCache = null;
}
