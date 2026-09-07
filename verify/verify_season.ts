// The year, checked against things everybody knows.
//
// The geometry here comes from one measured angle, so almost every result is a
// prediction rather than a setting -- and they are predictions of facts that
// are common knowledge, which makes this one of the easiest models in the
// project to catch being wrong. Twelve hours of daylight everywhere at the
// equinox. The sun not rising at midwinter above the Arctic Circle. The tropics
// lying at the tilt exactly. Midsummer day at sixty degrees north running to
// nearly nineteen hours.
//
// If the tilt were mistyped, or a sine swapped for a cosine, or a hemisphere
// inverted, one of these would say so immediately.

import * as A from '../sim/anchors.ts';
import {
  WEEKS_PER_YEAR, weekOfYear, declination, dayLengthHours, insolationWm2,
  temperatureAtWeek, extremeWeeks, growingWeeks, isGrowing, GROWING_THRESHOLD_C,
} from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

/** sin of a latitude in degrees, which is how the world stores it. */
const at = (deg: number): number => Math.sin((deg * Math.PI) / 180);

const EQUINOX = WEEKS_PER_YEAR / 4;      // a quarter year after the solstice
const MIDSUMMER = WEEKS_PER_YEAR / 2;    // northern

suite('the year has a shape', () => {
  measure('weeks in a year', WEEKS_PER_YEAR);
  assert('a year is fifty-two weeks and a bit',
    WEEKS_PER_YEAR > 52 && WEEKS_PER_YEAR < 52.5);

  // THE TROPICS ARE AT THE TILT. The sun stands overhead at its furthest north
  // exactly at the Tropic of Cancer, and that latitude IS the obliquity. This
  // is the check that catches a mistyped tilt.
  const maxDec = (declination(MIDSUMMER) * 180) / Math.PI;
  measure('furthest the sun goes north, degrees', maxDec);
  check('the tropic is the tilt', maxDec, A.AXIAL_TILT_DEG, 0.01);
  const minDec = (declination(0) * 180) / Math.PI;
  check('and the southern one is its mirror', minDec, -A.AXIAL_TILT_DEG, 0.01);

  // TWELVE HOURS EVERYWHERE AT THE EQUINOX, which is true at every latitude
  // and is the single best test that the hour-angle formula is right.
  let worstEquinox = 0;
  for (const lat of [0, 15, 30, 45, 60, 75, 89]) {
    worstEquinox = Math.max(worstEquinox,
      Math.abs(dayLengthHours(at(lat), EQUINOX) - 12));
  }
  measure('worst departure from twelve hours at the equinox', worstEquinox);
  assert('the equinox is twelve hours everywhere', worstEquinox < 0.2);

  // MIDSUMMER, at latitudes people know by heart.
  const london = dayLengthHours(at(51.5), MIDSUMMER);
  const sixty = dayLengthHours(at(60), MIDSUMMER);
  measure('midsummer day at 51.5N, hours', london);
  measure('midsummer day at 60N, hours', sixty);
  assert('London gets about sixteen and a half hours', london > 16 && london < 17);
  assert('and sixty north nearly nineteen', sixty > 18 && sixty < 19.5);

  // THE POLAR CIRCLES fall out rather than being put in: above 90 minus the
  // tilt the sun does not rise at midwinter and does not set at midsummer.
  const arctic = 90 - A.AXIAL_TILT_DEG;
  measure('the polar circle, degrees', arctic);
  const insideWinter = dayLengthHours(at(arctic + 3), 0);
  const insideSummer = dayLengthHours(at(arctic + 3), MIDSUMMER);
  check('inside the circle the midwinter sun does not rise', insideWinter, 0, 0.01);
  check('and the midsummer sun does not set', insideSummer, 24, 0.01);
  // And just outside it, the sun still rises.
  assert('just outside the circle it still rises',
    dayLengthHours(at(arctic - 3), 0) > 0);

  // THE EQUATOR barely notices the year at all.
  const equatorSwing = Math.abs(dayLengthHours(0, 0) - dayLengthHours(0, MIDSUMMER));
  measure('how much the day length varies at the equator, hours', equatorSwing);
  assert('the equator has no seasons worth the name', equatorSwing < 0.2);

  // INSOLATION. The pole in its own midsummer receives MORE daily sunlight
  // than the equator ever does -- twenty-four hours of a low sun beats twelve
  // of a high one. It is one of the least intuitive true things about the
  // year, and a model that gets it wrong has the geometry wrong.
  const poleSummer = insolationWm2(at(90), MIDSUMMER);
  const equatorBest = Math.max(
    insolationWm2(0, 0), insolationWm2(0, EQUINOX), insolationWm2(0, MIDSUMMER));
  measure('midsummer sun at the pole, W/m2', poleSummer);
  measure('the best the equator manages, W/m2', equatorBest);
  assert('polar midsummer out-lights the equator', poleSummer > equatorBest);

  // And nowhere gets more than the sun sends.
  let worstInsolation = 0;
  for (const lat of [-90, -45, 0, 45, 90]) {
    for (let w = 0; w < WEEKS_PER_YEAR; w += 2) {
      worstInsolation = Math.max(worstInsolation, insolationWm2(at(lat), w));
    }
  }
  measure('the most sunlight anywhere gets, W/m2', worstInsolation);
  assert('nowhere beats the solar constant', worstInsolation < A.SOLAR_CONSTANT_W_M2);
  assert('and polar night is dark',
    insolationWm2(at(85), 0) >= 0 && insolationWm2(at(85), 0) < 1);

  // TEMPERATURE follows the sun but late, and the hemispheres are opposite.
  const north = extremeWeeks(at(50));
  const south = extremeWeeks(at(-50));
  measure('warmest week at 50N', north.warmest);
  measure('warmest week at 50S', south.warmest);
  assert('the hemispheres are opposite',
    Math.abs(north.warmest - south.warmest) > WEEKS_PER_YEAR / 3);
  assert('and the heat lags the light',
    north.warmest > MIDSUMMER && north.warmest < MIDSUMMER + 8);

  const julyN = temperatureAtWeek(10, at(50), north.warmest);
  const janN = temperatureAtWeek(10, at(50), north.coldest);
  measure('warmest week at 50N, degC', julyN);
  measure('coldest week at 50N, degC', janN);
  assert('summer is warmer than winter', julyN > janN);
  check('and the mean is still the mean',
    (julyN + janN) / 2, 10, 0.001);

  // THE GROWING SEASON, which is what the plants will actually read. A
  // temperate place grows for most but not all of the year; the far north for
  // a few months; the tropics all of it.
  const temperate = growingWeeks(10, at(50));
  const boreal = growingWeeks(0, at(65));
  const tropic = growingWeeks(26, 0);
  measure('growing weeks at 50N, mean 10C', temperate);
  measure('growing weeks at 65N, mean 0C', boreal);
  measure('growing weeks at the equator, mean 26C', tropic);
  assert('a temperate year grows for most of itself',
    temperate > 26 && temperate < 52);
  assert('a boreal one for a season', boreal > 4 && boreal < 26);
  check('and the tropics never stop', tropic, Math.round(WEEKS_PER_YEAR), 1);
  assert('nowhere frozen grows at all', growingWeeks(-25, at(80)) === 0);

  // The threshold is the one plants actually use, from the other end of the
  // same physiology the treeline rule leans on.
  measure('growing threshold, degC', GROWING_THRESHOLD_C);
  assert('growth stops near freezing, not at it',
    GROWING_THRESHOLD_C > 0 && GROWING_THRESHOLD_C < 10);
  assert('and a week in a temperate summer is growing',
    isGrowing(10, at(50), north.warmest));

  // The week counter wraps rather than running away, since turns do not stop.
  check('week zero of year two is week zero', weekOfYear(Math.round(WEEKS_PER_YEAR) * 2),
    weekOfYear(Math.round(WEEKS_PER_YEAR) * 2), 0);
  assert('and a week is always inside the year',
    weekOfYear(99999) >= 0 && weekOfYear(99999) < WEEKS_PER_YEAR);
});
