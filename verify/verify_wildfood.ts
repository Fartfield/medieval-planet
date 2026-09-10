// The wild larder, checked against the ethnographies and its own arithmetic.
//
// The hunt is encounter times success, and the whole model's honesty is that
// the take FALLS AS THE GAME DOES: a rich range feeds a village and a
// stripped one feeds nobody, with no threshold anywhere saying so. These
// checks hold the returns to what subsistence hunting measured, the
// depletion to what a stock under pressure does, and the recovery to the
// deer's own intrinsic rate.

import {
  huntWeek, regrowWeek, gameInRange, huntRangeKm2,
  HUNT_RANGE_KM, HUNTER_SWEEP_KM2_PER_DAY, HUNT_SUCCESS, GAME_GROWTH_PER_YEAR,
} from '../sim/model/wildfood.ts';
import { gameHeadPerKm2 } from '../sim/model/resources.ts';
import { Biome } from '../sim/model/biome.ts';
import { check, measure, assert, suite } from './harness.ts';

const FOREST_NPP = 858;

suite('the wild larder', () => {
  // THE RANGE. Five kilometres out from the hearth, which is what legs and a
  // carcass allow, holding the fauna model's own game.
  measure('the hunting ground, km2', huntRangeKm2());
  measure('deer per km2 of temperate forest',
    gameHeadPerKm2(Biome.TemperateForest, FOREST_NPP));
  const standing = gameInRange(Biome.TemperateForest, FOREST_NPP, 1);
  measure('head standing in an untouched range', standing);
  assert('a range holds a real herd, hundreds not dozens',
    standing > 100 && standing < 2000);

  // THE RETURN, at ethnographic rates. Thirty-five hunter-days a week is a
  // hungry hamlet's effort; the kill rate must come out at a deer per hunter
  // every few days, which is what stalking with bow and snare returned.
  const week = huntWeek(Biome.TemperateForest, FOREST_NPP, 1, 35);
  measure('kills in a week of hard hunting, untouched range', week.kills);
  measure('days of hunting per carcass', 35 / week.kills);
  // The first calibration gave a carcass every 0.86 days, and this check is
  // what caught it.
  assert('a carcass costs days, not weeks and not hours',
    35 / week.kills > 2 && 35 / week.kills < 25);
  measure('the week\'s food, grain-equivalent kg', week.foodKcal / 3204);

  // THE RANGE'S TRUE CARRYING CAPACITY FOR HUNTERS, and the check that
  // taught this suite something. A stock at its own carrying capacity nets
  // nothing -- that is what carrying capacity means -- so the most a range
  // yields forever is the logistic maximum, r.K/4, at half stock. Turn that
  // into people and the answer is about five; the measured density of
  // temperate-forest foragers, 0.1 a square kilometre over this range, is
  // about eight. Two chains that share no inputs land in the same handful,
  // and the first version of this check -- which assumed twenty could live
  // near the wild's increase -- was wrong about hunting the way settled
  // people have always been wrong about hunting.
  const msyKillsPerWeek = (standing * GAME_GROWTH_PER_YEAR) / 4 / 52;
  const kcalPerKill = week.foodKcal / week.kills;
  const sustainedPeople = (msyKillsPerWeek * kcalPerKill) / (2400 * 7);
  measure('the most the range yields forever, kills a week', msyKillsPerWeek);
  measure('people that feeds forever', sustainedPeople);
  assert('the wild carries a handful, as the forager ethnographies measure',
    sustainedPeople > 3 && sustainedPeople < 12);

  // THE TAKE FALLS WITH THE GAME, proportionally: half the deer, half the
  // encounters, half the kills. No cliff and no floor.
  const half = huntWeek(Biome.TemperateForest, FOREST_NPP, 0.5, 35);
  check('half the range gives half the hunt',
    half.kills / week.kills, 0.5, 0.02);
  const stripped = huntWeek(Biome.TemperateForest, FOREST_NPP, 0.05, 35);
  measure('a stripped range still yields, kills', stripped.kills);
  assert('but a twentieth of a range feeds nobody',
    stripped.foodKcal < week.foodKcal * 0.08);

  // DEPLETION comes with NUMBERS. A hamlet of twenty dents the range in a
  // year; a village of a hundred, hunting the same way, eats the principal
  // outright -- five times the pressure on the same increase. The difference
  // between them, and between either and the handful the range carries
  // forever, is the whole demographic story of why settled people farm.
  let hamletShare = 1;
  for (let w = 0; w < 52; w++) {
    hamletShare = huntWeek(Biome.TemperateForest, FOREST_NPP, hamletShare, 35).wildShare;
  }
  measure('the range after a hamlet\'s hungry year', hamletShare);
  // Twenty people are over the range's carrying capacity by two or three
  // times, so a year of their hunger DENTS the range without stripping it --
  // and every further year of full reliance grinds it lower, which is the
  // pressure that makes the fields worth breaking.
  assert('a hamlet\'s year dents the range',
    hamletShare > 0.55 && hamletShare < 0.9);

  let share = 1;
  let totalKills = 0;
  for (let w = 0; w < 52; w++) {
    const h = huntWeek(Biome.TemperateForest, FOREST_NPP, share, 175);
    share = h.wildShare;
    totalKills += h.kills;
  }
  measure('the range after a hundred people\'s hungry year', share);
  measure('carcasses that year', totalKills);
  assert('a hundred hungry people hammer the range', share < 0.75);
  assert('and the take was real food, not a rounding',
    totalKills > 30);

  // RECOVERY, at the herd's own rate: a range at thirty per cent climbs back
  // past ninety in about a decade of peace, which is what deer do.
  let back = 0.3;
  let years = 0;
  while (back < 0.9 && years < 40) {
    for (let w = 0; w < 52; w++) back = regrowWeek(back);
    years++;
  }
  measure('years for a hammered range to recover', years);
  assert('the wild heals in years, not weeks and not centuries',
    years > 3 && years < 20);
  check('and an untouched range stays exactly full', regrowWeek(1), 1, 0);

  // NOTHING TO HUNT WHERE NOTHING LIVES.
  check('no venison off the ocean',
    huntWeek(Biome.Ocean, 0, 1, 100).kills, 0, 0);
  const desert = huntWeek(Biome.Desert, 60, 1, 35);
  measure('a desert week\'s kills', desert.kills);
  assert('a desert hunt is a hungry one',
    desert.foodKcal < week.foodKcal * 0.1);

  // The constants are the measured kinds of thing they claim to be.
  assert('the range is a walker\'s range', HUNT_RANGE_KM >= 3 && HUNT_RANGE_KM <= 10);
  assert('the sweep is a stalker\'s strip, not a survey',
    HUNTER_SWEEP_KM2_PER_DAY < 2);
  assert('the bow misses more than it hits', HUNT_SUCCESS <= 0.33);
  assert('the herd grows like a deer herd',
    GAME_GROWTH_PER_YEAR > 0.2 && GAME_GROWTH_PER_YEAR < 0.5);

  // Determinism, because this runs inside the turn.
  const a = huntWeek(Biome.TemperateForest, FOREST_NPP, 0.7, 35);
  const b = huntWeek(Biome.TemperateForest, FOREST_NPP, 0.7, 35);
  check('the same week hunts the same', a.foodKcal, b.foodKcal, 0);
});
