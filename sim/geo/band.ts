// A hex grid wrapped east to west around the sphere, at any resolution.
//
// The world map is one of these and so is the tectonic mesh the world map is
// generated from -- the same construction at 192 cells and at 196,608 -- so it
// lives here rather than twice.
//
// The grid is laid out in (longitude, sine of latitude), which is the Lambert
// cylindrical projection, and Lambert is EQUAL-AREA: the area element on a
// sphere is cos(lat)·dlat·dlon and d(sin lat) is cos(lat)·dlat, so equal area
// in the grid is exactly equal area on the sphere. Every cell is worth the
// same as every other, at every resolution, and a cell count is an area.
//
// Wrapping east to west is what buys a grid with no pentagons in it: a sphere
// cannot be tiled by hexagons -- Euler forces exactly twelve pentagons -- but a
// cylinder can, because its Euler characteristic is zero. The price is that
// the band stops short of the poles and the caps are not gridded.

import { dsin, dcos } from '../gen/mathx.ts';

const SQRT3 = Math.sqrt(3);

export interface Band {
  cols: number;
  rows: number;
  count: number;
  /** A cell's circumradius, in projection units. */
  cellR: number;
  /** How far the band reaches from the equator, as a sine of latitude. */
  sinLimit: number;
  /** Cell centres in the projection: longitude and sine of latitude. */
  lon: Float64Array;
  sinLat: Float64Array;
  /** Cell centres as unit vectors, packed xyz. */
  centres: Float64Array;
  /** Six per cell, in the order E, NE, NW, W, SW, SE. -1 is an ice cap. */
  neighbours: Int32Array;
}

/**
 * Build a band.
 *
 * `cols` must be three times `rows`. That ratio is not chosen for looks: it is
 * what makes the band reach the polar circle, and it drops out of the
 * arithmetic rather than being imposed. The band has to close on itself going
 * east, so `cols` cells of horizontal spacing sqrt(3)·r come to 2π and r is
 * fixed; `rows` rows of vertical spacing 1.5·r then reach
 * 2.7207·rows/cols, which is 0.9069 whenever cols is 3·rows -- latitude 65.05
 * degrees, against a real polar circle at 66.56. The two agreeing is luck.
 */
export function buildBand(cols: number, rows: number): Band {
  const count = cols * rows;
  const cellR = (2 * Math.PI) / (cols * SQRT3);
  const sinLimit = (rows * 1.5 * cellR) / 2;

  const lon = new Float64Array(count);
  const sinLat = new Float64Array(count);
  const centres = new Float64Array(count * 3);
  const neighbours = new Int32Array(count * 6).fill(-1);

  for (let row = 0; row < rows; row++) {
    // Odd rows sit half a cell east, which is what makes a hex grid a hex grid.
    const shift = row & 1;
    const y = -sinLimit + (row + 0.5) * 1.5 * cellR;
    const s = Math.max(-1, Math.min(1, y));
    const cosLat = Math.sqrt(1 - s * s);

    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      const l = (col + shift * 0.5) * SQRT3 * cellR;
      lon[cell] = l;
      sinLat[cell] = y;
      // Deterministic trig: these are cell centres, and the whole world is a
      // pure function of them.
      centres[cell * 3] = cosLat * dcos(l);
      centres[cell * 3 + 1] = s;
      centres[cell * 3 + 2] = cosLat * dsin(l);

      const east = (col + 1) % cols;
      const west = (col + cols - 1) % cols;
      const near = (col + shift) % cols;
      const far = (col + shift + cols - 1) % cols;
      const up = row + 1 < rows ? row + 1 : -1;
      const down = row - 1 >= 0 ? row - 1 : -1;

      neighbours[cell * 6 + 0] = row * cols + east;
      neighbours[cell * 6 + 1] = up < 0 ? -1 : up * cols + near;
      neighbours[cell * 6 + 2] = up < 0 ? -1 : up * cols + far;
      neighbours[cell * 6 + 3] = row * cols + west;
      neighbours[cell * 6 + 4] = down < 0 ? -1 : down * cols + far;
      neighbours[cell * 6 + 5] = down < 0 ? -1 : down * cols + near;
    }
  }

  return { cols, rows, count, cellR, sinLimit, lon, sinLat, centres, neighbours };
}

/**
 * Which cell of a band holds a direction.
 *
 * Inverted directly rather than searched: the projection says which row and
 * column a point lands in. The only care needed is that a hex grid's rows
 * interleave, so the nearest centre may be in the row above or below the one
 * the arithmetic gives -- three rows and two columns each settles it.
 *
 * A point over a cap belongs to no cell and gets the nearest one, because
 * everything upstream wants an answer and the caps are ice: the honest reply at
 * the pole is "the northernmost cell", not "nowhere".
 */
export function bandCellAt(
  b: Band,
  lonRad: number,
  sinLatValue: number,
): number {
  let l = lonRad;
  while (l < 0) l += 2 * Math.PI;
  while (l >= 2 * Math.PI) l -= 2 * Math.PI;

  const rowF = (sinLatValue + b.sinLimit) / (1.5 * b.cellR) - 0.5;
  let best = 0;
  let bestD = Infinity;

  for (let dr = -1; dr <= 1; dr++) {
    const row = Math.max(0, Math.min(b.rows - 1, Math.round(rowF) + dr));
    const shift = (row & 1) * 0.5;
    const colF = l / (SQRT3 * b.cellR) - shift;
    for (let dc = 0; dc <= 1; dc++) {
      const col = (((Math.round(colF) + dc) % b.cols) + b.cols) % b.cols;
      const cell = row * b.cols + col;
      // Distance in the projection, with longitude taken the short way round.
      let dl = b.lon[cell] - l;
      if (dl > Math.PI) dl -= 2 * Math.PI;
      if (dl < -Math.PI) dl += 2 * Math.PI;
      const ds = b.sinLat[cell] - sinLatValue;
      const d = dl * dl + ds * ds;
      if (d < bestD) { bestD = d; best = cell; }
    }
  }
  return best;
}
