// What the grass will feed.
//
// Wood was a stock and a flow; pasture is only a flow. There is no standing
// reserve of grass worth counting -- a sward eaten to the ground does not hand
// over a windfall the way a felled wood does, it simply stops growing. So the
// whole of the question is: how much does a hectare grow in a year, how much of
// that can an animal actually reach and eat, and how much does an animal eat.
//
// THREE FRACTIONS AND ONE APPETITE, and they are different questions that are
// easy to run together:
//
//   * GRAZEABLE_FRACTION -- of everything a place grows, how much is within
//     reach of something with hooves. A rainforest puts its production forty
//     metres up; a savanna puts it in grass. Already anchored in resources.ts.
//   * PASTURE_UTILISATION -- of the forage in reach, how much is eaten rather
//     than trodden, fouled, or left standing so the sward can regrow.
//   * INTAKE_DRY_FRACTION -- what an animal eats daily as a share of its own
//     mass. A fortieth, and it barely varies between ruminants because it is
//     set by gut capacity rather than by species.
//
// The first two are about the land and the third is about the animal, and the
// stocking rate is the first two divided by the third.
//
// COUNTED IN LIVESTOCK UNITS, because what limits a settlement is the eating
// and not the animal: an ox, a cow, five sheep and six pigs eat about the same.
// A herd of "twelve units" is a good many more than twelve beasts.

import * as A from '../anchors.ts';
import { type BiomeId } from './biome.ts';
import { GRAZEABLE_FRACTION } from './resources.ts';

/** Grams a square metre a year to kilogrammes a hectare a year. */
const G_M2_TO_KG_HA = 10;

/**
 * Dry fodder one livestock unit eats in a year, kg.
 *
 * Mass times the daily fraction times a year. A cow eats rather more than four
 * tonnes of dry matter a year, which is the number that makes hay meadows and
 * winter fodder the problem they were.
 */
export const INTAKE_KG_PER_UNIT_YEAR =
  A.LIVESTOCK_UNIT_KG * A.INTAKE_DRY_FRACTION * 365;

/**
 * Forage a hectare grows in a year that an animal can reach, kg dry.
 *
 * Productivity times what is in reach. Not yet what can be eaten -- see
 * `edibleKgPerHaYear` -- because a sward grazed bare stops growing.
 */
export function forageKgPerHaYear(biome: BiomeId, npp: number): number {
  return Math.max(0, npp) * G_M2_TO_KG_HA * (GRAZEABLE_FRACTION[biome] ?? 0);
}

/** Of that, what actually goes into an animal rather than under its feet. */
export function edibleKgPerHaYear(biome: BiomeId, npp: number): number {
  return forageKgPerHaYear(biome, npp) * A.PASTURE_UTILISATION;
}

/**
 * How many livestock units a hectare will carry, year in and year out.
 *
 * The stocking rate, which is the number a commons was argued over in. Nothing
 * here is chosen: it is production, times what is in reach, times what can be
 * taken, over what an animal eats.
 */
export function stockingUnitsPerHa(biome: BiomeId, npp: number): number {
  return edibleKgPerHaYear(biome, npp) / INTAKE_KG_PER_UNIT_YEAR;
}

/** The pasture a herd of this size needs, hectares. */
export function pastureNeededHa(units: number, biome: BiomeId, npp: number): number {
  const rate = stockingUnitsPerHa(biome, npp);
  if (rate <= 0) return Infinity;
  return Math.max(0, units) / rate;
}

/** What a settlement's grazing can carry, and what it is being asked to. */
export interface Grazing {
  /** Forage grown within reach in a year, kg dry. */
  forageKg: number;
  /** Of that, what can be taken without ruining the sward. */
  edibleKg: number;
  /** Livestock units the land will carry for ever. */
  carryingUnits: number;
  /** Units actually kept. */
  keptUnits: number;
  /** Of the herd, how much the land feeds, 0 to 1. Below one it is overstocked. */
  supply: number;
}

export function grazing(
  keptUnits: number, grazedHa: number, biome: BiomeId, npp: number,
): Grazing {
  const forageKg = Math.max(0, grazedHa) * forageKgPerHaYear(biome, npp);
  const edibleKg = forageKg * A.PASTURE_UTILISATION;
  const carryingUnits = edibleKg / INTAKE_KG_PER_UNIT_YEAR;
  const kept = Math.max(0, keptUnits);
  const supply = kept <= 0 ? 1 : Math.min(1, carryingUnits / kept);
  return { forageKg, edibleKg, carryingUnits, keptUnits: kept, supply };
}
