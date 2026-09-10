// A founding's first year, run for real and held to what it now is.
//
// This suite exists because nothing ever probed one. The harvest window
// landed, porter provisions stayed priced for weekly grain, and a temperate
// founding of twenty quietly became a death march that no measurement
// watched: eighteen starved while eight cattle -- half a year of food --
// walked past the window uneaten. The probe that found it is now this file,
// so the founding year can never again drift unmeasured.
//
// What it holds: the assart is priced from the task rates; a founding drives
// carts as well as backs; a hungry village eats its herd BEFORE its people
// die, not after; the ground breaks season by season and the harvest scales
// with it; an established settlement -- no record on the delta -- is
// grandfathered whole; and an ISOLATED cold-climate founding is a disaster
// that leaves survivors, which is colonisation as the sources describe it.
// Greenland was real. A daughter with a mother in trade reach is the case
// that thrives, and the kingdom suite measures that one.

import { World } from '../sim/world.ts';
import { resolveTurn } from '../sim/turn.ts';
import { breakingDaysPerHa, sownAcreDays } from '../sim/model/labour.ts';
import { foundingHerd } from '../sim/model/village_herd.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

/** A temperate, windowed-climate land tile, found the way the probe found it. */
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

interface FoundingRun {
  survivors: number;
  lowestHealth: number;
  herdGoneTurn: number;
  popAtHerdGone: number;
  brokenAtYearEnd: number;
  firstHarvestKg: number;
}

type Mode = 'founding' | 'fields-only' | 'suite-seeded';

function found(world: World, addr: number[], mode: Mode): FoundingRun {
  const carts = Math.floor(foundingHerd(20) / 4);
  world.setDelta(addr, {
    owner: 0, population: 20, populationHealth: 1,
    farmShare: 1,
    // A suite-seeded settlement carries no records at all, and the economy's
    // conventions read both absences as ESTABLISHED: a full larder and broken
    // ground. That pair is what every older suite implicitly relies on.
    ...(mode === 'suite-seeded'
      ? {}
      : { grainStock: 20 * A.PORTER_LOAD_KG + carts * A.CART_LOAD_KG }),
    ...(mode === 'founding' ? { brokenHa: 0 } : {}),
  });
  const run: FoundingRun = {
    survivors: 0, lowestHealth: 1, herdGoneTurn: -1, popAtHerdGone: -1,
    brokenAtYearEnd: 0, firstHarvestKg: 0,
  };
  let lastGranary = world.getDelta(addr)?.grainStock ?? 0;
  for (let t = 0; t < 60; t++) {
    resolveTurn(world, [], 1);
    const d = world.getDelta(addr);
    if (d === undefined) break;
    const pop = d.population ?? 0;
    const granary = d.grainStock ?? 0;
    run.lowestHealth = Math.min(run.lowestHealth, d.populationHealth ?? 1);
    if (run.herdGoneTurn < 0 && (d.herdHead ?? 0) <= 0.01) {
      run.herdGoneTurn = t;
      run.popAtHerdGone = pop;
    }
    if (run.firstHarvestKg === 0 && granary > lastGranary + 100) {
      run.firstHarvestKg = granary - lastGranary;
    }
    lastGranary = granary;
    if (t === 51) run.brokenAtYearEnd = d.brokenHa ?? -1;
    run.survivors = pop;
  }
  return run;
}

suite('a founding year', () => {
  // THE ASSART PRICE, from the same task rates as the farming year: paring
  // and burning at the recorded hand rate, then the first ploughing at the
  // broken-ground factor. Against about fifteen man-days to RAISE a sown
  // acre, bringing one in costs about fourteen -- land pays a year of its own
  // labour before it yields, which is why assarts spread slowly.
  measure('man-days to break a hectare, iron tools', breakingDaysPerHa(true));
  measure('and with wood', breakingDaysPerHa(false));
  assert('breaking costs about thirty-five days a hectare',
    breakingDaysPerHa(true) > 25 && breakingDaysPerHa(true) < 45);
  assert('wooden tools pay more', breakingDaysPerHa(false) > breakingDaysPerHa(true));
  measure('against raising a crop on a broken acre, days',
    sownAcreDays(true));

  // THE CARTS. Twenty settlers drive eight beasts, which is two working
  // yokes, which is two cartloads on top of twenty backs.
  const carts = Math.floor(foundingHerd(20) / 4);
  check('two carts behind eight beasts', carts, 2, 0);
  measure('a founding of twenty carries, kg',
    20 * A.PORTER_LOAD_KG + carts * A.CART_LOAD_KG);
  assert('the carts more than double what backs alone brought',
    carts * A.CART_LOAD_KG > 20 * A.PORTER_LOAD_KG);

  // THE YEAR ITSELF, on a windowed temperate site with nobody to trade with
  // -- the hardest founding there is.
  const world = new World({ seed: 20260826 });
  const addr = temperateSite(world);
  measure('the site: temperature C', world.tile(addr).temperatureC);
  const cold = found(world, addr, 'founding');

  measure('survivors of an isolated cold founding, of twenty', cold.survivors);
  measure('their worst health on the way', cold.lowestHealth);
  assert('an isolated cold founding is a disaster, not an extinction',
    cold.survivors >= 1 && cold.survivors < 12);

  // THE HERD GOES FIRST. The larder rule eats the stock before the people
  // fail: the byre must be empty while the village is still mostly alive,
  // because a mechanism that lets beasts outlive their keepers is the exact
  // bug this suite was built on.
  measure('the byre is empty by turn', cold.herdGoneTurn);
  measure('and the village still numbers', cold.popAtHerdGone);
  assert('they ate the stock before they starved',
    cold.herdGoneTurn >= 0 && cold.popAtHerdGone > 16);

  // THE GROUND BREAKS while all this happens: the assart proceeds through
  // the hunger, and by the year's end most of the worked land exists.
  measure('hectares broken by the year\'s end', cold.brokenAtYearEnd);
  assert('a year of spare hands breaks a real township',
    cold.brokenAtYearEnd > 15);
  measure('the first window harvest, kg', cold.firstHarvestKg);
  assert('and the first harvest is real but arrives too late to save them',
    cold.firstHarvestKg > 200);

  // WHAT ACTUALLY KILLS THEM, separated. A twin with its fields already
  // broken but the same thin larder dies IDENTICALLY -- the same survivors to
  // three decimals -- because on this site the assart finishes months before
  // the window and the larder was always the binding constraint. The first
  // version of this check expected the broken fields to save them and learned
  // otherwise: the founding problem is provisions against the distance to the
  // window, and the assart only bites where the window comes early.
  const world2 = new World({ seed: 20260826 });
  const fieldsOnly = found(world2, temperateSite(world2), 'fields-only');
  measure('the broken-fields twin\'s survivors', fieldsOnly.survivors);
  check('the assart did not kill them; the larder did',
    fieldsOnly.survivors, cold.survivors, 0.5);

  // THE GRANDFATHER CONVENTION, as the suites actually use it: no records at
  // all reads as established -- full larder, broken ground -- and such a
  // village sails through the same year.
  const world4 = new World({ seed: 20260826 });
  const grand = found(world4, temperateSite(world4), 'suite-seeded');
  measure('the suite-seeded twin\'s survivors', grand.survivors);
  assert('an established village does not relive the founding',
    grand.survivors > 15);

  // DETERMINISM: the same founding fails identically forever.
  const world3 = new World({ seed: 20260826 });
  const again = found(world3, temperateSite(world3), 'founding');
  check('the same hard year, to the soul',
    again.survivors, cold.survivors, 1e-9);
});
