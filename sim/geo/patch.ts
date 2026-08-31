// Which lattice a sub-map is built on, and how many cells it holds.
//
// There are two now. A hexagonal cell is filled with hexgrid's 91 hexagons; a
// PENTAGONAL cell is filled with pentgrid's 76, because a hexagon of hexagons
// does not fit inside a pentagon and clipping the overhang away only hides it.
//
// Everything below the world map used to be able to assume 91, and it did, in
// a hundred and forty-five places. This is the seam that assumption gets
// replaced by: a map carries its patch, and the patch answers how many cells it
// has, where they sit, and what touches what.
//
// WHERE THE PENTAGONS ARE, which is the part worth reading twice.
//
// Ten world cells are pentagons. Their sub-maps are pentagonal -- but so is the
// sub-map of the CENTRE cell of one of those, and the centre of that, forever.
// The pentagonal patch has exactly one five-neighbour cell and it is at index
// 0, so the defect does not spread sideways: it runs straight down the middle
// of a pentagon's descendants and nowhere else. That is the same self-similar
// structure H3 has, and it is why an address is pentagonal exactly when it
// begins at a pentagon and every step after is the centre.
//
// So at every depth there are ten pentagon-rooted maps and no more, out of 480,
// then 43,680, then four million. The defect does not multiply; the world grows
// around it.

import {
  SUBCELL_COUNT, RADIUS, subNeighbours, toPixel, fromPixel, ringOf,
} from './hexgrid.ts';
import {
  PENT_SUBCELL_COUNT, PENT_RADIUS, pentNeighbours, pentCentres,
  pentFromPoint, pentRing,
} from './pentgrid.ts';
import { isPentagon } from './sphere.ts';
import type { Address } from './address.ts';

const SQRT3 = Math.sqrt(3);

export interface Patch {
  /** Hexagonal or pentagonal, for anything that must branch on it. */
  readonly sides: 5 | 6;
  /** How many cells this patch holds: 91 or 76. */
  readonly count: number;
  /** Rings from the centre to the rim. The same for both, by design. */
  readonly radius: number;
  /** Six neighbour slots per cell, -1 where there is none. */
  readonly neighbours: Int32Array;
  /**
   * A cell's centre in patch units, where `size` is the circumradius the
   * patch is being drawn at.
   */
  centre(cell: number, size: number): { x: number; y: number };
  /** The cell containing a point in patch units, or -1 beyond the rim. */
  at(x: number, y: number, size: number): number;
  /** Rings out from the centre. Drives edge blending. */
  ring(cell: number): number;
}

export const HEX_PATCH: Patch = {
  sides: 6,
  count: SUBCELL_COUNT,
  radius: RADIUS,
  neighbours: subNeighbours,
  centre: (cell, size) => toPixel(cell, size),
  at: (x, y, size) => fromPixel(x, y, size),
  ring: (cell) => ringOf(cell),
};

export const PENT_PATCH: Patch = {
  sides: 5,
  count: PENT_SUBCELL_COUNT,
  radius: PENT_RADIUS,
  neighbours: pentNeighbours,
  // `size` MEANS THE SAME THING IN BOTH: a cell's circumradius.
  //
  // hexgrid's toPixel takes it that way, and adjacent cells there come out
  // sqrt(3) x size apart. pentgrid stores its centres in ring units, where
  // adjacent cells are 1.0 apart. So the ring unit is sqrt(3) x size, and
  // without that factor a pentagon's children would be laid out at 58% of the
  // spacing its siblings use -- the kind of mismatch that looks like a
  // rendering bug three layers further down.
  centre: (cell, size) => ({
    x: pentCentres[cell * 2] * SQRT3 * size,
    y: pentCentres[cell * 2 + 1] * SQRT3 * size,
  }),
  at: (x, y, size) => pentFromPoint(x / (SQRT3 * size), y / (SQRT3 * size)),
  ring: (cell) => pentRing[cell],
};

/**
 * The patch a map at this address is built on.
 *
 * Pentagonal exactly when the address starts at a pentagon and every step after
 * it is the centre cell -- index 0, which is where pentgrid puts its single
 * five-neighbour cell. Step off the centre once and every map below is
 * hexagonal for ever, because a hexagonal patch has no pentagon in it to
 * continue the line.
 */
export function patchFor(address: Address | readonly number[]): Patch {
  if (address.length === 0) return HEX_PATCH;
  if (!isPentagon(address[0])) return HEX_PATCH;
  for (let i = 1; i < address.length; i++) if (address[i] !== 0) return HEX_PATCH;
  return PENT_PATCH;
}

/**
 * A cell's circumradius in the map at this address, in projection units.
 *
 * Walked rather than raised to a power. It used to be `CELL_R / sqrt(91)^depth`
 * -- correct while every layer divided by 91 -- and a pentagonal layer divides
 * by 76, so the exponent has to be replaced by a walk that asks each layer what
 * it actually did. A branch that passes through one pentagon is 9% coarser at
 * every layer below it than one that does not, and that is the honest answer:
 * the pentagon really is smaller and really does hold fewer children.
 *
 * The world cell's own radius comes first, scaled by how big that cell is --
 * pentagons are 0.679 of the mean area, so 0.824 of the mean radius.
 */
export function cellRadiusForAddress(
  address: Address | readonly number[],
  worldCellR: number,
  scale: number,
): number {
  let r = worldCellR * scale;
  for (let i = 1; i <= address.length; i++) {
    r /= Math.sqrt(patchFor(address.slice(0, i)).count);
  }
  return r;
}

/**
 * How many cells the map at this address holds.
 *
 * The replacement for reading SUBCELL_COUNT and assuming it applies. Where a
 * caller has the map itself, `map.patch.count` says the same thing without a
 * lookup.
 */
export function cellCountFor(address: Address | readonly number[]): number {
  return patchFor(address).count;
}
