// Finding somewhere to stand, for the suites.
//
// A ground address is six numbers deep now, so no test can write one down. It
// has to descend, and every suite needs the same descent, so it lives here.
//
// The descent picks the most productive land at each layer. That is not the
// same as picking the best *tile* -- productivity at the shire layer is an
// average over 670 km², and the best tile inside it may be anywhere -- but it
// reliably lands somewhere green rather than on an ice cap, which is all a
// test site has to do.

import { World } from '../sim/world.ts';
import { GROUND_DEPTH } from '../sim/geo/address.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { SUBCELL_COUNT } from '../sim/geo/hexgrid.ts';
import { yieldsFor } from '../sim/gen/submap.ts';
import type { BiomeId } from '../sim/model/biome.ts';

/** The most productive region on the globe, or the most productive of a biome. */
export function bestRegion(w: World, biome?: BiomeId): number {
  let best = -1;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (w.planet.elevationM[c] <= 0) continue;
    if (biome !== undefined && w.planet.biome[c] !== biome) continue;
    if (best < 0 || w.planet.nppGm2[c] > w.planet.nppGm2[best]) best = c;
  }
  return best;
}

/**
 * Descend from a region to a ground-layer address, following grain yield.
 *
 * It used to follow net primary productivity and switch to yield only on the
 * last step, and its own comment said why that was wrong -- a wet hillside
 * out-produces a dry field and will not feed anybody -- without applying the
 * argument to the earlier steps.
 *
 * It survived because it was being carried. Drainage was a rank within each
 * map, so wherever the productivity descent landed, the tile arrived holding a
 * mid-rank alluvial bonus and yielded well enough. When drainage became an
 * absolute discharge and the bonus went to real floodplains only, the descent
 * put its reference settlement on a wet hillside and the site yield fell 72%
 * while the best tile available fell 39%. The gap between those two numbers is
 * the whole finding: the world got a third poorer and the chooser got worse.
 */
export function groundSiteIn(w: World, region: number): number[] {
  let address: number[] = [region];

  while (address.length <= GROUND_DEPTH) {
    const map = w.subMap(address);
    let pick = -1;

    const ys = yieldsFor(map);
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      if (map.elevationM[c] < 0) continue;
      if (pick < 0 || ys[c] > ys[pick]) pick = c;
    }
    // Every cell under water: take the highest and carry on, so the descent
    // always terminates with a real address rather than throwing.
    if (pick < 0) {
      pick = 0;
      for (let c = 0; c < SUBCELL_COUNT; c++) {
        if (map.elevationM[c] > map.elevationM[pick]) pick = c;
      }
    }
    address = [...address, pick];
  }
  return address;
}

/** The best farmland the suites can find, as a ground address. */
export function bestFarmSite(w: World): number[] {
  return groundSiteIn(w, bestRegion(w));
}

/** What that site yields, kg of grain per hectare per year. */
export function yieldAt(w: World, address: number[]): number {
  const map = w.subMap(address.slice(0, -1));
  return yieldsFor(map)[address[address.length - 1]];
}

/**
 * A ground cell in the same sub-map as `address`, chosen by a scoring
 * function. Used to find a poor tile with ore next to a good farm.
 */
export function siblingIn(
  w: World,
  address: number[],
  score: (yieldKgPerHa: number, cell: number, addr: number[]) => number,
): number[] | null {
  const parent = address.slice(0, -1);
  const map = w.subMap(parent);
  const ys = yieldsFor(map);
  let best = -1;
  let bestScore = -Infinity;

  for (let c = 0; c < SUBCELL_COUNT; c++) {
    if (map.elevationM[c] < 0) continue;
    const s = score(ys[c], c, [...parent, c]);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best < 0 || bestScore === -Infinity ? null : [...parent, best];
}
