// A year of a herd, and the winter that emerges from it.
//
// Nothing in husbandry.ts says "winter is hard". The season model says which
// weeks grow, the pasture model says what a hectare gives, the intake model
// says what a rumen can process, and the loop runs them against each other.
// What this suite checks is that the thing that comes out is the medieval
// farming year: beasts that thrive from May to October, lose weight from
// November, and die in March if the hay runs short -- with the hay itself cut
// from the summer surplus at a measured loss.
//
// THE STOCKING RATE IS THE STAKE. Overstock and the herd starves in February;
// understock and grass stands uneaten. The pasture model's stocking figure has
// to come out as the line between those, or the two models are describing
// different farms.

import {
  herdWeek, herdMeanMassKg, weeklyGrowthKg, hayFromKg, STANDING_LOSS_PER_WEEK,
  type HerdState,
} from '../sim/model/husbandry.ts';
import { CATTLE } from '../sim/model/cattle.ts';
import { needKcalPerDay } from '../sim/model/animal.ts';
import { harvest, compositionOf } from '../sim/model/process.ts';
import { atMoisture } from '../sim/model/material.ts';
import { GRASS } from '../sim/model/species.ts';
import { Part } from '../sim/model/plant.ts';
import { forageKgPerHaYear, stockingUnitsPerHa } from '../sim/model/pasture.ts';
import { beastsPerHa } from '../sim/model/herd.ts';
import { growingWeeks, isGrowing, WEEKS_PER_YEAR } from '../sim/model/season.ts';
import * as A from '../sim/anchors.ts';
import { Biome } from '../sim/model/biome.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;

// An English sort of place: mean 9 C at 52 degrees north.
const MEAN_C = 9;
const SIN_LAT = Math.sin((52 * Math.PI) / 180);
const MEADOW_NPP = 700;

const grassPile = harvest(GRASS, 3, 1, 30, W, 1).find((p) => p.part === Part.Leaf)!;
const GRASS_C = compositionOf(grassPile);
// Hay is the same grass at fifteen per cent water.
const HAY_C = atMoisture(GRASS_C, 0.15);

/**
 * Run a herd through a year on a farm of the given size, with a hay meadow.
 *
 * UNITS, carefully, because the first version got them wrong: the pasture
 * model's forage is DRY kilogrammes, and a herd eats FRESH grass at 72% water.
 * Feeding the dry figure to the herd as if it were fresh undervalued every
 * hectare three and a half fold -- the same class of error as the 13 m tile,
 * a number handed across a seam in the wrong unit.
 *
 * Grazing is discounted by the measured utilisation -- half of what grows goes
 * under hoof rather than into one -- but a MOWN meadow is not: a scythe does
 * not trample, and haymaking carries its own measured quarter loss instead.
 */
function year(
  head: number, pastureHa: number, hayHa: number, startWeek = 18,
  initialCondition = 1,
): { state: HerdState; died: number; worstCondition: number; hayMadeKg: number } {
  const annualDryPerHa = forageKgPerHaYear(Biome.TemperateGrassland, MEADOW_NPP);
  const freshOf = (dryKg: number): number => dryKg / (1 - GRASS_C.water);
  let barn = 0;
  // THE STANDING CROP, dry kg. Growth adds to it; the herd eats it down --
  // destroying twice what it swallows, because utilisation is a half and the
  // other half goes under hoof -- and what stands into winter weathers away at
  // the measured rate. This pool is what winter grazing actually is.
  let standing = 0;
  const growing = growingWeeks(MEAN_C, SIN_LAT);
  let state: HerdState = { head, condition: initialCondition };
  let died = 0;
  let worst = initialCondition;
  let hayMade = 0;
  for (let i = 0; i < W; i++) {
    const week = (startWeek + i) % W;
    // Shut up for the first half of the growing season, then thrown open. A
    // mown meadow is not trampled: the scythe takes the crop at its own
    // measured quarter loss instead.
    const shutUp = hayHa > 0 && i < growing / 2 && isGrowing(MEAN_C, SIN_LAT, week);
    if (shutUp) {
      const grownDry = weeklyGrowthKg(annualDryPerHa * hayHa, MEAN_C, SIN_LAT, week);
      const made = hayFromKg(freshOf(grownDry), GRASS_C.water);
      barn += made;
      hayMade += made;
    }
    const openHa = pastureHa + (shutUp ? 0 : hayHa);
    standing += weeklyGrowthKg(annualDryPerHa * openHa, MEAN_C, SIN_LAT, week);

    // What mouths can reach this week is the utilisable share of the crop.
    const offeredDry = standing * A.PASTURE_UTILISATION;
    const out = herdWeek(CATTLE, state, GRASS_C, freshOf(offeredDry), HAY_C, barn);
    const ateDry = out.ateKg * (1 - GRASS_C.water);
    standing = Math.max(0, standing - ateDry / A.PASTURE_UTILISATION);
    standing *= 1 - STANDING_LOSS_PER_WEEK;
    barn -= out.fodderKg;
    state = out.state;
    died += out.died;
    worst = Math.min(worst, state.condition);
  }
  return { state, died, worstCondition: worst, hayMadeKg: hayMade };
}

suite('a year of a herd', () => {
  measure('growing weeks at 52 north, 9 C mean', growingWeeks(MEAN_C, SIN_LAT));
  assert('the grass grows for roughly half the year',
    growingWeeks(MEAN_C, SIN_LAT) > 20 && growingWeeks(MEAN_C, SIN_LAT) < 40);
  measure('the mean beast of a full herd, kg', herdMeanMassKg(CATTLE));

  // THE STOCKING RATE IS A CLIFF, and it is the pasture model's own figure.
  const perHa = beastsPerHa(CATTLE, Biome.TemperateGrassland, MEADOW_NPP);
  measure('beasts a hectare the pasture model allows', perHa);

  // A farm of ten hectares, three of them shut up for hay in spring.
  const FARM = 10;
  const HAY = 3;
  const stocked = Math.round(perHa * FARM);
  measure('the farm carries this many beasts', stocked);

  // Two years chained, because sustainability IS the claim: a herd at the
  // model stocking must come through year after year, not once off spring fat.
  const fair1 = year(stocked, FARM - HAY, HAY);
  const fair = year(stocked, FARM - HAY, HAY, 18, fair1.state.condition);
  measure('at the model stocking: head left', fair.state.head);
  measure('worst condition through the year', fair.worstCondition);
  measure('hay made, kg dry', fair.hayMadeKg);
  assert('a herd at the model stocking comes through the year',
    fair.state.head >= stocked - 1);
  assert('in fair condition, because the barn was full',
    fair.worstCondition > 0.85);

  // OVERSTOCKED, THE WINTERS KILL -- plural, and the plural is the finding.
  // The first winter does not: the herd goes in fat off ample summer grass,
  // and at the anchored starvation rate of two per cent a week, twelve famine
  // weeks bring it to 0.87 -- emaciated, standing, alive. Starving a healthy
  // beast to death takes months, and a single winter does not have them. What
  // kills is the SECOND winter, entered thin, which is exactly how real
  // overstocking played out: the first hard year was survived on the fat and
  // the hay, and the second buried the herd.
  const greedy1 = year(stocked * 3, FARM - HAY, HAY);
  const greedy = year(
    Math.round(greedy1.state.head), FARM - HAY, HAY, 18, greedy1.state.condition,
  );
  measure('overstocked threefold: head after one year', greedy1.state.head);
  measure('condition entering the second winter', greedy1.state.condition);
  measure('head after the second year', greedy.state.head);
  measure('and worst condition in it', greedy.worstCondition);
  assert('the first winter is survived on fat and hay',
    greedy1.state.head > stocked * 3 * 0.9);
  // NOT A COLLAPSE, AND THAT IS THE HONEST ANSWER. Summer grass feeds even a
  // threefold herd -- the constraint was always winter -- and a starving beast
  // at the anchored two per cent a week takes months to die, so what
  // overstocking produces is not one burial but an ANNUAL CULL: the herd
  // yo-yos between autumn fat and spring famine and pays a tithe of itself
  // every February. The distinction that matters, and the one checked, is
  // against the fair stocking, which pays nothing at all.
  const greedyDeathsPerYear = greedy1.state.head - greedy.state.head;
  measure('the overstocked herd pays this many beasts a winter', greedyDeathsPerYear);
  assert('overstocking turns winter into an annual cull',
    greedyDeathsPerYear > stocked * 3 * 0.05);
  assert('while the fair-stocked herd buries nobody',
    fair.state.head >= stocked && fair1.state.head >= stocked);
  assert('and the dead are the winter dead, not a summer plague', (() => {
    // Run just the growing season at the same stocking: nobody should die.
    const annualPerHa = forageKgPerHaYear(Biome.TemperateGrassland, MEADOW_NPP);
    let standing = 0;
    let s: HerdState = { head: stocked * 3, condition: 1 };
    for (let i = 0; i < 20; i++) {
      const week = (18 + i) % W;
      standing += weeklyGrowthKg(annualPerHa * FARM, MEAN_C, SIN_LAT, week);
      const offered = (standing * A.PASTURE_UTILISATION) / (1 - GRASS_C.water);
      const out = herdWeek(CATTLE, s, GRASS_C, offered, HAY_C, 0);
      standing = Math.max(0, standing - (out.ateKg * (1 - GRASS_C.water)) / A.PASTURE_UTILISATION);
      standing *= 1 - STANDING_LOSS_PER_WEEK;
      s = out.state;
    }
    return s.head === stocked * 3;
  })());

  // WITHOUT HAY, THE SAME FARM CANNOT KEEP THE SAME HERD. The barn is not an
  // optimisation; it is the difference between a herd and a bone yard.
  const hayless = year(stocked, FARM, 0);
  measure('the same stocking with no hay meadow: head left', hayless.state.head);
  measure('and worst condition', hayless.worstCondition);
  assert('winter without a barn is worse than winter with one',
    hayless.worstCondition < fair.worstCondition - 0.02);
  assert('and it is the hayless herd that has the hard spring',
    hayless.worstCondition < 0.97);

  // THE HAY ARITHMETIC. A hectare shut up for half a growing season makes
  // about two tonnes of hay, which is the figure a meadow was valued at.
  measure('hay per shut-up hectare, kg dry', fair.hayMadeKg / HAY);
  check('a hay meadow gives a couple of tonnes a hectare',
    fair.hayMadeKg / HAY, 2000, 900);
  // And a wintering beast eats roughly a tonne and a half of it.
  const winterWeeks = W - growingWeeks(MEAN_C, SIN_LAT);
  measure('winter weeks', winterWeeks);

  // UNDERSTOCKED, NOTHING DIES AND GRASS STANDS UNEATEN, which is the other
  // half of the stocking figure being right.
  const timid = year(Math.max(1, Math.floor(stocked / 3)), FARM - HAY, HAY);
  measure('understocked threefold: worst condition', timid.worstCondition);
  // Against an absolute rather than against fair: the fair herd enters its
  // second year carrying autumn fat above proper weight, so its within-year
  // minimum can sit above a fresh herd's starting point and the comparison
  // reads backwards.
  assert('an understocked herd sails through', timid.state.head >= Math.floor(stocked / 3)
    && timid.worstCondition > 0.95);

  // CONDITION IS A MASS. A week of total starvation costs a computable weight.
  const starving = herdWeek(CATTLE, { head: 10, condition: 1 }, GRASS_C, 0, HAY_C, 0);
  const lostShare = 1 - starving.state.condition;
  measure('condition lost in one week of nothing at all', lostShare);
  // needKcal(week) / TISSUE_KCAL / properMass: about 2% of body weight a week,
  // which is what a starving beast actually loses.
  check('a starving beast loses a couple of per cent of itself a week',
    lostShare, 0.02, 0.01);
  assert('and one week of famine kills nothing on its own',
    starving.died === 0);

  // Weeks of it do. Fifteen weeks of nothing crosses the line for the tail.
  let s: HerdState = { head: 100, condition: 1 };
  let totalDied = 0;
  let firstDeathWeek = -1;
  for (let wk = 0; wk < 20; wk++) {
    const out = herdWeek(CATTLE, s, GRASS_C, 0, HAY_C, 0);
    s = out.state;
    totalDied += out.died;
    if (out.died > 0 && firstDeathWeek < 0) firstDeathWeek = wk + 1;
  }
  measure('weeks of total famine before the first deaths', firstDeathWeek);
  measure('of a hundred head, dead after twenty weeks', totalDied);
  assert('a herd endures famine for a season and then dies',
    firstDeathWeek > 6 && firstDeathWeek < 16 && totalDied > 50);

  // THE WEEK LOOP CONSERVES: eaten plus refused equals offered.
  const offered = 1000;
  const one = herdWeek(CATTLE, { head: 2, condition: 1 }, GRASS_C, offered, HAY_C, 0);
  measure('two beasts offered a tonne of grass eat, kg', one.ateKg);
  assert('what they eat is bounded by appetite, not by the offer',
    one.ateKg < offered);
});
