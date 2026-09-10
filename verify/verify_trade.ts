// Trade, specialisation, and the medieval farming year.
//
// The headline assertion is the last one: a town on barren ground with ore in
// it stays a subsistence hamlet when it is alone, and becomes an ironworks the
// moment somebody is there to sell grain. Same seed, same tile, same people --
// the only difference is a neighbour. That is the whole point of the system and
// it is worth a test that would notice if it stopped happening.

import * as A from '../sim/anchors.ts';
import { World } from '../sim/world.ts';
import { resolveTurn } from '../sim/turn.ts';
import { toKey, type Address } from '../sim/geo/address.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { SUBCELL_COUNT } from '../sim/geo/hexgrid.ts';
import { yieldsFor } from '../sim/gen/submap.ts';
import { Mineral } from '../sim/model/resources.ts';
import {
  sownAcreDays, heldHectareDays, threshDays,
  HELD_HECTARE_DAYS_IRON, HELD_HECTARE_DAYS_WOOD, IRON_LABOUR_SAVING,
  IRON_DAYS_PER_KG, PEOPLE_PER_IRONWORKER, WOOD_PER_IRON_KG,
  ironOutputKgPerYear, ironLimit,
} from '../sim/model/labour.ts';
import {
  clear, stockTarget, routeYield, modeBetween, distanceM,
  Transport, type Trader,
} from '../sim/model/trade.ts';
import { groundSiteIn, bestFarmSite, yieldAt } from './sites.ts';
import { GROUND_DEPTH } from '../sim/geo/address.ts';
import { check, measure, assert, suite } from './harness.ts';

const SEED = 20260826;

suite('the farming year', () => {
  // Added up from the task rates the manorial accounts record, not estimated.
  // Historians put the full cycle at 10-15 man-days to a sown acre.
  measure('sown acre man-days with iron', sownAcreDays(true));
  measure('sown acre man-days with a wooden ard', sownAcreDays(false));
  assert('an iron-shod acre is inside the historical 10-15 man-days',
    sownAcreDays(true) >= 10 && sownAcreDays(true) <= 15);
  assert('a wooden ard costs more', sownAcreDays(false) > sownAcreDays(true));

  measure('held hectare man-days with iron', HELD_HECTARE_DAYS_IRON);
  measure('held hectare man-days without', HELD_HECTARE_DAYS_WOOD);
  measure('iron saving on the farming year', IRON_LABOUR_SAVING);
  assert('iron takes a real bite out of the year',
    IRON_LABOUR_SAVING > 0.2 && IRON_LABOUR_SAVING < 0.5);

  // Held is not sown. A third of a holding lies fallow and still gets ploughed;
  // confusing the two is the same error as leaving fallow out of the yield.
  assert('a held hectare costs less than a sown one',
    heldHectareDays(true) < sownAcreDays(true) / A.ACRE_HECTARES);

  // THE VIRGATE CHECK. This is the one that says the whole derivation is sound.
  //
  // A yardland of 12 ha supported one family. A family of five has about two
  // and a half workers giving 250 days each. If the arable swallowed all of
  // that there would have been no week-work, no beasts and no croft -- and
  // week-work alone ran to two or three days in seven. So the family's own
  // fields should come to roughly half its days, and no more.
  const familyDays = A.WORKERS_PER_FAMILY * A.WORKING_DAYS_PER_YEAR;
  const virgateDays = A.VIRGATE_HECTARES * HELD_HECTARE_DAYS_IRON;
  measure('share of a family year spent on its own virgate', virgateDays / familyDays);
  assert('a virgate takes about half a family year, leaving room for the dues',
    virgateDays / familyDays > 0.3 && virgateDays / familyDays < 0.65);

  // Threshing scales with the harvest, not the acreage -- a flail gets through
  // about a quarter a day whatever the field looked like.
  check('threshing a quarter takes a day', threshDays(A.THRESH_KG_PER_DAY), 1, 1e-12);
  assert('better land costs more to thresh', threshDays(600) > threshDays(300));
});

suite('ironworking', () => {
  measure('man-days per kg of iron', IRON_DAYS_PER_KG);
  measure('timber per kg of iron', WOOD_PER_IRON_KG);

  // THE VILLAGE SMITH CHECK. At this cost one man working a full year keeps a
  // few hundred people in tools, and a few hundred people to a smith is what
  // the manorial record shows. Nothing was tuned to produce it.
  measure('people kept in tools by one ironworker', PEOPLE_PER_IRONWORKER);
  assert('one ironworker supplies a few hundred people',
    PEOPLE_PER_IRONWORKER > 100 && PEOPLE_PER_IRONWORKER < 1000);

  // The smallest of hands, ore and wood wins, and wood usually does -- which
  // is why ironworks moved when the woods gave out rather than when the ore did.
  const plentiful = ironOutputKgPerYear(1000, 1, 1e9);
  const woodless = ironOutputKgPerYear(1000, 1, 100);
  assert('no wood, no iron', woodless < plentiful);
  check('with no wood the limit is wood', ironLimit(1000, 1, 100) === 'wood' ? 1 : 0, 1, 0);
  check('with no ore there is no iron at all', ironOutputKgPerYear(1000, 0, 1e9), 0, 0);
  check('and it says so', ironLimit(1000, 0, 1e9) === 'no ore' ? 1 : 0, 1, 0);
  assert('a poor seam yields less than a rich one for the same effort',
    ironOutputKgPerYear(1000, 0.1, 1e9) < ironOutputKgPerYear(1000, 1, 1e9));
});

suite('the market', () => {
  const at = (key: string, x: number, navigable: boolean, offered: number, wanted: number): Trader =>
    ({ key, address: [0, 0, 0], dir: [Math.cos(x), 0, Math.sin(x)], navigable, offered, wanted });

  // Nothing to move.
  check('an empty market clears to nothing', clear([]).flows.length, 0, 0);
  check('all sellers and no buyers moves nothing',
    clear([at('a', 0, false, 100, 0), at('b', 0.001, false, 50, 0)]).flows.length, 0, 0);

  // One seller, one buyer, close together.
  const near = clear([at('seller', 0, false, 1000, 0), at('buyer', 0.0002, false, 0, 100)]);
  check('a nearby sale happens', near.flows.length, 1, 0);
  assert('the buyer gets what it asked for',
    Math.abs((near.received.get('buyer') ?? 0) - 100) < 1);
  assert('the seller shipped a little more than arrived',
    near.totalShipped > near.totalDelivered);

  // Water beats distance. A river supplier far away must out-compete a cart
  // supplier close by -- that is the whole reason rivers matter.
  const contest = clear([
    at('cart-near', 0.004, false, 1000, 0),
    at('river-far', 0.05, true, 1000, 0),
    at('buyer', 0, true, 0, 500),
  ]);
  const fromRiver = contest.flows.find((f) => f.from === 'river-far');
  assert('a distant river supplier beats a near overland one', fromRiver !== undefined);
  if (fromRiver !== undefined) {
    check('and it comes by water', fromRiver.mode === Transport.Water ? 1 : 0, 1, 0);
    measure('river route km', fromRiver.km);
  }

  // Nothing may be created. Delivered can never exceed shipped.
  const big = clear([
    at('a', 0, true, 5000, 0), at('b', 0.01, true, 3000, 0),
    at('c', 0.02, false, 0, 4000), at('d', 0.03, true, 0, 2000),
  ]);
  assert('the market never creates goods', big.totalDelivered <= big.totalShipped);
  assert('and it moves something', big.totalDelivered > 0);

  // Deterministic: the same market must clear identically, every time.
  const traders = [
    at('x', 0, true, 900, 0), at('y', 0.008, false, 400, 0),
    at('z', 0.015, true, 0, 800), at('w', 0.02, false, 0, 300),
  ];
  const first = JSON.stringify(clear(traders).flows);
  let stable = true;
  for (let i = 0; i < 5; i++) if (JSON.stringify(clear(traders).flows) !== first) stable = false;
  assert('the market clears deterministically', stable);

  // And it must not depend on the order the traders were listed in.
  const shuffled = [traders[2], traders[0], traders[3], traders[1]];
  const a = clear(traders);
  const b = clear(shuffled);
  check('clearing does not depend on trader order',
    Math.abs(a.totalDelivered - b.totalDelivered), 0, 1e-9);

  check('a stock target is a year of eating',
    stockTarget(1000), 1000 * A.GRAIN_STOCK_TARGET_YEARS, 1e-12);

  const p = at('p', 0, true, 0, 0);
  const q = at('q', 0.001, true, 0, 0);
  const land = at('r', 0.001, false, 0, 0);
  assert('two navigable places trade by water', modeBetween(p, q) === Transport.Water);
  assert('one landlocked end forces a cart', modeBetween(p, land) === Transport.Cart);
  assert('a nearer route delivers more', routeYield(p, q) > routeYield(p, at('s', 0.1, true, 0, 0)));
  measure('distance between the test pair km', distanceM(p, q) / 1000);
});

suite('specialisation', () => {
  // A barren tile with ore in it, and good farmland near enough to reach it.
  // Searched rather than hard-coded, so this still finds a site if generation
  // ever shifts underneath it.
  const scout = new World({ seed: SEED });
  // SEVERAL ANCHORS, not one.
  //
  // This used to take the single most productive site on the planet and look
  // within four kilometres of it. That is a bet that the best farmland in the
  // world happens to have barren ground beside it, and the bet came off until
  // the tiling changed: on the geodesic the ground around the best site is
  // uniformly fertile for seven and a half kilometres in every direction, so
  // the search found ore in 4,734 tiles and poor ground in none of them, and a
  // suite about specialisation failed for want of anywhere to put a mine.
  //
  // Widening the radius is the expensive answer -- reaching 7.6 km means
  // generating twelve thousand sub-maps, sixteen seconds of it. Trying the next
  // good region instead costs one more four-kilometre search, and the third
  // anchor here finds a site at 100 kg/ha next to farmland at 667, which is a
  // far sharper contrast than the original ever had.
  const ranked: number[] = [];
  for (let c = 0; c < CELL_COUNT; c++) if (scout.planet.elevationM[c] > 0) ranked.push(c);
  ranked.sort((a, b) => scout.planet.nppGm2[b] - scout.planet.nppGm2[a]);

  let farm: number[] | null = null;
  let farmYield = 0;
  let mine: number[] | null = null;
  let mineYield = Infinity;
  let mineOre = 0;

  for (let i = 0; i < 8 && mine === null; i++) {
    const site = groundSiteIn(scout, ranked[i]);
    const y = yieldAt(scout, site);
    // Only somewhere that is actually good farmland: the claim is about a poor
    // site NEXT TO a good one, so a mediocre anchor proves nothing.
    if (y < 300) continue;
    const dir = scout.tile(site).dir;
    const near = scout.cellsWithin(dir[0], dir[1], dir[2], 4000, GROUND_DEPTH);

    let bestYield = Infinity;
    let bestOre = 0;
    let best: number[] | null = null;
    for (const mapAddr of near) {
      const map = scout.subMap(mapAddr);
      const ys = yieldsFor(map);
      for (let c = 0; c < SUBCELL_COUNT; c++) {
        if (map.elevationM[c] < 0) continue;
        if (ys[c] > y * 0.45) continue;
        const ore = scout.tile([...mapAddr, c]).deposits.find((d) => d.kind === Mineral.Iron);
        if (ore === undefined || ore.richness < 0.2) continue;
        if (ys[c] < bestYield) { bestYield = ys[c]; bestOre = ore.richness; best = [...mapAddr, c]; }
      }
    }
    if (best !== null) {
      farm = site; farmYield = y;
      mine = best; mineYield = bestYield; mineOre = bestOre;
    }
  }

  measure('good regions tried before a mine site turned up',
    mine === null ? 0 : ranked.indexOf(farm![0]) + 1);

  assert('there is barren ground with ore in it near good farmland', mine !== null);
  if (mine === null || farm === null) return;
  measure('farm site yield', farmYield);
  measure('mine site yield', mineYield);
  measure('mine site ore richness', mineOre);
  assert('the mine site is much the poorer ground', mineYield < farmYield * 0.5);

  // Narrowed once here rather than asserted at each use: the guard above has
  // already returned if either is null, but the closure below is a separate
  // scope and the compiler cannot carry the narrowing into it.
  const farmSite: Address = farm;
  const mineSite: Address = mine;

  function play(withNeighbour: boolean, years: number): { pop: number; share: number; iron: number; grainIn: number } {
    const w = new World({ seed: SEED });
    if (withNeighbour) {
      w.setDelta(farmSite, {
        owner: 0, population: 400, populationHealth: 1,
        grainStock: 400 * 330, farmShare: 1,
      });
    }
    w.setDelta(mineSite, {
      owner: 0, population: 60, populationHealth: 1,
      grainStock: 60 * 30, farmShare: 1,
    });

    // Sample the LAST TURN THE TOWN WAS STILL ALONE, not simply the last turn.
    // A settlement on decent ore grows, and once demography let it grow fast
    // enough it founds daughters within the twelve years -- at which point it
    // is no longer alone and correctly turns to iron, living on its
    // children's grain. That is the paired behaviour arriving early, not the
    // alone behaviour failing, and reading the final turn conflated the two.
    // The claim is about a town WITH NO NEIGHBOUR, so it is read while it has
    // none.
    let last = null;
    let lastAlone = null;
    const turns = Math.round(years * A.TURNS_PER_YEAR);
    for (let t = 0; t < turns; t++) {
      const res = resolveTurn(w, [], 1);
      last = res.reports.get(toKey(mineSite)) ?? null;
      if (last === null) break;
      if (last.alone) lastAlone = last;
    }
    // When the caller wants the isolated reading, give it the last isolated
    // turn; the neighbour case is never alone and reads its final turn.
    const sample = withNeighbour ? last : (lastAlone ?? last);
    return sample === null
      ? { pop: 0, share: 1, iron: 0, grainIn: 0 }
      : { pop: sample.population, share: sample.farmShare, iron: sample.ironMade, grainIn: sample.grainIn };
  }

  const alone = play(false, 12);
  const paired = play(true, 12);

  measure('alone: farm share', alone.share);
  measure('alone: iron made per turn', alone.iron);
  measure('paired: farm share', paired.share);
  measure('paired: iron made per turn', paired.iron);
  measure('paired: grain imported per turn', paired.grainIn);

  // THE ASSERTION THIS WHOLE FILE EXISTS FOR.
  assert('alone on barren ground, it farms and makes no iron',
    alone.share > 0.9 && alone.iron < 1);
  assert('given a neighbour to trade with, it stops farming',
    paired.share < 0.4);
  assert('and becomes an ironworks', paired.iron > 50);
  assert('living on imported grain', paired.grainIn > 0);
  assert('and it survives doing so', paired.pop > 0);

  // Territory: two settlements cannot both farm the same field.
  //
  // The rival has to be inside the catchment to take anything from it, and the
  // mine site above may be four kilometres off -- beyond what 128 sub-maps
  // reach. So this uses a neighbour picked for being close, which is what the
  // claim is actually about.
  const w = new World({ seed: SEED });
  const catchment = w.catchmentFor(farm, 400);
  const rivalTile = catchment.candidates.find((t) => t.distanceM > 300 && t.distanceM < 800);
  assert('there is a tile close enough to put a rival on', rivalTile !== undefined);
  if (rivalTile === undefined) return;

  const rivalMap = catchment.maps[rivalTile.map];
  const rival = {
    x: rivalMap.dirs[rivalTile.cell * 3],
    y: rivalMap.dirs[rivalTile.cell * 3 + 1],
    z: rivalMap.dirs[rivalTile.cell * 3 + 2],
  };
  measure('rival distance m', rivalTile.distanceM);

  const solo = w.harvestFor(farm, 400);
  const withRival = w.harvestFor(farm, 400, 1, 1, [rival]);
  measure('tiles lost to a neighbour', withRival.tilesLostToNeighbours);
  assert('a neighbour takes land away', withRival.tilesLostToNeighbours > 0);
  assert('and that means less to farm',
    withRival.potentialPopulation < solo.potentialPopulation);
});
