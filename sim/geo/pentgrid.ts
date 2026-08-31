// The sub-map of a PENTAGON: one pentagon filled with 76 smaller cells.
//
// WHY THIS EXISTS
//
// Ten of the world map's 480 cells are pentagons -- Euler's twelve, less the
// two that sit inside the storms. Every one of them was being filled with the
// hexagonal patch from hexgrid.ts, which is a hexagon of 91 hexagons, and a
// hexagon does not fit inside a pentagon. The renderer clipped the overhang
// away, so it looked survivable and was not: the tiles were being generated for
// ground the cell does not own, and the clip hid it.
//
// THE SAME CONSTRUCTION AS THE HEXAGONAL PATCH, WITH FIVE SIDES
//
// A patch of radius R around a cell of N sides has concentric rings, ring i
// holding N.i cells -- i per side -- so the total is
//
//     1 + N.(1 + 2 + ... + R)  =  1 + N.R.(R+1)/2
//
// At N=6, R=5 that is 91, which is exactly hexgrid's count and not a
// coincidence: the hexagonal patch is this construction's six-sided case. At
// N=5 it is 76, the centred pentagonal number.
//
// WHAT IT COSTS, and it is worth stating rather than discovering later. A
// pentagon cell is 0.679 of the mean cell's area, so 76 children make each
// pentagon tile 19% smaller in area than a hexagon tile. That is better than
// the 32% it was when a pentagon got 91 children squeezed into it, and it is
// not zero. No child count makes it zero: the ideal is 0.679 x 91 = 62, and the
// centred pentagonal numbers either side are 51 and 76. 76 is the closer, and
// it keeps the ring depth the same as the hexagonal patch so the two ladders
// stay the same length.
//
// COORDINATES
//
// Not axial. Axial coordinates work because a hex lattice has three axes at 120
// degrees and a fixed neighbour table; a five-fold lattice has no such thing --
// that is the whole reason pentagons are defects. So a cell here is addressed
// by (ring, step): which ring out from the centre, and how far round it. The
// centre is ring 0, step 0.

import { dsin, dcos, PI } from '../gen/mathx.ts';

/** Rings out from the centre. The same depth the hexagonal patch uses. */
export const PENT_RADIUS = 5;

/** Sides. The whole difference from hexgrid. */
const SIDES = 5;

export const PENT_SUBCELL_COUNT = 1 + (SIDES * PENT_RADIUS * (PENT_RADIUS + 1)) / 2; // 76

/** Ring index by cell, and step within that ring. */
export const pentRing = new Int16Array(PENT_SUBCELL_COUNT);
export const pentStep = new Int16Array(PENT_SUBCELL_COUNT);

/** Where the first cell of each ring sits in the index. */
const ringStart = new Int32Array(PENT_RADIUS + 2);

/**
 * Cell centres in patch units, packed xy, where 1.0 is one ring's spacing.
 *
 * Ring i is the outline of a regular pentagon scaled by i, with i cells evenly
 * spaced along each of its five sides. That is what makes the patch fill a
 * PENTAGON rather than a disc -- putting the rings on circles instead would
 * space the cells just as evenly and leave the corners empty.
 */
export const pentCentres = new Float64Array(PENT_SUBCELL_COUNT * 2);

/** Up to six neighbours per cell, -1 where there is none. */
export const pentNeighbours = new Int32Array(PENT_SUBCELL_COUNT * 6).fill(-1);

build();

function build(): void {
  let i = 0;
  for (let ring = 0; ring <= PENT_RADIUS; ring++) {
    ringStart[ring] = i;
    const count = ring === 0 ? 1 : SIDES * ring;
    for (let step = 0; step < count; step++) {
      pentRing[i] = ring;
      pentStep[i] = step;

      if (ring === 0) {
        pentCentres[i * 2] = 0;
        pentCentres[i * 2 + 1] = 0;
      } else {
        // Which side of the ring, and how far along it.
        const side = Math.floor(step / ring);
        const along = (step % ring) / ring;
        const a0 = (side * 2 * PI) / SIDES;
        const a1 = ((side + 1) * 2 * PI) / SIDES;
        const x0 = ring * dcos(a0), y0 = ring * dsin(a0);
        const x1 = ring * dcos(a1), y1 = ring * dsin(a1);
        pentCentres[i * 2] = x0 + (x1 - x0) * along;
        pentCentres[i * 2 + 1] = y0 + (y1 - y0) * along;
      }
      i++;
    }
  }
  ringStart[PENT_RADIUS + 1] = i;

  if (i !== PENT_SUBCELL_COUNT) {
    throw new Error(`pentagon patch enumerated ${i} cells, expected ${PENT_SUBCELL_COUNT}`);
  }

  buildNeighbours();
}

/**
 * Adjacency, by proximity rather than by a direction table.
 *
 * A hex lattice has six fixed neighbour offsets and hexgrid uses them. This
 * lattice has no fixed offsets -- ring i has 5i cells and ring i+1 has 5(i+1),
 * so the two do not line up and no constant table can describe the join. What
 * IS true is that neighbours are the cells about one spacing away, so they are
 * found by distance.
 *
 * The threshold is 1.45 spacings. Within a ring the gap is 1.0 by
 * construction; between rings it is 1.0 at the corners and stretches towards
 * the middle of a side, and 1.45 admits that without reaching the ring beyond.
 * verify_geometry checks what this produces: five neighbours at the centre,
 * five or six everywhere inside, and reciprocity throughout.
 */
function buildNeighbours(): void {
  const limit = 1.45 * 1.45;
  for (let a = 0; a < PENT_SUBCELL_COUNT; a++) {
    const near: { cell: number; d: number }[] = [];
    for (let b = 0; b < PENT_SUBCELL_COUNT; b++) {
      if (b === a) continue;
      const dx = pentCentres[b * 2] - pentCentres[a * 2];
      const dy = pentCentres[b * 2 + 1] - pentCentres[a * 2 + 1];
      const d = dx * dx + dy * dy;
      if (d <= limit) near.push({ cell: b, d });
    }
    // Nearest first, and never more than six: a cell with seven candidates has
    // picked up a diagonal, and taking the closest six drops it.
    near.sort((p, q) => p.d - q.d || p.cell - q.cell);
    for (let k = 0; k < 6 && k < near.length; k++) pentNeighbours[a * 6 + k] = near[k].cell;
  }

  // Reciprocity, imposed rather than hoped for. Distance is symmetric but the
  // "closest six" cut is not: A may keep B while B's six are all nearer than A.
  // An edge that only one end believes in would break every walk over this
  // lattice, so the belief is dropped.
  for (let a = 0; a < PENT_SUBCELL_COUNT; a++) {
    for (let k = 0; k < 6; k++) {
      const b = pentNeighbours[a * 6 + k];
      if (b < 0) continue;
      let mutual = false;
      for (let j = 0; j < 6; j++) if (pentNeighbours[b * 6 + j] === a) mutual = true;
      if (!mutual) pentNeighbours[a * 6 + k] = -1;
    }
  }
}

/** How many neighbours a cell actually has. */
export function pentNeighbourCount(cell: number): number {
  let n = 0;
  for (let i = 0; i < 6; i++) if (pentNeighbours[cell * 6 + i] >= 0) n++;
  return n;
}

/** The index of a (ring, step), or -1 if there is no such cell. */
export function pentIndexOf(ring: number, step: number): number {
  if (ring < 0 || ring > PENT_RADIUS) return -1;
  const count = ring === 0 ? 1 : SIDES * ring;
  if (step < 0 || step >= count) return -1;
  return ringStart[ring] + step;
}

/**
 * The patch cell nearest a point, in patch units, or -1 beyond the rim.
 *
 * Scanned rather than inverted. The hexagonal patch can invert its lattice in
 * closed form because axial coordinates are a linear map; this one cannot, for
 * the same reason it has no neighbour table. Seventy-six comparisons is
 * cheaper than being clever, and it is exact.
 */
export function pentFromPoint(x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let c = 0; c < PENT_SUBCELL_COUNT; c++) {
    const dx = pentCentres[c * 2] - x;
    const dy = pentCentres[c * 2 + 1] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  // Beyond the rim by more than half a spacing is outside the patch, not the
  // nearest cell of it.
  return bestD <= 0.75 * 0.75 || best < 0 ? best : -1;
}
