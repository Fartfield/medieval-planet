// The granary: what lets a settlement hoard a year against the next bad one.
//
// The economy has always stored grain as if every settlement had somewhere to
// keep it -- a year's supply at five per cent spoilage, the figure for GOOD
// storage. Good storage is a building. This file is that building: a raised,
// dry, rat-proofed granary, built from timber and labour, whose capacity is the
// grain it can hold, and without which a place can keep only the little it can
// pile in its houses and pits -- enough for a few weeks, not for the gap
// between one harvest and the next.
//
// WHY A GRANARY IS NOT A WALL. A wall's circuit grows as the square root of the
// people, so a city walls itself cheap by the head. A granary does not: it
// holds a year's bread, and a year's bread is simply proportional to the
// mouths, so the granary a settlement needs -- and the labour to raise it --
// grows straight with its population. There is no economy of scale in a barn.
// That is why even the smallest village had one and why it was the first thing
// built, where a wall was the last.
//
// EVERYTHING HERE IS A VOLUME OVER A RATE, as in works.ts: grain has a bulk
// density, a granary is so many cubic metres of framed and floored timber, and
// the cubic metre costs its man-days to raise. The capacity is the volume times
// the density; the target is the volume that holds the year's supply the
// economy already aims at.

import * as A from '../anchors.ts';
import { GRAIN_PER_PERSON_PER_YEAR } from './settlement.ts';

/**
 * The bulk density of stored grain, kg per cubic metre.
 *
 * Wheat and rye poured into a bin settle at about 750 kg/m3 -- the grain test
 * weight every granary and grain trade was reckoned in. A cubic metre of
 * granary holds three quarters of a tonne.
 */
export const GRAIN_BULK_KG_PER_M3 = 750;

/**
 * Man-days to raise a cubic metre of granary.
 *
 * A granary is a framed timber building on staddle stones -- sills, posts,
 * a raised and boarded floor, weatherproofed walls and a roof -- and a modest
 * timber structure of this kind comes to about a man-day and a half for each
 * cubic metre it encloses, felling and working the timber folded in as the
 * palisade's was. Far cheaper by the cubic metre than stone, and cheaper still
 * than a wall by the head, because a barn has no economy of scale to climb.
 */
export const GRANARY_DAYS_PER_M3 = 1.5;

/**
 * What a settlement can keep with no granary at all, kg per person.
 *
 * Grain piled in the house, in a pit, in a chest keeps for a few weeks before
 * the damp and the rats have it -- call it six weeks of one person's bread. A
 * founding party's provisions fit inside this, so nobody starves for want of a
 * granary in their first season; but a year cannot be held this way, which is
 * the whole reason the granary was worth building.
 */
export const STORE_FREE_WEEKS = 6;
export const STORE_FREE_KG_PER_PERSON =
  GRAIN_PER_PERSON_PER_YEAR * (STORE_FREE_WEEKS / 52);

/** The grain a granary of this many man-days' building can hold, kg. */
export function granaryCapacityKg(granaryDays: number): number {
  const m3 = Math.max(0, granaryDays) / GRANARY_DAYS_PER_M3;
  return m3 * GRAIN_BULK_KG_PER_M3;
}

/**
 * The labour to build a granary holding the year's supply the economy aims at.
 *
 * A settlement wants to keep GRAIN_STOCK_TARGET_YEARS of its people's bread --
 * the stock the trade model already targets -- so the granary it builds toward
 * is the one that holds exactly that, and the labour is its volume over the
 * build rate. Proportional to population: no cheaper by the head.
 */
export function targetGranaryDays(population: number): number {
  if (population <= 0) return 0;
  const targetKg = population * GRAIN_PER_PERSON_PER_YEAR * A.GRAIN_STOCK_TARGET_YEARS;
  return (targetKg / GRAIN_BULK_KG_PER_M3) * GRANARY_DAYS_PER_M3;
}

/**
 * The most grain a settlement can keep: what its houses hold for free, plus
 * what its granary adds.
 *
 * This is the cap the economy stores against. A place with no granary is held
 * to the few weeks its dwellings keep; a place that has built toward a year's
 * supply can hoard it and ride out a failed harvest.
 */
export function storageCapKg(granaryDays: number, population: number): number {
  return Math.max(0, population) * STORE_FREE_KG_PER_PERSON
    + granaryCapacityKg(granaryDays);
}

/**
 * Raise the granary by a year's spare labour, up to the year's-supply target.
 *
 * Beyond the target the barn is big enough; more labour is better spent on the
 * walls or the forge. Like the works, nothing here chooses how much to spare --
 * the economy does, and it builds the granary before the wall because bread
 * comes before battlements.
 */
export function buildGranary(
  granaryDays: number, spareDays: number, population: number,
): number {
  const max = targetGranaryDays(population);
  return Math.min(max, Math.max(0, granaryDays) + Math.max(0, spareDays));
}

/** How full the granary stands, 0 to 1, for the panel. */
export function granaryFullness(
  granaryDays: number, population: number, stockKg: number,
): number {
  const cap = storageCapKg(granaryDays, population);
  if (cap <= 0) return 0;
  return Math.min(1, Math.max(0, stockKg) / cap);
}
