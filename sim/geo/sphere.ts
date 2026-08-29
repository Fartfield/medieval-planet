// The world map: a hex grid wrapped around the sphere, with no pentagons in it.
//
// WHY THIS IS NOT A GOLDBERG POLYHEDRON ANY MORE
//
// It was, and a Goldberg polyhedron carries exactly twelve pentagons. That is
// not a choice anyone made, it is Euler: with three faces meeting at every
// vertex, F hexagons give E = 3F edges and V = 2F vertices, so V - E + F = 0
// where a closed surface of genus zero requires 2. Admit pentagons and the
// same arithmetic returns P = 12 exactly, whatever H is. Twelve however fine
// the grid gets, which is why a football has twelve however many hexagons are
// sewn around them.
//
// At 92 cells the twelve were 13% of the world map -- one region in eight --
// and the highest-variance thing on screen. So the tiling changed instead: a
// hex grid that wraps east to west has no pentagons at all, because a cylinder
// has Euler characteristic zero rather than two.
//
// THE PROJECTION IS THE WHOLE TRICK
//
// The grid is laid out in (longitude, sine of latitude) -- the Lambert
// cylindrical projection -- and Lambert is EQUAL-AREA. The area element on a
// sphere is cos(lat)·dlat·dlon, and d(sin lat) = cos(lat)·dlat, so equal area
// in the projection is exactly equal area on the sphere. Not approximately.
//
// That is what makes this a change of tiling rather than a rewrite. Cells are
// still points on the unit sphere, still equal-area, still measured with
// great-circle distances -- so tangent frames, sub-maps, catchments, supply
// ranges and every calibrated number below this layer are untouched. Only
// which points are cell centres has changed.
//
// WHAT IT COSTS
//
// A sphere still will not be tiled by hexagons and this does not tile one: the
// grid covers the band between the polar circles, and the two caps beyond it
// are not gridded at all. Twelve pentagons have become two ice caps, which is
// a better trade than it sounds -- the defects moved from twelve places
// scattered through the temperate world to the two places nobody farms.
//
// Cells also stretch towards the poles. Equal-area guarantees the area and
// says nothing about the shape, so a cell at 60 degrees is taller and narrower
// than one at the equator. That is the distortion every cylindrical map has,
// and it lands on the rows least likely to be looked at.

import { dsin, dcos, datan2, PI } from '../gen/mathx.ts';

const SQRT3 = Math.sqrt(3);

/**
 * Rows of cells between the caps, and columns around the world.
 *
 * COLS is three times ROWS, and that ratio is not chosen for looks: it is what
 * makes the band reach the polar circle, and it drops out of the wrap
 * arithmetic rather than being imposed. See BAND_SIN_LIMIT.
 *
 * 24 by 8 puts 192 cells on the world map against the Goldberg globe's 92.
 * Six rows was closer to the old cell count and too coarse to hold a climate:
 * with only six latitude bands one of them lands squarely on the subtropical
 * desert belt, and the world came out 33.3% desert -- which is exactly two
 * rows in six, and the giveaway. Eight rows straddle the belt instead and the
 * figure falls to 27%, against a target of 19 +/- 10.
 */
export const ROWS = 8;
export const COLS = 3 * ROWS;
export const CELL_COUNT = COLS * ROWS;

/** None. That is the point of this module. */
export const PENTAGON_COUNT = 0;

/**
 * A cell's circumradius in projection units, solved from the wrap.
 *
 * The band has to close on itself exactly going east, so COLS cells of
 * horizontal spacing sqrt(3)·r must come to 2π. Nothing here is free.
 */
export const CELL_R = (2 * Math.PI) / (COLS * SQRT3);

/**
 * How far the grid reaches from the equator, as a sine of latitude.
 *
 * ROWS rows of vertical spacing 1.5·r, half above the equator and half below.
 * With COLS = 3·ROWS the ratio cancels and this is 0.9069 whatever ROWS is,
 * which is latitude 65.05 degrees. **The polar circle is at 66.56 degrees**,
 * set by Earth's 23.44-degree axial tilt -- so the grid ends within a degree
 * and a half of the real boundary of the polar day.
 *
 * That is a coincidence of the arithmetic rather than something imposed, and
 * it is worth saying so plainly. The grid does not stop there because the
 * Arctic is there. It stops there because a hex grid that closes on itself
 * around a sphere, with cells about as tall as they are wide, reaches about
 * that far. The two agreeing is luck, and convenient luck.
 */
export const BAND_SIN_LIMIT = (ROWS * 1.5 * CELL_R) / 2;

/** Cell centres as unit vectors, packed xyz. Index i is at [3i, 3i+1, 3i+2]. */
export const centres = new Float64Array(CELL_COUNT * 3);

/**
 * Neighbour ids, six per cell, packed in the order E, NE, NW, W, SW, SE.
 *
 * A -1 means the ice cap, and only the top and bottom rows have any: two each.
 * Every other cell has six, which is the entire point of the exercise.
 */
export const neighbours = new Int32Array(CELL_COUNT * 6).fill(-1);

build();

// ---------------------------------------------------------------------------

/** Where a cell sits in the projection: longitude, and sine of latitude. */
function projected(cell: number): { lon: number; sinLat: number } {
  const row = Math.floor(cell / COLS);
  const col = cell % COLS;
  // Odd rows sit half a cell east, which is what makes a hex grid a hex grid.
  const lon = (col + (row & 1) * 0.5) * SQRT3 * CELL_R;
  const sinLat = -BAND_SIN_LIMIT + (row + 0.5) * 1.5 * CELL_R;
  return { lon, sinLat };
}

/** A projection point to a unit vector. Latitude is the arcsine of y. */
function toVector(lon: number, sinLat: number, out: Float64Array, at: number): void {
  const s = Math.max(-1, Math.min(1, sinLat));
  const cosLat = Math.sqrt(1 - s * s);
  // Deterministic trig, because these are cell CENTRES: the whole world is a
  // pure function of them, and Math.cos is only approximated by the spec.
  out[at] = cosLat * dcos(lon);
  out[at + 1] = s;
  out[at + 2] = cosLat * dsin(lon);
}

function build(): void {
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    const p = projected(cell);
    toVector(p.lon, p.sinLat, centres, cell * 3);
  }

  // Offset-grid adjacency. The half-cell shift on odd rows moves the two
  // diagonals above and the two below with the row's parity, which is the one
  // place an offset layout is fiddlier than an axial one. It earns that here,
  // because the wrap is then a modulo on the column and nothing else.
  for (let row = 0; row < ROWS; row++) {
    const shift = row & 1;
    for (let col = 0; col < COLS; col++) {
      const cell = row * COLS + col;
      const east = (col + 1) % COLS;
      const west = (col + COLS - 1) % COLS;
      const near = (col + shift) % COLS;
      const far = (col + shift + COLS - 1) % COLS;

      const up = row + 1 < ROWS ? row + 1 : -1;
      const down = row - 1 >= 0 ? row - 1 : -1;

      neighbours[cell * 6 + 0] = row * COLS + east;
      neighbours[cell * 6 + 1] = up < 0 ? -1 : up * COLS + near;
      neighbours[cell * 6 + 2] = up < 0 ? -1 : up * COLS + far;
      neighbours[cell * 6 + 3] = row * COLS + west;
      neighbours[cell * 6 + 4] = down < 0 ? -1 : down * COLS + far;
      neighbours[cell * 6 + 5] = down < 0 ? -1 : down * COLS + near;
    }
  }
}

// ---------------------------------------------------------------------------

/** There are none. Kept so the layers above need not know that. */
export function isPentagon(_cell: number): boolean {
  return false;
}

export function neighbourCount(cell: number): number {
  let n = 0;
  for (let i = 0; i < 6; i++) if (neighbours[cell * 6 + i] >= 0) n++;
  return n;
}

export function centre(cell: number, out: Float64Array): Float64Array {
  out[0] = centres[cell * 3];
  out[1] = centres[cell * 3 + 1];
  out[2] = centres[cell * 3 + 2];
  return out;
}

/**
 * Which cell holds a direction.
 *
 * Inverted directly rather than searched. The projection says which row and
 * column a point lands in; the only care needed is that a hex grid's rows
 * interleave, so the nearest centre may be in the row above or below the one
 * the arithmetic gives. Three rows and two columns each is six candidates and
 * settles it exactly.
 *
 * A point over a cap belongs to no cell. The nearest edge cell is returned
 * rather than a failure, because everything upstream wants an answer and the
 * caps are ice: the honest reply at the pole is "the northernmost cell", not
 * "nowhere".
 */
export function cellAt(x: number, y: number, z: number): number {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) return 0;
  const nx = x / len, ny = y / len, nz = z / len;

  let lon = datan2(nz, nx);
  if (lon < 0) lon += 2 * PI;
  const rowF = (ny + BAND_SIN_LIMIT) / (1.5 * CELL_R) - 0.5;

  let best = 0;
  let bestDot = -2;
  for (let dr = -1; dr <= 1; dr++) {
    const row = Math.max(0, Math.min(ROWS - 1, Math.round(rowF) + dr));
    const shift = (row & 1) * 0.5;
    const colF = lon / (SQRT3 * CELL_R) - shift;
    for (let dc = 0; dc <= 1; dc++) {
      const col = (((Math.round(colF) + dc) % COLS) + COLS) % COLS;
      const cell = row * COLS + col;
      const d = centres[cell * 3] * nx
        + centres[cell * 3 + 1] * ny
        + centres[cell * 3 + 2] * nz;
      if (d > bestDot) { bestDot = d; best = cell; }
    }
  }
  return best;
}

/** Great-circle distance between two cell centres. */
export function distance(a: number, b: number, radiusM: number): number {
  const d = centres[a * 3] * centres[b * 3]
    + centres[a * 3 + 1] * centres[b * 3 + 1]
    + centres[a * 3 + 2] * centres[b * 3 + 2];
  return Math.acos(Math.max(-1, Math.min(1, d))) * radiusM;
}

export function latLon(cell: number): { lat: number; lon: number } {
  const x = centres[cell * 3];
  const y = centres[cell * 3 + 1];
  const z = centres[cell * 3 + 2];
  return { lat: Math.asin(y), lon: Math.atan2(z, x) };
}

/** Cell outlines, built lazily -- only the client ever needs them. */
let outlines: (Float64Array | null)[] | null = null;

/**
 * A cell's outline, as six points on the sphere.
 *
 * The hexagon is regular in the projection, and that is what makes neighbours
 * share their corners exactly: two cells that touch compute the same corner
 * from the same arithmetic, so the tiling closes by construction rather than
 * by tolerance.
 *
 * On the sphere it comes out stretched towards the poles. That is the
 * equal-area projection being honest that you cannot have both the area and
 * the shape, and it is the price of having no pentagons.
 */
export function outline(cell: number): Float64Array {
  if (outlines === null) outlines = new Array(CELL_COUNT).fill(null);
  const known = outlines[cell];
  if (known !== null && known !== undefined) return known;

  const p = projected(cell);
  const poly = new Float64Array(18);
  for (let i = 0; i < 6; i++) {
    // Pointy-top: vertices at 30, 90, 150 degrees and their opposites, so the
    // flat sides face the cell's east and west neighbours.
    const a = ((60 * i + 30) * PI) / 180;
    toVector(p.lon + CELL_R * Math.cos(a), p.sinLat + CELL_R * Math.sin(a), poly, i * 3);
  }
  outlines[cell] = poly;
  return poly;
}
