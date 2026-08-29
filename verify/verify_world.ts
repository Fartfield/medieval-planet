// The world facade: sub-maps, tiles, soil, resources, and the delta store.
//
// The headline assertion in here is the soil ordering. It is the one that
// caught a real modelling error -- the first fertility model had leaching and
// nothing else, and produced a rainforest more fertile than a prairie, which
// is exactly backwards and would have made "settle in the jungle" the right
// opening move forever. See docs/fix-attempts.md.

import { World } from '../sim/world.ts';
import { SUBCELL_COUNT } from '../sim/geo/hexgrid.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { toKey, fromKey, GROUND_DEPTH, MAX_DEPTH } from '../sim/geo/address.ts';
import { Biome, miamiNPP, biotemperature } from '../sim/model/biome.ts';
import { deriveSoil, leachingFraction, decompositionRate } from '../sim/model/soil.ts';
import { Mineral, gameHeadPerKm2, timberTPerHa } from '../sim/model/resources.ts';
import { Landform } from '../sim/model/tile.ts';
import { check, measure, assert, suite } from './harness.ts';
import { bestRegion, groundSiteIn, bestFarmSite, yieldAt, siblingIn } from './sites.ts';

const SEED = 20260826;

/**
 * A ground-layer address, found the same way every run so the measurements
 * compare. Six numbers deep now, so it has to be descended rather than
 * written down -- see sites.ts.
 */
function site(w: World): number[] {
  return bestFarmSite(w);
}

suite('soil', () => {
  // Each biome at its own latitude. Using one latitude for all of them puts
  // tundra at 24 degrees, which is how the first version of this test managed
  // to report a leaching fraction of 1.00 on permanently frozen ground.
  const at = (t: number, p: number, sinLat: number, biome: number) =>
    deriveSoil({ temperatureC: t, precipMm: p, sinLat, slope: 0.01, alluvial: 0.2, biome });

  const grassland = at(9, 480, 0.65, Biome.TemperateGrassland);
  const savanna = at(24, 800, 0.20, Biome.Savanna);
  const tempForest = at(11, 900, 0.70, Biome.TemperateForest);
  const rainforest = at(26, 2600, 0.05, Biome.TropicalRainforest);
  const taiga = at(0, 450, 0.85, Biome.Taiga);
  const tundra = at(-8, 250, 0.95, Biome.Tundra);
  const desert = at(27, 90, 0.42, Biome.Desert);

  measure('fertility temperate grassland', grassland.fertility);
  measure('fertility savanna', savanna.fertility);
  measure('fertility temperate forest', tempForest.fertility);
  measure('fertility tropical rainforest', rainforest.fertility);
  measure('fertility taiga', taiga.fertility);
  measure('fertility tundra', tundra.fertility);
  measure('fertility desert', desert.fertility);

  // The ordering IS the model. If these ever flip, the mechanism is wrong,
  // not the threshold.
  assert('grassland is the most fertile soil', grassland.fertility > savanna.fertility);
  assert('savanna beats temperate forest', savanna.fertility > tempForest.fertility);
  assert('temperate forest beats rainforest', tempForest.fertility > rainforest.fertility);
  assert('rainforest beats desert', rainforest.fertility > desert.fertility);
  assert('tundra is poor', tundra.fertility < taiga.fertility);

  // And the paradox itself, stated directly: the most productive vegetation on
  // Earth grows on some of its worst soil.
  const rainforestNpp = miamiNPP(26, 2600);
  const grasslandNpp = miamiNPP(9, 480);
  assert('rainforest out-produces grassland', rainforestNpp > grasslandNpp * 2);
  assert('grassland out-fertilises rainforest', grassland.fertility > rainforest.fertility * 4);
  measure('rainforest npp over grassland npp', rainforestNpp / grasslandNpp);
  measure('grassland fertility over rainforest fertility', grassland.fertility / rainforest.fertility);

  // Frozen ground cannot leach. This is the guard, tested directly.
  check('frozen ground does not leach', leachingFraction(300, -30, 0.99), 0, 0);
  assert('a wet warm place does leach', leachingFraction(2600, 26, 0.05) > 0.3);
  check('a semi-arid place has no surplus', leachingFraction(480, 9, 0.65), 0, 0);

  // Q10: decomposition doubles per ten degrees.
  check('decomposition doubles per 10 degC', decompositionRate(20) / decompositionRate(10), 2, 1e-12);
  check('decomposition at the reference temperature', decompositionRate(10), 1, 1e-12);

  // Biotemperature must discard the frozen months rather than average them in.
  assert('biotemperature exceeds the annual mean in a cold seasonal place',
    biotemperature(-8, 0.95) > -8);
  check('biotemperature equals the mean in an aseasonal warm place',
    biotemperature(26, 0.0), 26, 0.001);

  // Slope must strip soil off a mountain however good the climate is.
  const flat = deriveSoil({ temperatureC: 11, precipMm: 900, sinLat: 0.7, slope: 0.01, alluvial: 0.2, biome: Biome.TemperateForest });
  const steep = deriveSoil({ temperatureC: 11, precipMm: 900, sinLat: 0.7, slope: 0.45, alluvial: 0.2, biome: Biome.TemperateForest });
  assert('a steep slope holds far less soil', steep.depthCm < flat.depthCm * 0.4);
});

suite('resources', () => {
  // Savanna must carry several times the large game a forest does, despite the
  // forest out-producing it -- because a forest keeps its production in wood.
  const savannaGame = gameHeadPerKm2(Biome.Savanna, 900);
  const forestGame = gameHeadPerKm2(Biome.TemperateForest, 1200);
  assert('savanna carries more game than a richer forest', savannaGame > forestGame * 3);
  measure('savanna game per km2', savannaGame);
  measure('temperate forest game per km2', forestGame);

  // Anchored on the one measured point: African savanna at 5,000 kg/km2.
  check('savanna herbivore biomass matches the anchor',
    gameHeadPerKm2(Biome.Savanna, 900) * 70, 5000, 1);

  // Timber, anchored at 150 t/ha for a temperate forest at reference growth.
  check('temperate forest timber matches the anchor',
    timberTPerHa(Biome.TemperateForest, 1000), 150, 0.5);
  assert('grassland carries almost no timber', timberTPerHa(Biome.TemperateGrassland, 600) < 60);

  // Metal rarity must follow crustal abundance. Iron common, tin rare, gold
  // rarest -- and the bronze-then-iron shape of an age falls out of that.
  // Sampled across many regions, not one. Metal rarity is a global claim, and
  // tin in particular is deliberately clustered -- one map sitting inside a tin
  // province will show more tin than copper and be right to. The first version
  // of this test sampled a single map and failed for exactly that reason.
  //
  // One ground map per region: varying the realm index as well would need a
  // fresh sub-map for every tile, which at 75 ms each took over two minutes.
  // Sampled across three worlds and every land region in each.
  //
  // Metal rarity is a global claim about crustal abundance, and a sub-map is
  // 91 tiles now rather than 9,919 -- so a single map cannot say anything
  // about a metal that turns up on a fifth of one per cent of the ground.
  // Twenty-odd thousand tiles can.
  const counts = new Map<number, number>();
  let sampled = 0;
  let regions = 0;
  for (const seed of [SEED, SEED + 7919, SEED + 15838]) {
    const w = new World({ seed });
    for (let c = 0; c < CELL_COUNT; c++) {
      if (w.planet.elevationM[c] <= 0) continue;
      regions++;
      const parent = groundSiteIn(w, c).slice(0, -1);
      for (let i = 0; i < SUBCELL_COUNT; i++) {
        const t = w.tile([...parent, i]);
        sampled++;
        for (const d of t.deposits) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
      }
    }
  }
  measure('regions sampled for ore', regions);
  measure('tiles sampled for ore', sampled);
  const rate = (m: number): number => (counts.get(m) ?? 0) / sampled;
  measure('iron deposit rate', rate(Mineral.Iron));
  measure('copper deposit rate', rate(Mineral.Copper));
  measure('tin deposit rate', rate(Mineral.Tin));
  measure('gold deposit rate', rate(Mineral.Gold));
  assert('iron is commoner than copper', rate(Mineral.Iron) > rate(Mineral.Copper));
  assert('copper is commoner than tin', rate(Mineral.Copper) > rate(Mineral.Tin));
  assert('tin is commoner than gold', rate(Mineral.Tin) >= rate(Mineral.Gold));
  assert('stone is on every tile', rate(Mineral.Stone) > 0.99);
});

suite('sub-maps', () => {
  const w = new World({ seed: SEED });
  const ground = site(w);
  measure('reference region', ground[0]);

  const realm = w.subMap([ground[0]]);
  check('sub-map fills its cell count', realm.elevationM.length, SUBCELL_COUNT, 0);
  check('first sub-map depth', realm.depth, 1, 0);

  // Cell positions must be unit vectors, or every latitude below is wrong.
  let worstNorm = 0;
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    const x = realm.dirs[c * 3], y = realm.dirs[c * 3 + 1], z = realm.dirs[c * 3 + 2];
    worstNorm = Math.max(worstNorm, Math.abs(Math.sqrt(x * x + y * y + z * z) - 1));
  }
  check('sub-map cell directions are unit vectors', worstNorm, 0, 1e-12);

  // Scale. A hexagon has two different widths and it is easy to test the wrong
  // one: vertex-to-vertex is 2r, but flat-to-flat -- which is also the distance
  // between the centres of two neighbours -- is sqrt(3)*r, about 13% less.
  // spacingM is the centre-to-centre figure the slope calculation needs.
  measure('layer 1 cell spacing m', realm.spacingM);
  const groundMap = w.subMap(ground.slice(0, -1));
  measure('ground cell spacing m', groundMap.spacingM);
  check('ground depth', groundMap.depth, GROUND_DEPTH, 0);
  assert('a ground cell is a few tens of metres across',
    groundMap.spacingM > 20 && groundMap.spacingM < 60);

  // Drainage must be a real catchment: heavily skewed, with a few big channels
  // rather than a uniform smear.
  //
  // ASKED AT THE GROUND LAYER, because that is where a channel is narrower
  // than a tile and "this tile has a river on it" means something. It used to
  // be asked of the march map, where a cell is 27.8 km across and drains
  // 670 km2: at that size nearly every cell carries the 844 m3/s the threshold
  // asks for, and it is right that it does. Sixty-four of ninety-one is not
  // the model being wrong, it is the question being wrong -- the water is real
  // and it is spread over a hundred channels, none of them resolved. Same
  // finding as the soil model's, one field over: the rule is right and the
  // grid cannot ask it.
  let rivers = 0, sum = 0;
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    if (groundMap.drainage[c] > 0.55) rivers++;
    sum += groundMap.drainage[c];
  }
  measure('ground cells carrying a river', rivers);
  measure('mean ground drainage', sum / SUBCELL_COUNT);
  measure('march cells over the river threshold', (() => {
    let n = 0;
    for (let c = 0; c < SUBCELL_COUNT; c++) if (realm.drainage[c] > 0.55) n++;
    return n;
  })());
  assert('some ground cells carry a river', rivers > 0);
  assert('most ground cells do not', rivers < SUBCELL_COUNT * 0.5);

  // Detail must actually add relief, or every ground tile is identical.
  // `ground` is an address now, not a map -- reading elevationM off it was
  // what made this suite throw when the ladder went to eight layers.
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    lo = Math.min(lo, groundMap.elevationM[c]);
    hi = Math.max(hi, groundMap.elevationM[c]);
  }
  measure('ground map relief m', hi - lo);
  assert('a ground map has some relief', hi - lo > 0.5);

  // Generation must be reproducible, which is the whole persistence claim.
  const w2 = new World({ seed: SEED });
  const realm2 = w2.subMap([ground[0]]);
  let differs = 0;
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    if (realm.elevationM[c] !== realm2.elevationM[c]) differs++;
    if (realm.biome[c] !== realm2.biome[c]) differs++;
  }
  check('a sub-map regenerates identically', differs, 0, 0);
});

suite('tiles and deltas', () => {
  const w = new World({ seed: SEED });
  const addr = site(w);

  const t = w.tile(addr);
  assert('a tile has a biome', t.biome >= 0 && t.biome <= 12);
  assert('a tile has a landform', t.landform >= 0 && t.landform <= 7);
  assert('an unmodified tile is unmodified', !t.modified);
  check('an unsettled tile has nobody on it', t.population, 0, 0);
  check('an unclaimed tile has no owner', t.owner, -1, 0);
  measure('reference tile fertility', t.soil.fertility);
  measure('reference tile grain kg per ha', t.flora.grainKgPerHa);

  // Water tiles must classify as water, whatever else is true of them.
  let waterFound = false;
  const map = w.subMap(addr.slice(0, -1));
  for (let c = 0; c < SUBCELL_COUNT && !waterFound; c++) {
    if (map.elevationM[c] < 0) {
      waterFound = true;
      check('a submarine tile is water',
        w.tile([...addr.slice(0, -1), c]).landform, Landform.Water, 0);
    }
  }

  // The delta store: writes stick, and emptying one gives the storage back.
  check('a fresh world stores nothing', w.deltaCount, 0, 0);
  w.setDelta(addr, { population: 42, owner: 3 });
  check('a delta is stored', w.deltaCount, 1, 0);
  const settled = w.tile(addr);
  check('population comes back', settled.population, 42, 0);
  check('owner comes back', settled.owner, 3, 0);
  assert('the tile now reads as modified', settled.modified);

  // Everything not in the delta is still generated, not stored.
  check('biome is unchanged by a delta', settled.biome, t.biome, 0);
  check('elevation is unchanged by a delta', settled.elevationM, t.elevationM, 0);

  w.setDelta(addr, { population: undefined, owner: undefined });
  check('an emptied delta is dropped', w.deltaCount, 0, 0);

  // Address keys must round-trip through the store.
  const key = toKey(addr);
  const back = fromKey(key);
  check('address round-trips through its key', back.length, addr.length, 0);
  measure('ground address key length', key.length);

  // Scale, as a measurement rather than a claim in a comment.
  check('total ground tiles', w.totalCellsAt(GROUND_DEPTH), 574109573492, 0);
  check('ground tile area m2', w.cellAreaAt(GROUND_DEPTH), 888, 2);
  measure('region area km2', w.cellAreaAt(0) / 1e6);
  measure('finest layer area m2', w.cellAreaAt(MAX_DEPTH - 1));
});
