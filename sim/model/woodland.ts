// Wood: how much a place grows a year, and how much the people on it burn.
//
// The map has known how much timber a hectare STANDS since resources.ts, and
// as of flora.ts how many trees that is. Neither says what a settlement can
// take without the wood running out, which is the only question that makes a
// woodland a resource rather than scenery.
//
// THE TWO NUMBERS THAT MATTER ARE A STOCK AND A FLOW, and confusing them is the
// classic way to get this wrong. Standing timber is a stock: a mature temperate
// hectare holds 150 tonnes, and a village that cuts it holds a one-off windfall
// and then bare ground. Annual increment is the flow: the same hectare puts on
// about 8 tonnes a year, and a village that cuts only that has fuel for ever.
// Everything about how woodland was actually treated -- coppiced on a rotation,
// counted, fenced, and litigated over -- follows from the flow being small and
// the stock being tempting.
//
// Nothing here is chosen. The flow is the woody part of the productivity the
// climate model already computes; the demand is a fuel figure per person and a
// house frame amortised over its life. What comes out can be checked against
// how much woodland a real village kept, and verify_woodland does.

import * as A from '../anchors.ts';
import { type BiomeId } from './biome.ts';
import { WOODY_FRACTION, timberTPerHa } from './resources.ts';

/** Grams a square metre a year to tonnes a hectare a year. */
const G_M2_TO_T_HA = 0.01;

/**
 * What a hectare puts on in a year, tonnes of dry wood.
 *
 * The woody share of productivity, and nothing else. A temperate forest at its
 * reference productivity comes out at 8 t/ha/yr against a measured mean annual
 * increment of 3 to 10 for managed temperate woodland -- and that figure was
 * not used to build this, it falls out of the productivity and the woody
 * fraction the timber model already used for the standing stock.
 */
export function annualGrowthTPerHa(biome: BiomeId, npp: number): number {
  return Math.max(0, npp) * (WOODY_FRACTION[biome] ?? 0) * G_M2_TO_T_HA;
}

/**
 * What can be cut year after year without the wood shrinking, t/ha/yr.
 *
 * The increment, which is the whole of it. Cutting less lets the stand thicken
 * towards its standing maximum; cutting more eats the stock, and the stock is
 * about twenty years of growth, so a village taking double what it should has
 * two decades before it notices and then no woodland at all.
 */
export function sustainableCutTPerHa(biome: BiomeId, npp: number): number {
  return annualGrowthTPerHa(biome, npp);
}

/**
 * How many years of cutting the standing stock represents, at a given rate.
 *
 * The number that says how long a mistake takes to show. Infinite when the cut
 * is within the increment, which is the point of the distinction.
 */
export function yearsOfStock(biome: BiomeId, npp: number, cutTPerHaYear: number): number {
  const growth = annualGrowthTPerHa(biome, npp);
  if (cutTPerHaYear <= growth) return Infinity;
  const standing = Math.max(0, timberTPerHa(biome, npp));
  return standing / (cutTPerHaYear - growth);
}

/**
 * Wood a person needs in a year, kg of dry wood.
 *
 * Fuel dominates and construction is a rounding error beside it: a house frame
 * is fifteen cubic metres but stands a century and shelters five, which is
 * eighteen kilogrammes a person a year against a thousand burnt. That ratio is
 * the historically important part -- nobody ran out of house frames.
 */
export const BUILDING_KG_PER_PERSON_YEAR =
  (A.HOUSE_TIMBER_M3 * A.WOOD_DENSITY_KG_M3) / (A.HOUSE_LIFE_YEARS * A.HOUSE_PEOPLE);

export const WOOD_KG_PER_PERSON_YEAR =
  A.FIREWOOD_KG_PER_PERSON_YEAR + BUILDING_KG_PER_PERSON_YEAR;

/**
 * Wood a settlement needs in a year, kg, including what its ironworking burns.
 *
 * Iron is smelted with charcoal and charcoal is made from wood, and both of
 * those ratios were already anchored for the ironworking model -- so a
 * smith's demand on the woodland comes out of numbers that were there before
 * anyone asked this question.
 */
export function woodNeedKgPerYear(population: number, ironKgPerYear: number): number {
  const domestic = Math.max(0, population) * WOOD_KG_PER_PERSON_YEAR;
  const smelting = Math.max(0, ironKgPerYear)
    * A.CHARCOAL_PER_IRON_KG * A.WOOD_PER_CHARCOAL_KG;
  return domestic + smelting;
}

/**
 * The woodland a settlement must keep to burn for ever, hectares.
 *
 * Demand over increment. This is the number a manor actually had to know, and
 * the reason woodland was measured in acres per household rather than left to
 * look after itself.
 */
export function woodlandNeededHa(
  population: number, ironKgPerYear: number, biome: BiomeId, npp: number,
): number {
  const growth = annualGrowthTPerHa(biome, npp);
  if (growth <= 0) return Infinity;
  return woodNeedKgPerYear(population, ironKgPerYear) / 1000 / growth;
}

/** What a settlement gets from the woodland it has, and what it wanted. */
export interface WoodSupply {
  /** Dry wood wanted this year, kg. */
  needKg: number;
  /** Dry wood the woodland grows in a year, kg. */
  growthKg: number;
  /** Standing timber within reach, kg. The stock a shortfall eats into. */
  standingKg: number;
  /** Need met by growth alone, 0 to 1. Below one the stock is being spent. */
  supply: number;
  /** Years before the standing timber is gone at this rate. */
  yearsLeft: number;
}

/**
 * What the woodland in reach can actually give.
 *
 * `woodedHa` is the wooded area a settlement can work, which the catchment
 * knows; biome and productivity say what a hectare of it does.
 */
export function woodSupply(
  population: number, ironKgPerYear: number,
  woodedHa: number, biome: BiomeId, npp: number,
): WoodSupply {
  const needKg = woodNeedKgPerYear(population, ironKgPerYear);
  const growthKg = Math.max(0, woodedHa) * annualGrowthTPerHa(biome, npp) * 1000;
  const standingKg = Math.max(0, woodedHa) * Math.max(0, timberTPerHa(biome, npp)) * 1000;
  const supply = needKg <= 0 ? 1 : Math.min(1, growthKg / needKg);
  const overcut = needKg - growthKg;
  const yearsLeft = overcut <= 0 ? Infinity : standingKg / overcut;
  return { needKg, growthKg, standingKg, supply, yearsLeft };
}
