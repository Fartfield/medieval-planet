// A plant: what it is made of, how it grows, and when it does anything.
//
// Nothing here is stored. A plant is a pure function of (species, age, site,
// week) -- ask what an oak looks like in its ninetieth year on chalk in March
// and the answer is computed, the same answer every time, from the species'
// traits and the ground it stands on. There is no plant object anywhere with a
// size in it, which is what lets a world hold a trillion of them.
//
// FOUR THINGS MAKE UP A SPECIES.
//
// Its PARTS -- what it grows, in what proportion, of what composition. This is
// where leaves separate from branches and grain from chaff: they are different
// parts with different chemistry, and any process that treats them differently
// is reading that chemistry rather than a special case.
//
// Its GROWTH -- how mass accumulates with age, and how the site changes it.
//
// Its PHENOLOGY -- which weeks each part is present. A leaf is not a permanent
// feature of an oak; it is a part that exists between two weeks of the year.
//
// Its GERMINATION -- the conditions a seed needs and the odds per week inside
// them, which is what makes an acorn crop come up over three springs rather
// than one morning.
//
// SITE SCALES BOTH SIZE AND SPEED, which was a deliberate choice and is the
// hardest one here to check. Poor ground gives a smaller tree AND a slower one,
// which is true of a stressed plant, and it means a wrong answer could come
// from either half. So the two are measured separately -- final size and
// time-to-maturity each have their own check -- rather than only the product
// being tested, which would be mute about which half was wrong.

import { type Composition, type Material, porosityFor } from './material.ts';
import { dexp, dpow, dlog } from '../gen/mathx.ts';

/**
 * The parts a plant can have.
 *
 * Finely split on purpose. Heartwood against sapwood is the whole of timber
 * durability -- same tree, same year, and one lasts a century longer. Twig
 * against branch is this year's growth against the frame, which is browse and
 * kindling against firewood. Bark against wood is tanning and cork. Storage
 * against root is the difference between a carrot you dig for and a root you
 * pull up with the weed.
 */
export const Part = {
  Root: 0,
  Rhizome: 1,
  Storage: 2,
  Heartwood: 3,
  Sapwood: 4,
  Bark: 5,
  Branch: 6,
  Twig: 7,
  Bud: 8,
  Leaf: 9,
  Flower: 10,
  Fruit: 11,
  Seed: 12,
  Husk: 13,
  Sap: 14,
  Thorn: 15,
} as const;

export type Part = typeof Part[keyof typeof Part];

export const PART_NAMES: readonly string[] = [
  'root', 'rhizome', 'storage', 'heartwood', 'sapwood', 'bark', 'branch',
  'twig', 'bud', 'leaf', 'flower', 'fruit', 'seed', 'husk', 'sap', 'thorn',
];

/** Parts that are underground, and so have no visible asset of their own. */
export function isBuried(part: Part): boolean {
  return part === Part.Root || part === Part.Rhizome || part === Part.Storage;
}

/**
 * What colours a part, as four pigments.
 *
 * Bulk chemistry cannot give colour -- chlorophyll is under one per cent of a
 * leaf by mass -- so pigment is carried separately, and honestly. Four is
 * enough for everything a plant does: chlorophyll green, carotenoid yellow and
 * orange, anthocyanin red and purple, and the tannin brown of bark, dead wood
 * and everything on its way to rotting.
 *
 * Autumn is not a special case in this scheme. A leaf's chlorophyll is
 * withdrawn as the season closes, which reveals the carotenoid that was there
 * all along -- so the same four numbers and one withdrawal curve give summer
 * green, autumn gold and the brown of leaf litter.
 */
export interface Pigment {
  chlorophyll: number;
  carotenoid: number;
  anthocyanin: number;
  tannin: number;
}

/** The visible colour of a pigment mix, as an rgb triple 0-255. */
export function pigmentColour(p: Pigment): [number, number, number] {
  // Each pigment's own colour, measured off the real thing rather than derived:
  // pigments absorb light in ways bulk composition cannot predict.
  const total = Math.max(1e-9, p.chlorophyll + p.carotenoid + p.anthocyanin + p.tannin);
  const r = (p.chlorophyll * 46 + p.carotenoid * 218 + p.anthocyanin * 138 + p.tannin * 122) / total;
  const g = (p.chlorophyll * 110 + p.carotenoid * 165 + p.anthocyanin * 40 + p.tannin * 92) / total;
  const b = (p.chlorophyll * 42 + p.carotenoid * 32 + p.anthocyanin * 62 + p.tannin * 58) / total;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/**
 * A pigment mix as it stands in a given week, with chlorophyll withdrawn as
 * the part senesces.
 *
 * `senescence` runs 0 while the part is in full growth to 1 when it is spent.
 * Chlorophyll goes first, which is why the yellow underneath appears; then the
 * whole drifts towards tannin brown as it dies.
 */
export function aged(p: Pigment, senescence: number): Pigment {
  const s = Math.max(0, Math.min(1, senescence));
  return {
    chlorophyll: p.chlorophyll * (1 - s),
    carotenoid: p.carotenoid * (1 - s * 0.4),
    anthocyanin: p.anthocyanin * (1 - s * 0.3),
    tannin: p.tannin + s * 0.6 * (p.chlorophyll + p.carotenoid),
  };
}

/** When in the year a part is present at all. */
export interface Phenology {
  /** Week it appears. */
  from: number;
  /** Week it is shed or harvested. Equal to `from` means all year. */
  to: number;
}

/** Present all year: leaves on an evergreen, wood on anything. */
export const PERENNIAL: Phenology = { from: 0, to: 0 };

export function isPresent(p: Phenology, week: number, weeksPerYear: number): boolean {
  if (p.from === p.to) return true;
  const w = ((week % weeksPerYear) + weeksPerYear) % weeksPerYear;
  return p.from <= p.to ? w >= p.from && w < p.to : w >= p.from || w < p.to;
}

/** How far through its life a part is this week, 0 fresh to 1 spent. */
export function senescenceOf(p: Phenology, week: number, weeksPerYear: number): number {
  if (p.from === p.to) return 0;
  const w = ((week % weeksPerYear) + weeksPerYear) % weeksPerYear;
  const span = p.from <= p.to ? p.to - p.from : weeksPerYear - p.from + p.to;
  const since = p.from <= p.to ? w - p.from : (w >= p.from ? w - p.from : weeksPerYear - p.from + w);
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, since / span));
}

/** One part of a species: what it is, how much of it, and what colour. */
export interface PartSpec {
  part: Part;
  /** Share of the plant's mature dry mass. Shares should sum to one. */
  share: number;
  composition: Composition;
  /** Measured bulk density, kg/m3, from which porosity is forced. */
  densityKgM3: number;
  pigment: Pigment;
  phenology: Phenology;
}

/** What a seed needs before it will come up, and the odds once it has it. */
export interface Germination {
  /** Soil must be at least this warm, degC. */
  minTempC: number;
  /** Weeks of cold below 5 C the seed must have had first. Zero for none. */
  chillWeeks: number;
  /**
   * Chance a seed germinates in any week its conditions are met, 0 to 1.
   *
   * A hazard rate, not a date, and that is the point: most of an acorn crop
   * comes up in one spring, some the next, and most of it never comes up at
   * all. Dormancy is not a separate mechanism here -- it is this number being
   * low.
   */
  weeklyOdds: number;
  /** Of seeds that ever germinate, the share that survives its first year. */
  seedlingSurvival: number;
}

/** A species: its traits, and the parts it grows. */
export interface Species {
  name: string;
  /** Years to live on good ground. */
  lifespanYears: number;
  /**
   * Dry mass at maturity on the best site it can have, kg.
   *
   * Above and below ground together, which is why the part shares include the
   * roots.
   */
  matureMassKg: number;
  /**
   * How fast it approaches that mass, per year.
   *
   * The rate constant of the growth curve. A wheat plant's is enormous and an
   * oak's is tiny, which is the whole difference between an annual and a tree.
   */
  growthRate: number;
  /** Widest the plant gets, metres, at maturity on the best site. */
  matureSpreadM: number;
  germination: Germination;
  parts: readonly PartSpec[];
}

/**
 * How good this ground is for this species, 0 to 1.
 *
 * One number standing for everything the site does, taken as productivity
 * against what the species would have in its ideal place. A separate model can
 * refine it later -- shade, drainage, pH -- without anything downstream
 * changing, because everything downstream reads this one number.
 */
export function siteQuality(npp: number, speciesOptimumNpp: number): number {
  if (speciesOptimumNpp <= 0) return 0;
  return Math.max(0, Math.min(1, npp / speciesOptimumNpp));
}

/**
 * Dry mass of one plant at an age, kg.
 *
 * A von Bertalanffy curve -- fast when small, slowing towards an asymptote --
 * which is the standard growth form for anything that grows by accumulating on
 * a surface and respiring by volume.
 *
 * SITE SCALES BOTH the ceiling and the pace, which is the choice made in the
 * design and is the strongest claim in this file. A poor site's oak is both
 * smaller and slower, which is true of a stressed plant, and it means a scrubby
 * oak on chalk is old AND stunted rather than merely young.
 */
export function massAt(s: Species, ageYears: number, site: number): number {
  if (ageYears <= 0) return 0;
  const q = Math.max(0, Math.min(1, site));
  if (q <= 0) return 0;
  const ceiling = s.matureMassKg * q;
  const rate = s.growthRate * q;
  return ceiling * dpow(1 - dexp(-rate * ageYears), 3);
}

/** How wide it is at that age, metres. Spread follows mass by the cube root. */
export function spreadAt(s: Species, ageYears: number, site: number): number {
  const m = massAt(s, ageYears, site);
  if (m <= 0) return 0;
  const full = s.matureMassKg * Math.max(0, Math.min(1, site));
  if (full <= 0) return 0;
  return s.matureSpreadM * Math.max(0, Math.min(1, site)) * dpow(m / full, 1 / 3);
}

/** The age at which it reaches a given share of its own final size, years. */
export function ageAtFraction(s: Species, fraction: number, site: number): number {
  const q = Math.max(1e-9, Math.min(1, site));
  const f = Math.max(1e-9, Math.min(0.999, fraction));
  const rate = s.growthRate * q;
  if (rate <= 0) return Infinity;
  // Invert the curve: f = (1 - e^-kt)^3
  return -dlog(1 - dpow(f, 1 / 3)) / rate;
}

/** Mass of one part of one plant this week, kg. Zero when out of season. */
export function partMass(
  s: Species, spec: PartSpec, ageYears: number, site: number,
  week: number, weeksPerYear: number,
): number {
  if (!isPresent(spec.phenology, week, weeksPerYear)) return 0;
  return massAt(s, ageYears, site) * spec.share;
}

/** A part as a material, so every process in the world can read it. */
export function partMaterial(spec: PartSpec): Material {
  return {
    name: PART_NAMES[spec.part],
    composition: spec.composition,
    porosity: porosityFor(spec.composition, spec.densityKgM3),
  };
}

/** The colour of a part this week, after the season has worked on it. */
export function partColour(
  spec: PartSpec, week: number, weeksPerYear: number,
): [number, number, number] {
  return pigmentColour(aged(spec.pigment, senescenceOf(spec.phenology, week, weeksPerYear)));
}

/**
 * Whether a seed germinates this week, as a probability.
 *
 * Conditions first -- warm enough, and chilled first if the species needs it --
 * and then the weekly hazard. Multiplying rather than gating on a date is what
 * spreads a crop over several springs.
 */
export function germinationChance(
  g: Germination, soilTempC: number, chilledWeeks: number, moist: boolean,
): number {
  if (!moist) return 0;
  if (soilTempC < g.minTempC) return 0;
  if (chilledWeeks < g.chillWeeks) return 0;
  return Math.max(0, Math.min(1, g.weeklyOdds));
}

/** Chance a seed has come up at all after a number of eligible weeks. */
export function germinatedBy(g: Germination, eligibleWeeks: number): number {
  const p = Math.max(0, Math.min(1, g.weeklyOdds));
  if (p <= 0 || eligibleWeeks <= 0) return 0;
  return 1 - dpow(1 - p, eligibleWeeks);
}
