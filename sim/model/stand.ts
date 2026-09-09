// What is standing on this exact piece of ground, plant by plant.
//
// flora.ts says a hectare of temperate forest carries three hundred trees.
// This says WHICH three hundred: where each one stands, how old it is, and
// therefore -- through form.ts -- how wide its crown is and what it is carrying
// this week. Nothing is stored. Ask twice and get the same wood, on any machine,
// this year or in ten.
//
// THE PICTURE AND THE SIMULATION MUST NOT DISAGREE, and that is the whole
// difficulty. It is easy to scatter convincing trees; it is easy to compute a
// timber yield; and it is very easy for the two to be describing different
// woods. So the trees drawn here are constrained to weigh what the model says
// stands there -- see `meanAgeFor` below, which solves for the age structure
// that makes the count and the mass agree. Cut down every tree you can see and
// you get the tonnage the supply model promised.
//
// AGE IS A DISTRIBUTION, NOT A NUMBER. A wood is not three hundred identical
// trees; it is a few old ones, more middling ones and a great many saplings,
// and the shape of that is measured: under a constant yearly chance of dying,
// ages come out negative-exponential. That single fact does a surprising amount
// of work here -- it is why a wood looks like a wood rather than an orchard,
// and it is why the mean tree is much younger than the big ones you notice.
//
// WHY THE POSITIONS COME FROM NOISE RATHER THAN A HASH OF THE TILE. A tile is
// drawn by whichever map is on screen, and the same ground can be reached
// through more than one of them; the addresses differ, the direction vectors
// agree to within a rounding error. Hashing an address would put the trees in
// different places depending on how you got there. Sampling a smooth field at
// a point on the sphere cannot, which is the same argument underCanopy already
// makes in the renderer.

import * as A from '../anchors.ts';
import { dexp, dlog } from '../gen/mathx.ts';
import { uniformAt } from '../gen/noise.ts';
import { type BiomeId } from './biome.ts';
import { floraAt, countOn, FloraKind, type Flora } from './flora.ts';
import { type Species, Part, massAt } from './plant.ts';
import { OAK, HAZEL, BRAMBLE, GRASS, SPECIES } from './species.ts';

/** One plant, standing somewhere. */
export interface Individual {
  species: Species;
  /** Metres east and north of the tile's centre. */
  x: number;
  y: number;
  ageYears: number;
  /** Its own number, so its form is its own and stays its own. */
  seed: number;
}

/**
 * Which species stands for each habit, until there are more of them.
 *
 * A placeholder in the sense that a real world has a hundred trees and this has
 * one, and not a placeholder in any other sense: the oak that gets drawn is the
 * oak that is modelled, with its own mass, twigs, acorns and autumn.
 */
export function speciesForKind(kind: FloraKind): Species | null {
  switch (kind) {
    case FloraKind.Tree: return OAK;
    case FloraKind.Shrub: return HAZEL;
    case FloraKind.Vine: return BRAMBLE;
    case FloraKind.Grass: return GRASS;
    default: return null;
  }
}

/** The share of a plant's mass that is wood, which is what a count is made of. */
export function woodShare(s: Species): number {
  let share = 0;
  for (const p of s.parts) {
    if (p.part === Part.Heartwood || p.part === Part.Sapwood || p.part === Part.Bark
      || p.part === Part.Branch || p.part === Part.Twig) share += p.share;
  }
  return share;
}

/** The whole-plant mass that flora.ts was dividing by, kg. */
export function anchorMassKg(kind: FloraKind, s: Species): number {
  const wood = kind === FloraKind.Tree ? A.TREE_WOOD_T * 1000
    : kind === FloraKind.Shrub ? A.SHRUB_WOOD_KG
      : kind === FloraKind.Vine ? A.VINE_WOOD_KG
        : A.GRASS_TUFT_G / 1000;
  const share = woodShare(s);
  // A grass's "tuft mass" is standing dry matter rather than wood, so it is
  // already the above-ground plant and needs no dividing.
  if (kind === FloraKind.Grass) return A.GRASS_TUFT_G / 1000 / (1 - 0.45);
  return share > 0 ? wood / share : wood;
}

/**
 * The quantiles an exponential age distribution is averaged over.
 *
 * Sixty-four, evenly spaced in probability, which integrates a smooth function
 * of age to well under a per cent and does it with no random draws at all --
 * so the answer is the same on every machine and does not wander between
 * frames.
 */
const QUANTILES = 64;

/** Age at the i-th quantile of an exponential with the given mean, years. */
function quantileAge(meanAgeYears: number, i: number, lifespanYears: number): number {
  const u = (i + 0.5) / QUANTILES;
  return Math.min(lifespanYears, -meanAgeYears * dlog(1 - u));
}

/** Mean mass of a stand whose ages are exponential with this mean, kg. */
export function meanMassOfStand(
  s: Species, site: number, meanAgeYears: number,
): number {
  let total = 0;
  for (let i = 0; i < QUANTILES; i++) {
    total += massAt(s, quantileAge(meanAgeYears, i, s.lifespanYears), site);
  }
  return total / QUANTILES;
}

/**
 * THE CONSTRAINT THAT KEEPS THE PICTURE HONEST.
 *
 * flora.ts got its stem count by dividing standing biomass by the mass of one
 * mature plant. If the plants that then get DRAWN are a mix of ages, their mean
 * mass is lower than that -- often far lower, because an exponential age
 * distribution is mostly young -- and the wood on screen would weigh a fraction
 * of the wood in the model. Count three hundred trees, fell them, and find a
 * third of the timber the supply chain was promised.
 *
 * So the age structure is not chosen: it is SOLVED. Find the mean age whose
 * distribution has exactly the mean mass the count was made from, and the two
 * agree by construction at every site quality and for every species.
 *
 * Bisection, fifty steps, on a function that rises monotonically with the mean
 * age -- an older stand is a heavier one, always -- so there is one answer and
 * this finds it.
 */
export function meanAgeFor(s: Species, site: number, targetKg: number): number {
  if (targetKg <= 0 || site <= 0) return 0;
  const full = massAt(s, s.lifespanYears, site);
  // A site too poor to ever reach the target: the oldest stand it can grow is
  // the best it can do, and saying so is better than searching past the end.
  if (full <= targetKg) return s.lifespanYears;
  let lo = 1e-4;
  let hi = s.lifespanYears * 20;
  for (let step = 0; step < 50; step++) {
    const mid = (lo + hi) / 2;
    if (meanMassOfStand(s, site, mid) < targetKg) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A cache for the solve above.
 *
 * The renderer asks for the same species on the same ground thousands of times
 * a frame, and fifty bisection steps of a sixty-four point average is four
 * hundred thousand growth evaluations if nothing remembers. Site quality is
 * rounded to a hundredth before it becomes a key, which is finer than the
 * productivity field it comes from is meaningful to.
 */
const ageCache = new Map<string, number>();

export function meanAgeCached(s: Species, site: number, targetKg: number): number {
  const q = Math.round(Math.max(0, Math.min(1, site)) * 100) / 100;
  const key = `${s.name}|${q}|${Math.round(targetKg * 100)}`;
  const hit = ageCache.get(key);
  if (hit !== undefined) return hit;
  const v = meanAgeFor(s, q, targetKg);
  ageCache.set(key, v);
  return v;
}

/**
 * A field sample in [0, 1) at a point on the sphere, for one purpose.
 *
 * `uniform3` and not `noise3`, and the difference is the whole suite. Raw
 * gradient noise is bell-shaped about a half, so an age drawn from it through
 * -mean.ln(1-u) never reaches the tail -- every tree came out near the median,
 * the old ones that carry a wood's mass were simply absent, and the drawn
 * timber measured 0.646 of the model's. Corrected, it converges to 1.00 over a
 * hundred hectares.
 */
function field(
  dirX: number, dirY: number, dirZ: number, scale: number, salt: number,
): number {
  // A HASH AND NOT THE SMOOTH FIELD, and the difference is only visible where
  // the probability is small. Gradient noise is bounded -- it never leaves
  // 0.089 to 0.907 -- so thresholding it at a fortieth returns a quarter of
  // what it should, which at the parish layer is three quarters of a forest
  // that never came up. See uniformAt in noise.ts.
  //
  // The quantum is an eighth of the sample's own spacing: far coarser than the
  // rounding difference between two maps covering the same ground, and far
  // finer than anything that would make two neighbouring patches agree.
  const quantum = 1 / (8 * Math.max(1e-9, scale));
  return Math.max(0, Math.min(0.999999, uniformAt(dirX, dirY, dirZ, quantum, salt)));
}

/** What a tile is asked about. */
export interface Ground {
  biome: BiomeId;
  nppGm2: number;
  /** The tile's centre as a unit vector. */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** The sphere's radius in metres, for turning directions into a scale. */
  radiusM: number;
  /** Centre-to-centre tile spacing, metres. */
  spacingM: number;
  /** How good this ground is for what grows on it, 0 to 1. */
  site: number;
  /**
   * The ground a sample stands for, m2, when it is not a hexagonal tile.
   *
   * The crown lattice samples SQUARE cells rather than the hexagons of the tile
   * ladder, and a square of side s is s^2 where a hexagon of spacing s is
   * 0.866 s^2. Left out, the hexagon is assumed, which is what every caller
   * working off the map wants.
   */
  areaM2?: number;
}

/**
 * How far apart the crown lattice's cells are, metres.
 *
 * DERIVED, and from the only thing that could decide it: the widest plant that
 * gets placed. A lattice cell has to be about one crown across, because that is
 * what makes the number of stems in a cell independent of how far you have
 * zoomed in -- which is the whole reason the lattice exists. Finer and a crown
 * spans many cells and the stems that shade you are outside every one you
 * looked at; coarser and a cell holds a crowd whose positions have to be
 * invented within it.
 *
 * So it is the largest mature spread in the species list, and it moves on its
 * own when a bigger tree is added.
 */
export const CROWN_GRID_M = SPECIES.reduce((m, s) => Math.max(m, s.matureSpreadM), 1);

/** A hexagonal tile's area, m2. Centre-to-centre spacing squared, times sqrt3/2. */
export function tileAreaM2(spacingM: number): number {
  return (Math.sqrt(3) / 2) * spacingM * spacingM;
}

/**
 * What stands on one tile.
 *
 * `kinds` says which habits the caller wants: a renderer drawing individual
 * trees over a grass texture asks for trees and shrubs and leaves the grass to
 * the texture, and asking for grass on a hectare would return a hundred million
 * tufts, which is why `limit` exists and why it reports what it dropped rather
 * than quietly truncating.
 */
export interface Stand {
  plants: Individual[];
  /** How many were wanted but not returned, because of the limit. */
  omitted: number;
  flora: Flora;
}

export function standOn(
  g: Ground, kinds: readonly FloraKind[], limit = 512,
): Stand {
  const flora = floraAt(g.biome, g.nppGm2);
  const plants: Individual[] = [];
  let omitted = 0;
  if (g.spacingM <= 0) return { plants, omitted, flora };

  const area = g.areaM2 ?? tileAreaM2(g.spacingM);
  // One field cycle per tile, so neighbouring tiles get uncorrelated draws
  // while the same tile always gets the same one.
  const scale = g.radiusM / Math.max(1e-9, g.spacingM);

  for (const kind of kinds) {
    const s = speciesForKind(kind);
    if (s === null) continue;
    const wanted = countOn(flora, kind, area);
    if (wanted <= 0) continue;

    // A FRACTIONAL COUNT IS A PROBABILITY, not a rounding error. At the parish
    // layer a tile is a fifth of a tree; rounding that down empties the forest
    // and rounding it up fills the desert. One field sample per tile decides
    // whether this is one of the tiles that has the tree, and the density comes
    // out right across any patch big enough to average.
    const whole = Math.floor(wanted);
    const spare = wanted - whole;
    let n = whole;
    if (spare > 0 && field(g.dirX, g.dirY, g.dirZ, scale, 0x5EED + kind) < spare) n++;
    if (n > limit) { omitted += n - limit; n = limit; }
    if (n <= 0) continue;

    const meanAge = meanAgeCached(s, g.site, anchorMassKg(kind, s));
    for (let i = 0; i < n; i++) {
      // Each plant's own three draws, from the same field at different salts.
      const salt = 0x1000 * (kind + 1) + i * 7919;
      const u = field(g.dirX, g.dirY, g.dirZ, scale, salt);
      const v = field(g.dirX, g.dirY, g.dirZ, scale, salt + 1);
      const w = field(g.dirX, g.dirY, g.dirZ, scale, salt + 2);
      // Uniform over the tile's own square, which for a hexagon overspills the
      // corners a little -- and that is right rather than wrong: a crown hangs
      // over a tile edge, and a plant is not confined to the hexagon it is
      // counted in.
      const x = (u - 0.5) * g.spacingM;
      const y = (v - 0.5) * g.spacingM;
      const ageYears = Math.min(s.lifespanYears, -meanAge * dlog(1 - w));
      plants.push({ species: s, x, y, ageYears, seed: Math.round(w * 1e6) + i });
    }
  }

  return { plants, omitted, flora };
}

/**
 * The mass of everything standing on a tile, kg, as DRAWN.
 *
 * The check that the picture and the model agree, computed rather than
 * asserted, so a suite can hold it to what the woodland model says is there.
 */
export function standingMassKg(stand: Stand, site: number): number {
  let total = 0;
  for (const p of stand.plants) total += massAt(p.species, p.ageYears, site);
  return total;
}

/**
 * Net primary production of the most productive ground there is, g/m2/yr.
 *
 * Measured: a temperate forest on a good site fixes about 1,200 grammes of dry
 * matter a square metre a year, and a tropical rainforest more. This is the
 * denominator that turns the productivity field into a site quality, so that
 * one number stands for everything the ground does for a plant.
 */
export const NPP_OPTIMUM_GM2 = 1200;

/** How good this ground is, 0 to 1, from the productivity field. */
export function siteFrom(nppGm2: number): number {
  return Math.max(0, Math.min(1, nppGm2 / NPP_OPTIMUM_GM2));
}

/**
 * How many plants one frame may draw one at a time.
 *
 * FREE PARAMETER 2, and it is the honest one to have: everything else about
 * when individuals appear is DERIVED from it. A browser will stamp a few
 * thousand images in a frame and not a million, and no amount of physics says
 * which few thousand.
 *
 * MEASURED, on a thirty-frame drag at the plot layer with the headless client:
 *
 *     3000    2,795 plants,  median frame 20 ms
 *     1500        0 plants,  median frame 17 ms
 *      800        0 plants,  median frame 16 ms
 *
 * The zeroes are not a bargain, they are the gap in docs/known-gaps.md: the
 * affordability test is currently the only thing choosing which layer gets
 * plants, and it is a knife edge, so below three thousand no layer qualifies at
 * all. That is a fault in the sampling and not in this number, and when the
 * crown lattice lands this can come down.
 */
export const DRAW_BUDGET = 3000;

/**
 * Whether individual plants are worth drawing at this zoom, or whether the
 * ground should stay a texture.
 *
 * THE THRESHOLD IS SOLVED, NOT PICKED. A screen of area A pixels showing
 * ground at p pixels a metre is looking at A/p^2 square metres; at d plants a
 * square metre that is A.d/p^2 plants. Set that equal to the budget and the
 * scale at which individuals become affordable falls out:
 *
 *     p >= sqrt(A . d / B)
 *
 * So a dense forest resolves into trees later than an open savanna does, and a
 * bigger window resolves later than a small one, and neither of those had to be
 * thought about. What a person would otherwise do here is pick a zoom level and
 * find out two months later that it was wrong for wide monitors.
 */
export function individualsAffordable(
  plantsPerM2: number, pxPerM: number, screenPx2: number,
  budget = DRAW_BUDGET,
): boolean {
  if (plantsPerM2 <= 0) return false;
  if (pxPerM <= 0 || screenPx2 <= 0) return false;
  const need = Math.sqrt((screenPx2 * plantsPerM2) / Math.max(1, budget));
  return pxPerM >= need;
}

/**
 * How wide a crown has to be, in pixels, before drawing individuals beats
 * drawing a texture.
 *
 * FREE PARAMETER 1, and the honest place for it. Below about three pixels a
 * crown is a smudge that costs a stamp and says less than the tile's own colour
 * already does, so the renderer stops drawing plants and lets the density
 * texture carry the wood -- which is what it was always doing above this
 * threshold too. The handover is not a zoom level somebody picked; it is the
 * point at which a tree stops being visible, and it moves on its own when the
 * tree is a bramble instead of an oak.
 */
export const VANISH_PX = 3;

/** Whether individuals are worth drawing at this scale, for this plant. */
export function worthDrawing(spreadM: number, pxPerM: number): boolean {
  return spreadM * pxPerM >= VANISH_PX;
}

/**
 * The exponential age distribution's own shape, exposed for checking.
 *
 * Returned as the share of a stand older than each of a few ages, which is the
 * form a forester would recognise and the form that makes a wrong answer
 * obvious: a wood where half the trees are over a century is not a wood.
 */
export function shareOlderThan(meanAgeYears: number, ageYears: number): number {
  if (meanAgeYears <= 0) return 0;
  return dexp(-ageYears / meanAgeYears);
}
