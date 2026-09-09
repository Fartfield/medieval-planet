// A household: people, through the same physics as everything else.
//
// A person here is one more animal -- Kleiber's law fits a human as well as it
// fits a cow, and HUMAN digestion has been in the process model since the day
// grass had to feed a cow and not a person. What is human is not the
// metabolism; it is the three things no beast has. A HEARTH, which burns wood
// all winter or the household sickens. A STORE, which moves the harvest to the
// hungry months and rots while it waits. And WORK, which is the day the whole
// economy is denominated in.
//
// "FROM HAMLETS UP" STARTS HERE, and the claim this file stakes is that a
// household is DERIVED like everything else: its bread from the grain model,
// its firewood from the fuel model against the winter the season model gives
// its latitude, its keep from the same week loop the herd runs. The number of
// hands a hide of land needs, and the number of mouths it feeds, then have to
// come out at what the historical record says a hide was -- the land of one
// household -- or something upstream is wrong.
//
// WHAT IS ON THE SHEET AND NOT DERIVED, said plainly: the shape of the
// household itself. Five souls -- two adults, three children in the demography
// of the period -- is a social fact, like a litter size. The retreat to bread:
// what share of the diet is grain (three quarters, in every account of the
// period) is a preference and an economy, not a physical law.

import { dpow } from '../gen/mathx.ts';
import { type Composition } from './material.ts';
import { basalKcalPerDay } from './animal.ts';
import { digestibleKcalPerKg, HUMAN, type Pile } from './process.ts';
import { fuelMJPerKg, atMoisture } from './material.ts';
import { temperatureAtWeek, WEEKS_PER_YEAR } from './season.ts';

/**
 * The souls of one household, in adult-equivalents.
 *
 * Five people -- two adults and three children -- eat about as much as four
 * adults, children being smaller. Both numbers are the demography of the
 * period: households ran three to seven souls with five the median, and the
 * conversion is the one every grain-requirement study uses.
 */
export const SOULS_PER_HOUSEHOLD = 5;
export const ADULT_EQUIVALENTS = 4.0;

/** The adult the equivalents are in units of, kg. */
export const ADULT_KG = 62;

/**
 * What one adult-equivalent spends in a day, kcal.
 *
 * Kleiber gives the basal figure -- 1,550 at 62 kg, which is what calorimetry
 * gives a smallish adult -- and farm work multiplies it. The 1.9 is the
 * measured physical-activity level of subsistence agriculture, between the
 * 1.4 of sitting and the 2.5 of an army on the march. It lands at about
 * 2,900 kcal, which is the ration every medieval provisioning record implies.
 */
export const FARM_WORK_PAL = 1.9;

export function personKcalPerDay(massKg = ADULT_KG, pal = FARM_WORK_PAL): number {
  return basalKcalPerDay(massKg) * pal;
}

/**
 * Three quarters of those calories come as grain.
 *
 * The measured shape of the medieval diet at every station below the
 * aristocracy: bread, pottage and ale are all grain, and garden stuff, dairy,
 * meat and the pig make the rest. A social fact, on the sheet.
 */
export const GRAIN_SHARE_OF_DIET = 0.75;

/** Grain one household must eat in a year, kg, from the diet and the grain. */
export function grainNeedKgPerYear(grain: Composition): number {
  const perKg = digestibleKcalPerKg(grain, HUMAN);
  if (perKg <= 0) return Infinity;
  const kcalYear = personKcalPerDay() * ADULT_EQUIVALENTS * 365;
  return (kcalYear * GRAIN_SHARE_OF_DIET) / perKg;
}

/**
 * And a quarter again of the bread corn went to the brewhouse.
 *
 * Ale was the drink of every meal and brewing was a fifth to a third of all
 * grain use in every account of the period. Counted as grain LEAVING THE STORE
 * rather than as calories arriving, because brewing wastes most of them --
 * which is why ale is in the arithmetic of the holding and not in the
 * arithmetic of the diet.
 */
export const ALE_GRAIN_SHARE = 0.25;

export function aleGrainKgPerYear(grain: Composition): number {
  return grainNeedKgPerYear(grain) * ALE_GRAIN_SHARE;
}

/**
 * What the harvest owes before the household eats: tithe and rent.
 *
 * A tenth to the church, in the sheaf, everywhere and by law. Rent to the
 * lord -- in kind, in coin the grain was sold to raise, or in labour that
 * displaced the household's own -- lands near a quarter of output across
 * manorial studies. A third and more of every harvest was spoken for before
 * the bread was, and no model of a holding's size is honest without it.
 */
export const TITHE_SHARE = 0.10;
export const RENT_SHARE = 0.25;

// --- the hearth ---------------------------------------------------------------

/**
 * Heat one hearth gives out in a week this cold, MJ of wood burnt.
 *
 * THE FIRST VERSION HELD THE ROOM AT TWELVE DEGREES AND THE BILL CAME TO EIGHT
 * TONNES A YEAR -- four times the documented fuel use of a medieval hearth,
 * and the four is the point: nobody LIVED at twelve degrees. The physics of a
 * leaky one-room cottage (about 150 W lost per degree of difference) and an
 * open hearth (a fifth of the fire's heat into the room, the rest up with the
 * smoke) mean that what a household could actually sustain was a LIFT of a few
 * degrees over the street -- and that is what reconstructions of open-hall
 * buildings measure, interiors running two to four degrees over winter
 * exteriors. Medieval people were cold indoors, wore wool there, and the fuel
 * record is the proof.
 *
 * So the model burns for a three-degree lift whenever the week is cold enough
 * to want one, and the yearly total comes out at the faggot-a-day it must.
 */
const HOUSE_LOSS_W_PER_C = 150;
const HEARTH_EFFICIENCY = 0.2;
/** The lift an open hearth sustains, C. Measured in open-hall reconstructions. */
const HEARTH_LIFT_C = 3;
/** Below this, the fire is lit for warmth and not only the pot. */
const COLD_THRESHOLD_C = 10;

export function hearthMJPerWeek(outdoorC: number): number {
  if (outdoorC >= COLD_THRESHOLD_C) return 0;
  // Watts to MJ over a week: W x 604,800 s / 1e6.
  return (HOUSE_LOSS_W_PER_C * HEARTH_LIFT_C * 0.6048) / HEARTH_EFFICIENCY;
}

/** And the cooking fire, which burns in every season. */
export const COOKING_MJ_PER_WEEK = 100;

/**
 * Firewood a household burns in a year at this place, kg.
 *
 * The season model gives the week-by-week temperature; the fuel model gives
 * what a kilogramme of the wood is worth as it stands. Nothing here knows what
 * winter is -- a household on a warm coast comes out at a third of one on a
 * cold plain, because its weeks do.
 */
export function firewoodKgPerYear(
  wood: Composition, annualMeanC: number, sinLat: number,
): number {
  const perKg = fuelMJPerKg(wood);
  if (perKg <= 0) return Infinity;
  let mj = 0;
  for (let w = 0; w < WEEKS_PER_YEAR; w++) {
    mj += hearthMJPerWeek(temperatureAtWeek(annualMeanC, sinLat, w)) + COOKING_MJ_PER_WEEK;
  }
  return mj / perKg;
}

// --- the store ----------------------------------------------------------------

/** A household's stores: what stands between the harvest and the spring. */
export interface Larder {
  grainKg: number;
  /** Salted, smoked and potted things, counted in kcal for simplicity's sake. */
  otherKcal: number;
  firewoodKg: number;
}

/** One week of a household drawing on its larder. */
export interface HouseholdWeek {
  larder: Larder;
  /** Kcal short this week, zero when fed. */
  hunger: number;
  /** MJ of heat short this week, zero when warm. */
  cold: number;
}

/**
 * A week at home: eat from the store, burn from the pile.
 *
 * The same shape as the herd's week, because it is the same problem -- a
 * stock, a need, and a winter -- and the deficits it reports are what the
 * settlement layer will turn into sickness and death. This function does not
 * kill anybody; a household's dying is tangled with disease and charity in a
 * way a beast's is not, and that belongs to the layer that can see the whole
 * village.
 */
export function householdWeek(
  larder: Larder, grain: Composition, wood: Composition,
  outdoorC: number,
): HouseholdWeek {
  const kcalNeed = personKcalPerDay() * ADULT_EQUIVALENTS * 7;
  const grainPerKg = digestibleKcalPerKg(grain, HUMAN);

  // Grain first, to its share; the rest of the diet from the pot.
  const grainWantKcal = kcalNeed * GRAIN_SHARE_OF_DIET;
  const grainKg = Math.min(
    larder.grainKg, grainPerKg > 0 ? grainWantKcal / grainPerKg : 0,
  );
  let got = grainKg * grainPerKg;
  const otherWant = kcalNeed - got;
  const otherKcal = Math.min(larder.otherKcal, otherWant);
  got += otherKcal;

  const mjNeed = hearthMJPerWeek(outdoorC) + COOKING_MJ_PER_WEEK;
  const woodPerKg = fuelMJPerKg(wood);
  const woodKg = Math.min(
    larder.firewoodKg, woodPerKg > 0 ? mjNeed / woodPerKg : 0,
  );

  return {
    larder: {
      grainKg: larder.grainKg - grainKg,
      otherKcal: larder.otherKcal - otherKcal,
      firewoodKg: larder.firewoodKg - woodKg,
    },
    hunger: Math.max(0, kcalNeed - got),
    cold: Math.max(0, mjNeed - woodKg * woodPerKg),
  };
}

// --- the land -----------------------------------------------------------------

/**
 * The arable one household must sow, hectares, at a yield.
 *
 * Grain need, plus next year's seed -- the yield ratio of the period is
 * three-and-a-half to one, so over a quarter of every harvest goes back in the
 * ground -- over what a hectare gives. At the period's 900 kg/ha this comes
 * out near 1.9 ha under crop; under a two-field rotation the household holds
 * twice that. THE CHECK AGAINST HISTORY is the virgate: the standard holding
 * of one villein family, a quarter of a hide, seven to nine hectares -- and
 * this arithmetic, run from Kleiber's law upward with no historical acreage
 * anywhere in it, has to land inside that or something upstream is wrong.
 */
export function arableNeededHa(
  grain: Composition, yieldKgPerHa: number, yieldRatio: number,
): number {
  if (yieldKgPerHa <= 0) return Infinity;
  const wanted = grainNeedKgPerYear(grain) + aleGrainKgPerYear(grain);
  const sownShare = yieldRatio > 0 ? 1 / yieldRatio : 0;
  // The harvest covers the seed, the tithe and the rent before the household:
  // what it keeps is the remainder, and the remainder must be the bread and
  // the ale. THE FIRST VERSION FED ONLY ITS OWN MOUTHS and came out at 3.1 ha
  // -- and the missing five hectares of the virgate were exactly the seed
  // corn, the church's tenth, the lord's share and the brewhouse.
  const kept = Math.max(0.01, 1 - sownShare - TITHE_SHARE - RENT_SHARE);
  return wanted / kept / yieldKgPerHa;
}

/** With the fallow of a two-field rotation, the holding itself. */
export function holdingHa(
  grain: Composition, yieldKgPerHa: number, yieldRatio: number,
): number {
  return arableNeededHa(grain, yieldKgPerHa, yieldRatio) * 2;
}

/**
 * Bread, solved through every model at once.
 *
 * From grain to loaf: milling extracts about 82% of the wheat as flour, a
 * loaf is flour and water at about 1.35 kg of bread per kg of flour, and the
 * loaf's food value has to come out at what a bakery scale reads. This is the
 * deepest single chain in the project -- climate to npp to harvest to
 * threshing to milling to the table -- and this function is the last link.
 */
export const EXTRACTION_RATE = 0.82;
export const BREAD_PER_FLOUR = 1.35;

export function breadFromGrain(grainPile: Pile): Pile {
  const flourKg = grainPile.massKg * EXTRACTION_RATE;
  return {
    from: grainPile.from,
    what: 'bread',
    // Baking wets the flour and the crumb holds it: bread is about 38% water,
    // which is exactly the atMoisture verb applied in reverse.
    composition: atMoisture(grainPile.composition, 0.38),
    densityKgM3: 250,
    massKg: flourKg * BREAD_PER_FLOUR,
    moisture: 0.38,
  };
}
