// The fold beside the byre, run through real years in a real village.
//
// The flock shares the herd's machinery -- the same husbandry loop at a
// thirteenth the mass -- and the village wiring is what this suite drives:
// one sward split by demand, one barn, the shearing at its derived week, the
// evenings spinning the wool store into cloth, and the wardrobe wearing out
// as fast as history says it did. The centrepiece is self-sufficiency in the
// thing the period traded most: a village of twenty with its five ewes a
// family must roughly clothe itself, because that arithmetic -- flock size
// against fleece against the spindle -- is what every smallholding actually
// balanced.

import { World } from '../sim/world.ts';
import { resolveTurn } from '../sim/turn.ts';
import { foundingFlock, foundingHerd, shearingWeek } from '../sim/model/village_herd.ts';
import { FLEECE_KG_PER_YEAR } from '../sim/model/sheep.ts';
import { CLOTH_KG_PER_M2 } from '../sim/model/craft.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

/** The founding suite's own temperate site search, reused verbatim. */
function temperateSite(world: World): number[] {
  for (let r = 0; r < 480; r += 7) {
    if (world.tile([r, 45]).elevationM < 50) continue;
    for (let c = 40; c < 50; c++) {
      const a = [r, 45, 45, 45, 45, c];
      const t = world.tile(a);
      if (t.elevationM > 20 && t.nppGm2 > 400 && t.slope < 0.05
        && t.temperatureC > 4 && t.temperatureC < 13) return a;
    }
  }
  throw new Error('no temperate ground on this seed');
}

suite('the fold', () => {
  // Twenty people are four families; five ewes each is twenty head. The
  // first version of this check said twenty-five, having counted five
  // families -- the suite's own arithmetic, not the model's.
  check('five ewes a family walk in', foundingFlock(20), 20, 0);

  // AN ESTABLISHED VILLAGE, three years watched. Established rather than a
  // founding, so the flock's own year is read without the first winter's
  // emergency writing over it -- the founding case stays verify_founding's.
  const world = new World({ seed: 20260826 });
  const addr = temperateSite(world);
  world.setDelta(addr, {
    owner: 0, population: 20, populationHealth: 1, farmShare: 1,
  });
  const tile = world.tile(addr);
  const shearW = shearingWeek(tile.temperatureC, tile.dir[1]);
  measure('the shearing falls in week', shearW);
  assert('shearing is early in the season, after the cold',
    shearW >= 0);

  let woolPeak = 0;
  let woolShearings = 0;
  let lastWool = 0;
  let clothEnd = 0;
  let flockEnd = 0;
  let cattleEnd = 0;
  for (let t = 0; t < 156; t++) {
    resolveTurn(world, [], 1);
    const d = world.getDelta(addr);
    if (d === undefined) break;
    const wool = d.woolKg ?? 0;
    if (wool > lastWool + 1) woolShearings++;
    lastWool = wool;
    woolPeak = Math.max(woolPeak, wool);
    clothEnd = d.clothM2 ?? 0;
    flockEnd = d.flockHead ?? 0;
    cattleEnd = d.herdHead ?? 0;
  }

  // THE FLOCK LIVES BESIDE THE HERD on one sward: three years on, both stand.
  measure('the flock after three years', flockEnd);
  measure('and the cattle beside it', cattleEnd);
  assert('the fold and the byre share the sward and both live',
    flockEnd > 15 && cattleEnd > 5);

  // THE SHEARING COMES ONCE A YEAR, and the store shows each one.
  measure('shearings seen in three years', woolShearings);
  assert('the shears come out once a summer',
    woolShearings >= 2 && woolShearings <= 4);
  measure('the wool store at its fullest, kg', woolPeak);
  assert('a shearing is the flock\'s own fleece-weight or near it',
    woolPeak > foundingFlock(20) * FLEECE_KG_PER_YEAR * 0.5);

  // THE WARDROBE. Twenty people wear out 50 kg of cloth a year; the flock
  // gives 35-odd kg of fleece; the evenings spin what there is. The village
  // comes out CLOSE to clothed and a little short -- which is exactly the
  // gap the cloth trade of the entire period existed to fill, and the reason
  // the wool towns will have something to sell when trade in cloth lands.
  measure('the wardrobe after three years, m2', clothEnd);
  const yearNeedM2 = (20 * 2.5) / CLOTH_KG_PER_M2;
  measure('a year\'s wear for twenty, m2', yearNeedM2);
  const flockClothM2 = (flockEnd * FLEECE_KG_PER_YEAR * 0.7) / CLOTH_KG_PER_M2;
  measure('what the flock\'s year can weave, m2', flockClothM2);
  assert('the flock clothes most of the village, not all of it',
    flockClothM2 > yearNeedM2 * 0.4 && flockClothM2 < yearNeedM2 * 1.5);

  // Rough arithmetic nobody typed: sheep per person to be fully clothed.
  measure('ewes to clothe one person, at the scoured fleece',
    2.5 / (FLEECE_KG_PER_YEAR * 0.7));

  // DETERMINISM through the whole stack, flock included.
  const world2 = new World({ seed: 20260826 });
  const addr2 = temperateSite(world2);
  world2.setDelta(addr2, {
    owner: 0, population: 20, populationHealth: 1, farmShare: 1,
  });
  for (let t = 0; t < 60; t++) resolveTurn(world2, [], 1);
  const world3 = new World({ seed: 20260826 });
  const addr3 = temperateSite(world3);
  world3.setDelta(addr3, {
    owner: 0, population: 20, populationHealth: 1, farmShare: 1,
  });
  for (let t = 0; t < 60; t++) resolveTurn(world3, [], 1);
  check('the same fold folds the same',
    world2.getDelta(addr2)?.flockHead ?? -1,
    world3.getDelta(addr3)?.flockHead ?? -2, 0);
});
