// An animal, solved from its body mass.
//
// The plants got their leverage from one number -- mature mass -- and animals
// get theirs from the same place, only more so, because ALLOMETRY is the best
// developed quantitative relationship in biology. What an animal eats, how fast
// it grows, how long it lives, how long it carries a calf, how much water it
// drinks and how much dung it drops are all powers of its body mass, and the
// exponents are measured across five orders of magnitude from a mouse to an
// elephant.
//
// THE ONE THAT MATTERS IS KLEIBER'S LAW: metabolic rate goes as mass to the
// three quarters, not to the one. A cow is a hundred times a hen and eats
// thirty times as much, not a hundred. That single fact is why small animals
// are efficient converters and large ones are not, why a pig fattens faster
// than an ox, and why the mix of stock a village keeps is an economic question
// with a right answer rather than a preference.
//
// WHAT IS NOT SOLVED FROM MASS, said plainly. Litter size is not: a cow has one
// calf and a sow has ten at the same order of body mass, and that is a
// life-history strategy rather than a consequence of size. Digestion is not: a
// rumen is a piece of anatomy. Milk yield is not, quite -- it is bounded by
// metabolism and then set by centuries of breeding, and a landrace cow gives a
// tenth of a modern one at the same weight. Those three are on the sheet, and
// they are the only three.

import { dexp, dlog, dpow } from '../gen/mathx.ts';
import { type Composition } from './material.ts';
import {
  type Digestion, type Pile, digestibleKcalPerKg, digestibility,
  indigestibleFibreShare,
} from './process.ts';

// --- the measured exponents ---------------------------------------------------

/**
 * Kleiber's law: basal metabolic rate, kcal a day, from body mass in kg.
 *
 * BMR = 70 . M^0.75, and both numbers are measured. The 0.75 has been argued
 * over for ninety years and holds across eighteen orders of magnitude of mass;
 * the 70 is the coefficient for placental mammals. A 450 kg cow comes out at
 * 6,800 kcal a day of pure ticking over.
 */
const KLEIBER_COEFF = 70;
const KLEIBER_EXPONENT = 0.75;

/**
 * What a working animal actually spends, as a multiple of basal.
 *
 * Measured: maintenance metabolisable energy for cattle at pasture is about
 * 0.5 MJ per kg^0.75 per day, which is 120 kcal against a basal 70 -- so an
 * animal standing in a field, walking to water and keeping warm spends about
 * 1.7 times what it would spend asleep in a chamber. A draught ox pulling a
 * plough spends more again, and that is what `working` is for.
 */
const MAINTENANCE_OVER_BASAL = 1.7;
const WORKING_OVER_BASAL = 2.8;

/**
 * Lifespan goes as mass to the quarter, and so does everything else with a
 * clock in it: heart rate, breathing, gestation, time to maturity.
 *
 * Measured, and the reason it is one exponent rather than four is that they are
 * the same fact -- biological time itself runs slower in a big animal. The
 * coefficient here is set so that a 450 kg cow lives about twenty years, which
 * is what a cow does when nobody eats it.
 */
const LIFESPAN_EXPONENT = 0.25;
const LIFESPAN_COEFF = 4.35;

/**
 * Gestation, days, as mass to the quarter.
 *
 * Same clock. Set from cattle at 283 days and 450 kg: a sheep at 70 kg then
 * comes out at 178 against a measured 147, and a pig at 200 kg at 231 against
 * a measured 114 -- which is the honest limit of a one-parameter fit. Pigs are
 * fast for their size because they are litter-bearers, and litter size is the
 * thing this file already says is not derivable from mass.
 */
const GESTATION_EXPONENT = 0.25;
const GESTATION_COEFF = 61.5;

/**
 * Gut capacity is very nearly proportional to mass, not to mass^0.75.
 *
 * Measured, and it is the mismatch with Kleiber that shapes the whole of
 * husbandry: gut grows as M and metabolism as M^0.75, so a BIG animal has
 * proportionally more gut per unit of energy need and can therefore live on
 * poorer forage. That is why an ox can winter on straw and a hen cannot, and it
 * is not a fact anybody had to type in -- it falls out of two exponents.
 *
 * The coefficient is the share of body mass a ruminant's full gut represents,
 * measured at about 15% for cattle.
 */
const GUT_FRACTION = 0.15;

/**
 * Water turned over, litres per kg of dry matter eaten.
 *
 * Measured, and the standard husbandry rule: cattle need four to five litres of
 * water for every kilogramme of dry feed. Water DRUNK is that minus the water
 * already in the feed, which is why a cow on lush spring grass barely visits
 * the trough and the same cow on hay drinks forty litres a day. That difference
 * is a real constraint on where stock can be kept, and it falls out of two
 * numbers rather than being a rule about troughs.
 */
const WATER_L_PER_KG_DRY = 4.5;

/**
 * How much INDIGESTIBLE matter a gut can pass in a day, as a share of body
 * weight.
 *
 * THE SECOND CONSTRAINT ON INTAKE, and without it the model let a cow winter
 * comfortably on straw. An animal does not stop eating when its energy need is
 * met; it stops when its rumen is full, and what fills a rumen is the part that
 * will not ferment. So the limit is on indigestible matter, not on food.
 *
 * Measured: a cow eats about 2.5% of her body weight in dry matter of good
 * grass, whose indigestible fibre is 26% of its dry matter -- so she can pass
 * 0.65% of her weight in fibre residue a day. Held constant, the SAME figure
 * predicts 1.36% of body weight of straw, whose residue is 48%, against a
 * measured 1.2%. That is a prediction from one anchor, not a fit to two.
 */
const INDIGESTIBLE_CAPACITY = 0.006475;

// --- the sheet ----------------------------------------------------------------

/** A tissue an animal is made of, in the same terms as a plant's parts. */
export interface Tissue {
  name: string;
  /** Share of the animal's live weight. */
  share: number;
  composition: Composition;
  densityKgM3: number;
  /** True for what a person will eat. */
  edible: boolean;
  /** True for what hangs on the hook: meat, fat and bone. */
  carcass: boolean;
}

/** A species of animal. */
export interface Animal {
  name: string;
  /**
   * Mature live weight, kg. THE number: nearly everything else is a power of
   * it.
   */
  matureMassKg: number;
  /** Weight at birth, kg. Measured; it does not scale cleanly from the adult. */
  birthMassKg: number;
  digestion: Digestion;
  /** Young per birth. A life-history strategy, not a consequence of size. */
  litterSize: number;
  /** Births a year, once mature. */
  littersPerYear: number;
  /**
   * Milk given a year, litres, by a female in milk.
   *
   * ON THE SHEET AND NOT DERIVED, and it is worth being clear why. Metabolism
   * bounds it -- no cow can secrete more energy than she eats -- but within
   * that bound it is the single most heavily bred trait in the history of
   * livestock, and a landrace cow gives a tenth of a Holstein at the same
   * weight. A model that derived it from mass would say the middle ages had
   * modern dairying, which is the opposite of true.
   */
  milkLitresPerYear: number;
  /**
   * Coat colour, rgb.
   *
   * ON THE SHEET, and for the same reason a plant's pigment is: colour is not
   * a consequence of bulk chemistry, and claiming otherwise would be inventing.
   * A landrace of medieval cattle was dun and red-brown because that is what
   * the landrace was, and no allometry predicts it.
   */
  coat: [number, number, number];
  /** Whether it carries horns. Every medieval beast did; polled breeds are new. */
  horned: boolean;
  tissues: readonly Tissue[];
}

// --- what falls out of the mass ------------------------------------------------

/** Basal metabolic rate, kcal a day. Kleiber. */
export function basalKcalPerDay(massKg: number): number {
  if (massKg <= 0) return 0;
  return KLEIBER_COEFF * dpow(massKg, KLEIBER_EXPONENT);
}

/** What it actually spends in a day, kcal, standing in a field or working. */
export function needKcalPerDay(massKg: number, working = false): number {
  return basalKcalPerDay(massKg)
    * (working ? WORKING_OVER_BASAL : MAINTENANCE_OVER_BASAL);
}

/**
 * How much of a given feed it must eat in a day, kg.
 *
 * DERIVED FROM BOTH ENDS, which is the point: the energy it needs comes from
 * its mass, and the energy in the feed comes from the feed's composition and
 * the animal's own digestion. Nothing states an intake. Give a cow straw
 * instead of grass and the figure rises on its own, until it passes what the
 * gut can hold -- which is what `canLiveOn` tests and is exactly how a real
 * animal starves on poor hay.
 */
export function intakeKgPerDay(
  a: Animal, massKg: number, feed: Composition, working = false,
): number {
  const perKg = digestibleKcalPerKg(feed, a.digestion);
  if (perKg <= 0) return Infinity;
  return needKcalPerDay(massKg, working) / perKg;
}

/** What its gut holds at one time, kg. Proportional to mass. */
export function gutCapacityKg(massKg: number): number {
  return GUT_FRACTION * massKg;
}

/**
 * The most dry matter of this feed it can physically get through in a day, kg.
 *
 * Fill-limited, not appetite-limited: what stops an animal is the indigestible
 * residue sitting in the rumen, so the worse the feed the LESS of it can be
 * eaten -- which is the opposite of what a hungry animal would choose and is
 * exactly why poor forage starves stock that have plenty of it in front of
 * them.
 */
export function maxDryIntakeKgPerDay(
  a: Animal, massKg: number, feed: Composition,
): number {
  return (INDIGESTIBLE_CAPACITY * massKg) / indigestibleFibreShare(feed, a.digestion);
}

/**
 * Can it live on this alone?
 *
 * Two questions in one, and the second is the one that matters: is there enough
 * energy in what it can PHYSICALLY EAT to meet what it needs? An animal in a
 * yard full of straw is surrounded by food and still starving, because it fills
 * up before it is fed.
 */
export function canLiveOn(
  a: Animal, massKg: number, feed: Composition, working = false,
): boolean {
  const total = Object.values(feed).reduce((x, y) => x + y, 0);
  if (total <= 0) return false;
  const dryShare = 1 - feed.water / total;
  if (dryShare <= 0) return false;
  const maxFreshKg = maxDryIntakeKgPerDay(a, massKg, feed) / dryShare;
  const gotKcal = maxFreshKg * digestibleKcalPerKg(feed, a.digestion);
  return gotKcal >= needKcalPerDay(massKg, working);
}

/**
 * Water it drinks in a day, litres: what it turns over, less what was in the
 * feed.
 */
export function waterDrunkLPerDay(
  a: Animal, massKg: number, feed: Composition, working = false,
): number {
  const total = Object.values(feed).reduce((x, y) => x + y, 0);
  if (total <= 0) return 0;
  const eaten = intakeKgPerDay(a, massKg, feed, working);
  if (!Number.isFinite(eaten)) return 0;
  const dry = eaten * (1 - feed.water / total);
  const inFeed = eaten * (feed.water / total);
  return Math.max(0, dry * WATER_L_PER_KG_DRY - inFeed);
}

/** How long it lives if nothing eats it, years. */
export function lifespanYears(massKg: number): number {
  return LIFESPAN_COEFF * dpow(massKg, LIFESPAN_EXPONENT);
}

/** How long it carries young, days. */
export function gestationDays(massKg: number): number {
  return GESTATION_COEFF * dpow(massKg, GESTATION_EXPONENT);
}

/**
 * Growth rate, per year, for the von Bertalanffy curve below.
 *
 * The same quarter-power clock: a big animal takes proportionally longer to
 * reach its own size, so the rate goes as mass to the MINUS a quarter. Set so
 * that cattle reach half their weight in about a year, which they do.
 */
export function growthRate(matureMassKg: number): number {
  return 5.5 * dpow(matureMassKg, -LIFESPAN_EXPONENT);
}

/**
 * Live weight at an age, kg.
 *
 * The same growth curve the plants use, for the same reason -- accumulation on
 * a surface against respiration by volume -- and starting from a birth weight
 * rather than from nothing, because an animal is not born as a seed.
 */
export function massAtAge(a: Animal, ageYears: number): number {
  if (ageYears <= 0) return a.birthMassKg;
  const k = growthRate(a.matureMassKg);
  const span = a.matureMassKg - a.birthMassKg;
  return a.matureMassKg - span * dexp(-k * ageYears);
}

/** The age at which it reaches a share of its mature weight, years. */
export function ageAtMass(a: Animal, massKg: number): number {
  const k = growthRate(a.matureMassKg);
  const span = a.matureMassKg - a.birthMassKg;
  const left = a.matureMassKg - massKg;
  if (span <= 0 || left <= 0 || k <= 0) return Infinity;
  return -dlog(left / span) / k;
}

/**
 * What a year of it eats, kg of the given feed, over its whole growth.
 *
 * The number that decides whether an animal is worth keeping: a beast eats
 * every day of its life and pays once. Integrated over the year rather than
 * taken at the final weight, because a growing animal is lighter for most of
 * it and the difference is a third.
 */
export function feedForYearKg(
  a: Animal, fromAgeYears: number, feed: Composition, working = false,
): number {
  let total = 0;
  for (let d = 0; d < 365; d++) {
    total += intakeKgPerDay(a, massAtAge(a, fromAgeYears + d / 365), feed, working);
  }
  return total;
}

// --- what comes off it ---------------------------------------------------------

/** A slaughtered animal, as piles. */
export function slaughter(a: Animal, liveMassKg: number): Pile[] {
  const out: Pile[] = [];
  for (const t of a.tissues) {
    const kg = liveMassKg * t.share;
    if (kg <= 0) continue;
    const total = Object.values(t.composition).reduce((x, y) => x + y, 0);
    out.push({
      from: a.name,
      what: t.name,
      composition: t.composition,
      densityKgM3: t.densityKgM3,
      massKg: kg,
      moisture: total > 0 ? t.composition.water / total : 0,
    });
  }
  return out;
}

/**
 * Dressing percentage: the share of live weight that hangs as a carcass.
 *
 * MEAT, FAT AND BONE, and not everything a person will eat -- which is what
 * this first counted, and it read 0.63 against a measured 0.55. The offal, the
 * blood and the head are food and are not carcass; a butcher weighs the beast
 * alive and again on the hook, and the gap is the hide, the gut fill and
 * everything the hook does not hold.
 */
export function dressingPercentage(a: Animal): number {
  return a.tissues.filter((t) => t.carcass).reduce((x, t) => x + t.share, 0);
}

/** Milk, as a pile, for a span of days in milk. */
export function milk(a: Animal, days: number): Pile {
  const litres = (a.milkLitresPerYear * Math.max(0, days)) / 365;
  const spec = a.tissues.find((t) => t.name === 'milk');
  const composition = spec?.composition ?? {
    water: 0.87, cellulose: 0, lignin: 0, starch: 0, sugar: 0.048,
    oil: 0.04, protein: 0.033, tannin: 0, ash: 0.007,
  };
  const densityKgM3 = spec?.densityKgM3 ?? 1030;
  return {
    from: a.name,
    what: 'milk',
    composition,
    densityKgM3,
    massKg: (litres * densityKgM3) / 1000,
    moisture: composition.water,
  };
}

/**
 * DUNG, which is where the ring closes.
 *
 * What goes in and is not absorbed comes out, so the mass is intake minus what
 * the gut took -- and the nitrogen in it is the protein the animal did not use.
 * This is the number that makes a fold of sheep on a fallow field worth more
 * than the sheep, and it is arithmetic rather than a rule about manure.
 */
export interface Dung {
  massKgPerDay: number;
  /** Nitrogen returned to the soil, kg a day. */
  nitrogenKgPerDay: number;
}

/**
 * Protein is about sixteen per cent nitrogen by mass -- the measured factor
 * every feed analysis uses backwards, quoting crude protein as N times 6.25.
 */
const NITROGEN_IN_PROTEIN = 0.16;

export function dung(
  a: Animal, massKg: number, feed: Composition, working = false,
): Dung {
  const eaten = intakeKgPerDay(a, massKg, feed, working);
  if (!Number.isFinite(eaten)) return { massKgPerDay: 0, nitrogenKgPerDay: 0 };
  const total = Object.values(feed).reduce((x, y) => x + y, 0);
  if (total <= 0) return { massKgPerDay: 0, nitrogenKgPerDay: 0 };
  // What the gut could take of the dry matter, by the same rules eating uses.
  const dryShare = 1 - feed.water / total;
  const digestible = (feed.starch + feed.sugar + feed.protein + feed.oil) / total
    + (feed.cellulose / total) * a.digestion.fibre;
  const absorbed = eaten * digestible * a.digestion.efficiency;
  // Most of the nitrogen an animal eats it excretes, having used what it needs
  // for growth and milk; on maintenance alone that is nearly all of it.
  const nitrogen = eaten * (feed.protein / total) * NITROGEN_IN_PROTEIN;
  return {
    massKgPerDay: Math.max(0, eaten * dryShare - absorbed),
    nitrogenKgPerDay: nitrogen,
  };
}
