// A village keeps a herd for twelve years, and the year does what years do.
//
// The unit here is the farming year, run week by week: hay in early summer,
// the herd on the common, the Michaelmas cull to what the barn can winter,
// milk while the grass grows and none when it stops. Every one of those is a
// consequence of models already verified separately -- the season's window,
// the cow's appetite, the hay's worth, the fill limit -- and this suite is
// where they have to work as one farm.
//
// THE CENTRAL PREDICTION is the equilibrium herd. Nothing anywhere states how
// many beasts a meadow keeps: the herd breeds at its own rate, the barn fills
// at the meadow's rate, and the cull trims one to the other every autumn. If
// the machinery is right, the herd settles near forage over intake -- a beast
// per couple of tonnes of grass a year -- without any code knowing that
// number. If it grows without bound or dies out on good land, something in
// the chain is lying.

import {
  villageHerdWeek, foundingHerd, type VillageHerd,
} from '../sim/model/village_herd.ts';
import { CATTLE as CATTLE_A } from '../sim/model/cattle.ts';
import { CATTLE } from '../sim/model/cattle.ts';
import { herdMeanMassKg } from '../sim/model/husbandry.ts';
import { needKcalPerDay } from '../sim/model/animal.ts';
import {
  growingWeeks, harvestWindow, isGrowing, WEEKS_PER_YEAR,
} from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = Math.floor(WEEKS_PER_YEAR);

// An English sort of meadow: temperate, mid-latitude, and fifty-odd hectares
// of grazeable catchment for a hamlet of twenty -- about 125 tonnes of dry
// forage a year, which is what such a catchment computes to.
const MEAN_C = 9;
const SIN_LAT = 0.71;
const FORAGE_KG = 125000;

interface YearLog {
  headAtEnd: number;
  cullWeeks: number;
  culled: number;
  died: number;
  milkWeeks: number;
  winterMilkWeeks: number;
  hayPeak: number;
  hayAtSeasonStart: number;
  minCondition: number;
  foodKcal: number;
}

/** Run whole years and log what each did. */
function farm(
  years: number, forageKg: number, meanC: number, sinLat: number,
  founding: number,
): { herd: VillageHerd; log: YearLog[] } {
  let herd: VillageHerd = {
    head: founding, condition: 1, hayKg: 0, standingKg: 0,
  };
  const log: YearLog[] = [];
  const seasonStart = (() => {
    for (let w = 0; w < W; w++) {
      if (isGrowing(meanC, sinLat, w) && !isGrowing(meanC, sinLat, (w - 1 + W) % W)) return w;
    }
    return -1;
  })();

  for (let y = 0; y < years; y++) {
    const yl: YearLog = {
      headAtEnd: 0, cullWeeks: 0, culled: 0, died: 0, milkWeeks: 0,
      winterMilkWeeks: 0, hayPeak: 0, hayAtSeasonStart: 0,
      minCondition: Infinity, foodKcal: 0,
    };
    for (let w = 0; w < W; w++) {
      const out = villageHerdWeek(CATTLE_A, herd, forageKg, meanC, sinLat, w);
      herd = out.herd;
      if (herd.hayKg < 0 || herd.standingKg < 0 || herd.head < 0) {
        throw new Error(`negative stock in year ${y} week ${w}`);
      }
      if (out.culled > 0) { yl.cullWeeks++; yl.culled += out.culled; }
      yl.died += out.died;
      if (out.foodKcal > 0 && out.culled === 0) {
        yl.milkWeeks++;
        if (!isGrowing(meanC, sinLat, w)) yl.winterMilkWeeks++;
      }
      yl.foodKcal += out.foodKcal;
      yl.hayPeak = Math.max(yl.hayPeak, herd.hayKg);
      if (w === seasonStart) yl.hayAtSeasonStart = herd.hayKg;
      yl.minCondition = Math.min(yl.minCondition, herd.condition);
    }
    yl.headAtEnd = herd.head;
    log.push(yl);
  }
  return { herd, log };
}

suite('the village herd', () => {
  check('a hamlet of twenty walks in with eight beasts', foundingHerd(20), 8, 0);

  const { log } = farm(12, FORAGE_KG, MEAN_C, SIN_LAT, foundingHerd(20));
  const late = log.slice(9);
  const settled = late.reduce((a, y) => a + y.headAtEnd, 0) / late.length;

  measure('growing weeks on this meadow', growingWeeks(MEAN_C, SIN_LAT));
  measure('head after year one', log[0].headAtEnd);
  measure('after year three', log[2].headAtEnd);
  measure('after year six', log[5].headAtEnd);
  measure('the settled herd, mean of years ten to twelve', settled);

  // THE HERD GROWS AND THEN SETTLES. Growth is breeding minus old age; the
  // ceiling is the meadow through the barn; and neither number is in a file.
  assert('the founding herd grows', log[2].headAtEnd > foundingHerd(20));
  const early = log.slice(6, 9).reduce((a, y) => a + y.headAtEnd, 0) / 3;
  measure('and the three years before those', early);
  assert('and settles rather than compounding forever',
    Math.abs(settled - early) < settled * 0.25);

  // The equilibrium against the meadow: a beast needs about two tonnes of dry
  // matter a year, so 125 tonnes keeps a few dozen -- less than the naive
  // forage-over-intake bound, because winter keep must be MOWN and mowing
  // gets only the shut-up half of the growth.
  const intakeBound = FORAGE_KG / 2000;
  measure('the naive bound, forage over intake', intakeBound);
  assert('the herd lives inside what the grass could ever feed',
    settled < intakeBound);
  assert('and is a real herd, not a remnant', settled > foundingHerd(20));

  // THE YEAR HAS ITS SHAPE. One cull, at the close of the harvest window;
  // milk while the grass grows and none in the hard of winter; hay peaked
  // before the cull and worn down by spring.
  const lastYear = log[11];
  measure('cull events in the last year', lastYear.cullWeeks);
  check('one slaughter a year, at Michaelmas', lastYear.cullWeeks, 1, 0);
  measure('beasts culled that year', lastYear.culled);
  assert('the cull is most of the year\'s increase',
    lastYear.culled > 0);
  measure('weeks with milk', lastYear.milkWeeks);
  assert('milk flows most of the growing season',
    lastYear.milkWeeks > growingWeeks(MEAN_C, SIN_LAT) * 0.7);
  check('and none of it in the dead of the year', lastYear.winterMilkWeeks, 0, 0);
  measure('the barn at its peak, kg', lastYear.hayPeak);
  measure('and at the next season\'s start', lastYear.hayAtSeasonStart);
  assert('the barn is built up and then eaten down',
    lastYear.hayAtSeasonStart < lastYear.hayPeak * 0.5);
  assert('but the winter was priced right: the barn was not empty at spring',
    lastYear.hayAtSeasonStart > 0);

  // The barn's peak against the winter it must cover, in the barn's own kcal.
  const winterWeeks = WEEKS_PER_YEAR - growingWeeks(MEAN_C, SIN_LAT);
  const perHeadWinter = needKcalPerDay(herdMeanMassKg(CATTLE)) * 7 * winterWeeks;
  measure('winters of keep in the peak barn, per settled head',
    (lastYear.hayPeak * 1632) / (perHeadWinter * settled));

  // WELL-KEPT BEASTS. On ample land the herd never approaches the fertility
  // floor, so the famine echo stays a mechanism and not a permanent state.
  measure('worst condition across the last year', lastYear.minCondition);
  assert('a herd on good land stays in flesh', lastYear.minCondition > 0.9);
  measure('grain-equivalent food off the herd in a year, kg',
    lastYear.foodKcal / 3204);
  assert('the herd feeds people -- milk and the cull together',
    lastYear.foodKcal > 0);

  // A MOOR, NOT A MEADOW: a tenth of the forage. The herd must shrink -- and
  // through the CULL, the reeve seeing the empty barn, not through beasts
  // dying of want. That is the difference between poor land and a disaster.
  const moor = farm(6, FORAGE_KG / 10, MEAN_C, SIN_LAT, foundingHerd(20));
  measure('the same founding herd on a moor, after six years',
    moor.log[5].headAtEnd);
  assert('poor land keeps a smaller herd',
    moor.log[5].headAtEnd < settled / 2);
  measure('beasts dead of want on the moor across six years',
    moor.log.reduce((a, y) => a + y.died, 0));
  measure('and culled', moor.log.reduce((a, y) => a + y.culled, 0));
  assert('the reeve culls before the beasts starve',
    moor.log.reduce((a, y) => a + y.culled, 0)
      > moor.log.reduce((a, y) => a + y.died, 0));

  // DETERMINISM, because this runs inside the lockstep turn.
  const again = farm(12, FORAGE_KG, MEAN_C, SIN_LAT, foundingHerd(20));
  assert('the same farm farms the same',
    again.log[11].headAtEnd === log[11].headAtEnd
    && again.log[11].hayPeak === log[11].hayPeak);

  // No herd is quietly conjured: a byre with nothing in it stays empty.
  const empty = villageHerdWeek(
    CATTLE_A,
    { head: 0, condition: 1, hayKg: 0, standingKg: 0 },
    FORAGE_KG, MEAN_C, SIN_LAT, 20,
  );
  check('no beasts appear from nowhere', empty.herd.head, 0, 0);
  check('and an empty byre makes no food', empty.foodKcal, 0, 0);

  // The harvest window exists on this meadow, since the cull check leans on it.
  assert('the meadow has a harvest window at all',
    harvestWindow(MEAN_C, SIN_LAT) !== null);
});
