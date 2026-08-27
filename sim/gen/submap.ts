// Everything below the globe.
//
// One function generates every layer under layer zero, because the recursion
// is uniform: a sub-map is 9,919 hexagons filling one cell of the layer above,
// and it is built by inheriting that cell's context and adding detail the
// parent was too coarse to carry. Going deeper is a parameter, not new code.
//
// A sub-map is generated whole rather than a tile at a time. That is forced:
// slope needs neighbours, and drainage needs the entire map at once because
// water arriving here came from somewhere uphill. 9,919 cells is a couple of
// milliseconds, and it is then cached -- so the cost of a player opening a
// region is one map, not ten thousand tiles.
//
// GEOMETRY
//
// Each sub-cell gets a real position on the sphere: the parent's centre,
// displaced in the parent's own tangent plane by the hex grid offset, then
// normalised back onto the sphere. That matters more than it looks. It means
// noise is sampled in 3D world space rather than in map space, so terrain is
// continuous across a sub-map boundary even though the adjacency lists are
// not -- two neighbouring regions grow the same mountain from opposite sides
// without ever consulting each other.

import * as A from '../anchors.ts';
import {
  SUBCELL_COUNT, subNeighbours, toPixel, fromPixel, ringOf,
} from '../geo/hexgrid.ts';
import { CELL_COUNT, centres, neighbours, neighbourCount, cellAt } from '../geo/sphere.ts';
import { addressSeed, SALT, type Address } from '../geo/address.ts';
import { fbm3, ridged3 } from './noise.ts';
import { clamp, smoothstep, dlog } from './mathx.ts';
import { classify, miamiNPP, aridityIndex, type BiomeId } from '../model/biome.ts';
import {
  deriveSoil, waterlogging as calcWaterlogging, grainYieldKgPerHa, cropSuitability,
  type Soil,
} from '../model/soil.ts';
import type { Planet } from './planet.ts';

/** A local frame: origin on the sphere, plus east and north in its tangent plane. */
export interface Basis {
  ox: number; oy: number; oz: number;
  ex: number; ey: number; ez: number;
  nx: number; ny: number; nz: number;
}

export interface SubMap {
  /** Address of the parent cell this map fills. */
  parent: Address;
  /** Depth of the cells in this map: 1 is realm, 2 is ground. */
  depth: number;
  basis: Basis;
  /** Circumradius of one cell of this map, in radians of arc. */
  cellRadiusRad: number;
  /** Centre-to-centre spacing between neighbouring cells, metres. */
  spacingM: number;

  dirs: Float64Array;
  elevationM: Float32Array;
  slope: Float32Array;
  temperatureC: Float32Array;
  precipMm: Float32Array;
  /** Normalised upstream catchment, 0..1. Above ~0.4 this is a river. */
  drainage: Float32Array;
  waterlogging: Float32Array;
  nppGm2: Float32Array;
  biome: Uint8Array;
  /** Tectonic uplift inherited from the region, for the geology model. */
  upliftM: Float32Array;

  /**
   * Grain a hectare of each cell would yield, kg/yr, on virgin soil.
   *
   * Built on first use and then kept, because a catchment reads it for every
   * one of 69,000 candidate tiles and deriving it involves the exponentials in
   * the soil model. Computing it lazily rather than during generation means a
   * map nobody farms never pays for it.
   *
   * Virgin soil: a delta that has worn a tile down is applied on top, by
   * whoever is asking. Baking a player's soil health into a generated array
   * would put mutable state inside the pure layer.
   */
  yieldKgPerHa: Float32Array | null;
}

/** The context a sub-map needs from whatever is above it. */
export interface ParentSample {
  elevationM: number;
  precipMm: number;
  upliftM: number;
}

/** Circumradius of a layer-0 cell in radians, and the ratio per layer down. */
const L0_RADIUS_RAD = Math.sqrt(
  (4 * Math.PI) / CELL_COUNT / ((3 * Math.sqrt(3)) / 2),
);
const SHRINK = Math.sqrt(SUBCELL_COUNT);

export function cellRadiusRad(depth: number): number {
  let r = L0_RADIUS_RAD;
  for (let i = 0; i < depth; i++) r /= SHRINK;
  return r;
}

/** Build a tangent frame at a point on the sphere. */
export function basisAt(ox: number, oy: number, oz: number): Basis {
  // East is the pole crossed with the position. At a pole that degenerates, so
  // fall back to another axis -- the twelve pentagons include the poles and
  // this would otherwise produce a NaN basis on exactly those cells.
  let ex = oz, ey = 0, ez = -ox;
  let len = Math.sqrt(ex * ex + ez * ez);
  if (len < 1e-9) { ex = 1; ey = 0; ez = 0; len = 1; }
  ex /= len; ey /= len; ez /= len;
  return {
    ox, oy, oz, ex, ey, ez,
    nx: oy * ez - oz * ey,
    ny: oz * ex - ox * ez,
    nz: ox * ey - oy * ex,
  };
}

/** Local tangent-plane offset, in radians, back to a direction on the sphere. */
export function toDirection(b: Basis, x: number, y: number, out: Float64Array, at: number): void {
  const dx = b.ox + x * b.ex + y * b.nx;
  const dy = b.oy + x * b.ey + y * b.ny;
  const dz = b.oz + x * b.ez + y * b.nz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out[at] = dx / len;
  out[at + 1] = dy / len;
  out[at + 2] = dz / len;
}

/** A direction on the sphere back to the sub-map cell containing it, or -1. */
export function cellContaining(b: Basis, radiusRad: number, x: number, y: number, z: number): number {
  const lx = x * b.ex + y * b.ey + z * b.ez;
  const ly = x * b.nx + y * b.ny + z * b.nz;
  return fromPixel(lx, ly, radiusRad);
}

/**
 * Read the planet's fields at an arbitrary direction, smoothly.
 *
 * Inverse-distance over the containing cell and its neighbours. Taking the
 * containing cell's value alone would give every sub-map a flat floor with a
 * cliff at each region boundary; interpolating gives a continuous surface that
 * the detail noise then roughens.
 */
export function samplePlanet(planet: Planet, x: number, y: number, z: number): ParentSample {
  const c = cellAt(x, y, z);
  let we = 0, wp = 0, wu = 0, wsum = 0;

  const add = (cell: number): void => {
    const dx = centres[cell * 3] - x;
    const dy = centres[cell * 3 + 1] - y;
    const dz = centres[cell * 3 + 2] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    // A tiny floor so that landing exactly on a centre is not a division by
    // zero; at this scale it simply means that cell dominates, which is right.
    const w = 1 / (d2 + 1e-9);
    we += planet.elevationM[cell] * w;
    wp += planet.precipMm[cell] * w;
    wu += upliftProxy(planet, cell) * w;
    wsum += w;
  };

  add(c);
  for (let i = 0; i < neighbourCount(c); i++) {
    const n = neighbours[c * 6 + i];
    if (n >= 0) add(n);
  }
  return { elevationM: we / wsum, precipMm: wp / wsum, upliftM: wu / wsum };
}

/**
 * How much this cell was pushed up by tectonics, reconstructed after the fact.
 *
 * The planet generator does not keep the uplift field -- it folds it into
 * elevation and discards it. Rather than carry another 40 kB array for the
 * whole life of a world, recover it here: uplift is what elevation has that
 * the plate's baseline does not. Good enough for the geology model, which only
 * needs to know roughly where the collisions were.
 */
function upliftProxy(planet: Planet, cell: number): number {
  const base = planet.plateOceanic[planet.plate[cell]] ? -3800 : 500;
  return Math.max(0, planet.elevationM[cell] - base);
}

/** Read a generated sub-map at an arbitrary direction on the sphere. */
export function sampleSubMap(map: SubMap, x: number, y: number, z: number): ParentSample {
  const c = cellContaining(map.basis, map.cellRadiusRad, x, y, z);
  if (c < 0) {
    // Off the edge of this sub-map. Falling back to the centre is wrong but
    // bounded, and it only happens on the outermost ring where the child map
    // slightly overhangs its parent. Real cross-boundary sampling is the
    // unsolved geometry problem in docs/known-gaps.md.
    const mid = fromPixel(0, 0, map.cellRadiusRad);
    return { elevationM: map.elevationM[mid], precipMm: map.precipMm[mid], upliftM: map.upliftM[mid] };
  }
  return { elevationM: map.elevationM[c], precipMm: map.precipMm[c], upliftM: map.upliftM[c] };
}

// ---------------------------------------------------------------------------

/**
 * Build the sub-map filling one cell.
 *
 * `sample` reads whatever is above: the planet for a realm map, the parent
 * sub-map for a ground map. That indirection is what makes the recursion
 * uniform -- this function does not know or care which layer it is on, only
 * how big its cells are.
 */
export function generateSubMap(
  worldSeed: number,
  parentAddress: Address,
  depth: number,
  basis: Basis,
  sample: (x: number, y: number, z: number) => ParentSample,
  radiusM = A.EARTH_RADIUS_M,
): SubMap {
  const cellRad = cellRadiusRad(depth);
  const spacingM = Math.sqrt(3) * cellRad * radiusM;
  const seed = addressSeed(worldSeed, parentAddress, SALT.submap);

  const dirs = new Float64Array(SUBCELL_COUNT * 3);
  // The parent's fields at each of our cells. Kept rather than re-sampled in
  // the climate pass below: sampling walks the parent's neighbour ring, and
  // doing it twice for 9,919 cells doubled the cost of opening a map.
  const parentElev = new Float32Array(SUBCELL_COUNT);
  const parentPrecip = new Float32Array(SUBCELL_COUNT);
  const elevationM = new Float32Array(SUBCELL_COUNT);
  const precipMm = new Float32Array(SUBCELL_COUNT);
  const upliftM = new Float32Array(SUBCELL_COUNT);
  const temperatureC = new Float32Array(SUBCELL_COUNT);
  const slope = new Float32Array(SUBCELL_COUNT);
  const drainage = new Float32Array(SUBCELL_COUNT);
  const waterlogging = new Float32Array(SUBCELL_COUNT);
  const nppGm2 = new Float32Array(SUBCELL_COUNT);
  const biome = new Uint8Array(SUBCELL_COUNT);

  // Detail frequency: the noise wavelength has to shrink with the cells, or a
  // ground map inherits the same three hills its region already had. Tie it to
  // the cell size so every layer adds roughness at its own scale.
  const detailFreq = 0.45 / cellRad;
  // Detail amplitude falls with depth: a region's relief is hundreds of metres,
  // a ground tile's is a few. Halving per layer matches the way real terrain
  // loses amplitude faster than it loses wavelength.
  const detailAmp = 420 / SHRINK ** (depth - 1);

  for (let c = 0; c < SUBCELL_COUNT; c++) {
    const p = toPixel(c, cellRad);
    toDirection(basis, p.x, p.y, dirs, c * 3);
    const x = dirs[c * 3], y = dirs[c * 3 + 1], z = dirs[c * 3 + 2];

    const parent = sample(x, y, z);
    upliftM[c] = parent.upliftM;
    parentElev[c] = parent.elevationM;
    parentPrecip[c] = parent.precipMm;

    // Rolling detail everywhere, plus ridges gated to ground that is already
    // being pushed up -- the same trick the planet uses, one scale down.
    const rolling = fbm3(x * detailFreq, y * detailFreq, z * detailFreq, seed ^ 0x1d, 5);
    const crest = ridged3(x * detailFreq * 2.3, y * detailFreq * 2.3, z * detailFreq * 2.3, seed ^ 0x2e, 3);
    const gate = smoothstep(300, 2800, parent.upliftM);

    let e = parent.elevationM + rolling * detailAmp + crest * gate * detailAmp * 1.6;
    // Do not let detail push a sea tile onto land or the reverse; the coastline
    // belongs to the layer that solved sea level for it.
    if (parent.elevationM < -50) e = Math.min(e, -1);
    elevationM[c] = e;
  }

  // --- slope, from the neighbours we have -----------------------------------
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    let worst = 0;
    for (let d = 0; d < 6; d++) {
      const n = subNeighbours[c * 6 + d];
      if (n < 0) continue;
      worst = Math.max(worst, Math.abs(elevationM[c] - elevationM[n]) / spacingM);
    }
    slope[c] = worst;
  }

  computeDrainage(elevationM, drainage);

  // --- climate and everything downstream of it -------------------------------
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    const sinLat = dirs[c * 3 + 1];
    const u = sinLat * sinLat;
    const seaLevelT = A.TEMP_EQUATOR_C - A.TEMP_QUAD_COEFF * u - A.TEMP_CUBIC_COEFF * u * u * u;
    temperatureC[c] = seaLevelT - A.LAPSE_RATE_PER_M * Math.max(0, elevationM[c]);

    // Local orographic correction on top of what the parent already applied.
    // Only the *difference* from the parent's elevation counts, or the effect
    // would be applied twice at every layer.
    const rise = elevationM[c] - parentElev[c];
    const local = rise > 0
      ? 1 + Math.min(0.9, rise / A.OROGRAPHIC_DOUBLING_M)
      : clamp(1 + rise / A.RAIN_SHADOW_M, 0.35, 1);
    precipMm[c] = Math.max(0, parentPrecip[c] * local);

    // Ordering: waterlogging is needed to classify the biome, and the biome is
    // needed to derive the soil. Waterlogging itself does not read the biome,
    // so it can be computed first with a placeholder.
    waterlogging[c] = calcWaterlogging({
      temperatureC: temperatureC[c],
      precipMm: precipMm[c],
      sinLat,
      slope: slope[c],
      drainage: drainage[c],
      biome: 0,
    });
    nppGm2[c] = elevationM[c] < 0 ? 0 : miamiNPP(temperatureC[c], precipMm[c]);
    biome[c] = classify({
      temperatureC: temperatureC[c],
      precipMm: precipMm[c],
      sinLat,
      elevationM: elevationM[c],
      waterlogging: waterlogging[c],
    });
  }

  return {
    parent: parentAddress, depth, basis, cellRadiusRad: cellRad, spacingM,
    dirs, elevationM, slope, temperatureC, precipMm, drainage,
    waterlogging, nppGm2, biome, upliftM,
    yieldKgPerHa: null,
  };
}

/**
 * Flow accumulation: where the water goes, and therefore where the rivers are.
 *
 * Every cell sends its water to its lowest neighbour. Process the cells from
 * high to low and each one has already received everything upstream of it by
 * the time its turn comes, so a single pass does the whole catchment -- no
 * iteration, no convergence test.
 *
 * The result is the most useful field on the map. Rivers are where it is
 * large; floodplains are where it is large and flat; the deepest soil in any
 * landscape is where it is large, flat and slow. It is why settlements go
 * where they go, and it costs one sort.
 *
 * Sinks are not filled. A basin with no outlet keeps its water, which is
 * correct -- that is a lake, and the Caspian is not a bug.
 */
function computeDrainage(elevation: Float32Array, out: Float32Array): void {
  const order = new Int32Array(SUBCELL_COUNT);
  for (let i = 0; i < SUBCELL_COUNT; i++) order[i] = i;
  // Descending by elevation. Ties broken by index so the order is total and
  // the result does not depend on the sort's stability.
  const sorted = Array.from(order).sort((a, b) => (elevation[b] - elevation[a]) || (a - b));

  const flow = new Float32Array(SUBCELL_COUNT).fill(1);
  for (const c of sorted) {
    let lowest = -1;
    let lowestE = elevation[c];
    for (let d = 0; d < 6; d++) {
      const n = subNeighbours[c * 6 + d];
      if (n < 0) continue;
      if (elevation[n] < lowestE) { lowestE = elevation[n]; lowest = n; }
    }
    if (lowest >= 0) flow[lowest] += flow[c];
  }

  // Normalise on a log scale. Flow accumulation spans four orders of magnitude
  // between a hilltop and a trunk river, and a linear normalisation would make
  // everything except the main channel read as zero.
  let maxFlow = 1;
  for (let c = 0; c < SUBCELL_COUNT; c++) maxFlow = Math.max(maxFlow, flow[c]);
  const denom = dlog(maxFlow + 1);
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    out[c] = denom > 0 ? dlog(flow[c] + 1) / denom : 0;
  }
}

/** Soil for one cell of a generated sub-map. */
export function soilAt(map: SubMap, cell: number): Soil {
  return deriveSoil({
    temperatureC: map.temperatureC[cell],
    precipMm: map.precipMm[cell],
    sinLat: map.dirs[cell * 3 + 1],
    slope: map.slope[cell],
    drainage: map.drainage[cell],
    biome: map.biome[cell] as BiomeId,
  });
}

/**
 * Grain yield per hectare for every cell, built once and kept.
 *
 * The first call costs about as much as generating the map did; every call
 * after it is an array read. A settlement's catchment consults tens of
 * thousands of tiles a turn, so this is the difference between a turn that
 * resolves instantly and one that does not.
 */
export function yieldsFor(map: SubMap): Float32Array {
  if (map.yieldKgPerHa !== null) return map.yieldKgPerHa;
  const out = new Float32Array(SUBCELL_COUNT);
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    if (map.elevationM[c] < 0) continue;
    const suitability = cropSuitability(
      map.precipMm[c], map.temperatureC[c], map.dirs[c * 3 + 1]);
    out[c] = grainYieldKgPerHa(soilAt(map, c), map.nppGm2[c], suitability);
  }
  map.yieldKgPerHa = out;
  return out;
}

/** Aridity for one cell, which several of the resource models want. */
export function aridityAt(map: SubMap, cell: number): number {
  return aridityIndex(map.precipMm[cell], map.temperatureC[cell], map.dirs[cell * 3 + 1]);
}

export { SUBCELL_COUNT, ringOf };
