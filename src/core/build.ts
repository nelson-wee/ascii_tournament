/**
 * What made this run (dev-guide Section 7.23).
 *
 * A seed replays a match only against the same engine and the same data. Both
 * moved several times while the side bias of Section 7.20.26 was hunted, so a
 * seed on its own is half a key: it still runs, and it gives a **different**
 * match. A seed with a build id is a whole key.
 *
 * Two parts:
 *
 * - `codeVersion` is the commit, already short, with a `+` when the tree that
 *   built it had changes that the commit does not hold. The browser has no
 *   git, so `vite.config.ts` writes it in, and vitest reads the same config,
 *   so a test sees the real commit. A build that sets nothing reads `dev`.
 * - `dataFingerprint` is a hash of the data files. They import as JSON, so
 *   the same code gives the same answer in the browser, in Node and in the
 *   tests, with no build step.
 */
import announcementsJson from "../../data/announcements.json";
import pickupsJson from "../../data/pickups.json";
import rolesJson from "../../data/roles.json";
import tacticsJson from "../../data/tactics.json";
import weaponRolesJson from "../../data/weapon-roles.json";
import tuningJson from "../../data/tuning.json";
import arenaProfilesJson from "../../data/arena-profiles.json";
import baselineWeaponJson from "../../data/weapons/baseline.json";
import redeemerWeaponJson from "../../data/weapons/redeemer.json";
import { deriveSeed } from "./rng.js";

/** The commit, written in by the build. `dev` when nothing set it. */
declare const __BUILD_COMMIT__: string | undefined;

export function codeVersion(): string {
  // A guard, not a check: a plain `tsx` run defines nothing.
  return typeof __BUILD_COMMIT__ === "string" && __BUILD_COMMIT__.length > 0
    ? __BUILD_COMMIT__
    : "dev";
}

/**
 * A hash of every data file that a generator reads, in base 36.
 *
 * Change one number in `data/tuning.json` and the same seed gives different
 * weapons. This is what says so.
 */
export function dataFingerprint(): string {
  const text = JSON.stringify([
    announcementsJson,
    arenaProfilesJson,
    baselineWeaponJson,
    pickupsJson,
    redeemerWeaponJson,
    rolesJson,
    tacticsJson,
    tuningJson,
    weaponRolesJson,
  ]);
  return (deriveSeed(text, "data") >>> 0).toString(36);
}

/**
 * The build id that a ticket carries: the commit and the data, together.
 *
 * It does not cut the commit short. `vite.config.ts` and the batch CLI both
 * write a short one already, and cutting it here took the `+` off a tree with
 * changes in it, which is the one mark that matters most.
 */
export function buildId(): string {
  return `${codeVersion()}.${dataFingerprint()}`;
}
