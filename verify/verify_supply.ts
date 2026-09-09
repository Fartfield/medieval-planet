// Supply, catchment, and whether a settlement can feed itself.
//
// The historical checks in here are the point. Transport cost is derived from
// what the movers eat -- nothing in it was fitted to a target -- and it has to
// land on two independent measurements taken from Roman evidence. If it stops
// doing that, the derivation is wrong somewhere, and the failure will be
// visible here long before it is visible in a game.

import * as A from '../sim/anchors.ts';
import { World } from '../sim/world.ts';
import { resolveTurn } from '../sim/turn.ts';
import { SUBCELL_COUNT } from '../sim/geo/hexgrid.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { GROUND_DEPTH } from '../sim/geo/address.ts';
import { yieldsFor } from '../sim/gen/submap.ts';
import { soilAt } from '../sim/gen/submap.ts';
import { grainYieldKgPerHa, cropSuitability, growingDays } from '../sim/model/soil.ts';
import { Biome } from '../sim/model/biome.ts';
import {
  Transport, costPerKm, delivered, rangeKm, labourEfficiency, reachFactor,
  WATER_ROAD_RATIO, CART_DOUBLING_KM, COMMUTE_LIMIT_KM,
  COST_PORTER, COST_CART, COST_WATER,
} from '../sim/model/supply.ts';
import {
  SEED_CORN_FRACTION, GRAIN_PER_PERSON_PER_YEAR, radiusForPopulation,
} from '../sim/model/settlement.ts';
import { HELD_HECTARE_DAYS_IRON } from '../sim/model/labour.ts';
import { check, measure, assert, suite } from './harness.ts';
import { bestRegion, groundSiteIn, bestFarmSite, yieldAt, siblingIn } from './sites.ts';

const SEED = 20260826;

suite('transport', () => {
  measure('porter cost per km', COST_PORTER);
  measure('cart cost per km', COST_CART);
  measure('water cost per km', COST_WATER);

  // Diocletian's Price Edict implies sea is about a fortieth of road. This is a
  // ratio, so the round-trip factor cancels out of it entirely -- which makes
  // it the cleaner of the two historical checks.
  measure('water is cheaper than road by', WATER_ROAD_RATIO);
  check('water beats road by the Diocletian ratio',
    WATER_ROAD_RATIO, A.WATER_ROAD_COST_RATIO, 12);

  // Duncan-Jones puts the price doubling for a wagon-load of wheat near 480 km.
  // Physical cost must come out BELOW a price-derived figure, because a price
  // carries tolls, risk and profit on top of the food the oxen ate. Coming out
  // above it would be the impossible result.
  measure('cart doubling distance km', CART_DOUBLING_KM);
  assert('the physical doubling distance is below the price-derived one',
    CART_DOUBLING_KM < A.WHEAT_DOUBLING_DISTANCE_KM);
  assert('but within a factor of two of it',
    CART_DOUBLING_KM > A.WHEAT_DOUBLING_DISTANCE_KM / 2);

  // Ordering: a cart beats a porter, water beats everything.
  assert('a cart beats a porter', COST_CART < COST_PORTER);
  assert('water beats a cart', COST_WATER < COST_CART);

  measure('porter range km', rangeKm(Transport.Porter));
  measure('cart range km', rangeKm(Transport.Cart));
  measure('water range km', rangeKm(Transport.Water));

  // At village scale transport is nearly free, which is why labour and not
  // haulage is what bounds a settlement.
  assert('two kilometres by cart costs under 1%',
    delivered(Transport.Cart, 2) > 0.99);
  // And at provincial scale it is the whole story.
  assert('five hundred kilometres by cart loses most of the load',
    delivered(Transport.Cart, 500) < 0.4);
  assert('five hundred kilometres by water loses almost none',
    delivered(Transport.Water, 500) > 0.98);

  // Nothing may deliver more than it started with, or arrive owing grain.
  let bad = 0;
  for (const mode of [Transport.Porter, Transport.Cart, Transport.Water] as const) {
    for (const km of [0, 1, 100, 1e5, 1e9]) {
      const d = delivered(mode, km);
      if (d < 0 || d > 1) bad++;
    }
  }
  check('delivery fraction stays in range', bad, 0, 0);
});

suite('labour and the walk', () => {
  check('a field at the door costs no walking', labourEfficiency(0), 1, 0);
  measure('commute limit km', COMMUTE_LIMIT_KM);
  check('past the commute limit nothing gets done',
    labourEfficiency(COMMUTE_LIMIT_KM + 1), 0, 0);
  assert('a field at 2 km still gives most of the day', labourEfficiency(2) > 0.9);
  assert('a field at 12 km gives about half', Math.abs(labourEfficiency(12) - 0.5) < 0.06);

  // Labour falls off fast and transport slowly, which is the whole reason a
  // settlement is compact but a trade route is not.
  assert('at 5 km the walk costs more than the haul',
    1 - labourEfficiency(5) > 1 - delivered(Transport.Cart, 5));
  assert('reach never exceeds one', reachFactor(0, Transport.Cart) <= 1);
  assert('reach falls with distance',
    reachFactor(1, Transport.Cart) > reachFactor(10, Transport.Cart));

  // Labour per hectare now comes from the medieval task rates in labour.ts,
  // added up job by job, rather than from dividing the virgate by a family
  // year. See verify_trade.ts for the derivation and the virgate check that
  // now sits on top of it.
  measure('labour days per held hectare', HELD_HECTARE_DAYS_IRON);
  assert('a hectare of arable is a few weeks of work',
    HELD_HECTARE_DAYS_IRON > 15 && HELD_HECTARE_DAYS_IRON < 40);

  measure('seed corn fraction', SEED_CORN_FRACTION);
  check('seed corn matches the yield ratio',
    1 / SEED_CORN_FRACTION, A.MEDIEVAL_YIELD_RATIO, 1e-9);
});

suite('crop suitability', () => {
  // The term that replaced an NPP double-count. It must answer a question
  // about the CROP, not about the landscape -- so a rainforest, which
  // out-produces everything, must not read as good wheat country.
  const beauce = cropSuitability(650, 11, 0.72);
  const rainforest = cropSuitability(3000, 26, 0.05);
  const desert = cropSuitability(90, 27, 0.42);
  const tundra = cropSuitability(300, -8, 0.95);

  measure('suitability temperate arable', beauce);
  measure('suitability rainforest', rainforest);
  measure('suitability desert', desert);
  measure('suitability tundra', tundra);

  assert('temperate arable is fully suitable', beauce > 0.95);
  assert('a desert cannot grow wheat', desert < 0.25);
  assert('tundra cannot grow wheat', tundra < 0.5);
  assert('a rainforest is water-rich but not better than good arable',
    rainforest <= beauce + 1e-9);

  // Season, not just water.
  assert('a long warm year gives a full season', growingDays(20, 0.1) > A.WHEAT_GROWING_DAYS);
  assert('a frozen year gives none', growingDays(-20, 0.95) < A.WHEAT_GROWING_DAYS);

  // And the double-count itself must stay gone: fertility must not appear
  // twice in a yield. Virgin soil has full health.
  const w = new World({ seed: SEED });
  const map = w.subMap(bestFarmSite(w).slice(0, -1));
  let sample = -1;
  for (let c = 0; c < SUBCELL_COUNT; c++) if (map.elevationM[c] > 0) { sample = c; break; }
  const soil = soilAt(map, sample >= 0 ? sample : 0);
  check('virgin soil is in full health', soil.health, 1, 0);
});

suite('farmland', () => {
  const w = new World({ seed: SEED });

  // Somewhere on this planet must have land as good as medieval Europe's, or
  // the game has no arable at all. Scan and take the best.
  let bestHaPerPerson = Infinity;
  let bestYield = 0;
  let scanned = 0;
  for (let c = 0; c < CELL_COUNT && scanned < 16; c += 3) {
    if (w.planet.elevationM[c] <= 0) continue;
    scanned++;
    const map = w.subMap(groundSiteIn(w, c).slice(0, -1));
    const ys = yieldsFor(map);
    const sorted = Array.from(ys).filter((v) => v > 0).sort((a, b) => b - a);
    if (sorted.length === 0) continue;
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    bestYield = Math.max(bestYield, sorted[0]);
    const ha = GRAIN_PER_PERSON_PER_YEAR / (p10 * (1 - SEED_CORN_FRACTION));
    bestHaPerPerson = Math.min(bestHaPerPerson, ha);
  }
  measure('best tile yield kg per ha', bestYield);
  measure('best land ha per person', bestHaPerPerson);

  // Agricultural historians put a person's subsistence at 0.5 to 1.5 hectares
  // under a three-field rotation. The best land on the planet has to reach it.
  assert('the best land is inside the historical 0.5-1.5 ha per person',
    bestHaPerPerson >= A.HISTORICAL_HA_PER_PERSON_LOW * 0.8
    && bestHaPerPerson <= A.HISTORICAL_HA_PER_PERSON_HIGH);
  assert('the best tiles reach medieval yields',
    bestYield > 330 && bestYield < 900);
});

suite('settlement', () => {
  const w = new World({ seed: SEED });
  const addr = bestFarmSite(w);
  measure('reference settlement site yield', yieldAt(w, addr));

  // A settlement must reach far more land than it stands on. This is the whole
  // point of the system: one tile is 506 m2 and feeds a tenth of a person.
  const small = w.harvestFor(addr, 5);
  assert('five people can feed themselves', small.ration >= 1);
  assert('and are limited by hands, not by land', small.limitedBy === 'labour');
  measure('ration at 5 people', small.ration);
  measure('hectares worked at 5 people', small.hectaresWorked);

  // Five people supply 625 man-days. At 23 days to a held hectare that is
  // about 27 ha -- more than a virgate, because a virgate is what a family
  // farmed *after* its dues to the lord, and nobody here owes any.
  measure('hectares five people work', small.hectaresWorked);
  assert('five people work more than a virgate and less than a hide',
    small.hectaresWorked > A.VIRGATE_HECTARES
    && small.hectaresWorked < A.VIRGATE_HECTARES * 5);

  // A big settlement runs out of land instead.
  const big = w.harvestFor(addr, 6000);
  assert('six thousand people outgrow the land', big.ration < 1);
  assert('and are limited by land, not by hands', big.limitedBy === 'land');
  measure('carrying capacity of the catchment', big.potentialPopulation);
  assert('the catchment supports a proper village or town',
    big.potentialPopulation > 100 && big.potentialPopulation < 20000);

  // Radius grows with the settlement, or a city searches only its own doorstep.
  assert('a bigger settlement searches further',
    radiusForPopulation(5000, w.cellAreaAt(GROUND_DEPTH))
      > radiusForPopulation(50, w.cellAreaAt(GROUND_DEPTH)));

  // The ranking must be by return per day, so the best land is taken first.
  const catchment = w.catchmentFor(addr, 500);
  let outOfOrder = 0;
  for (let i = 1; i < catchment.candidates.length; i++) {
    if (catchment.candidates[i].returnPerDay > catchment.candidates[i - 1].returnPerDay + 1e-9) {
      outOfOrder++;
    }
  }
  check('candidates are ranked by return per day', outOfOrder, 0, 0);
  measure('candidate tiles in a 500-person catchment', catchment.candidates.length);

  // Von Thunen falls out rather than being coded: what gets farmed first is
  // near, and the frontier moves outward as the settlement grows.
  assert('a larger settlement farms further out',
    w.harvestFor(addr, 2000).furthestWorkedM > w.harvestFor(addr, 20).furthestWorkedM);
});

suite('a settlement over time', () => {
  const w = new World({ seed: SEED });
  const addr = bestFarmSite(w);

  w.setDelta(addr, { owner: 0, population: 5, populationHealth: 1 });
  const track: number[] = [];
  // The granary through year three, once the village is past its founding
  // stores: the seasonal economy has to show in it or it is not seasonal.
  const granary: number[] = [];
  for (let t = 1; t <= 2600; t++) {
    resolveTurn(w, [], 1);
    if (t % 520 === 0) track.push(w.getDelta(addr)?.population ?? 0);
    if (t > 104 && t <= 156) granary.push(w.getDelta(addr)?.grainStock ?? 0);
  }

  // THE YEAR HAS A SHAPE NOW. The whole crop lands in the derived harvest
  // window and the granary saws: full after the harvest, drawn down through
  // winter and spring, lowest just before the next crop. A granary that never
  // swings would mean the grain was arriving by fifty-seconds again.
  const fullest = Math.max(...granary);
  const leanest = Math.min(...granary);
  measure('the granary at its year-round fullest, kg', fullest);
  measure('and at its leanest', leanest);
  measure('the lean weeks hold this share of the fat ones', leanest / Math.max(1, fullest));
  assert('the granary saws through the year, as a granary does',
    fullest > 0 && leanest < fullest * 0.8);
  assert('and the hungry gap does not empty it at this stocking',
    leanest > 0);

  measure('people after 10 years', track[0]);
  measure('people after 30 years', track[2]);
  measure('people after 50 years', track[4]);

  // The fractional-population bug: growth below one person a turn was rounded
  // away every turn, so a settlement with an ample surplus sat at exactly five
  // for a decade. This is the assertion that would have caught it.
  assert('a settlement with a surplus actually grows', track[0] > 5);

  // And it must level off rather than run away -- there is no cap in the code,
  // so the ceiling has to come from the land.
  //
  // Compared against the interval before it, not against the first one. An
  // S-curve's absolute growth is still rising through the inflection, so
  // year 40-50 legitimately exceeds year 10-20 and the earlier version of this
  // test failed against correct behaviour.
  measure('growth in years 20-30', track[2] - track[1]);
  measure('growth in years 30-40', track[3] - track[2]);
  measure('growth in years 40-50', track[4] - track[3]);

  // Self-limitation is tested through the ration rather than through the
  // shape of the curve. Absolute growth is still rising through the inflection
  // of an S-curve, and a fifty-year window on a poor site may not reach it --
  // two earlier versions of this test failed against entirely correct
  // behaviour for that reason. What must be true at every point is that
  // feeding more people off the same land gets harder.
  //
  // Measured against the land's own capacity rather than at 20 and 40 people.
  // Those were absolute numbers that only meant anything for the site the test
  // used to land on: once the reference settlement moved to real farmland with
  // room for eleven hundred, both populations sat so far inside it that the
  // ration was at its cap in both, and a true claim measured 0 -- not because
  // it had stopped being true but because it was being asked somewhere it
  // could not show.
  const final = track[track.length - 1];
  const capacity = w.harvestFor(addr, final).potentialPopulation;
  const early = w.harvestFor(addr, Math.max(5, capacity * 0.1)).ration;
  const late = w.harvestFor(addr, Math.max(10, capacity * 0.9)).ration;
  measure('ration at a tenth of capacity', early);
  measure('ration at nine tenths of capacity', late);
  assert('the same land feeds a larger settlement less well', late < early);
  measure('population after 50 years', final);
  measure('carrying capacity of the land', capacity);
  measure('fraction of capacity reached', final / capacity);

  // It grows, and it stays well inside what the land could bear.
  //
  // An earlier version asserted it would reach half the carrying capacity in
  // fifty years, and that stopped being true when settlements learned to farm
  // what they need rather than every hectare in reach. Five people now grow at
  // a realistic seven per cent a year and reach two hundred; the old figure of
  // two thousand came from a village ploughing five square kilometres it had
  // no use for. Slower is the correct answer.
  assert('it grows many times over', final > track[0] * 8);
  assert('and never exceeds what the land can bear', final < capacity);

  // Poor land must support fewer people than good land, measured the same way.
  //
  // Two earlier versions of this got it wrong in different ways. The first
  // asserted an absolute -- that forty people could not live on taiga -- which
  // stopped being true when the labour model came down to real medieval task
  // rates. The second compared the two at *different populations*, and since
  // the search radius grows with population that compared two different-sized
  // catchments and reported the poor land as richer. Same population, same
  // radius, or it means nothing.
  const w2 = new World({ seed: SEED });
  let poorSite: number[] | null = null;
  let poorYield = Infinity;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (w2.planet.elevationM[c] <= 0 || w2.planet.nppGm2[c] <= 0) continue;
    const candidate = groundSiteIn(w2, c);
    const y = yieldAt(w2, candidate);
    if (y > 0 && y < poorYield) { poorYield = y; poorSite = candidate; }
  }

  if (poorSite !== null) {
    const AT = 400;
    const poorCapacity = w2.harvestFor(poorSite, AT).potentialPopulation;
    const goodCapacity = w2.harvestFor(bestFarmSite(w2), AT).potentialPopulation;
    measure('poorest site yield kg per ha', poorYield);
    measure('poor land carrying capacity', poorCapacity);
    measure('good land carrying capacity', goodCapacity);
    assert('poor land carries fewer people than good land, at the same size',
      poorCapacity < goodCapacity);
  }
});
