// The sub-map: one hexagon filled with 9,919 smaller hexagons.
//
// WHY THIS IS FLAT
//
// Only the globe needs spherical geometry. An L0 cell is 277 km across, and
// over that span the Earth's curvature distorts a flat projection by about
// 0.06% -- less than the rounding in any number the economy uses. So every
// layer below the globe is an ordinary flat hex field, which means no
// pentagons, no seams, no projection, and exact arithmetic all the way down.
// The twelve pentagons exist on layer zero and never propagate.
//
// WHY 9,919 AND NOT 10,000
//
// The design asked for 100x100. A 100x100 rhombus of hexes would work but it
// nests badly: a rhombus inside a hexagon leaves the corners ragged, and the
// player zooming in would see a diamond floating in a hexagon. A hexagon of
// hexagons nests the way the eye expects. Hexagonal numbers go
// 3r^2 + 3r + 1, and r = 57 gives 9,919 -- 0.8% under ten thousand, which is
// closer than the globe layer manages and invisible at any zoom.
//
// COORDINATES
//
// Axial (q, r), with the third cube coordinate s = -q-r implied. A cell is
// inside the map when none of |q|, |r|, |s| exceeds the radius. Axial is worth
// the small strangeness because distance is one line and the six neighbour
// directions are constants rather than a parity table -- offset coordinates
// need different neighbour offsets on odd and even rows, and that asymmetry
// has bitten every hex game that chose it.

export const RADIUS = 5;
export const SUBCELL_COUNT = 3 * RADIUS * RADIUS + 3 * RADIUS + 1; // 91

const SPAN = RADIUS * 2 + 1;

/** Axial coordinates by index, packed as [q0, r0, q1, r1, ...]. */
export const coords = new Int16Array(SUBCELL_COUNT * 2);

/** Reverse lookup: (q + RADIUS) * SPAN + (r + RADIUS) -> index, or -1. */
const lookup = new Int32Array(SPAN * SPAN).fill(-1);

/** The six axial neighbour directions, in a fixed order used everywhere. */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

/** Neighbour index by cell and direction, or -1 when it leaves the sub-map. */
export const subNeighbours = new Int32Array(SUBCELL_COUNT * 6).fill(-1);

build();

function build(): void {
  let i = 0;
  for (let q = -RADIUS; q <= RADIUS; q++) {
    const lo = Math.max(-RADIUS, -q - RADIUS);
    const hi = Math.min(RADIUS, -q + RADIUS);
    for (let r = lo; r <= hi; r++) {
      coords[i * 2] = q;
      coords[i * 2 + 1] = r;
      lookup[(q + RADIUS) * SPAN + (r + RADIUS)] = i;
      i++;
    }
  }
  if (i !== SUBCELL_COUNT) {
    throw new Error(`sub-map enumerated ${i} cells, expected ${SUBCELL_COUNT}`);
  }

  for (let c = 0; c < SUBCELL_COUNT; c++) {
    const q = coords[c * 2];
    const r = coords[c * 2 + 1];
    for (let d = 0; d < 6; d++) {
      subNeighbours[c * 6 + d] = indexOf(q + DIRECTIONS[d][0], r + DIRECTIONS[d][1]);
    }
  }
}

/** Index of an axial coordinate, or -1 if it falls outside the hexagon. */
export function indexOf(q: number, r: number): number {
  if (q < -RADIUS || q > RADIUS || r < -RADIUS || r > RADIUS) return -1;
  const s = -q - r;
  if (s < -RADIUS || s > RADIUS) return -1;
  return lookup[(q + RADIUS) * SPAN + (r + RADIUS)];
}

export function q(cell: number): number {
  return coords[cell * 2];
}

export function r(cell: number): number {
  return coords[cell * 2 + 1];
}

/** Steps between two cells. In cube coordinates this is just the L-infinity
 *  norm halved -- one of the reasons axial is worth the strangeness. */
export function hexDistance(a: number, b: number): number {
  const aq = coords[a * 2];
  const ar = coords[a * 2 + 1];
  const bq = coords[b * 2];
  const br = coords[b * 2 + 1];
  return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
}

/** Distance from the centre of the sub-map, in steps. Drives edge blending. */
export function ringOf(cell: number): number {
  const cq = coords[cell * 2];
  const cr = coords[cell * 2 + 1];
  return (Math.abs(cq) + Math.abs(cq + cr) + Math.abs(cr)) / 2;
}

/**
 * Pointy-top axial to pixel, for the renderer only.
 *
 * `size` is the hexagon's circumradius -- centre to corner, not centre to
 * edge. Getting those two confused is the classic hex bug and shows up as a
 * grid with hairline gaps that only appear at some zoom levels.
 */
/**
 * The position of an axial coordinate, whether or not it is inside the map.
 *
 * `toPixel` needs a cell index and so cannot answer for a neighbour that falls
 * outside the hexagon -- which is exactly the neighbour a rim cell is missing.
 * The lattice extends past the map even though the array does not.
 */
export function pixelOfAxial(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

export function toPixel(cell: number, size: number): { x: number; y: number } {
  const cq = coords[cell * 2];
  const cr = coords[cell * 2 + 1];
  return {
    x: size * Math.sqrt(3) * (cq + cr / 2),
    y: size * 1.5 * cr,
  };
}

/** Pixel back to the nearest cell index, for picking. Cube-rounds, so a click
 *  anywhere in a hexagon lands on that hexagon and never on its neighbour. */
export function fromPixel(x: number, y: number, size: number): number {
  const fr = (y * 2) / 3 / size;
  const fq = (x / (size * Math.sqrt(3))) - fr / 2;
  const fs = -fq - fr;

  let rq = Math.round(fq);
  let rr = Math.round(fr);
  const rs = Math.round(fs);
  const dq = Math.abs(rq - fq);
  const dr = Math.abs(rr - fr);
  const ds = Math.abs(rs - fs);
  // Discard whichever coordinate moved furthest, so that q + r + s stays zero.
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;

  return indexOf(rq, rr);
}

// The corner offsets a renderer needs to draw a hexagon used to live here and
// now live in client/src/render.ts. They needed Math.cos and Math.sin, which
// verify_purity.ts forbids anywhere under sim/ -- and rather than grant this
// file an exception, the function moved to where it belonged. Drawing a shape
// is not simulating one. The exception would have been harmless and the rule
// is only worth having if it does not accumulate them.
