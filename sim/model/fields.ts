// The arable: how much ground a village ploughs, and what that looks like.
//
// The economy already answers the first half -- workedCells fills the labour
// available into the best-returning tiles at HELD_HECTARE_DAYS a hectare --
// and this mirrors its arithmetic for the renderer, which cannot afford to
// solve a full catchment for every village on screen. The mirror is the
// INFIELD reading: the worked area as one disc around the village, nearest
// ground first, which is close to the economy's own ranking because distance
// is already in its cost of working a tile, and closer still to the medieval
// reality, where the manured land nearest the tofts was worked first and
// hardest.
//
// The DIVERGENCE is labelled here so nobody discovers it as a bug: the
// economy may pick a rich far tile over a poor near one, and the picture will
// show the near one ploughed. The fix is not in the picture -- it is carting
// cost pressed harder in the economy's ranking, and it is on the gaps list.
//
// THE STRIPS THEMSELVES are measured. Ridge-and-furrow survives in thousands
// of English pastures precisely because it was permanent earthwork: the
// ridges run three to ten metres crest to crest, five being the ordinary
// broad rig, and every strip in a furlong runs the same way because a plough
// team turns badly.

import * as A from '../anchors.ts';
import { HELD_HECTARE_DAYS_IRON } from './labour.ts';

/** Crest to crest, metres. The ordinary broad rig of the excavations. */
export const RIDGE_WAVELENGTH_M = 5;

/**
 * Below this productivity nobody ploughs: the seed returned would not repay
 * the labour. The margin of cultivation, as a round figure on the npp field
 * the climate model already computes.
 */
export const PLOUGH_NPP_FLOOR = 150;

/**
 * Hectares a settlement's hands actually work, mirroring workedCells: the
 * labour available at the given farm share, spread at the iron-tool rate.
 * The wooden-tool rate is higher and the mirror assumes iron, as the
 * catchment search does -- a village short of iron works less land, and the
 * picture will run slightly ahead of it. Labelled, not hidden.
 */
export function workedHa(population: number, farmShare: number): number {
  const labour = ((population * A.WORKERS_PER_FAMILY) / 5)
    * A.WORKING_DAYS_PER_YEAR * Math.max(0, Math.min(1, farmShare));
  return labour / HELD_HECTARE_DAYS_IRON;
}

/** The radius of the disc that holds the worked hectares, metres. */
export function fieldRadiusM(population: number, farmShare: number): number {
  return Math.sqrt((workedHa(population, farmShare) * 10000) / Math.PI);
}

/** How many ridges cross a sample cell of the given width. */
export function ridgesAcross(spacingM: number): number {
  return Math.max(1, Math.round(spacingM / RIDGE_WAVELENGTH_M));
}
