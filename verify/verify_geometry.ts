// Geometry: the claims the whole world rests on.
//
// If the globe has the wrong number of cells, or a neighbour relation is not
// symmetric, or a click lands on the cell next to the one under the cursor,
// nothing above it can be right. These run first and cost milliseconds.

import {
  CELL_COUNT, PENTAGON_COUNT, FREQUENCY, centres, neighbours, neighbourCount,
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

suite('sphere', () => {
  check('cell count', CELL_COUNT, 92, 0);
  check('subdivision frequency', FREQUENCY, 3, 0);

  // Euler's formula is why there are twelve pentagons and not zero. If this
  // ever fails the subdivision has produced something that is not a sphere.
  let edges = 0;
  let pentagons = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const n = neighbourCount(c);
    edges += n;
    if (n === 5) pentagons++;
  }
  edges /= 2;
  const faces = (2 * edges) / 3; // every triangle has three edges, every edge two triangles
  check('pentagon count', pentagons, PENTAGON_COUNT, 0);
  check('Euler characteristic', CELL_COUNT - edges + faces, 2, 0);
  measure('edge count', edges);

  // The twelve pentagons must be the twelve icosahedron vertices, because the
  // generator relies on isPentagon being a cheap id comparison.
  let mismatched = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (isPentagon(c) !== (neighbourCount(c) === 5)) mismatched++;
  }
  check('isPentagon agrees with neighbour count', mismatched, 0, 0);

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

  // Greedy descent must land on the true nearest cell every time, or picking
  // is wrong somewhere on the globe and only sometimes.
  let wrong = 0;
  for (let t = 0; t < 400; t++) {
    const c = (t * 977) % CELL_COUNT;
    const found = cellAt(centres[c * 3], centres[c * 3 + 1], centres[c * 3 + 2]);
    if (found !== c) wrong++;
  }
  check('cellAt recovers a cell from its own centre', wrong, 0, 0);

  // The nearest cell to the pole, not a cell *at* the pole. At 92 regions a
  // cell is 2,900 km across, so its centre can be twelve degrees off the pole
  // and still be the nearest -- the old tolerance of a thousandth of a degree
  // only passed because 10,242 cells put one almost exactly there.
  const poleCell = cellAt(0, 1, 0);
  const poleLat = (latLon(poleCell).lat * 180) / Math.PI;
  measure('latitude of the cell nearest the pole', poleLat);
  assert('the cell nearest the pole is in the far north', poleLat > 60);

  // Cell area, cross-checked two ways: the sphere's area over the cell count,
  // against the ladder in docs/architecture.md.
  const area = (4 * Math.PI * A.EARTH_RADIUS_M ** 2) / CELL_COUNT;
  measure('region area km2', area / 1e6);
  measure('region across km', (2 * Math.sqrt(area / ((3 * Math.sqrt(3)) / 2))) / 1000);

  // Neighbour spacing should be tight -- a Goldberg polyhedron is not perfectly
  // regular, but a 3:1 spread would mean the subdivision went wrong.
  let minStep = Infinity, maxStep = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    for (let i = 0; i < neighbourCount(c); i++) {
      const d = distance(c, neighbours[c * 6 + i], A.EARTH_RADIUS_M);
      minStep = Math.min(minStep, d);
      maxStep = Math.max(maxStep, d);
    }
  }
  measure('closest neighbour km', minStep / 1000);
  measure('furthest neighbour km', maxStep / 1000);
  check('neighbour spacing is near-uniform', maxStep / minStep, 1.0, 0.35);

  // Outlines: five corners on a pentagon, six everywhere else.
  let badOutline = 0;
  for (let c = 0; c < CELL_COUNT; c += 37) {
    if (outline(c).length / 3 !== neighbourCount(c)) badOutline++;
  }
  check('outline corner count matches neighbour count', badOutline, 0, 0);
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
