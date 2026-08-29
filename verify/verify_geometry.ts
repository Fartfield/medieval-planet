// Geometry: the claims the whole world rests on.
//
// If the globe has the wrong number of cells, or a neighbour relation is not
// symmetric, or a click lands on the cell next to the one under the cursor,
// nothing above it can be right. These run first and cost milliseconds.

import {
  CELL_COUNT, PENTAGON_COUNT, COLS, ROWS, BAND_SIN_LIMIT, CELL_R,
  centres, neighbours, neighbourCount,
  isPentagon, cellAt, distance, latLon, outline,
} from '../sim/geo/sphere.ts';
import {
  RADIUS, SUBCELL_COUNT, subNeighbours, coords, indexOf,
  hexDistance, ringOf, toPixel, fromPixel,
} from '../sim/geo/hexgrid.ts';
import {
  toKey, fromKey, addressSeed, child, parent, equals, GROUND_DEPTH, MAX_DEPTH,
} from '../sim/geo/address.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

suite('the world map has no pentagons', () => {
  // A hex grid that wraps east to west, laid out in longitude and the sine of
  // latitude. That projection is Lambert cylindrical and Lambert is EQUAL-AREA
  // -- the area element on a sphere is cos(lat)·dlat·dlon and d(sin lat) is
  // cos(lat)·dlat -- so equal area in the grid is exactly equal area on the
  // sphere, and every cell is worth the same as every other.
  //
  // This replaced a Goldberg polyhedron, which carries exactly twelve
  // pentagons because Euler says it must: with three faces at each vertex, F
  // hexagons give E = 3F and V = 2F, so V - E + F = 0 where a closed surface
  // needs 2. At 92 cells the twelve were one region in eight.
  check('cell count', CELL_COUNT, COLS * ROWS, 0);
  check('columns are three times the rows', COLS, 3 * ROWS, 0);

  // THE HEADLINE. Not "few" pentagons: none.
  let fives = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (neighbourCount(c) === 5) fives++;
  measure('cells with five neighbours', fives);
  check('there are no pentagons', fives, 0, 0);
  check('and the module agrees', PENTAGON_COUNT, 0, 0);
  let claimed = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (isPentagon(c)) claimed++;
  check('isPentagon says so too', claimed, 0, 0);

  // Every cell has six neighbours except the two rows against the ice caps,
  // which have four. Nothing has three or five: the grid is regular, and the
  // only irregularity is the boundary.
  let six = 0, four = 0, other = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const n = neighbourCount(c);
    if (n === 6) six++; else if (n === 4) four++; else other++;
  }
  measure('cells with six neighbours', six);
  measure('cells against an ice cap', four);
  check('nothing has any other number of neighbours', other, 0, 0);
  check('the cap rows are the top and bottom', four, 2 * COLS, 0);

  // The wrap has to close, or the world has a seam down it.
  const westOfFirst = neighbours[0 * 6 + 3];
  const eastOfLast = neighbours[(COLS - 1) * 6 + 0];
  check('going west from column zero reaches the last column', westOfFirst, COLS - 1, 0);
  check('and going east from the last returns to zero', eastOfLast, 0, 0);

  // Adjacency must be symmetric or every flood fill in the project is wrong.
  let asymmetric = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    for (let i = 0; i < 6; i++) {
      const n = neighbours[c * 6 + i];
      if (n < 0) continue;
      let back = false;
      for (let j = 0; j < 6; j++) if (neighbours[n * 6 + j] === c) back = true;
      if (!back) asymmetric++;
    }
  }
  check('adjacency is symmetric', asymmetric, 0, 0);

  // Centres must be unit vectors; the climate model reads latitude straight
  // off the y component and would drift if they were not normalised.
  let worstNorm = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const x = centres[c * 3], y = centres[c * 3 + 1], z = centres[c * 3 + 2];
    worstNorm = Math.max(worstNorm, Math.abs(Math.sqrt(x * x + y * y + z * z) - 1));
  }
  check('centres are unit vectors', worstNorm, 0, 1e-12);

  let wrong = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (cellAt(centres[c * 3], centres[c * 3 + 1], centres[c * 3 + 2]) !== c) wrong++;
  }
  check('cellAt recovers a cell from its own centre', wrong, 0, 0);

  // A point over a cap has no cell, so it gets the nearest one, which must be
  // in the top row and not somewhere arbitrary.
  const overPole = cellAt(0, 1, 0);
  assert('a point over the pole lands in the top row', overPole >= (ROWS - 1) * COLS);
  const poleLat = (latLon(overPole).lat * 180) / Math.PI;
  measure('latitude of the cell nearest the pole', poleLat);
  assert('which is in the far north', poleLat > 40);

  // How far the grid reaches, against the polar circle it happens to land on.
  const bandLat = (Math.asin(BAND_SIN_LIMIT) * 180) / Math.PI;
  measure('latitude the grid reaches', bandLat);
  measure('fraction of the sphere that is gridded', BAND_SIN_LIMIT);
  assert('the ice caps are small', BAND_SIN_LIMIT > 0.85);
  assert('and the grid stops short of the pole', BAND_SIN_LIMIT < 0.98);

  // EQUAL AREA, which is the property the whole economy leans on. Every cell
  // covers the same solid angle: the gridded band over the cell count.
  const bandArea = 4 * Math.PI * BAND_SIN_LIMIT;
  const perCell = bandArea / CELL_COUNT;
  const area = perCell * A.EARTH_RADIUS_M ** 2;
  measure('region area km2', area / 1e6);
  measure('region across km', (2 * Math.sqrt(area / ((3 * Math.sqrt(3)) / 2))) / 1000);

  // Checked against the outlines rather than asserted: a cell's area from its
  // own corners, by spherical excess, must be the same everywhere.
  let minArea = Infinity, maxArea = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const poly = outline(c);
    // Planar area in the projection, which is where the cells are regular.
    let a2 = 0;
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      const ax = Math.atan2(poly[i * 3 + 2], poly[i * 3]);
      const ay = poly[i * 3 + 1];
      const bx = Math.atan2(poly[j * 3 + 2], poly[j * 3]);
      const by = poly[j * 3 + 1];
      // Longitudes wrap; take the short way round.
      let dx = bx - ax;
      if (dx > Math.PI) dx -= 2 * Math.PI;
      if (dx < -Math.PI) dx += 2 * Math.PI;
      a2 += dx * (ay + by);
    }
    const cellArea = Math.abs(a2) / 2;
    minArea = Math.min(minArea, cellArea);
    maxArea = Math.max(maxArea, cellArea);
  }
  measure('smallest cell area, steradians', minArea);
  measure('largest cell area, steradians', maxArea);
  check('every cell has the same area', maxArea / minArea, 1.0, 1e-9);

  // Spacing is uniform east to west by construction, and varies north to
  // south only as the projection stretches. A three-to-one spread would mean
  // the layout went wrong.
  let minStep = Infinity, maxStep = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    for (let i = 0; i < 6; i++) {
      const n = neighbours[c * 6 + i];
      if (n < 0) continue;
      const d = distance(c, n, A.EARTH_RADIUS_M);
      minStep = Math.min(minStep, d);
      maxStep = Math.max(maxStep, d);
    }
  }
  measure('closest neighbour km', minStep / 1000);
  measure('furthest neighbour km', maxStep / 1000);
  assert('no neighbour is absurdly far', maxStep / minStep < 3.5);

  // Six corners on everything. There is nothing else any more.
  let badOutline = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (outline(c).length / 3 !== 6) badOutline++;
  check('every cell has six corners', badOutline, 0, 0);
  measure('cell circumradius in projection units', CELL_R);
});

suite('sub-map', () => {
  check('sub-map radius', RADIUS, 5, 0);
  check('sub-map cell count', SUBCELL_COUNT, 91, 0);
  // 91 is the nearest hexagonal number to a hundred: r=5 gives 91, r=6 gives
  // 127. Nine per cent under is as close as a hexagon of hexagons comes.
  check('sub-map is within 10% of a hundred',
    Math.abs(SUBCELL_COUNT - 100) / 100, 0, 0.10);

  // Every cell must round-trip through its axial coordinates.
  let badRoundTrip = 0;
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    if (indexOf(coords[c * 2], coords[c * 2 + 1]) !== c) badRoundTrip++;
  }
  check('axial coordinates round-trip', badRoundTrip, 0, 0);

  // Symmetric adjacency again, and edge cells must lose neighbours rather
  // than wrap onto the far side of the map.
  let asymmetric = 0;
  let edgeCells = 0;
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    let missing = 0;
    for (let d = 0; d < 6; d++) {
      const n = subNeighbours[c * 6 + d];
      if (n < 0) { missing++; continue; }
      const back = subNeighbours[n * 6 + ((d + 3) % 6)];
      if (back !== c) asymmetric++;
    }
    if (missing > 0) edgeCells++;
  }
  check('sub-map adjacency is symmetric', asymmetric, 0, 0);
  // The outer ring of a radius-57 hexagon is 6*57 cells.
  check('cells on the rim', edgeCells, 6 * RADIUS, 0);

  check('centre cell is index of (0,0)', ringOf(indexOf(0, 0)), 0, 0);
  check('rim cell ring equals radius', ringOf(indexOf(RADIUS, 0)), RADIUS, 0);
  check('distance across the map', hexDistance(indexOf(-RADIUS, 0), indexOf(RADIUS, 0)), 2 * RADIUS, 0);

  // Pixel round-trip: a click at a cell's centre must return that cell.
  let badPick = 0;
  for (let c = 0; c < SUBCELL_COUNT; c += 13) {
    const p = toPixel(c, 10);
    if (fromPixel(p.x, p.y, 10) !== c) badPick++;
  }
  check('pixel round-trip picks the right cell', badPick, 0, 0);

  // And a click anywhere inside a hexagon, not just dead centre.
  let badJitter = 0;
  for (let c = 0; c < SUBCELL_COUNT; c += 53) {
    const p = toPixel(c, 10);
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2]]) {
      if (fromPixel(p.x + dx, p.y + dy, 10) !== c) badJitter++;
    }
  }
  check('clicks inside a hexagon pick that hexagon', badJitter, 0, 0);
});

suite('address', () => {
  const cases: number[][] = [[0], [91], [88, 42], [88, 42, 90], [1, 2, 3, 4, 5, 6, 7, 8]];
  let bad = 0;
  for (const a of cases) if (!equals(fromKey(toKey(a)), a)) bad++;
  check('address keys round-trip', bad, 0, 0);

  // Eight levels of two base-36 characters plus seven dots.
  check('a full-depth key stays short', toKey([91, 90, 90, 90, 90, 90, 90, 90]).length, 23, 2);
  assert('parent of a child is the original', equals(parent(child([88, 42], 55)), [88, 42]));

  // Address seeds must decorrelate: neighbouring addresses are the common case
  // and must not produce neighbouring seeds, or the terrain will band.
  const seeds = new Set<number>();
  let lowBitRuns = 0;
  let prev = -1;
  for (let i = 0; i < 4000; i++) {
    const s = addressSeed(12345, [88, 42, 7, 3, 60, i], 0);
    seeds.add(s);
    if (prev >= 0 && (s & 0xff) === (prev & 0xff)) lowBitRuns++;
    prev = s;
  }
  check('address seeds are distinct', seeds.size, 4000, 0);
  check('adjacent addresses do not share low bits', lowBitRuns, 0, 40);

  // The scale ladder itself, as a measurement rather than a comment.
  const groundCells = CELL_COUNT * SUBCELL_COUNT ** GROUND_DEPTH;
  measure('total ground tiles', groundCells);
  measure('ground tile area m2', (4 * Math.PI * A.EARTH_RADIUS_M ** 2) / groundCells);
  measure('finest layer area m2',
    (4 * Math.PI * A.EARTH_RADIUS_M ** 2) / (CELL_COUNT * SUBCELL_COUNT ** (MAX_DEPTH - 1)));
});
