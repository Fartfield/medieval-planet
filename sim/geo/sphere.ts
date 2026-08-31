// The world map: a geodesic grid, with the storms standing on two of its defects.
//
// WHY THIS IS NOT A WRAPPED BAND ANY MORE
//
// It was, and a band has no pentagons at all -- a cylinder has Euler
// characteristic zero, so nothing forces them. That was the whole reason for
// it. What a band cannot do is keep the cells the same SHAPE: the projection
// is Lambert cylindrical, which buys exact equal area by stretching everything
// towards the poles, and the stretch is 1/cos^2(latitude). Measured on the
// 39x14 band that stood here: 1.01:1 at the equator, 1.63:1 at 39 degrees,
// 2.56:1 at 50, and 5.60:1 in the outermost row. Every cell had identical area
// and no two of them looked alike.
//
// You cannot have all three of uniform shape, uniform area, and no pentagons.
// That is not an implementation limit, it is two theorems:
//
//   * GAUSS (Theorema Egregium). A sphere has curvature and a flat hexagonal
//     lattice does not, so no arrangement of congruent hexagons lies on a
//     sphere without distorting something. Distortion is compulsory; the only
//     choice is where to spend it.
//   * EULER. Tile a closed surface with hexagons and pentagons, three meeting
//     at each corner, and V - E + F = 2 forces exactly twelve pentagons --
//     whatever the resolution, however they are arranged.
//
// The band spent its distortion on shape and paid nothing to Euler. This grid
// does the opposite: cells are near-regular everywhere and there are twelve
// pentagons.
//
// AND TWO OF THE TWELVE ARE FREE. The icosahedron is oriented with a vertex at
// each pole, so two of the pentagons sit exactly where the storm caps are --
// ungridded, undrawn, part of no map. Ten remain, on the rings at 26.57 degrees
// north and south, which is 2.1% of the cells here against the 13% they were
// when this project last had them.
//
// THE CAPS ARE UNCHANGED, which is the constraint this was built to. Discarding
// each pole cell and the ring of five around it leaves the grid stopping near
// 77.6 degrees -- the same edge the band had, reached a different way. See
// docs/world-lore.md.

import { dsin, dcos, datan2, PI } from '../gen/mathx.ts';

/**
 * Subdivision frequency: each icosahedron edge is cut into this many.
 *
 * Solved from the caps rather than picked. A class-I geodesic has 10f^2 + 2
 * cells, and discarding a pole plus its five neighbours takes six per pole --
 * the smallest removal that keeps the five-fold symmetry without reaching the
 * next ring out. Six of 492 is 1.22% of the sphere per cap, which is a cap of
 * about 12.7 degrees against the 12.42 the band left. Frequency 8 would give
 * 642 cells and, removing the same six, a cap of 11.1 -- eleven per cent
 * narrow.
 *
 * 480 cells after the caps, against the band's 546. Regions come out 13.7%
 * larger in consequence, and so does every tile below them.
 */
export const FREQUENCY = 7;

/** Cells in the closed tiling, before the caps are taken out of it. */
const FULL_COUNT = 10 * FREQUENCY * FREQUENCY + 2;

/**
 * How far from each pole the storms take, in degrees.
 *
 * Ten degrees takes the pole cell and the ring of five around it -- the first
 * ring sits at 63.435/7 = 9.06 degrees -- which is the same six cells the
 * previous "pole and its neighbours" rule removed. Written as a DISTANCE
 * because that is the thing being decided; the ring structure is how the grid
 * happens to answer it, and at another frequency the same distance takes a
 * different number of rings.
 */
const CAP_REMOVE_DEG = 10;

const SQRT3 = Math.sqrt(3);
/** Area of a regular hexagon of circumradius 1. */
const HEX_AREA = (3 * SQRT3) / 2;

interface Grid {
  count: number;
  centres: Float64Array;
  neighbours: Int32Array;
  pentagon: Uint8Array;
  stormEdge: Uint8Array;
  radiusScale: Float64Array;
  /** Every cell of the closed tiling, caps included. Outlines need them. */
  fullCentres: Float64Array;
  fullNeighbours: Int32Array;
  /** The full-tiling index of each kept cell. */
  toFull: Int32Array;
  gridSinLimit: number;
  capSinLimit: number;
  capRadiusRad: number;
}

const grid = build();

export const CELL_COUNT = grid.count;
export const centres = grid.centres;

/**
 * Neighbour ids, six per cell, in cyclic order around it.
 *
 * A -1 means either a pentagon's missing sixth, or a neighbour that is inside a
 * storm and so is not a cell. The order is the load-bearing part: `outline`
 * walks consecutive pairs to build corners, and a shuffled list would give a
 * self-crossing star rather than a hexagon.
 */
export const neighbours = grid.neighbours;

/** Ten. Two of Euler's twelve are inside the storms and are not cells here. */
export const PENTAGON_COUNT = 10;

/**
 * How big this cell is, as a multiplier on `CELL_R`.
 *
 * `CELL_R` is the AVERAGE cell's circumradius, and the cells are near-uniform
 * -- but the ten pentagons are 0.679 of the mean area, so a sub-map sized for
 * the average overflows a pentagon by 28% in each direction. Measured before
 * this existed: a pentagon's children reached 1.278 times its own outline,
 * covering 63% more ground than the cell they were subdividing.
 *
 * The renderer clipped that away and it looked fine, which is exactly why it
 * needed measuring rather than looking at: the tiles were being generated for
 * ground the cell does not own, so a pentagon's economy was being run on the
 * wrong acreage.
 *
 * Square root, because it scales a radius against an area.
 */
export function cellRadiusScale(cell: number): number {
  return grid.radiusScale[cell];
}

/**
 * Whether a cell actually touches a storm.
 *
 * NOT the same question as "has a -1 among its neighbours", which is the trap:
 * a pentagon has a -1 in its unused sixth slot and touches nothing. Asking the
 * wrong one counts all ten pentagons -- which sit at 26.57 degrees, about as
 * far from a storm as a cell gets -- as being on the rim, and a check that no
 * cell bordering a storm is land then fails on tropical farmland.
 */
export function bordersStorm(cell: number): boolean {
  return grid.stormEdge[cell] === 1;
}

/**
 * A layer-0 cell's circumradius, in the projection's units.
 *
 * The ladder below is still laid out in (longitude, sine of latitude). That did
 * not change with the tiling, and it is what lets a sub-map be a flat hexagon
 * of hexagons wherever on the globe it sits. What changed is that a world cell
 * is no longer itself a hexagon in that projection, so this can no longer be
 * read off the wrap arithmetic.
 *
 * Solved from the AREA instead: the circumradius of the projection-space
 * hexagon with the same area as an average cell. Equal-area is what makes that
 * legitimate -- the projection preserves area exactly, so matching area in
 * projection units matches it on the sphere, and every calibrated figure below
 * this layer goes on meaning what it meant.
 *
 * Fed the band's own numbers this formula returns the band's own constant to
 * five figures, which is the check that it is the same quantity measured a
 * different way rather than a new one.
 */
export const CELL_R = Math.sqrt((4 * PI) / FULL_COUNT / HEX_AREA);

/**
 * Where the grid stops, and where a storm may be drawn up to.
 *
 * Two numbers, because the edge is ragged now. A band ended in a row and had a
 * single edge; a geodesic ends in a ring of hexagon sides, whose corners reach
 * further than its edge midpoints. The storm disc is drawn to the INNER extent
 * and the cells paint over it -- the same trick the band's notch line used, for
 * the same reason: matching a ragged edge with a circle leaves a row of gaps.
 */
export const GRID_SIN_LIMIT = grid.gridSinLimit;
export const CAP_SIN_LIMIT = grid.capSinLimit;

/** What the renderer always actually wanted: where do the storms begin. */
export const BAND_SIN_LIMIT = grid.capSinLimit;

/**
 * The angular radius of a disc covering the same area as one storm cap.
 *
 * The cap's real boundary is a ring of hexagon sides around a five-fold vertex,
 * so it is pentagon-ish rather than round: 9.0 degrees across the flats and
 * 13.5 to the points. Raising the grid's frequency does not fix that -- at
 * frequency 9 the out-of-round ratio is 1.50, exactly what it is at 7, because
 * the five-fold symmetry is the icosahedron's and not the resolution's.
 *
 * So the renderer draws a storm of THIS radius over the top, with a soft edge.
 * A storm has a diffuse edge in any case, and a diffuse edge is what hides a
 * boundary that no amount of subdividing will make circular.
 */
export const CAP_RADIUS_RAD = grid.capRadiusRad;

// ---------------------------------------------------------------------------

export function isPentagon(cell: number): boolean {
  return grid.pentagon[cell] === 1;
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

/**
 * Which cell holds a direction.
 *
 * A band could invert its projection and answer in closed form. A geodesic
 * cannot: its cells are the spherical Voronoi diagram of the geodesic vertices,
 * and there is no formula for which one a point falls in.
 *
 * So a coarse lookup gets near and a hill climb finishes exactly. The climb is
 * what makes this exact rather than approximate: Voronoi cells on a sphere are
 * convex, so "step to whichever neighbour is nearer, until none is" cannot halt
 * anywhere but the true nearest. The table only decides how few steps that
 * takes, which means a coarse table costs speed and never correctness.
 */
const LUT_LON = 256;
const LUT_LAT = 128;
const lut = buildLut();

export function cellAt(x: number, y: number, z: number): number {
  const lon = datan2(z, x);
  const u = Math.min(LUT_LON - 1, Math.max(0,
    Math.floor(((lon + PI) / (2 * PI)) * LUT_LON)));
  const v = Math.min(LUT_LAT - 1, Math.max(0,
    Math.floor(((Math.max(-1, Math.min(1, y)) + 1) / 2) * LUT_LAT)));
  return climb(lut[v * LUT_LON + u], x, y, z);
}

function climb(from: number, x: number, y: number, z: number): number {
  let best = from;
  let bestDot = centres[best * 3] * x + centres[best * 3 + 1] * y + centres[best * 3 + 2] * z;
  for (;;) {
    let moved = -1;
    for (let i = 0; i < 6; i++) {
      const n = neighbours[best * 6 + i];
      if (n < 0) continue;
      const d = centres[n * 3] * x + centres[n * 3 + 1] * y + centres[n * 3 + 2] * z;
      if (d > bestDot) { bestDot = d; moved = n; }
    }
    if (moved < 0) return best;
    best = moved;
  }
}

function buildLut(): Int32Array {
  const table = new Int32Array(LUT_LON * LUT_LAT);
  let guess = 0;
  for (let v = 0; v < LUT_LAT; v++) {
    const sinLat = ((v + 0.5) / LUT_LAT) * 2 - 1;
    const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
    for (let u = 0; u < LUT_LON; u++) {
      const lon = ((u + 0.5) / LUT_LON) * 2 * PI - PI;
      // Seeded from the previous entry, which is next door, so each climb is a
      // step or two rather than a search.
      guess = climb(guess, cosLat * dcos(lon), sinLat, cosLat * dsin(lon));
      table[v * LUT_LON + u] = guess;
    }
  }
  return table;
}

/** Cell outlines, built lazily -- only the client ever needs them. */
let outlines: (Float64Array | null)[] | null = null;

/**
 * A cell's outline: the corners it shares with its neighbours.
 *
 * Each corner is equidistant from three touching cells and is taken as the
 * normalised sum of their three centres. Two neighbours therefore compute the
 * same corner from the same three cells, so the tiling closes by construction
 * rather than by tolerance -- the same guarantee the band had, carried through
 * the change of tiling.
 *
 * Built from the FULL tiling, caps included. A cell on a storm's edge has
 * neighbours that are no longer cells, but they still have positions, and using
 * them gives that cell a complete hexagon reaching properly into the storm
 * rather than a gap-toothed one stopping short of it.
 *
 * Five corners for a pentagon. Callers step the array by threes and do not care.
 */
export function outline(cell: number): Float64Array {
  if (outlines === null) outlines = new Array(CELL_COUNT).fill(null);
  const known = outlines[cell];
  if (known !== null && known !== undefined) return known;

  const f = grid.toFull[cell];
  const around: number[] = [];
  for (let i = 0; i < 6; i++) {
    const n = grid.fullNeighbours[f * 6 + i];
    if (n >= 0) around.push(n);
  }

  const poly = new Float64Array(around.length * 3);
  for (let i = 0; i < around.length; i++) {
    const a = around[i];
    const b = around[(i + 1) % around.length];
    const cx = grid.fullCentres[f * 3] + grid.fullCentres[a * 3] + grid.fullCentres[b * 3];
    const cy = grid.fullCentres[f * 3 + 1] + grid.fullCentres[a * 3 + 1] + grid.fullCentres[b * 3 + 1];
    const cz = grid.fullCentres[f * 3 + 2] + grid.fullCentres[a * 3 + 2] + grid.fullCentres[b * 3 + 2];
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    poly[i * 3] = cx / len;
    poly[i * 3 + 1] = cy / len;
    poly[i * 3 + 2] = cz / len;
  }
  outlines[cell] = poly;
  return poly;
}

// ---------------------------------------------------------------------------
// Construction.

function build(): Grid {
  const { verts, faces } = icosahedron();

  // --- subdivide, sharing the points along face boundaries -----------------
  //
  // Keyed on rounded coordinates. Two faces meeting along an edge generate the
  // same points there from the same corner vectors in the same order, so the
  // arithmetic agrees bit for bit and the rounding is a formality rather than a
  // tolerance being leaned on.
  const index = new Map<string, number>();
  const points: number[][] = [];

  const add = (x: number, y: number, z: number): number => {
    const len = Math.sqrt(x * x + y * y + z * z);
    const nx = x / len, ny = y / len, nz = z / len;
    const k = `${Math.round(nx * 1e9)},${Math.round(ny * 1e9)},${Math.round(nz * 1e9)}`;
    const hit = index.get(k);
    if (hit !== undefined) return hit;
    const id = points.length;
    points.push([nx, ny, nz]);
    index.set(k, id);
    return id;
  };

  const adjacency: Set<number>[] = [];
  const touch = (a: number, b: number): void => {
    while (adjacency.length < points.length) adjacency.push(new Set<number>());
    adjacency[a].add(b);
    adjacency[b].add(a);
  };

  const m = FREQUENCY;
  for (const face of faces) {
    const A = verts[face[0]], B = verts[face[1]], C = verts[face[2]];
    // EQUAL ARC, not equal chord.
    //
    // The obvious subdivision walks the flat triangle in even steps and pushes
    // each point out to the sphere. That bunches points towards the corners,
    // because a chord of fixed length subtends less angle the further it lies
    // from the middle of an edge -- and the corners are exactly where the
    // twelve pentagons are. Measured on the chord version: a pentagon's
    // neighbours sat 7.90 degrees off against a hexagon's 9.95, and the
    // pentagon came out half the area of a hexagon.
    //
    // Slerping puts the points at equal ANGLES instead, so the first step from
    // a corner is 63.435/7 = 9.06 degrees and the compression goes with it.
    //
    // Rows step away from A: row i runs from a point on AB to the matching
    // point on AC and holds i + 1 points. Getting that layout wrong -- slerping
    // between the wrong pair of edges -- collapses points onto each other, and
    // the giveaway was 478 cells instead of 492 with a neighbour spacing of
    // zero.
    const id: number[][] = [];
    for (let i = 0; i <= m; i++) {
      const row: number[] = [];
      if (i === 0) {
        row.push(add(A[0], A[1], A[2]));
      } else {
        const P = slerp(A, B, i / m);
        const Q = slerp(A, C, i / m);
        for (let k = 0; k <= i; k++) {
          const r = slerp(P, Q, k / i);
          row.push(add(r[0], r[1], r[2]));
        }
      }
      id.push(row);
    }
    for (let i = 0; i < m; i++) {
      for (let k = 0; k <= i; k++) {
        // The downward triangle every point carries, and the upward one that
        // fills the gap between consecutive downward ones.
        touch(id[i][k], id[i + 1][k]);
        touch(id[i][k], id[i + 1][k + 1]);
        touch(id[i + 1][k], id[i + 1][k + 1]);
        if (k < i) touch(id[i][k], id[i][k + 1]);
      }
    }
  }
  while (adjacency.length < points.length) adjacency.push(new Set<number>());

  const n = points.length;
  if (n !== FULL_COUNT) {
    throw new Error(`geodesic came out ${n} cells, expected ${FULL_COUNT}`);
  }

  const fullCentres = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    fullCentres[i * 3] = points[i][0];
    fullCentres[i * 3 + 1] = points[i][1];
    fullCentres[i * 3 + 2] = points[i][2];
  }

  // --- neighbours, put into cyclic order -----------------------------------
  const fullNeighbours = new Int32Array(n * 6).fill(-1);
  orderNeighbours(fullCentres, fullNeighbours, n, adjacency);

  // NO RELAXATION HERE, and it was tried. Lloyd's algorithm -- move every cell
  // to the centroid of its own corners, repeat -- is the standard way to even
  // out a point set on a sphere, and it made this WORSE: the area spread went
  // from 2.264 to 2.509 and the pentagons shrank from 0.513 of the mean to
  // 0.438. The reason is that Lloyd's needs the true Voronoi diagram
  // recomputed each pass, and these corners are the dual of a FIXED
  // triangulation. Once the points move, the corners are no longer the cell's
  // own boundary, so the iteration converges confidently to the wrong shape.
  // See docs/fix-attempts.md.

  // --- take the storms out --------------------------------------------------
  const keep = new Uint8Array(n).fill(1);
  const cut = Math.cos((CAP_REMOVE_DEG * PI) / 180);
  for (const sign of [1, -1]) {
    for (let c = 0; c < n; c++) {
      if (fullCentres[c * 3 + 1] * sign >= cut) keep[c] = 0;
    }
  }

  const toKept = new Int32Array(n).fill(-1);
  let count = 0;
  for (let c = 0; c < n; c++) if (keep[c] === 1) toKept[c] = count++;
  const toFull = new Int32Array(count);
  for (let c = 0; c < n; c++) if (keep[c] === 1) toFull[toKept[c]] = c;

  const outCentres = new Float64Array(count * 3);
  const outNeighbours = new Int32Array(count * 6).fill(-1);
  const pentagon = new Uint8Array(count);
  const stormEdge = new Uint8Array(count);
  for (let k = 0; k < count; k++) {
    const f = toFull[k];
    outCentres[k * 3] = fullCentres[f * 3];
    outCentres[k * 3 + 1] = fullCentres[f * 3 + 1];
    outCentres[k * 3 + 2] = fullCentres[f * 3 + 2];
    let slot = 0;
    let degree = 0;
    for (let i = 0; i < 6; i++) {
      const nb = fullNeighbours[f * 6 + i];
      if (nb < 0) continue;
      degree++;
      if (keep[nb] === 1) outNeighbours[k * 6 + slot++] = toKept[nb];
      else stormEdge[k] = 1;
    }
    pentagon[k] = degree === 5 ? 1 : 0;
  }

  // --- how big each cell actually is ---------------------------------------
  //
  // From its own corners, by the shoelace in (longitude, sine of latitude):
  // that projection is equal-area, so an area measured in its units IS the
  // solid angle, with no conversion.
  const radiusScale = new Float64Array(count);
  const meanSolid = (4 * PI) / FULL_COUNT;
  let covered = 0;
  for (let k = 0; k < count; k++) {
    const f = toFull[k];
    const around: number[] = [];
    for (let i = 0; i < 6; i++) {
      const nb = fullNeighbours[f * 6 + i];
      if (nb >= 0) around.push(nb);
    }
    let a2 = 0;
    for (let i = 0; i < around.length; i++) {
      const a = around[i], b = around[(i + 1) % around.length];
      const nx = around[(i + 1) % around.length];
      const cx1 = fullCentres[f * 3] + fullCentres[a * 3] + fullCentres[b * 3];
      const cy1 = fullCentres[f * 3 + 1] + fullCentres[a * 3 + 1] + fullCentres[b * 3 + 1];
      const cz1 = fullCentres[f * 3 + 2] + fullCentres[a * 3 + 2] + fullCentres[b * 3 + 2];
      const l1 = Math.sqrt(cx1 * cx1 + cy1 * cy1 + cz1 * cz1) || 1;
      const j = (i + 1) % around.length;
      const a2b = around[j], b2b = around[(j + 1) % around.length];
      const cx2 = fullCentres[f * 3] + fullCentres[a2b * 3] + fullCentres[b2b * 3];
      const cy2 = fullCentres[f * 3 + 1] + fullCentres[a2b * 3 + 1] + fullCentres[b2b * 3 + 1];
      const cz2 = fullCentres[f * 3 + 2] + fullCentres[a2b * 3 + 2] + fullCentres[b2b * 3 + 2];
      const l2 = Math.sqrt(cx2 * cx2 + cy2 * cy2 + cz2 * cz2) || 1;
      const ax = datan2(cz1 / l1, cx1 / l1), ay = cy1 / l1;
      const bx = datan2(cz2 / l2, cx2 / l2), by = cy2 / l2;
      let dx = bx - ax;
      if (dx > PI) dx -= 2 * PI;
      if (dx < -PI) dx += 2 * PI;
      a2 += dx * (ay + by);
    }
    const solid = Math.abs(a2) / 2;
    covered += solid;
    radiusScale[k] = Math.sqrt(solid / meanSolid);
  }

  // THE CAP'S HONEST SIZE: the angular radius of a disc with the area the
  // storms actually cover. The boundary is a ring of hexagon sides and is not
  // a circle -- measured, it runs from 9.0 to 13.5 degrees, half again as far
  // in one direction as another -- so no single radius describes it. This is
  // the one that gets the AREA right, which is what "the same size as before"
  // was asking about, and it is what the renderer feathers around.
  const capSolid = (4 * PI - covered) / 2;
  const capRadiusRad = Math.acos(1 - capSolid / (2 * PI));

  // --- where the storms begin, measured off the corners ---------------------
  let gridSinLimit = 0;
  let capSinLimit = 1;
  for (let k = 0; k < count; k++) {
    const f = toFull[k];
    let onEdge = false;
    const around: number[] = [];
    for (let i = 0; i < 6; i++) {
      const nb = fullNeighbours[f * 6 + i];
      if (nb < 0) continue;
      around.push(nb);
      if (keep[nb] === 0) onEdge = true;
    }
    if (!onEdge) continue;
    for (let i = 0; i < around.length; i++) {
      const a = around[i], b = around[(i + 1) % around.length];
      const cx = fullCentres[f * 3] + fullCentres[a * 3] + fullCentres[b * 3];
      const cy = fullCentres[f * 3 + 1] + fullCentres[a * 3 + 1] + fullCentres[b * 3 + 1];
      const cz = fullCentres[f * 3 + 2] + fullCentres[a * 3 + 2] + fullCentres[b * 3 + 2];
      const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
      const s = Math.abs(cy / len);
      if (s > gridSinLimit) gridSinLimit = s;
      if (s < capSinLimit) capSinLimit = s;
    }
  }

  return {
    count,
    centres: outCentres,
    neighbours: outNeighbours,
    pentagon,
    stormEdge,
    radiusScale,
    fullCentres,
    fullNeighbours,
    toFull,
    gridSinLimit,
    capSinLimit,
    capRadiusRad,
  };
}

/**
 * Sort each cell's neighbours into cyclic order around it.
 *
 * Order is load-bearing: `outline` walks consecutive pairs to make corners, so
 * a shuffled list gives a self-crossing star rather than a hexagon -- and the
 * relaxation below reads those same corners, so it would relax towards a star.
 */
function orderNeighbours(
  centresIn: Float64Array,
  out: Int32Array,
  n: number,
  adjacency: Set<number>[],
): void {
  for (let c = 0; c < n; c++) {
    const px = centresIn[c * 3], py = centresIn[c * 3 + 1], pz = centresIn[c * 3 + 2];
    // Any tangent frame will do; only the ordering it induces is used.
    let ex = -pz, ey = 0, ez = px;
    let len = Math.sqrt(ex * ex + ez * ez);
    if (len < 1e-9) { ex = 1; ey = 0; ez = 0; len = 1; }
    ex /= len; ey /= len; ez /= len;
    const fx = py * ez - pz * ey;
    const fy = pz * ex - px * ez;
    const fz = px * ey - py * ex;

    const ring = [...adjacency[c]].map((nb) => {
      const dx = centresIn[nb * 3] - px;
      const dy = centresIn[nb * 3 + 1] - py;
      const dz = centresIn[nb * 3 + 2] - pz;
      return { nb, a: datan2(dx * fx + dy * fy + dz * fz, dx * ex + dy * ey + dz * ez) };
    });
    ring.sort((p, q) => p.a - q.a);
    for (let i = 0; i < 6; i++) out[c * 6 + i] = i < ring.length ? ring[i].nb : -1;
  }
}

/**
 * Great-circle interpolation between two unit vectors.
 *
 * Two faces sharing an edge generate the same points along it, but from their
 * own ends -- slerp(A,B,t) against slerp(B,A,1-t) -- which is the same value
 * summed in the other order and so need not agree in the last bit. The
 * rounding in `add` absorbs that, and here it is doing real work rather than
 * being the formality it was when both faces walked the chord identically.
 */
function slerp(u: number[], v: number[], t: number): number[] {
  const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [u[0], u[1], u[2]];
  const s0 = dsin((1 - t) * omega);
  const s1 = dsin(t * omega);
  const k = 1 / dsin(omega);
  return [
    (s0 * u[0] + s1 * v[0]) * k,
    (s0 * u[1] + s1 * v[1]) * k,
    (s0 * u[2] + s1 * v[2]) * k,
  ];
}

/**
 * An icosahedron with a vertex at each pole.
 *
 * The orientation is the whole point. The twelve vertices become the twelve
 * pentagons, and putting two of them on the axis puts two pentagons inside the
 * storm caps, where nothing is gridded and nothing is drawn. The other ten land
 * on the rings at latitude +/- 26.565 degrees -- arctan(1/2), which is where an
 * icosahedron's vertices sit however it is turned.
 */
function icosahedron(): { verts: number[][]; faces: number[][] } {
  const sinRing = 1 / Math.sqrt(5);
  const cosRing = 2 / Math.sqrt(5);

  const verts: number[][] = [[0, 1, 0]];
  for (let k = 0; k < 5; k++) {
    const lon = (k * 2 * PI) / 5;
    verts.push([cosRing * dcos(lon), sinRing, cosRing * dsin(lon)]);
  }
  for (let k = 0; k < 5; k++) {
    const lon = ((k + 0.5) * 2 * PI) / 5;
    verts.push([cosRing * dcos(lon), -sinRing, cosRing * dsin(lon)]);
  }
  verts.push([0, -1, 0]);

  // Upper ring vertex k sits at longitude 72k; lower ring vertex k at 72k + 36,
  // so each upper vertex falls between lower k-1 and lower k, and each lower
  // vertex between upper k and upper k+1. The twenty faces follow from that.
  const faces: number[][] = [];
  for (let k = 0; k < 5; k++) {
    const up = 1 + k;
    const upNext = 1 + ((k + 1) % 5);
    const lo = 6 + k;
    const loPrev = 6 + ((k + 4) % 5);
    faces.push([0, up, upNext]);
    faces.push([11, 6 + ((k + 1) % 5), lo]);
    faces.push([up, loPrev, lo]);
    faces.push([lo, up, upNext]);
  }
  return { verts, faces };
}
