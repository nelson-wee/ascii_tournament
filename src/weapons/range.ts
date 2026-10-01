/**
 * Effective range: one curve, read by everything (dev-guide Section 7.33).
 *
 * Before this the project held **three** range models that did not agree:
 *
 * 1. `roles[*].bandMultiplier` in `data/weapon-roles.json`. The sniper role read
 *    `{ close 0.5, mid 0.95, long 1.35 }` — bad near, best far. The budget and
 *    the AI read it, through `dpsProfile`.
 * 2. `roles[*].reactionByBand`. The sniper reads `{ close 7-10, long 1-3 }` —
 *    the same shape again, said a second way.
 * 3. `distance / weapon.rangeMax` in `hitChance`. A plain decline from the
 *    muzzle, which says the sniper is at its **best** at point-blank range.
 *
 * The third contradicted the first two, and it was the only one the simulation
 * obeyed. So a marksman was priced as a long-range weapon, sent to long range by
 * the AI, and then given its worst hit chance when it arrived (Section 7.32.2).
 *
 * This module replaces all three with one statement of where a weapon works:
 *
 * - `optimalRange` — the distance it is built for.
 * - `rangeTolerance` — how far from that distance it stays useful.
 *
 * Accuracy falls with the **deviation from the optimal range**, in both
 * directions. A close-range weapon misses far away, a sniper misses in your
 * face, and a mid-range weapon is the versatile one — not by a number that says
 * so, but because its optimal range sits in the middle of the distances an arena
 * actually produces, so its worst deviation is the smallest.
 *
 * `dpsProfile` is now derived from this curve rather than rolled beside it, so
 * the budget, the AI and the simulation cannot disagree again.
 *
 * It holds no browser API and no RNG: it is arithmetic.
 */
import type { BandValues, RangeBand, Weapon } from "./types.js";

/** The two band boundaries, in cells. `SimConfig` and the tuning both carry them. */
export interface RangeBands {
  closeMax: number;
  midMax: number;
  /**
   * The far edge of the long band, in cells (Section 7.48).
   *
   * The long band used to have no far edge, and `bandDistanceOf` stood one
   * number in its place. A band needs both edges to be averaged over, and the
   * honest edge is the distance a bot can see: it cannot shoot at what it cannot
   * find. A caller that leaves it out takes `midMax * 1.75`, which is the old
   * `midMax * 1.25` representative distance carried out to an edge.
   */
  longMax?: number;
}

/** What the range curve needs to answer. `Weapon` satisfies it. */
export interface RangeShape {
  optimalRange: number;
  rangeTolerance: number;
}

/** How the curve falls away from the optimal range. `SimConfig` carries it. */
export interface RangeFalloff {
  /** How much accuracy is lost at one full `rangeTolerance` of deviation. */
  distanceFalloff: number;
  /** The least a weapon keeps from range alone, however far off its band. */
  rangeFloorShare: number;
}

/**
 * The distance that stands for a band, in cells.
 *
 * The close band runs 0 to `closeMax` and its middle is `closeMax / 2`. The mid
 * band runs `closeMax` to `midMax` and its middle is the mean of the two. The
 * long band has no far edge, so it takes `midMax * 1.25`: far enough to be past
 * the boundary, near enough that a bot can see it.
 *
 * The AI and the weapon generator both need this, and they used to hold separate
 * copies. One copy means a band cannot mean one distance to the generator and
 * another to the bot that carries the weapon.
 */
export function bandDistanceOf(band: RangeBand, bands: RangeBands): number {
  if (band === "close") return bands.closeMax / 2;
  if (band === "mid") return (bands.closeMax + bands.midMax) / 2;
  return bands.midMax * 1.25;
}

/**
 * The two edges of a band, in cells (Section 7.48).
 *
 * `bandDistanceOf` gives one distance for a band that is 7 to 11 cells wide, and
 * one distance cannot say what a weapon does across a span that wide. Averaging
 * the curve over the span can, and it needs both edges.
 */
export function bandSpanOf(band: RangeBand, bands: RangeBands): [number, number] {
  if (band === "close") return [0, bands.closeMax];
  if (band === "mid") return [bands.closeMax, bands.midMax];
  return [bands.midMax, bands.longMax ?? bands.midMax * 1.75];
}

/** How many points the band average takes. Enough that the answer stops moving. */
const BAND_SAMPLES = 24;

/**
 * What a weapon does across a whole band: how much of the band it can reach, and
 * the accuracy it holds over the part it can (Section 7.48).
 *
 * This replaces two things that each said something false.
 *
 * - **One sample a band.** `bandAccuracyOf` read the curve at the middle of the
 *   band. A cone that fires to 8 cells was asked about 11.5 and answered with
 *   the floor, although it works at the bottom of the mid band.
 * - **A binary reach gate.** `bandReach` was 1 or 0, set by comparing `rangeMax`
 *   with that same middle distance. So a weapon whose reach ended inside a band
 *   lost the whole band, and a close-range weapon read a **hard zero** at long
 *   range while a marksman read a soft fade at close range. The curve is
 *   symmetric and the bands made it asymmetric.
 *
 * `reach` is the share of the band the weapon can fire into, so it is the chance
 * that an enemy at a distance in this band is in range at all. `accuracy` is the
 * mean of the curve over that reachable part, and it is 0 when nothing is
 * reachable. The two multiply into the expected damage of a shot in the band.
 */
export function bandReachOf(
  weapon: RangeShape,
  band: RangeBand,
  bands: RangeBands,
  falloff: RangeFalloff,
  rangeMax: number,
): { reach: number; accuracy: number } {
  const [lo, hi] = bandSpanOf(band, bands);
  const top = Math.min(hi, rangeMax);
  if (hi <= lo || top <= lo) return { reach: 0, accuracy: 0 };
  let sum = 0;
  for (let i = 0; i < BAND_SAMPLES; i += 1) {
    sum += rangeAccuracy(weapon, lo + ((i + 0.5) / BAND_SAMPLES) * (top - lo), falloff);
  }
  return { reach: (top - lo) / (hi - lo), accuracy: sum / BAND_SAMPLES };
}

/**
 * What a weapon keeps of its accuracy at `distance`, from `rangeFloorShare` to 1.
 *
 * It is 1 at the optimal range and falls by `distanceFalloff` for every full
 * `rangeTolerance` of deviation, on either side. A weapon fired at half its
 * tolerance off its best distance keeps `1 - distanceFalloff / 2`.
 *
 * The curve is symmetric. Being too close and being too far are different kinds
 * of failure in life, and `reactionByBand` already carries some of that
 * difference, so a second tolerance for the near side is not worth the tuning
 * surface until something measures the need. **TBD**
 */
export function rangeAccuracy(
  weapon: RangeShape,
  distance: number,
  falloff: RangeFalloff,
): number {
  const tolerance = Math.max(0.5, weapon.rangeTolerance);
  const deviation = Math.abs(distance - weapon.optimalRange);
  const kept = 1 - falloff.distanceFalloff * (deviation / tolerance);
  return Math.max(falloff.rangeFloorShare, Math.min(1, kept));
}

/**
 * The curve read at the three bands.
 *
 * This is what replaces the hand-written `bandMultiplier` of each role. Four
 * roles times three bands was twelve numbers that could silently disagree with
 * the simulation, and did. Two numbers a weapon now say the same thing, and the
 * simulation reads the same function.
 */
export function bandAccuracyOf(
  weapon: RangeShape,
  bands: RangeBands,
  falloff: RangeFalloff,
): BandValues {
  return {
    close: rangeAccuracy(weapon, bandDistanceOf("close", bands), falloff),
    mid: rangeAccuracy(weapon, bandDistanceOf("mid", bands), falloff),
    long: rangeAccuracy(weapon, bandDistanceOf("long", bands), falloff),
  };
}

/**
 * The accuracy a weapon holds across each band, averaged over the band and over
 * the part of it the weapon can reach (Section 7.48).
 *
 * It is what `bandAccuracyOf` tried to be. That one samples the middle of a
 * band, which is still what `bestBandOf` and `rangeGateOf` want, because they
 * ask "which band is this weapon FOR" and a single distance answers that.
 */
export function bandCurveOf(
  weapon: RangeShape,
  bands: RangeBands,
  falloff: RangeFalloff,
  rangeMax: number,
): { accuracy: BandValues; reach: BandValues } {
  const close = bandReachOf(weapon, "close", bands, falloff, rangeMax);
  const mid = bandReachOf(weapon, "mid", bands, falloff, rangeMax);
  const long = bandReachOf(weapon, "long", bands, falloff, rangeMax);
  return {
    accuracy: { close: close.accuracy, mid: mid.accuracy, long: long.accuracy },
    reach: { close: close.reach, mid: mid.reach, long: long.reach },
  };
}

/**
 * The band a weapon is built for: the one its curve scores highest at.
 *
 * A tie goes to the nearer band, so the answer never moves with the order of a
 * loop. The report and the tactics screen name it, so a player can read what a
 * weapon is for without reading two numbers.
 */
export function bestBandOf(weapon: RangeShape, bands: RangeBands, falloff: RangeFalloff): RangeBand {
  const byBand = bandAccuracyOf(weapon, bands, falloff);
  if (byBand.close >= byBand.mid && byBand.close >= byBand.long) return "close";
  if (byBand.mid >= byBand.long) return "mid";
  return "long";
}

/**
 * The furthest a weapon will fire, in cells.
 *
 * The gate is derived from the curve and not rolled beside it, because a weapon
 * that may fire where it cannot hit is the defect of Section 7.30.7 said the
 * other way round. `gateTolerances` sets how far past the optimal range a bot
 * still takes the shot; past that the curve is at its floor and the shot is a
 * waste of ammunition.
 *
 * It is never shorter than `floorCells`, so no weapon is unusable, and never
 * longer than a bot can see.
 *
 * **`floorCells` is not `closeMax`** (Section 7.48.2). It used to be, and
 * `closeMax` is the far edge of the close band, so a clamped weapon reached to
 * exactly the boundary and got a mid-band reach of exactly zero. A cone's
 * natural reach is about 6.8 cells, so every cone was clamped, every cone was
 * close-band only, and a profile in one band cannot be priced: its expected DPS
 * per point of damage is so small that the damage needed to fill a tier budget
 * swings from -41 to 303 against a role range of 4 to 30.
 *
 * One number was doing two jobs, which is the defect of Section 7.30.3 again:
 * where the close band ends, and the least far a weapon may shoot.
 */
export function rangeGateOf(
  weapon: RangeShape,
  gateTolerances: number,
  sightCapCells: number,
  floorCells: number,
): number {
  const reach = weapon.optimalRange + weapon.rangeTolerance * gateTolerances;
  return Math.min(sightCapCells, Math.max(floorCells, reach));
}

/** Read the range shape of a full weapon. */
export function shapeOf(weapon: Weapon): RangeShape {
  return { optimalRange: weapon.optimalRange, rangeTolerance: weapon.rangeTolerance };
}
