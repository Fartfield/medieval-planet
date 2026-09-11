// The granary, against the grain test-weight and the gap between harvests.
//
// The claim is simple and it is the one the economy always assumed: a
// settlement can hoard the year's supply that bridges one harvest to the next
// only if it has built somewhere to keep it. Without a granary it holds a few
// weeks in its houses; with one it holds the year the trade model already aims
// at. The numbers to check are the grain's bulk density, the labour a timber
// barn costs by the cubic metre, and the one structural fact that sets a
// granary apart from a wall -- it has no economy of scale, so it costs the same
// by the head however large the place.

import {
  granaryCapacityKg, targetGranaryDays, storageCapKg, buildGranary,
  granaryFullness, GRAIN_BULK_KG_PER_M3, GRANARY_DAYS_PER_M3,
  STORE_FREE_KG_PER_PERSON, STORE_FREE_WEEKS,
} from '../sim/model/granary.ts';
import { GRAIN_PER_PERSON_PER_YEAR } from '../sim/model/settlement.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

/** A settlement's total labour in a year, man-days. */
function labourDaysPerYear(population: number): number {
  return (population * A.WORKERS_PER_FAMILY) / 5 * A.WORKING_DAYS_PER_YEAR;
}

suite('the granary', () => {
  // THE GRAIN TEST-WEIGHT and the free store.
  measure('grain bulk density, kg/m3', GRAIN_BULK_KG_PER_M3);
  measure('man-days to raise a cubic metre of granary', GRANARY_DAYS_PER_M3);
  measure('weeks of bread a house keeps with no granary', STORE_FREE_WEEKS);
  check('the free store is six weeks of one mouth',
    STORE_FREE_KG_PER_PERSON, GRAIN_PER_PERSON_PER_YEAR * (STORE_FREE_WEEKS / 52), 1e-9);

  // CAPACITY IS VOLUME TIMES DENSITY. A granary of a hundred man-days holds
  // what its cubic metres hold.
  measure('grain a 100-day granary holds, kg', granaryCapacityKg(100));
  check('capacity is the volume times the density',
    granaryCapacityKg(100), (100 / GRANARY_DAYS_PER_M3) * GRAIN_BULK_KG_PER_M3, 1e-6);

  // THE TARGET holds the year's supply the economy aims at -- a year's grain
  // plus the six weeks the houses keep comes to a little over a year in all.
  const pop = 200;
  const td = targetGranaryDays(pop);
  const yearKg = pop * GRAIN_PER_PERSON_PER_YEAR;
  measure('a village of 200\'s year of grain, kg', Math.round(yearKg));
  measure('man-days to build its granary', Math.round(td));
  measure('what a full granary lets it keep, years',
    storageCapKg(td, pop) / yearKg);
  assert('a full granary holds about a year, a little more with the houses',
    storageCapKg(td, pop) / yearKg > 1 && storageCapKg(td, pop) / yearKg < 1.25);
  assert('with no granary it keeps only weeks',
    storageCapKg(0, pop) / yearKg < 0.2);
  check('and that is exactly the free store',
    storageCapKg(0, pop), pop * STORE_FREE_KG_PER_PERSON, 1e-6);

  // NO ECONOMY OF SCALE: the granary costs the same by the head at every size,
  // where a wall grows cheaper. This is why the smallest village still built one.
  const perHead = (p: number): number => targetGranaryDays(p) / p;
  measure('granary man-days per head, village of 60', perHead(60));
  measure('granary man-days per head, town of 1000', perHead(1000));
  check('the granary costs the same by the head however large the place',
    perHead(1000), perHead(60), 1e-9);

  // A SEASON'S WORK, not years: a granary is cheap, the first thing raised.
  const sparePerYear = labourDaysPerYear(pop) * 0.05;
  measure('years to raise the granary at a twentieth of the labour', td / sparePerYear);
  assert('the granary is the work of a season', td / sparePerYear < 0.5);

  // BUILDING ACCUMULATES AND CAPS at the year's-supply target.
  let g = 0;
  for (let y = 0; y < 3; y++) g = buildGranary(g, sparePerYear, pop);
  check('building cannot exceed the year\'s-supply target', g, td, 1e-6);

  // FULLNESS, for the panel: empty, half, brimming.
  check('an empty granary reads empty', granaryFullness(td, pop, 0), 0, 0);
  assert('a granary at half its cap reads about half',
    Math.abs(granaryFullness(td, pop, storageCapKg(td, pop) * 0.5) - 0.5) < 1e-9);
  check('and it cannot read past full',
    granaryFullness(td, pop, storageCapKg(td, pop) * 2), 1, 1e-9);
});
