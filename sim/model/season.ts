// The shape of the year, from the tilt of the axis.
//
// Everything in this world has been an annual mean. A place had a temperature
// and a productivity and they were the same in February as in July, which was
// recorded as a gap and was survivable while nothing depended on WHEN. Plants
// depend on when: a seed germinates in a window, a tree leafs out and drops,
// grain ripens, hay is cut once and must last until spring. None of that can be
// built on a flat year, and building it on one and adding seasons afterwards
// means building it twice.
//
// WHAT IS DERIVED AND WHAT IS ANCHORED, because the difference matters here.
//
// The GEOMETRY is derived, all of it, from one measured angle. The tilt gives
// the sun's declination through the year; declination and latitude give the
// hour angle at which the sun rises; that gives day length and the daily
// insolation at the top of the atmosphere. No free parameters, and the results
// are checkable against things everyone knows -- twelve hours everywhere at
// the equinox, the sun never rising above the Arctic Circle at midwinter, the
// tropics being at the tilt exactly.
//
// The TEMPERATURE SWING is not derived, and it would be dishonest to pretend
// otherwise. Turning insolation into air temperature needs a heat balance over
// ocean, land, cloud and circulation, which this model does not have. What it
// has is `seasonalAmplitude`, already anchored from measured continental
// ranges, and geometry to say WHEN the peak falls. So the amplitude is
// measured, the phase is derived, and the lag between them is measured. That
// is three honest pieces rather than one dishonest one.
//
// WEEK ZERO IS THE NORTHERN WINTER SOLSTICE. An arbitrary choice of origin, but
// it has to be somewhere, and putting it at a solstice makes the declination a
// plain cosine with no offset to get wrong.

import * as A from '../anchors.ts';
import { dsin, dcos, PI } from '../gen/mathx.ts';
import { seasonalAmplitude } from './biome.ts';

const DEG = PI / 180;
const TILT = A.AXIAL_TILT_DEG * DEG;

/** Weeks in a year, from the turn length the game already runs at. */
export const WEEKS_PER_YEAR = A.TURNS_PER_YEAR;

/** Where in the year a turn falls, 0 at the northern winter solstice. */
export function weekOfYear(turn: number): number {
  const w = turn % WEEKS_PER_YEAR;
  return w < 0 ? w + WEEKS_PER_YEAR : w;
}

/**
 * The sun's declination for a week, radians.
 *
 * How far north or south of the equator the sun stands overhead. Runs from
 * minus the tilt at the northern midwinter to plus the tilt at midsummer, and
 * a cosine is the whole of it once week zero is a solstice.
 *
 * The real orbit is slightly eccentric, so the true declination is not quite a
 * cosine and the seasons are not quite equal in length. That refinement is not
 * here and is worth about a day and a half at the equinoxes.
 */
export function declination(week: number): number {
  return -TILT * dcos((2 * PI * week) / WEEKS_PER_YEAR);
}

/**
 * The hour angle of sunrise, radians: half the length of the day.
 *
 * cos H = -tan(lat) tan(dec), which is the standard result and is simply the
 * statement that the sun crosses the horizon when its altitude is zero. Beyond
 * the polar circles the equation has no solution, and that is not a failure to
 * guard against -- it IS polar day and polar night, and the clamp produces them
 * correctly: H of pi is a sun that never sets, H of zero one that never rises.
 */
export function sunriseAngle(sinLat: number, week: number): number {
  const dec = declination(week);
  const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
  const cosDec = dcos(dec);
  const sinDec = dsin(dec);
  // tan as a ratio rather than Math.tan, which is not IEEE-pinned and is
  // banned in sim/ for that reason.
  if (cosLat < 1e-12) return sinLat * sinDec > 0 ? PI : 0;
  if (cosDec < 1e-12) return PI / 2;
  const c = -(sinLat / cosLat) * (sinDec / cosDec);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Hours of daylight at a latitude in a given week. */
export function dayLengthHours(sinLat: number, week: number): number {
  return (24 * sunriseAngle(sinLat, week)) / PI;
}

/**
 * Sunlight arriving at the top of the atmosphere that day, W/m2 averaged over
 * the whole twenty-four hours.
 *
 * The standard daily-mean insolation: the solar constant over pi, times the
 * geometry of how long the sun is up and how high it gets. This is what drives
 * growth -- a place with long days and a high sun grows, and the reason a
 * northern summer can out-produce a tropical one despite being colder is that
 * eighteen-hour days more than make up for a lower sun.
 */
export function insolationWm2(sinLat: number, week: number): number {
  const H = sunriseAngle(sinLat, week);
  const dec = declination(week);
  const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
  return (A.SOLAR_CONSTANT_W_M2 / PI)
    * (H * sinLat * dsin(dec) + cosLat * dcos(dec) * dsin(H));
}

/**
 * The temperature this week, given the annual mean the climate model gives.
 *
 * The swing's SIZE is `seasonalAmplitude`, measured from continental ranges.
 * Its TIMING is the geometry above, delayed by the measured thermal lag -- the
 * hottest week is a month after the longest day because the ground goes on
 * gaining heat while days are still long.
 *
 * The hemisphere falls out of the sign of sinLat without a branch: the same
 * cosine that peaks in the northern summer troughs in the southern one.
 */
export function temperatureAtWeek(
  annualMeanC: number, sinLat: number, week: number,
): number {
  const phase = (2 * PI * (week - A.THERMAL_LAG_WEEKS)) / WEEKS_PER_YEAR;
  // -cos so that the northern hemisphere is coldest at week zero.
  const northward = -dcos(phase);
  const swing = seasonalAmplitude(sinLat) / 2;
  return annualMeanC + swing * northward * Math.sign(sinLat || 1);
}

/** The warmest and coldest weeks of the year at a latitude, in order. */
export function extremeWeeks(sinLat: number): { warmest: number; coldest: number } {
  const half = WEEKS_PER_YEAR / 2;
  const warmNorth = (half + A.THERMAL_LAG_WEEKS) % WEEKS_PER_YEAR;
  const coldNorth = A.THERMAL_LAG_WEEKS % WEEKS_PER_YEAR;
  return sinLat >= 0
    ? { warmest: warmNorth, coldest: coldNorth }
    : { warmest: coldNorth, coldest: warmNorth };
}

/**
 * Is the ground growing this week?
 *
 * Five degrees is the threshold nearly every temperate species shares: below
 * it, root uptake and cell division effectively stop, which is why the growing
 * season is conventionally counted as days above 5 C and why a mild winter is
 * still a dead one. It is a property of plant physiology rather than of this
 * model, and it is the same number the treeline rule leans on from the other
 * end.
 */
export const GROWING_THRESHOLD_C = 5.0;

export function isGrowing(annualMeanC: number, sinLat: number, week: number): boolean {
  return temperatureAtWeek(annualMeanC, sinLat, week) >= GROWING_THRESHOLD_C;
}

/** How many weeks of the year the ground grows at all. */
export function growingWeeks(annualMeanC: number, sinLat: number): number {
  let n = 0;
  for (let w = 0; w < WEEKS_PER_YEAR; w++) {
    if (isGrowing(annualMeanC, sinLat, w)) n++;
  }
  return n;
}

/**
 * How many weeks the reaping takes.
 *
 * Measured from the manorial calendar: the grain harvest ran from Lammas to
 * Michaelmas-ish, four to six weeks of the whole village in the fields. Four
 * here, and the character of the number is a duration of work, not a switch.
 */
export const HARVEST_SPAN_WEEKS = 4;

/**
 * The weeks the year's grain actually arrives, for a place.
 *
 * DERIVED FROM THE GROWING SEASON'S OWN END: grain ripens when growth stops,
 * so the harvest is the last weeks of the growing season -- which is late
 * summer at 52 north, a different month at 40, and the opposite half of the
 * year south of the line, none of it stated anywhere.
 *
 * Returns null where the ground grows all year round: a tropical place has no
 * single harvest and no hungry gap -- it crops continuously, which is exactly
 * the difference between the temperate granary economy and everywhere the
 * granary never had to be invented.
 */
export function harvestWindow(
  annualMeanC: number, sinLat: number,
): { from: number; to: number } | null {
  const W = Math.floor(WEEKS_PER_YEAR);
  let growingCount = 0;
  let lastGrowing = -1;
  for (let w = 0; w < W; w++) {
    if (!isGrowing(annualMeanC, sinLat, w)) continue;
    growingCount++;
    // The season's end: a growing week whose successor is dead.
    if (!isGrowing(annualMeanC, sinLat, (w + 1) % W)) lastGrowing = w;
  }
  if (growingCount === 0) return null;
  if (growingCount >= W) return null; // grows all year: continuous cropping
  const to = lastGrowing;
  const from = ((to - HARVEST_SPAN_WEEKS + 1) % W + W) % W;
  return { from, to };
}

/**
 * Whether this week of the year is inside the span, wrap and all.
 *
 * The parameter is not named window: the purity suite greps the simulation for
 * browser globals, and a local called window is indistinguishable from a leak.
 */
export function inWindow(
  span: { from: number; to: number }, week: number,
): boolean {
  const W = Math.floor(WEEKS_PER_YEAR);
  const w = ((week % W) + W) % W;
  return span.from <= span.to
    ? w >= span.from && w <= span.to
    : w >= span.from || w <= span.to;
}
