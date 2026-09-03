// What is actually growing on a piece of ground.
//
// The map has known for a long time how PRODUCTIVE a place is -- nppGm2, grams
// of dry matter a square metre a year -- and how much of that stands as wood
// rather than as leaf, and therefore how much timber a hectare carries. What it
// has never known is how many plants that is, or what kind, and those are the
// two questions a picture of the ground has to answer: how many trees, how far
// apart, and what fills the space between them.
//
// NOTHING HERE IS A PLANT COUNT TYPED IN. A count is a mass divided by the mass
// of one plant, and both of those are measured. The chain is:
//
//     productivity  ->  standing biomass  ->  number of plants
//
// with the first step already in resources.ts (timberTPerHa, WOODY_FRACTION)
// and the second an allometric mass per individual from anchors.ts. What comes
// out can be checked against stand densities nobody used to build it: a
// temperate forest lands at 300 stems a hectare against a measured 300 to 500,
// and a temperate sward at 130 tufts a square metre against a measured 100
// to 170. See verify_flora.ts, which holds every one of those to its range.
//
// CANOPY COVER IS NOT THE SUM OF THE CROWNS, and that is the one piece of
// arithmetic here worth reading twice. Crowns overlap. Scatter n crowns of area
// a at random over a hectare and the fraction of ground left uncovered is
// exp(-n.a) -- the same Poisson argument as Beer's law for light through a
// medium -- so cover is 1 - exp(-n.a) and approaches one without ever reaching
// it. Adding crown areas instead gives covers above 100% in any closed forest,
// which is how you can tell it is the wrong model.

import * as A from '../anchors.ts';
import { dexp } from '../gen/mathx.ts';
import { Biome, type BiomeId } from './biome.ts';
import { WOODY_FRACTION, timberTPerHa } from './resources.ts';

/**
 * How the woody growth of a place is divided between the three habits.
 *
 * Not a preference: the same biomass builds very different communities
 * depending on what can survive there. A closed forest puts nearly all its wood
 * into trees; a savanna keeps most of its woody mass in scattered trees but
 * carries far more shrubs per tonne; tundra and heath are shrubs almost
 * entirely, because a tree cannot stand the season. Lianas need a canopy to
 * climb and light to reach, which is why they are a tropical forest's signature
 * and nearly absent from a boreal one.
 *
 * The three columns sum to one. They describe where the wood IS, not how many
 * plants there are -- the counts fall out of dividing by the mass of one.
 */
const WOOD_SHARE: readonly (readonly [number, number, number])[] = [
  //  tree  shrub  vine
  [0.00, 0.00, 0.00], // ocean
  [0.00, 0.00, 0.00], // ice
  [0.05, 0.95, 0.00], // tundra: dwarf willow and heath, no trees
  [0.90, 0.10, 0.00], // taiga
  [0.10, 0.90, 0.00], // temperate grassland: what wood there is, is scrub
  [0.88, 0.10, 0.02], // temperate forest
  [0.85, 0.11, 0.04], // temperate rainforest
  [0.20, 0.80, 0.00], // desert: woody shrubs, the odd acacia
  [0.55, 0.45, 0.00], // savanna: scattered trees over a shrubby ground layer
  [0.80, 0.10, 0.10], // tropical seasonal forest
  [0.76, 0.09, 0.15], // tropical rainforest: lianas at their heaviest
  [0.35, 0.65, 0.00], // wetland: carr and willow scrub
  [0.05, 0.95, 0.00], // alpine: dwarf shrub above the treeline
];

/** What is growing on a hectare of it, and how much ground it covers. */
export interface Flora {
  /** Mature stems a hectare. */
  treesPerHa: number;
  shrubsPerHa: number;
  vinesPerHa: number;
  /** Tufts a square metre, which is the unit a sward is counted in. */
  grassPerM2: number;
  /** Fraction of the ground under a crown, trees and shrubs together, 0 to 1. */
  canopyCover: number;
  /** Which of the four is most of what you would see. */
  dominant: FloraKind;
}

/**
 * The four habits, as a frozen object rather than an enum.
 *
 * `const enum` is not erasable syntax and this project is run by Node's type
 * stripping, which removes types without understanding them -- so an enum is
 * one of the few TypeScript constructs that has no meaning left at run time.
 * verify_purity catches it; this is the shape that survives.
 */
export const FloraKind = {
  None: 0,
  Grass: 1,
  Shrub: 2,
  Vine: 3,
  Tree: 4,
} as const;

export type FloraKind = typeof FloraKind[keyof typeof FloraKind];

export const FLORA_NAMES: readonly string[] = ['bare', 'grass', 'scrub', 'vine', 'wood'];

const M2_PER_HA = 10000;

/** The ground a crown of the given width covers, m2. */
function crownArea(widthM: number): number {
  return Math.PI * (widthM / 2) ** 2;
}

/**
 * What grows here, from how productive it is and what kind of place it is.
 *
 * `npp` is grams of dry matter a square metre a year, the field the climate
 * model already produces. Everything else is division.
 */
export function floraAt(biome: BiomeId, npp: number): Flora {
  const share = WOOD_SHARE[biome] ?? WOOD_SHARE[Biome.Ocean];

  // Standing wood, tonnes a hectare, already derived from productivity.
  const wood = Math.max(0, timberTPerHa(biome, npp));

  const treesPerHa = (wood * share[0]) / A.TREE_WOOD_T;
  const shrubsPerHa = (wood * 1000 * share[1]) / A.SHRUB_WOOD_KG;
  const vinesPerHa = (wood * 1000 * share[2]) / A.VINE_WOOD_KG;

  // The herbaceous half. What is not wood is leaf and grass, and it stands for
  // about a year, so a grassland's standing biomass IS its annual production.
  const herbGm2 = Math.max(0, npp) * (1 - (WOODY_FRACTION[biome] ?? 0)) * A.HERB_RESIDENCE_YR;
  const grassPerM2 = herbGm2 / A.GRASS_TUFT_G;

  // Crowns overlap, so cover is Poisson rather than a sum. Vines are left out:
  // a liana lives in somebody else's crown and covers no ground of its own.
  const crowded = (treesPerHa * crownArea(A.TREE_CROWN_M)
    + shrubsPerHa * crownArea(A.SHRUB_CROWN_M)) / M2_PER_HA;
  const canopyCover = 1 - dexp(-crowded);

  return {
    treesPerHa,
    shrubsPerHa,
    vinesPerHa,
    grassPerM2,
    canopyCover,
    dominant: dominantOf(treesPerHa, shrubsPerHa, vinesPerHa, grassPerM2, canopyCover),
  };
}

/**
 * What you would say the ground IS, looking at it.
 *
 * By ground covered rather than by count, which is the whole of the difference
 * between an answer and a nonsense: a hectare of forest holds three hundred
 * trees and a million grass tufts, and it is not a grassland.
 */
function dominantOf(
  trees: number, shrubs: number, vines: number, grass: number, cover: number,
): FloraKind {
  const treeGround = trees * crownArea(A.TREE_CROWN_M);
  const shrubGround = shrubs * crownArea(A.SHRUB_CROWN_M);
  const vineGround = vines * crownArea(A.VINE_CROWN_M);
  // Grass holds the ground the canopy leaves, and only that.
  const grassGround = grass > 0 ? M2_PER_HA * (1 - cover) : 0;

  let best: FloraKind = FloraKind.None;
  let bestGround = M2_PER_HA * 0.02; // bare unless something beats a fiftieth
  if (grassGround > bestGround) { bestGround = grassGround; best = FloraKind.Grass; }
  if (shrubGround > bestGround) { bestGround = shrubGround; best = FloraKind.Shrub; }
  if (vineGround > bestGround) { bestGround = vineGround; best = FloraKind.Vine; }
  if (treeGround > bestGround) { bestGround = treeGround; best = FloraKind.Tree; }
  return best;
}

/**
 * How many of a kind stand on one tile, given its area.
 *
 * The renderer's question, and it is asked at every scale: at the parish layer
 * a tile is 170 m2 and holds a handful of trees, and eight layers down it is
 * 2 cm2 and holds a fraction of one blade. A fraction is the honest answer --
 * whether THIS tile is the one with the tree on it is for the caller to decide
 * from its own position, not for this to round away.
 */
export function countOn(flora: Flora, kind: FloraKind, areaM2: number): number {
  switch (kind) {
    case FloraKind.Tree: return (flora.treesPerHa * areaM2) / M2_PER_HA;
    case FloraKind.Shrub: return (flora.shrubsPerHa * areaM2) / M2_PER_HA;
    case FloraKind.Vine: return (flora.vinesPerHa * areaM2) / M2_PER_HA;
    case FloraKind.Grass: return flora.grassPerM2 * areaM2;
    default: return 0;
  }
}
