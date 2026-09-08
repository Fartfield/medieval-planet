// The wood on the screen is the wood in the model, or this fails.
//
// That sentence is the whole suite. It is easy to scatter convincing trees and
// easy to compute a timber yield; what is hard is making the two describe the
// same wood, and nothing but a measurement will tell you whether they do. So
// the central check here counts the trees a hectare gets, weighs them, and
// holds the total against what the woodland model says stands on that hectare.
//
// The rest is the machinery that makes it come out: an age structure that is
// solved rather than chosen, positions that do not depend on which map you
// reached the ground through, and a fractional plant count treated as the
// probability it is instead of being rounded away.

import {
  standOn, standingMassKg, meanAgeFor, meanAgeCached, meanMassOfStand,
  anchorMassKg, woodShare, speciesForKind, tileAreaM2, shareOlderThan,
  worthDrawing, VANISH_PX, type Ground,
} from '../sim/model/stand.ts';
import { floraAt, FloraKind, countOn } from '../sim/model/flora.ts';
import { Biome } from '../sim/model/biome.ts';
import { OAK, HAZEL, GRASS } from '../sim/model/species.ts';
import { massAt, spreadAt } from '../sim/model/plant.ts';
import { timberTPerHa } from '../sim/model/resources.ts';
import { check, measure, assert, suite } from './harness.ts';

const EARTH_R = 6371000;
const HECTARE_SIDE = 100;
// A tile a hectare in area, so a count per hectare and a count per tile are the
// same number and the comparison below needs no conversion to hide in.
const HA_SPACING = Math.sqrt(10000 / (Math.sqrt(3) / 2));

// A patch of ordinary temperate forest, at the productivity the climate model
// gives a decent one.
const FOREST_NPP = 900;

function ground(dirX: number, dirY: number, dirZ: number, spacingM: number): Ground {
  return {
    biome: Biome.TemperateForest, nppGm2: FOREST_NPP,
    dirX, dirY, dirZ, radiusM: EARTH_R, spacingM, site: 1,
  };
}

suite('what stands on it', () => {
  measure('a hectare tile is this many metres across', HA_SPACING);
  check('and it is a hectare', tileAreaM2(HA_SPACING), 10000, 1);

  // THE AGE STRUCTURE IS SOLVED, NOT CHOSEN. The count came from dividing
  // biomass by the mass of one plant; the drawn plants are a mix of ages; the
  // mean of that mix has to be the mass the division used or the picture is
  // lighter than the model.
  const treeAnchor = anchorMassKg(FloraKind.Tree, OAK);
  measure('oak: share of it that is wood', woodShare(OAK));
  measure('the whole-plant mass a tree count was made from, kg', treeAnchor);
  const meanAge = meanAgeFor(OAK, 1, treeAnchor);
  measure('mean age of a stand that weighs that, years', meanAge);
  check('and a stand of that age weighs exactly it',
    meanMassOfStand(OAK, 1, meanAge), treeAnchor, treeAnchor * 0.01);

  // The age of the AVERAGE tree is not the age of a tree of average mass, and
  // the gap is large. Worth measuring because it is the thing that would be got
  // wrong by anybody who reached for one number instead of a distribution.
  const evenAge = (() => {
    let lo = 0;
    let hi = OAK.lifespanYears;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (massAt(OAK, mid, 1) < treeAnchor) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  })();
  measure('the age one tree of that mass would be, years', evenAge);
  assert('a mixed-age wood must be older on average than an even-aged one',
    meanAge > evenAge);
  measure('share of the wood over a century old', shareOlderThan(meanAge, 100));
  measure('share over two centuries', shareOlderThan(meanAge, 200));
  assert('most of a wood is young, as a wood is',
    shareOlderThan(meanAge, meanAge * 2) < 0.2);

  // POOR GROUND NEEDS AN OLDER STAND to carry the same weight of wood, which
  // nothing was told and which is exactly what a forester would say.
  const poorAge = meanAgeFor(OAK, 0.6, treeAnchor);
  measure('mean age needed on poorer ground, years', poorAge);
  assert('poor ground takes longer to grow the same timber', poorAge > meanAge);

  // THE CENTRAL CHECK. A hectare of temperate forest, drawn tree by tree, and
  // weighed.
  const g = ground(0.3, 0.5, Math.sqrt(1 - 0.09 - 0.25), HA_SPACING);
  const stand = standOn(g, [FloraKind.Tree, FloraKind.Shrub, FloraKind.Vine], 4096);
  const flora = floraAt(Biome.TemperateForest, FOREST_NPP);
  measure('trees a hectare, from the flora model', flora.treesPerHa);
  measure('plants actually placed on the tile', stand.plants.length);
  check('nothing was silently dropped', stand.omitted, 0, 0);

  const drawnKg = standingMassKg(stand, 1);
  // What the model says is there: standing timber, turned back into whole
  // plants by the share of a plant that is wood.
  const timberKg = timberTPerHa(Biome.TemperateForest, FOREST_NPP) * 1000;
  measure('standing timber the model gives a hectare, kg', timberKg);
  measure('mass of every plant drawn on it, kg', drawnKg);
  const woodDrawn = stand.plants.reduce(
    (a, p) => a + massAt(p.species, p.ageYears, 1) * woodShare(p.species), 0);
  measure('and the wood in them, kg', woodDrawn);
  check('the wood you can see is the wood the model has',
    woodDrawn / Math.max(1, timberKg), 1, 0.2);

  // The tolerance is a fifth, and it is not slack: one hectare holds a couple
  // of hundred trees drawn from a distribution whose mass is dominated by its
  // oldest few, so the sampling spread at this size is real. Averaged over a
  // hundred hectares it should be far tighter, and that is the next check.
  let totalWood = 0;
  let totalTimber = 0;
  let totalTrees = 0;
  for (let i = 0; i < 100; i++) {
    // A hundred different patches of the same kind of ground.
    const a = 0.2 + i * 0.0037;
    const b = 0.4 + i * 0.0021;
    const c = Math.sqrt(Math.max(1e-9, 1 - a * a - b * b));
    const gi = ground(a, b, c, HA_SPACING);
    const si = standOn(gi, [FloraKind.Tree, FloraKind.Shrub, FloraKind.Vine], 4096);
    totalTrees += si.plants.filter((p) => p.species === OAK).length;
    totalWood += si.plants.reduce(
      (acc, p) => acc + massAt(p.species, p.ageYears, 1) * woodShare(p.species), 0);
    totalTimber += timberKg;
  }
  measure('trees a hectare, averaged over a hundred of them', totalTrees / 100);
  measure('wood drawn over a hundred hectares, kg', totalWood);
  check('over a hundred hectares it converges',
    totalWood / totalTimber, 1, 0.06);
  check('and the stem count is the one flora.ts derived',
    totalTrees / 100 / flora.treesPerHa, 1, 0.1);

  // A FRACTIONAL COUNT IS A PROBABILITY. At the parish layer a tile holds a
  // fraction of a tree, and the density has to survive that.
  // Four metres across, which is two layers below the parish: at a hectare a
  // 13 m tile still holds three and a half trees, and it was chosen by
  // guessing rather than by dividing. 4 m gives 14 m2 and a third of a tree.
  const smallSpacing = 4;
  const perTile = countOn(flora, FloraKind.Tree, tileAreaM2(smallSpacing));
  measure('trees on a parish-layer tile', perTile);
  assert('which is less than one', perTile < 1 && perTile > 0);
  let withTree = 0;
  const TRIES = 400;
  for (let i = 0; i < TRIES; i++) {
    const a = 0.11 + i * 0.0019;
    const b = 0.37 + i * 0.0013;
    const c = Math.sqrt(Math.max(1e-9, 1 - a * a - b * b));
    const si = standOn(ground(a, b, c, smallSpacing), [FloraKind.Tree], 8);
    if (si.plants.length > 0) withTree++;
  }
  measure('share of parish tiles with a tree on them', withTree / TRIES);
  check('a fraction of a tree is that fraction of the tiles',
    withTree / TRIES / perTile, 1, 0.25);

  // DETERMINISM, and specifically determinism against the thing that would
  // break it: the same ground reached with a direction that differs in the last
  // bits, as it does when two maps both cover it.
  const again = standOn(g, [FloraKind.Tree, FloraKind.Shrub, FloraKind.Vine], 4096);
  assert('the same ground grows the same wood',
    JSON.stringify(again.plants.map((p) => [p.x, p.y, p.ageYears]))
      === JSON.stringify(stand.plants.map((p) => [p.x, p.y, p.ageYears])));
  const nudged = standOn(
    { ...g, dirX: g.dirX * (1 + 1e-12) }, [FloraKind.Tree], 4096);
  const straight = standOn(g, [FloraKind.Tree], 4096);
  measure('trees after nudging the direction by a part in a trillion',
    nudged.plants.length);
  check('a rounding error does not move the forest',
    nudged.plants.length, straight.plants.length, 0);

  // Plants land within their own tile, give or take the overhang a crown has
  // every right to.
  const worst = Math.max(...stand.plants.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  measure('furthest a plant sits from its tile centre, m', worst);
  assert('nothing is placed outside the tile it belongs to',
    worst <= HA_SPACING / 2 + 1e-9);

  // NOTHING GROWS ON THE SEA, and a desert grows scrub rather than oaks.
  const sea = standOn(
    { ...g, biome: Biome.Ocean, nppGm2: 0 }, [FloraKind.Tree, FloraKind.Shrub], 64);
  check('the sea has no trees on it', sea.plants.length, 0, 0);
  const desert = standOn(
    { ...g, biome: Biome.Desert, nppGm2: 90 }, [FloraKind.Tree, FloraKind.Shrub], 64);
  measure('plants on a hectare of desert', desert.plants.length);
  assert('a desert is scrub, not forest',
    desert.plants.length < stand.plants.length / 3);

  // THE VANISHING POINT is a size, not a zoom level, so it moves on its own
  // when the plant is a bramble instead of an oak.
  const oakCrown = spreadAt(OAK, 120, 1);
  const hazelCrown = spreadAt(HAZEL, 7, 1);
  measure('metres per pixel at which an oak vanishes', oakCrown / VANISH_PX);
  measure('and at which a hazel does', hazelCrown / VANISH_PX);
  assert('a big tree survives further out than a small shrub',
    oakCrown / VANISH_PX > hazelCrown / VANISH_PX);
  assert('an oak is worth drawing at a metre a pixel',
    worthDrawing(oakCrown, 1));
  assert('and is not at a kilometre a pixel',
    !worthDrawing(oakCrown, 1 / 1000));

  // Grass is a species now, and the anchor it was built to match still holds.
  measure('a grass tuft, whole-plant kg', massAt(GRASS, 4, 1));
  measure('the tuft mass a count is made from, kg',
    anchorMassKg(FloraKind.Grass, GRASS));
  assert('grass is the grass the pasture model was counting',
    Math.abs(massAt(GRASS, 4, 1) - anchorMassKg(FloraKind.Grass, GRASS)) < 0.002);
  assert('every habit that the map draws has a plant',
    speciesForKind(FloraKind.Tree) !== null && speciesForKind(FloraKind.Shrub) !== null
    && speciesForKind(FloraKind.Vine) !== null && speciesForKind(FloraKind.Grass) !== null);

  // The cache answers what the solver answers. Cheap, and it is the kind of
  // thing that silently rots.
  check('the cache does not lie',
    meanAgeCached(OAK, 1, treeAnchor), meanAgeFor(OAK, 1, treeAnchor), 0.5);
  measure('a hectare side, m', HECTARE_SIDE);
});
