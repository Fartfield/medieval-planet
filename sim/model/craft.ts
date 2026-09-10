// Making things: the verbs that turn stuff into objects.
//
// The same discipline as burn and rot: ONE RULE PER CRAFT, reading the
// composition rather than the name. Tanning does not know about cows; it knows
// that tannin crosslinks protein, which is why the bark of the oak and the hide
// of the ox meet in a pit. Hewing does not know about houses; it knows that a
// squared timber is the inscribed prism of a round log, and the strength of
// what comes out is whatever the material model says wood of that density has.
//
// THE PAYOFF IS THE SAME PAYOFF: leather's durability is not written anywhere.
// The tannin bound into the hide is IN the leather's composition, and the rot
// model -- which was solved from timber durabilities and leaf litter, knowing
// nothing of leather -- reads it and gives a raw hide a half-life of days and
// tanned sole leather one of decades. That factor of a thousand is the entire
// reason the craft existed, and it emerges.

import { dpow } from '../gen/mathx.ts';
import {
  type Composition, atMoisture, bendingMPa, density,
} from './material.ts';
import { type Pile, materialOf, compositionOf } from './process.ts';

// --- tanning -----------------------------------------------------------------

/**
 * Tannin bound per unit of hide protein in finished vegetable-tanned leather.
 *
 * Measured: heavy leather analyses run 35 to 45 parts combined tannin per 100
 * of hide substance. This one ratio sets the bark bill, and the bill it sets
 * is the medieval one -- see below.
 */
const TANNIN_PER_PROTEIN = 0.4;

/** Finished leather's moisture, air-dry like everything else on a shelf. */
const LEATHER_MOISTURE = 0.14;

/**
 * How long the pit takes, days.
 *
 * Measured, and famously: sole leather lay in the tan pits about a year, and
 * statutes punished tanners who drew it early. It is a diffusion process
 * through a dense hide, which is why it is months and not hours and why no
 * amount of extra bark hurries it.
 */
export const TANNING_DAYS = 365;

export interface Tanned {
  leather: Pile | null;
  /** Bark consumed, kg. */
  barkUsedKg: number;
  /** True when there was not bark enough, in which case nothing tans. */
  short: boolean;
}

/**
 * Tan hides against bark.
 *
 * The bark bill is solved from two compositions: the hide's protein wants its
 * measured share of tannin, and the bark carries its measured fraction. For an
 * ox hide against oak bark that comes out near the hide's own weight in bark,
 * which is the medieval tanner's rule of thumb -- and nothing here was told
 * it.
 */
export function tan(hide: Pile, bark: Pile): Tanned {
  const hc = compositionOf(hide);
  const bc = compositionOf(bark);
  const hTotal = Object.values(hc).reduce((a, b) => a + b, 0);
  const bTotal = Object.values(bc).reduce((a, b) => a + b, 0);
  if (hTotal <= 0 || bTotal <= 0 || bc.tannin <= 0) {
    return { leather: null, barkUsedKg: 0, short: true };
  }

  const proteinKg = hide.massKg * (hc.protein / hTotal);
  const tanninNeededKg = proteinKg * TANNIN_PER_PROTEIN;
  const barkNeededKg = tanninNeededKg / (bc.tannin / bTotal);
  if (bark.massKg < barkNeededKg) {
    return { leather: null, barkUsedKg: 0, short: true };
  }

  // The leather: the hide's dry substance plus the bound tannin, at shelf
  // moisture. The water of the raw hide is wrung, drained and dried away.
  const hideDryKg = hide.massKg * (1 - hc.water / hTotal);
  const dryLeatherKg = hideDryKg + tanninNeededKg;

  // Its recipe: the hide's dry composition with the tannin folded in, then
  // wetted to shelf state. This is what the rot model will read.
  const dry = atMoisture(hc, 0);
  const scale = hideDryKg / dryLeatherKg;
  const composition: Composition = atMoisture({
    water: 0,
    cellulose: dry.cellulose * scale,
    lignin: dry.lignin * scale,
    starch: dry.starch * scale,
    sugar: dry.sugar * scale,
    oil: dry.oil * scale,
    protein: dry.protein * scale,
    tannin: dry.tannin * scale + tanninNeededKg / dryLeatherKg,
    ash: dry.ash * scale,
  }, LEATHER_MOISTURE);

  return {
    leather: {
      from: hide.from,
      what: 'leather',
      composition,
      // Measured: vegetable-tanned leather runs about 950 kg/m3.
      densityKgM3: 950,
      massKg: dryLeatherKg / (1 - LEATHER_MOISTURE),
      moisture: LEATHER_MOISTURE,
    },
    barkUsedKg: barkNeededKg,
    short: false,
  };
}

// --- hewing ------------------------------------------------------------------

/**
 * What squaring a round log keeps.
 *
 * Geometry, not opinion: the largest square prism inside a cylinder holds
 * 2/pi of its volume -- 63.7% -- and a real hewman loses a little more to
 * taper and sweep. Sawing into planks pays the kerf and the slabs besides,
 * which is why boards were dear and beams were not.
 */
export const HEWN_YIELD = 0.6;
export const SAWN_YIELD = 0.45;

export interface Timber {
  beam: Pile;
  /** Chips, slabs and bark: the offcut, which is the woodshed's gain. */
  offcutKg: number;
  /** The beam's square section, metres on a side. */
  sectionM: number;
  lengthM: number;
}

/**
 * Hew a bole into a beam.
 *
 * The section falls out of the log: the inscribed square of a round stem of
 * the given diameter has a side of d/sqrt(2). The offcut is not waste; it is
 * fuel, and it goes back as a pile.
 */
export function hew(
  bole: Pile, stemDiameterM: number, lengthM: number, sawn = false,
): Timber {
  const yield_ = sawn ? SAWN_YIELD : HEWN_YIELD;
  const beamKg = bole.massKg * yield_;
  return {
    beam: { ...bole, what: sawn ? 'plank' : 'beam', massKg: beamKg },
    offcutKg: bole.massKg - beamKg,
    sectionM: stemDiameterM / Math.sqrt(2),
    lengthM,
  };
}

/**
 * What a beam carries at mid-span before it breaks, kg.
 *
 * The bending formula every barn was sized by feel against: a central load W
 * on a simply supported span L breaks when WL/4 exceeds the section modulus
 * bh^2/6 times the material's bending strength -- and the strength is the
 * material model's, read from the wood's own density, where it was anchored on
 * published oak long before anybody built with it.
 */
export function beamBreaksAtKg(t: Timber): number {
  if (t.lengthM <= 0) return Infinity;
  const sigma = bendingMPa(materialOf(t.beam)) * 1e6;
  const z = (t.sectionM * t.sectionM * t.sectionM) / 6;
  const momentNm = sigma * z;
  const loadN = (4 * momentNm) / t.lengthM;
  return loadN / 9.81;
}

/**
 * The load a builder actually trusts it with.
 *
 * A fifth of breaking, which is the working stress every timber code before
 * and since has landed near: wood creeps, knots hide, and joints eat margin.
 */
export const WORKING_LOAD_FACTOR = 0.2;

export function beamCarriesKg(t: Timber): number {
  return beamBreaksAtKg(t) * WORKING_LOAD_FACTOR;
}

/**
 * The wall a cord of timber builds, m2 -- the number a house bill is in.
 *
 * A cruck cottage's frame is measured at about a cubic metre and a half of
 * oak for its thirty-odd square metres of floor; what this returns is the
 * frame timber for a given floor, and it is the demand the woodland model
 * meets. Wattle, thatch and daub are the walls' own trades and are not
 * timber.
 */
export const FRAME_M3_PER_FLOOR_M2 = 0.05;

export function frameTimberKg(floorM2: number, woodDensityKgM3: number): number {
  return floorM2 * FRAME_M3_PER_FLOOR_M2 * woodDensityKgM3;
}

/** How dense the beam's wood actually is, for the bill above. */
export function timberDensityKgM3(bole: Pile): number {
  return density(materialOf(bole));
}

// --- the textile trades -------------------------------------------------------
//
// Fleece to cloth is four verbs, and the famous fact about them is a RATIO:
// it took seven spinners to keep one weaver in yarn, and whole counties
// spun. That ratio is not written anywhere below -- the shears, the pond,
// the spindle and the loom each get their own measured day-rate, and the
// seven-to-one has to EMERGE from the spindle's rate against the loom's, or
// one of the rates is wrong. verify_textile holds it to that.

import { SHEEP, FLEECE_KG_PER_YEAR, GREASY_WOOL, FLEECE_BULK_KG_M3 } from './sheep.ts';

/**
 * What scouring takes out of a greasy fleece: the lanolin, the suint and
 * the field. Measured at a quarter to two fifths of the weight; the grease
 * was itself kept -- lanolin waterproofed everything a shepherd owned.
 */
export const SCOURING_YIELD = 0.7;

/**
 * A day at the drop spindle, kg of yarn.
 *
 * The slowest step in every textile economy before the wheel: eighty
 * grammes of even yarn is a long day's spinning, and it is why spinning
 * was every woman's second task every evening there was light.
 */
export const SPIN_KG_PER_DAY = 0.08;

/**
 * A day at the warp-weighted loom, kg of cloth woven from ready yarn.
 *
 * A narrow loom's weaver beat in a few metres of cloth a day; at the weight
 * of ordinary weft that is a bit over half a kilogramme. Seven spindle-days
 * to one loom-day falls out of this rate against the spindle's, which is
 * the ratio the sources repeat for six centuries.
 */
export const WEAVE_KG_PER_DAY = 0.6;

/** Ordinary cloth, kg the square metre. Broadcloth ran three to four fifths. */
export const CLOTH_KG_PER_M2 = 0.35;

/**
 * Water retting, days in the pond.
 *
 * The pectin gumming the bast to the core ferments out in a week or two of
 * warm water -- the stem's own low lignin is why flax rets in days while
 * straw would take a season. The pond stank enough that retting was banned
 * upstream of towns, which is as measured as a process gets.
 */
export const RETTING_DAYS = 10;

/** Long fibre out of retted straw: an eighth to a fifth. The rest is shive. */
export const FIBRE_YIELD = 0.15;

/** A sheep's year of wool, as a pile ready for the sack. */
export function shear(count: number): Pile {
  return {
    from: SHEEP.name,
    what: 'greasy wool',
    composition: GREASY_WOOL,
    densityKgM3: FLEECE_BULK_KG_M3,
    massKg: count * FLEECE_KG_PER_YEAR,
    moisture: GREASY_WOOL.water,
  };
}

/** Scoured wool: the fibre without its grease, ready for the spindle. */
export function scour(greasy: Pile): { clean: Pile; greaseKg: number } {
  const clean: Pile = {
    ...greasy,
    what: 'wool',
    massKg: greasy.massKg * SCOURING_YIELD,
    // Scouring takes the oil: what is left is nearly all keratin.
    composition: {
      ...greasy.composition,
      oil: greasy.composition.oil * 0.15,
      protein: greasy.composition.protein + greasy.composition.oil * 0.85,
    },
  };
  return { clean, greaseKg: greasy.massKg * (1 - SCOURING_YIELD) };
}

/**
 * Ret a pile of flax straw: the pond lets the bast go.
 *
 * Returns the fibre and the shive separately, because the shive is not
 * waste -- it is kindling and litter -- and because nothing in this project
 * is allowed to vanish.
 */
export function ret(straw: Pile): { fibre: Pile; shive: Pile } {
  const fibre: Pile = {
    ...straw,
    what: 'flax fibre',
    massKg: straw.massKg * FIBRE_YIELD,
    // The fibre is the stem's cellulose with the gums fermented off.
    composition: {
      ...straw.composition,
      cellulose: 0.80,
      sugar: 0.02,
      lignin: 0.02,
      water: 0.12,
      protein: 0.02,
      ash: 0.02,
      starch: 0,
      oil: 0,
      tannin: 0,
    },
    densityKgM3: 300,
  };
  const shive: Pile = {
    ...straw,
    what: 'shive',
    massKg: straw.massKg * (1 - FIBRE_YIELD),
  };
  return { fibre, shive };
}

/** Days of spinning to turn this much fibre into yarn. */
export function spinningDays(fibreKg: number): number {
  return fibreKg / SPIN_KG_PER_DAY;
}

/** Days at the loom for this much yarn. */
export function weavingDays(yarnKg: number): number {
  return yarnKg / WEAVE_KG_PER_DAY;
}

/** Cloth from yarn, square metres. Weaving wastes little; spinning wasted less. */
export function clothM2(yarnKg: number): number {
  return yarnKg / CLOTH_KG_PER_M2;
}
