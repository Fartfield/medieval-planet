// Geometry: the claims the whole world rests on.
//
// If the globe has the wrong number of cells, or a neighbour relation is not
// symmetric, or a click lands on the cell next to the one under the cursor,
// nothing above it can be right. These run first and cost milliseconds.

import {
  CELL_COUNT, PENTAGON_COUNT, FREQUENCY, GRID_SIN_LIMIT, CAP_SIN_LIMIT, CELL_R,
  centres, neighbours, neighbourCount,
  isPentagon, bordersStorm, cellAt, distance, latLon, outline,
} from '../sim/geo/sphere.ts';
import {
  RADIUS, SUBCELL_COUNT, subNeighbours, coords, indexOf,
  hexDistance, ringOf, toPixel, fromPixel,
} from '../sim/geo/hexgrid.ts';
import {
  toKey, fromKey, addressSeed, child, parent, equals, GROUND_DEPTH, MAX_DEPTH,
} from '../sim/geo/address.ts';
import * as A from '../sim/anchors.ts';
import { World } from '../sim/world.ts';
import { cellContaining } from '../sim/gen/submap.ts';
import { MESH_ROWS, MESH_COLS } from '../sim/gen/tectonics.ts';
import {
  PENT_SUBCELL_COUNT, PENT_RADIUS, pentRing, pentCentres,
  pentNeighbours, pentNeighbourCount, pentFromPoint,
} from '../sim/geo/pentgrid.ts';
import { check, measure, assert, suite } from './harness.ts';

/**
 * A cell's solid angle, from its own outline.
 *
 * Shoelace in (longitude, sine of latitude), which IS the solid angle: the
 * projection is equal-area, so an area measured in its units is an area on the
 * sphere with no conversion. Corner count varies now -- five on a pentagon --
 * so it is read off the outline rather than assumed to be six.
 */
function areaOf(cell: number): number {
  const poly = outline(cell);
  const n = poly.length / 3;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
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
  return Math.abs(a2) / 2;
}

/**
 * What share of the sphere the storms cover.
 *
 * Counted rather than integrated: every direction belongs to whichever cell
 * centre is nearest, so sampling directions and asking whether the nearest cell
 * of the FULL tiling was one the storms took gives the fraction directly. A
 * lattice of directions rather than random ones, because nothing here may use
 * Math.random and a lattice converges faster anyway.
 */
function capFraction(): number {
  let covered = 0;
  for (let c = 0; c < CELL_COUNT; c++) covered += areaOf(c);
  return (4 * Math.PI - covered) / (4 * Math.PI) / 2;
}

suite('the world map has ten pentagons, and the storms hold the other two', () => {
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
  // A class-I geodesic has 10f^2 + 2 cells, less the two pole cells and the
  // ring of five around each that the storms take.
  check('cell count', CELL_COUNT, 10 * FREQUENCY * FREQUENCY + 2 - 12, 0);

  // EULER SAYS TWELVE. Two of them are inside the storms, which is the whole
  // reason the icosahedron is oriented with a vertex at each pole.
  check('the pentagons Euler forces, less the two inside the storms',
    PENTAGON_COUNT, 10, 0);

  // They sit at arctan(1/2), where an icosahedron's vertices are however it is
  // turned. Checking the LATITUDE is what confirms the orientation, which is
  // the load-bearing part: turned any other way, all twelve would be visible.
  let offRing = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!isPentagon(c)) continue;
    const lat = Math.abs((Math.asin(centres[c * 3 + 1]) * 180) / Math.PI);
    if (Math.abs(lat - 26.565) > 0.01) offRing++;
  }
  check('every remaining pentagon is on the 26.57 degree ring', offRing, 0, 0);

  measure('grid reaches, degrees', (Math.asin(GRID_SIN_LIMIT) * 180) / Math.PI);
  measure('storm may be drawn to, degrees', (Math.asin(CAP_SIN_LIMIT) * 180) / Math.PI);
  // The caps were the constraint the whole re-tiling was built to: they had to
  // come out the size the band left them. Area is the honest measure of that,
  // the edge being ragged.
  const capArea = capFraction();
  measure('storm cap share of the globe, per cap', capArea);
  check('the caps are the size the band left them', capArea, 0.01167, 0.004);

  // THE HEADLINE, and it is the opposite of what it used to be. This suite once
  // asserted zero pentagons, which a wrapped band could give; the price was
  // cells stretched 5.6:1 at the rim. Uniform cells cost Euler's twelve, and
  // ten of them are here -- the other two are inside the storms.
  let claimed = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (isPentagon(c)) claimed++;
  measure('pentagons on the map', claimed);
  check('ten of Euler’s twelve are on the map', claimed, 10, 0);
  check('and the module agrees', PENTAGON_COUNT, 10, 0);

  // Every cell has six neighbours except the two rows against the ice caps,
  // which have four. Nothing has three or five: the grid is regular, and the
  // only irregularity is the boundary.
  let six = 0, four = 0, other = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const n = neighbourCount(c);
    if (n === 6) six++; else if (n === 4) four++; else other++;
  }
  measure('cells with six neighbours', six);
  measure('cells with fewer, being pentagons or against a storm', CELL_COUNT - six);
  // A geodesic has no rows to close, so the old wrap checks are gone with them.
  // What replaces them is that NOTHING may have more than six: five is a
  // pentagon or a cell that lost a neighbour to a storm, and both are expected,
  // but a seven would mean the adjacency was built wrong.
  let tooMany = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (neighbourCount(c) > 6) tooMany++;
  check('no cell has more than six neighbours', tooMany, 0, 0);
  // Four is a storm-rim cell that lost two neighbours, five is a pentagon or a
  // rim cell that lost one, six is everything else. Three would mean a hole.
  let tooFew = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (neighbourCount(c) < 4) tooFew++;
  check('and none has fewer than four', tooFew, 0, 0);

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
  // on the storm's rim and not somewhere arbitrary.
  const overPole = cellAt(0, 1, 0);
  let bordersStorm = false;
  for (let i = 0; i < 6; i++) if (neighbours[overPole * 6 + i] < 0) bordersStorm = true;
  assert('a point over the pole lands on the storm rim', bordersStorm);
  const poleLat = (latLon(overPole).lat * 180) / Math.PI;
  measure('latitude of the cell nearest the pole', poleLat);
  assert('which is in the far north', poleLat > 40);

  // How far the grid reaches. Ragged now, so both ends of the raggedness are
  // measured rather than one being passed off as the edge.
  measure('latitude the grid reaches', (Math.asin(GRID_SIN_LIMIT) * 180) / Math.PI);
  measure('latitude the storms are drawn to', (Math.asin(CAP_SIN_LIMIT) * 180) / Math.PI);
  assert('the storms are small', CAP_SIN_LIMIT > 0.85);
  assert('and the grid stops short of the pole', GRID_SIN_LIMIT < 0.999);

  // NEARLY EQUAL AREA, which is the property the economy leans on. A band gave
  // this exactly and paid for it in shape; a geodesic gives it to within a few
  // per cent and buys near-regular cells with the difference. The cell-by-cell
  // spread is measured below and is the honest figure -- this is the mean.
  const perCell = (4 * Math.PI) / (10 * FREQUENCY * FREQUENCY + 2);
  const area = perCell * A.EARTH_RADIUS_M ** 2;
  measure('region area km2', area / 1e6);
  measure('region across km', (2 * Math.sqrt(area / ((3 * Math.sqrt(3)) / 2))) / 1000);

  // Checked against the outlines rather than asserted: a cell's area from its
  // own corners, by spherical excess, must be the same everywhere.
  let minArea = Infinity, maxArea = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const cellArea = areaOf(c);
    minArea = Math.min(minArea, cellArea);
    maxArea = Math.max(maxArea, cellArea);
  }
  measure('smallest cell area, steradians', minArea);
  measure('largest cell area, steradians', maxArea);
  measure('cell area spread', maxArea / minArea);

  // NEARLY the same area, which is the trade this tiling made. A band gave
  // exactly equal area and paid in shape; the geodesic gives near-equal both.
  // The hexagons agree to 13%, and the pentagons are smaller because they are
  // where the sphere's curvature is concentrated -- 0.68 of the mean, which is
  // Euler's bill rather than a defect. Measured separately so that a real
  // regression in the hexagons cannot hide behind the pentagons.
  let hexLo = Infinity, hexHi = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (isPentagon(c)) continue;
    const a = areaOf(c);
    hexLo = Math.min(hexLo, a);
    hexHi = Math.max(hexHi, a);
  }
  measure('hexagon area spread', hexHi / hexLo);
  assert('the hexagons are all much of a size', hexHi / hexLo < 1.35);

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
  measure('neighbour distance spread', maxStep / minStep);

  // THE POINT OF THE WHOLE RE-TILING. The band's spread was 3.90 -- its cells
  // had identical area and wildly different shape, 5.60:1 at the outermost row.
  // A geodesic spends its distortion the other way: near-regular cells
  // everywhere, at the price of Euler's twelve pentagons. A spread near 1 is
  // that trade having been made.
  assert('every cell is nearly the same size as every other', maxStep / minStep < 1.35);

  // Six corners on everything but the ten pentagons, which have five.
  let badOutline = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const want = isPentagon(c) ? 5 : 6;
    if (outline(c).length / 3 !== want) badOutline++;
  }
  check('every cell has as many corners as it has neighbours', badOutline, 0, 0);
  measure('cell circumradius in projection units', CELL_R);
});

suite('nothing makes landfall against a storm', () => {
  // The lore constraint, checked rather than asserted in prose: the two caps
  // are permanent storms and the last thing before them is open water. See
  // docs/world-lore.md, and drownStormMargin in sim/gen/tectonics.ts.
  //
  // A cell borders a cap exactly when one of its six neighbours is -1, which
  // is true only in the top and bottom rows. This is the check that would
  // catch the margin being dropped, mis-signed, or applied to the mesh's row
  // height instead of the world's -- the mesh row is a fifteenth the size, so
  // that mistake would leave the outer row very much above water.
  const w = new World({ seed: 20260826 });

  let bordering = 0;
  let borderingLand = 0;
  let highestLand = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    // `bordersStorm`, NOT "has a -1 neighbour". A pentagon has a -1 in its
    // unused sixth slot and touches nothing; asking the wrong question counted
    // all ten of them -- which sit at 26.57 degrees -- as being on the rim, and
    // this check then failed on tropical farmland.
    if (bordersStorm(c)) {
      bordering++;
      if (w.planet.elevationM[c] > 0) borderingLand++;
    }
    if (w.planet.elevationM[c] > 0) {
      const s = Math.abs(centres[c * 3 + 1]);
      if (s > highestLand) highestLand = s;
    }
  }

  measure('world cells bordering a storm', bordering);
  assert('there are cells on the rim to check', bordering > 10);
  check('and none of them is land', borderingLand, 0, 0);

  const latDeg = (Math.asin(highestLand) * 180) / Math.PI;
  measure('highest latitude holding land, degrees', latDeg);
  // The storm rim sits near 73 degrees on this tiling and the drowning reaches
  // down to where those cells' own corners are, about 68. So land has to stop
  // below that. The upper bound is the claim; the lower one guards against the
  // margin eating the whole temperate world, which a sign error would do.
  //
  // Uniform cells bought a climate band back here. The band's outermost row was
  // 21 degrees of latitude tall, so drowning it left no land above 57; the
  // geodesic's rim cells are the same size as any other, so the same rule costs
  // only what is above about 68.
  assert('land stops short of the storms', latDeg < 68.5 && latDeg > 45);

  // The land drowned at the poles comes back further south rather than being
  // lost, because sea level is re-solved to Earth's land fraction afterwards.
  let land = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (w.planet.elevationM[c] > 0) land++;
  measure('world land fraction with the storms in place', land / CELL_COUNT);
  assert('the world did not lose its land to the storms',
    land / CELL_COUNT > 0.2 && land / CELL_COUNT < 0.4);
});

suite('a tile can name what is across its edge', () => {
  // THE HALF OF CROSS-BOUNDARY WORK THAT WAS MISSING. Rivers have crossed an
  // edge for a while and area queries have too, because `cellsWithin` descends
  // from the globe rather than walking sideways. What nothing could do was name
  // the tile ADJACENT to a given one across a boundary -- which is the first
  // thing a road, a border or any pathfinding asks for.
  const w = new World({ seed: 20260826 });
  const map = w.subMap([3]);

  let deep = 0;
  let deepSix = 0;
  let rimLinks = 0;
  let crossing = 0;
  let mutual = 0;
  let mostNeighbours = 0;

  for (let c = 0; c < map.patch.count; c++) {
    const ring = map.patch.ring(c);
    const ns = w.neighboursOf([3, c]);
    mostNeighbours = Math.max(mostNeighbours, ns.length);

    // WELL INSIDE means two rings clear of the rim, not merely "has six
    // lattice neighbours". A hexagon of hexagons covers about 91% of its
    // parent, so the children of two neighbouring parents INTERLEAVE along the
    // seam: measured, a cell three rings out picks up a tile of the next map
    // 0.76 spacings away -- nearer than its own lattice neighbours at 1.00.
    // The intrusion reaches in about two rings and stops.
    if (ring <= PENT_RADIUS - 3) {
      deep++;
      if (ns.length === 6) deepSix++;
      continue;
    }
    if (ring < map.patch.radius) continue;
    for (const n of ns) {
      rimLinks++;
      if (n[0] !== 3) crossing++;
      if (w.neighboursOf(n).some((r) => toKey(r) === toKey([3, c]))) mutual++;
    }
  }

  // Away from a seam nothing has changed: a hexagon has six neighbours.
  measure('tiles well inside the map', deep);
  check('a tile well inside still has exactly six neighbours', deepSix, deep, 0);

  // And near one, it has more. Recorded rather than asserted tightly, because
  // how many depends on how the two lattices happen to meet.
  measure('most neighbours any tile has', mostNeighbours);
  assert('a seam gives a tile more neighbours, not fewer', mostNeighbours > 6);

  measure('links from rim tiles', rimLinks);
  measure('of those, links that cross a map boundary', crossing);
  assert('tiles on a rim do reach across', crossing > 20);

  // SYMMETRY IS THE POINT. Defining a neighbour by DIRECTION -- which cell lies
  // that way -- gave links that did not come back: 44% mutual, because two
  // hexagonal lattices meeting at an arbitrary angle have no mutually-nearest
  // cells, like two brick walls laid askew. An edge that exists one way and not
  // the other is a trap for anything that walks, so adjacency is defined by
  // DISTANCE, which is symmetric whatever the lattices are doing.
  check('every link is mutual', mutual, rimLinks, 0);
});

suite('the pentagon sub-map', () => {
  // Ten of the world's cells are pentagons, and a hexagon of 91 hexagons does
  // not fit inside one. This is the five-sided patch: the same construction as
  // the hexagonal one with N = 5 rather than 6.
  check('cells', PENT_SUBCELL_COUNT, 76, 0);
  check('which is 1 + 5 x (1+2+3+4+5)', PENT_SUBCELL_COUNT, 1 + 5 * 15, 0);

  // Ring i holds exactly 5i cells -- i along each of five sides. Getting this
  // wrong is how a patch ends up a disc with empty corners instead of a
  // pentagon.
  const ringSize = new Map<number, number>();
  for (let c = 0; c < PENT_SUBCELL_COUNT; c++) {
    ringSize.set(pentRing[c], (ringSize.get(pentRing[c]) ?? 0) + 1);
  }
  let ringsRight = ringSize.get(0) === 1;
  for (let r = 1; r <= PENT_RADIUS; r++) if (ringSize.get(r) !== 5 * r) ringsRight = false;
  assert('every ring holds five cells per step out', ringsRight);

  // THE DEFECT IS AT THE CENTRE AND NOWHERE ELSE. That is the whole point of a
  // five-sided patch: the five-fold vertex is the cell being subdivided, so it
  // sits in the middle where it belongs rather than being smeared over a rim.
  check('the centre has five neighbours', pentNeighbourCount(0), 5, 0);

  let interiorSix = 0;
  let interiorOther = 0;
  for (let c = 1; c < PENT_SUBCELL_COUNT; c++) {
    if (pentRing[c] >= PENT_RADIUS) continue;
    if (pentNeighbourCount(c) === 6) interiorSix++; else interiorOther++;
  }
  measure('interior cells with six neighbours', interiorSix);
  check('and no interior cell has any other number', interiorOther, 0, 0);

  // NOTHING MAY NAME A CELL THAT IS NOT ONE.
  //
  // pentgrid builds one ring past the map so rim tiles have corners to be made
  // from, and the first version handed that halo-inclusive list out as the
  // map's adjacency. 55 of the 76 cells then named a neighbour that does not
  // exist: the water router walked into index 95 of a 76-long array, read
  // undefined, and propagated NaN. The suite went from four minutes to
  // thirteen. A halo is for looking at, never for walking.
  let outside = 0;
  for (let c = 0; c < PENT_SUBCELL_COUNT; c++) {
    for (let k = 0; k < 6; k++) {
      const nb = pentNeighbours[c * 6 + k];
      if (nb >= PENT_SUBCELL_COUNT) outside++;
    }
  }
  check('no neighbour points outside the map', outside, 0, 0);

  // Adjacency built by proximity, so reciprocity is a property to check rather
  // than one the construction gives away.
  let asymmetric = 0;
  for (let c = 0; c < PENT_SUBCELL_COUNT; c++) {
    for (let k = 0; k < 6; k++) {
      const nb = pentNeighbours[c * 6 + k];
      if (nb < 0) continue;
      let mutual = false;
      for (let j = 0; j < 6; j++) if (pentNeighbours[nb * 6 + j] === c) mutual = true;
      if (!mutual) asymmetric++;
    }
  }
  check('adjacency is symmetric', asymmetric, 0, 0);

  // Connected, or a walk over the patch would strand cells.
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const c = queue.pop()!;
    for (let k = 0; k < 6; k++) {
      const nb = pentNeighbours[c * 6 + k];
      if (nb >= 0 && !seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
  }
  check('every cell is reachable from the centre', seen.size, PENT_SUBCELL_COUNT, 0);

  // Spacing: cells one ring apart along a side are one unit apart by
  // construction, and nothing should be closer.
  let closest = Infinity;
  for (let a = 0; a < PENT_SUBCELL_COUNT; a++) {
    for (let b = a + 1; b < PENT_SUBCELL_COUNT; b++) {
      const dx = pentCentres[a * 2] - pentCentres[b * 2];
      const dy = pentCentres[a * 2 + 1] - pentCentres[b * 2 + 1];
      closest = Math.min(closest, Math.hypot(dx, dy));
    }
  }
  measure('closest pair of cells, in ring spacings', closest);
  assert('no two cells sit on top of each other', closest > 0.5);

  // And the lookup finds what it should.
  let wrong = 0;
  for (let c = 0; c < PENT_SUBCELL_COUNT; c++) {
    if (pentFromPoint(pentCentres[c * 2], pentCentres[c * 2 + 1]) !== c) wrong++;
  }
  check('every cell is found at its own centre', wrong, 0, 0);
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

suite('the ladder nests the same at every latitude', () => {
  // A region's children must belong to that region, and to the same degree
  // wherever the region is. Not all 91 of them: a hexagon of hexagons has a
  // stepped edge, so a handful always sit just outside their parent, and the
  // flat maps have always run at about 85 of 91. What must not happen is for
  // that figure to depend on WHERE the region is.
  //
  // It did. The world map is a hex grid in (longitude, sine of latitude), so a
  // cell up there is a regular hexagon in the projection and a stretched one
  // on the sphere -- 2.7 times taller than wide at 53 degrees. Children were
  // being laid out isotropically in a tangent plane, which cannot tile that,
  // and at 53 degrees only 61 of 91 fell inside their own parent. A third of
  // every polar region's tiles belonged somewhere else, and the world map was
  // the only layer that did not look like a clean mosaic of the layer below.
  //
  // The fix was to give a map's basis the projection's own anchor and convert
  // through it exactly, so children are laid out in the same space their
  // parent is drawn in.
  const w = new World({ seed: 20260826 });
  const inside: number[] = [];

  // Sampled across latitude rather than by row, there being no rows. The point
  // is unchanged: whatever a cell's latitude, its children must land in it.
  const byLat: number[] = [];
  for (let c = 0; c < CELL_COUNT; c++) byLat.push(c);
  byLat.sort((a, b) =>
    Math.abs(centres[a * 3 + 1]) - Math.abs(centres[b * 3 + 1]));

  for (let i = 0; i < 8; i++) {
    const cell = byLat[Math.floor((i / 7) * (byLat.length - 1))];
    const map = w.subMap([cell]);
    let n = 0;
    for (let k = 0; k < SUBCELL_COUNT; k++) {
      if (cellAt(map.dirs[k * 3], map.dirs[k * 3 + 1], map.dirs[k * 3 + 2]) === cell) n++;
    }
    inside.push(n);
    measure(`children inside their parent, latitude band ${i}`, n);
  }

  const worst = Math.min(...inside);
  const best = Math.max(...inside);
  measure('worst nesting at any latitude', worst);
  measure('best nesting at any latitude', best);

  // NOT 91 ANY MORE, and that is the tiling rather than a fault. A band's cell
  // is a regular hexagon in the projection the children are laid out in, so a
  // child map filled it exactly and every one of the 91 landed inside. A
  // geodesic's cell is a near-regular hexagon on the SPHERE, which a hexagon of
  // hexagons approximates closely but does not equal, so a few tiles round the
  // rim fall just outside. The renderer clips them to the parent and fills the
  // parent underneath, which is what that clip has always been for.
  assert('most of a region’s children are inside it', worst > SUBCELL_COUNT * 0.75);

  // THE CLAIM THAT ACTUALLY MATTERS, and the one that failed before: it must
  // not depend on where you are. The old form asserted a tight spread, which
  // only worked while the answer was exactly 91 everywhere. Now the variation
  // is cell to cell -- a cell neighbouring a pentagon nests differently from
  // one that does not -- so the honest test is for a TREND with latitude
  // rather than for a narrow band.
  const half = inside.length >> 1;
  let lowSum = 0, highSum = 0;
  for (let i = 0; i < half; i++) lowSum += inside[i];
  for (let i = half; i < inside.length; i++) highSum += inside[i];
  const lowMean = lowSum / half;
  const highMean = highSum / (inside.length - half);
  measure('nesting near the equator', lowMean);
  measure('nesting near the storms', highMean);
  assert('and it does not matter which latitude the region is at',
    Math.abs(lowMean - highMean) <= SUBCELL_COUNT * 0.06);

  // The same question of a flat map, which is the standard the world map is
  // being held to -- they should now agree.
  const parent = w.subMap([100]);
  let flat = 0;
  for (let k = 0; k < SUBCELL_COUNT; k++) {
    const kid = w.subMap([100, k]);
    for (let j = 0; j < SUBCELL_COUNT; j++) {
      const c = cellContaining(parent.basis, parent.cellRadiusRad,
        kid.dirs[j * 3], kid.dirs[j * 3 + 1], kid.dirs[j * 3 + 2]);
      if (c === k) flat++;
    }
  }
  const flatAvg = flat / SUBCELL_COUNT;
  measure('children inside their parent on a flat map', flatAvg);
  assert('the world map nests as well as a flat one does',
    worst >= flatAvg - SUBCELL_COUNT * 0.05);
});
