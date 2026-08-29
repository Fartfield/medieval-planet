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
  SUBCELL_COUNT, RADIUS, subNeighbours, coords, DIRECTIONS,
  toPixel, pixelOfAxial, fromPixel, ringOf,
} from '../geo/hexgrid.ts';
import { CELL_COUNT, centres, neighbours, neighbourCount, cellAt } from '../geo/sphere.ts';
import { addressSeed, SALT, type Address } from '../geo/address.ts';
import { fbm3, ridged3 } from './noise.ts';
import { clamp, smoothstep, dpow, lerp } from './mathx.ts';
import {
  routeWater, runoffM as runoffDepthM, drainageOf, alluvialFraction,
  type Boundary, type Flow,
} from './hydrology.ts';
import {
  classify, miamiNPP, aridityIndex, potentialEvapotranspiration, type BiomeId,
} from '../model/biome.ts';
import {
  rockAt, erosionRateM, soilDepthM as regolithDepthM, factorOfSafety,
  rootCohesionKPa, standingCoverOf, type RockId,
} from '../model/rock.ts';
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
  /**
   * Discharge on the fixed 0..1 scale of hydrology.drainageOf.
   *
   * Comparable between maps and between layers now, which it was not when each
   * map normalised against its own biggest channel.
   */
  drainage: Float32Array;
  /** Depth of water leaving each cell in a year, metres. */
  runoffM: Float32Array;
  /** Fraction of each cell that is river floodplain, 0..1. */
  alluvial: Float32Array;

  /** What rock is under each cell. See model/rock.ts. */
  rock: Uint8Array;
  /** Surface lowering, metres a year, from stream power on this cell's own
   *  catchment and gradient. */
  erosionMPerYr: Float32Array;
  /** Depth of soil over bedrock, metres. Zero is bare rock, and it happens. */
  regolithM: Float32Array;
  /**
   * Infinity-capped factor of safety against a shallow landslide, dry.
   *
   * Below one the hillside is already going; between one and about 1.3 it is
   * going the next time it rains hard or the next time somebody fells the
   * trees on it. Bare rock and flat ground both return the cap.
   */
  stability: Float32Array;
  /**
   * Whether the three fields above mean anything on this map.
   *
   * False wherever a cell is wider than a hillslope, which is every layer
   * above the plot. The numbers are still there -- same function, no branch --
   * but a gradient measured across 300 km is not a hillslope gradient and the
   * steady state it implies is fiction. See anchors.HILLSLOPE_LENGTH_M.
   */
  hillslopesResolved: boolean;
  /** Catchment, discharge, lakes and flow directions. See gen/hydrology.ts. */
  flow: Flow;
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
  /**
   * Which side of sea level the layer above says this is, from -1 to +1.
   *
   * The classification, interpolated on its own rather than read off the
   * elevation. Kept apart because the two want opposite things from an
   * interpolator. Elevation wants a straight average, so that a planar
   * hillside stays planar; the coastline wants land and sea weighted equally,
   * so that the crossing sits near the boundary between two cells instead of a
   * long way inside whichever one is shallower.
   *
   * Trying to serve both with one field -- normalising elevation by the mean
   * land height and mean ocean depth before interpolating -- does place the
   * coast correctly and puts a 4.4x kink in the gradient at exactly sea level,
   * which the interpolation then reproduces as a cliff along every shore. Two
   * fields, one question each.
   */
  landness: number;
}

/**
 * The number a factor of safety is reported as when nothing can slide -- flat
 * ground, or bare rock. Infinity is the honest answer and it does not survive
 * a Float32Array or a JSON round trip, so it is capped where it is stored.
 */
export const STABILITY_CAP = 99;

/**
 * FREE PARAMETER: how far a coastline may wander from where the layer above
 * put it, as a fraction of the way from the cell boundary toward a cell centre.
 *
 * Zero would pin the coast exactly to the boundary the coarse map implies and
 * give it no detail at all; one would let the noise redraw the map. At 0.3 the
 * coast keeps the shape of the continent it was given and gains bays and
 * headlands about a third of a cell deep.
 *
 * No measurement settles this. It is a statement about how much authority each
 * layer has over the one below, and the honest range is wide.
 */
const COAST_BAND = 0.3;

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
  let we = 0, wp = 0, wu = 0, wl = 0, wsum = 0;

  const add = (cell: number): void => {
    const dx = centres[cell * 3] - x;
    const dy = centres[cell * 3 + 1] - y;
    const dz = centres[cell * 3 + 2] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    // A tiny floor so that landing exactly on a centre is not a division by
    // zero; at this scale it simply means that cell dominates, which is right.
    const w = 1 / (d2 + 1e-9);
    we += planet.elevationM[cell] * w;
    wl += (planet.elevationM[cell] >= 0 ? 1 : -1) * w;
    wp += planet.precipMm[cell] * w;
    wu += upliftProxy(planet, cell) * w;
    wsum += w;
  };

  add(c);
  for (let i = 0; i < neighbourCount(c); i++) {
    const n = neighbours[c * 6 + i];
    if (n >= 0) add(n);
  }
  return {
    elevationM: we / wsum,
    precipMm: wp / wsum,
    upliftM: wu / wsum,
    landness: wl / wsum,
  };
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

/**
 * Read a generated sub-map at an arbitrary direction on the sphere.
 *
 * Barycentric interpolation over the triangle of cell centres the point falls
 * in. The property that matters is that it **reproduces a linear field
 * exactly**: a planar hillside sampled at any resolution comes back planar,
 * with the gradient it actually has.
 *
 * THIS TOOK THREE GOES AND THE FIRST TWO ARE WORTH KEEPING.
 *
 * It was nearest-neighbour for seven layers -- only the globe-to-region step
 * had ever been fixed, and its comment there says exactly why it had to be.
 * Every layer below inherited its parent as a step function and rebuilt the
 * same staircase: relief measured 756 m at the 3 km layer and still 756 m at
 * the 41 cm layer. Three quarters of a kilometre of relief across four metres
 * of ground, with slopes reading 90 degrees.
 *
 * Copying samplePlanet's inverse-distance weighting fixed a third of it and
 * not the rest. Shepard weighting has a flat spot at every node -- the
 * gradient goes to zero exactly at a cell centre -- so the field sits level
 * across each cell and does all its climbing near the boundary. The staircase
 * came back as a ramp: the maximum gradient inside a child map was 50 degrees
 * where its parent's own gradient was 8. Softer, and just as wrong.
 *
 * Barycentric has no flat spot and no free parameter. A point sits in a
 * triangle of three cell centres, the three weights are what they are, and a
 * linear field passes through untouched -- which is the whole requirement,
 * because over one cell of the layer above, terrain *is* close to linear and
 * the detail noise is what is supposed to add the rest.
 *
 * The sister project's ledger has this as "the same mistake as nearest-
 * neighbour sampling turning a coastline into a 39 km staircase, and it was
 * the sampler both times". Three times now.
 */
/**
 * What one cell of a map holds, for a cell that may belong to another map.
 *
 * The four fields the layer below inherits, and nothing else.
 */
export interface CellValue {
  elevationM: number;
  precipMm: number;
  upliftM: number;
}

/**
 * Look up a cell of the SAME layer that this map does not hold.
 *
 * A rim cell is missing two or three neighbours, and those neighbours are not
 * nowhere -- they are in a sibling map, under a different grandparent. Only
 * something holding the whole world can find them, so the world passes this
 * in. Returning null means give up and use what is to hand.
 */
export type Neighbouring = (x: number, y: number, z: number) => CellValue | null;

export function sampleSubMap(
  map: SubMap,
  x: number,
  y: number,
  z: number,
  outside: Neighbouring | null = null,
): ParentSample {
  const b = map.basis;
  const lx = x * b.ex + y * b.ey + z * b.ez;
  const ly = x * b.nx + y * b.ny + z * b.nz;
  const c = fromPixel(lx, ly, map.cellRadiusRad);
  if (c < 0) {
    // Off the edge of this sub-map. Falling back to the centre is wrong but
    // bounded, and it only happens on the outermost ring where the child map
    // slightly overhangs its parent. Real cross-boundary sampling is the
    // unsolved geometry problem in docs/known-gaps.md.
    const mid = fromPixel(0, 0, map.cellRadiusRad);
    return {
      elevationM: map.elevationM[mid],
      precipMm: map.precipMm[mid],
      upliftM: map.upliftM[mid],
      landness: map.elevationM[mid] >= 0 ? 1 : -1,
    };
  }

  const p0 = toPixel(c, map.cellRadiusRad);

  // Hex centres are a triangular lattice, so the containing triangle is the
  // cell and two neighbours adjacent to each other. Six to try, and normally
  // exactly one contains the point.
  //
  // ON THE PARENT'S RIM there may be none: a rim cell is missing two or three
  // of its neighbours, so the triangle covering the point can be one we do not
  // hold. The old answer was to fall back to the cell's own value, which is
  // nearest-neighbour -- and nearest-neighbour is the staircase this whole
  // function exists to avoid. It survived on every map edge, and that is a
  // third of the cells of a radius-5 hexagon. Measured: a child map covering a
  // rim cell had a 1,000 m step across one 305 m cell, a 73-degree cliff, and
  // its relief did not fall from its parent's at all.
  //
  // So take the best triangle available and let the weights go negative, which
  // is linear EXTRAPOLATION rather than interpolation. It still reproduces a
  // linear field exactly -- the only thing that changes is that the point sits
  // outside the triangle rather than inside it -- and the gradient carries on
  // across the rim instead of flattening against it.
  const side = (v: number): number => (v >= 0 ? 1 : -1);

  for (let i = 0; i < 6; i++) {
    const na = subNeighbours[c * 6 + i];
    const nb = subNeighbours[c * 6 + ((i + 1) % 6)];
    if (na < 0 || nb < 0) continue;
    const p1 = toPixel(na, map.cellRadiusRad);
    const p2 = toPixel(nb, map.cellRadiusRad);

    const det = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
    if (det === 0) continue;
    const w0 = ((p1.y - p2.y) * (lx - p2.x) + (p2.x - p1.x) * (ly - p2.y)) / det;
    const w1 = ((p2.y - p0.y) * (lx - p2.x) + (p0.x - p2.x) * (ly - p2.y)) / det;
    const w2 = 1 - w0 - w1;
    // A small negative tolerance so a point exactly on an edge lands in the
    // first triangle that claims it rather than in none of them.
    if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;

    return {
      elevationM: w0 * map.elevationM[c] + w1 * map.elevationM[na] + w2 * map.elevationM[nb],
      precipMm: w0 * map.precipMm[c] + w1 * map.precipMm[na] + w2 * map.precipMm[nb],
      upliftM: w0 * map.upliftM[c] + w1 * map.upliftM[na] + w2 * map.upliftM[nb],
      landness: w0 * side(map.elevationM[c])
        + w1 * side(map.elevationM[na])
        + w2 * side(map.elevationM[nb]),
    };
  }

  // NO TRIANGLE CONTAINS THE POINT, which happens on the parent's rim: a rim
  // cell is missing two or three of its neighbours, so the triangle covering
  // the point can be one this map does not hold. A third of the cells of a
  // radius-5 hexagon are rim cells, so this is not a corner case.
  //
  // If the caller can reach the sibling map that DOES hold them, ask it. The
  // neighbour's position is known even when its index is not: the lattice runs
  // on past the edge of the array. This is the same answer as cellsWithin's --
  // descend from the globe rather than walk sideways -- applied to a single
  // cell instead of to an area.
  if (outside !== null) {
    const crossed = crossTriangle(map, c, p0, lx, ly, outside);
    if (crossed !== null) return crossed;
  }
  //
  // Nothing to ask, so fall back to a plane through the cell, least-squares
  // through whatever neighbours it does have. Bounded by construction -- it
  // can only carry the gradient those neighbours actually show -- and still
  // exact for a linear field.
  //
  // The two answers this replaced are both worth remembering. The cell's own
  // value is nearest-neighbour, which is the staircase this function exists to
  // remove, and it survived on every map edge: measured on a child of a rim
  // cell, a 987 m step across one 306 m cell and a 73-degree cliff, entirely
  // inherited rather than added by noise. Extrapolating from the least-bad
  // triangle was worse, because a triangle that does not contain the point can
  // be lopsided and unbounded extrapolation amplifies its gradient.
  return planeAt(map, c, p0, lx, ly);
}

/**
 * Barycentric interpolation across a map boundary.
 *
 * Same triangles as above, but a neighbour whose index is -1 is looked up by
 * POSITION instead. The hex lattice continues past the edge of the array, so
 * the missing neighbour's centre is computable from its axial coordinate; what
 * is not computable from inside this map is the value there, and that is what
 * the caller's lookup answers.
 *
 * Returns null if the sibling cannot be reached, so the caller can fall back.
 */
function crossTriangle(
  map: SubMap,
  c: number,
  p0: { x: number; y: number },
  lx: number,
  ly: number,
  outside: Neighbouring,
): ParentSample | null {
  const cq = coords[c * 2];
  const cr = coords[c * 2 + 1];

  for (let i = 0; i < 6; i++) {
    const ia = i;
    const ib = (i + 1) % 6;
    const va = valueOfNeighbour(map, c, cq, cr, ia, outside);
    const vb = valueOfNeighbour(map, c, cq, cr, ib, outside);
    if (va === null || vb === null) continue;

    const det = (va.y - vb.y) * (p0.x - vb.x) + (vb.x - va.x) * (p0.y - vb.y);
    if (det === 0) continue;
    const w0 = ((va.y - vb.y) * (lx - vb.x) + (vb.x - va.x) * (ly - vb.y)) / det;
    const w1 = ((vb.y - p0.y) * (lx - vb.x) + (p0.x - vb.x) * (ly - vb.y)) / det;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;

    const side = (v: number): number => (v >= 0 ? 1 : -1);
    return {
      elevationM: w0 * map.elevationM[c] + w1 * va.elevationM + w2 * vb.elevationM,
      precipMm: w0 * map.precipMm[c] + w1 * va.precipMm + w2 * vb.precipMm,
      upliftM: w0 * map.upliftM[c] + w1 * va.upliftM + w2 * vb.upliftM,
      landness: w0 * side(map.elevationM[c])
        + w1 * side(va.elevationM)
        + w2 * side(vb.elevationM),
    };
  }
  return null;
}

/** One neighbour of a cell, from this map if it holds it and from the world
 *  next door if it does not. */
function valueOfNeighbour(
  map: SubMap,
  c: number,
  cq: number,
  cr: number,
  dir: number,
  outside: Neighbouring,
): (CellValue & { x: number; y: number }) | null {
  const n = subNeighbours[c * 6 + dir];
  const q = cq + DIRECTIONS[dir][0];
  const r = cr + DIRECTIONS[dir][1];
  const p = pixelOfAxial(q, r, map.cellRadiusRad);

  if (n >= 0) {
    return {
      x: p.x, y: p.y,
      elevationM: map.elevationM[n],
      precipMm: map.precipMm[n],
      upliftM: map.upliftM[n],
    };
  }

  // Outside this map. Its position on the sphere is still exact.
  const dir3 = new Float64Array(3);
  toDirection(map.basis, p.x, p.y, dir3, 0);
  const v = outside(dir3[0], dir3[1], dir3[2]);
  return v === null ? null : { x: p.x, y: p.y, ...v };
}

/**
 * The value at a point, from a plane fitted through one cell and its
 * neighbours.
 *
 * Exact through the cell itself and least-squares through the neighbours, so a
 * linear field passes through untouched and anything else is carried by the
 * local gradient rather than by a single sample. Two non-collinear neighbours
 * are enough, and a rim cell of a hexagon of hexagons always keeps three.
 */
function planeAt(
  map: SubMap,
  c: number,
  p0: { x: number; y: number },
  lx: number,
  ly: number,
): ParentSample {
  let sxx = 0, sxy = 0, syy = 0;
  let sxe = 0, sye = 0, sxp = 0, syp = 0, sxu = 0, syu = 0, sxl = 0, syl = 0;
  const side = (v: number): number => (v >= 0 ? 1 : -1);
  const e0 = map.elevationM[c];
  const pr0 = map.precipMm[c];
  const u0 = map.upliftM[c];
  const l0 = side(e0);

  for (let i = 0; i < 6; i++) {
    const n = subNeighbours[c * 6 + i];
    if (n < 0) continue;
    const pn = toPixel(n, map.cellRadiusRad);
    const dx = pn.x - p0.x;
    const dy = pn.y - p0.y;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    sxe += dx * (map.elevationM[n] - e0); sye += dy * (map.elevationM[n] - e0);
    sxp += dx * (map.precipMm[n] - pr0); syp += dy * (map.precipMm[n] - pr0);
    sxu += dx * (map.upliftM[n] - u0); syu += dy * (map.upliftM[n] - u0);
    sxl += dx * (side(map.elevationM[n]) - l0); syl += dy * (side(map.elevationM[n]) - l0);
  }

  const det = sxx * syy - sxy * sxy;
  const qx = lx - p0.x;
  const qy = ly - p0.y;
  if (det === 0) {
    // Collinear neighbours, which a hex lattice does not produce. Total rather
    // than reachable.
    return { elevationM: e0, precipMm: pr0, upliftM: u0, landness: l0 };
  }

  const at = (sx: number, sy: number, base: number): number => {
    const a = (syy * sx - sxy * sy) / det;
    const b = (sxx * sy - sxy * sx) / det;
    return base + a * qx + b * qy;
  };

  return {
    elevationM: at(sxe, sye, e0),
    precipMm: at(sxp, syp, pr0),
    upliftM: at(sxu, syu, u0),
    landness: clamp(at(sxl, syl, l0), -1, 1),
  };
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
  inflow: readonly Boundary[] = [],
): SubMap {
  const cellRad = cellRadiusRad(depth);
  const spacingM = Math.sqrt(3) * cellRad * radiusM;
  // ONE NOISE FIELD PER LAYER, shared by every map on it.
  //
  // This was seeded from the parent's address, which meant every sub-map
  // sampled a different field. Sampling in world space -- which the header
  // above is right that we do -- is necessary for continuity and not
  // sufficient: two maps can read the same coordinates and still disagree, if
  // they are reading different fields. Measured at the region layer, two maps
  // asked about the SAME POINT ON THE SPHERE differed by 184 m at the median
  // and 806 m at the ninetieth percentile, and 1.5% of pairs straddling a
  // border disagreed about whether that point was land or sea. On screen that
  // is a coastline that stops at the edge of a hexagon.
  //
  // Keyed on the depth rather than on nothing, so each layer still adds its
  // own detail rather than every layer repeating the same shapes at different
  // scales. Two maps on the same layer now read one field, and a mountain
  // grows from both sides of a boundary without either map consulting the
  // other -- which is what the header claimed all along.
  const fieldSeed = addressSeed(worldSeed, [depth], SALT.submap);

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
  const runoffM = new Float32Array(SUBCELL_COUNT);
  const rock = new Uint8Array(SUBCELL_COUNT);
  const erosionMPerYr = new Float32Array(SUBCELL_COUNT);
  const regolithM = new Float32Array(SUBCELL_COUNT);
  const stability = new Float32Array(SUBCELL_COUNT);
  const alluvial = new Float32Array(SUBCELL_COUNT);
  const waterlogging = new Float32Array(SUBCELL_COUNT);
  const nppGm2 = new Float32Array(SUBCELL_COUNT);
  const biome = new Uint8Array(SUBCELL_COUNT);

  // Detail frequency: the noise wavelength has to shrink with the cells, or a
  // ground map inherits the same three hills its region already had. Tie it to
  // the cell size so every layer adds roughness at its own scale.
  const detailFreq = 0.45 / cellRad;
  // How much relief to add at this layer's own scale.
  //
  // Anchored rather than picked: real landscapes are reported by their local
  // relief over a ten-kilometre baseline, and relief scales as the baseline to
  // the Hurst exponent. So one measured relief at one measured baseline fixes
  // the amplitude at every cell size the ladder has, and the result is a
  // number that can be checked against a landscape instead of against taste.
  //
  // Per cell rather than per map, because how rough ground is depends on where
  // it is: the mountain end of the range where the plates are still pushing,
  // the plain end where they are not. `gate` below carries that.
  const reliefScale = dpow(spacingM / A.LOCAL_RELIEF_BASELINE_M, A.TOPOGRAPHY_HURST);

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
    const rolling = fbm3(x * detailFreq, y * detailFreq, z * detailFreq, fieldSeed ^ 0x1d, 5);
    const crest = ridged3(x * detailFreq * 2.3, y * detailFreq * 2.3, z * detailFreq * 2.3, fieldSeed ^ 0x2e, 3);
    const gate = smoothstep(300, 2800, parent.upliftM);

    // Between the measured ends: a shield plain where nothing is being pushed
    // up, a high belt where it is.
    const localRelief = lerp(A.LOCAL_RELIEF_PLAIN_M, A.LOCAL_RELIEF_MOUNTAIN_M, gate);
    const detailAmp = localRelief * reliefScale;

    let e = parent.elevationM + rolling * detailAmp + crest * gate * detailAmp * 0.8;
    // The coastline belongs to the layer that solved sea level for it, and
    // detail may only move it inside the band where the two genuinely compete
    // -- the continental shelf, which is ground that has been dry land within
    // the last glacial cycle.
    //
    // THIS RULE USED TO RUN ONE WAY ONLY. Its own comment said "or the
    // reverse" and the code did not: sea could not become land, and land could
    // drown freely. The leak compounds at every layer, because each one adds
    // its own noise to whatever survived the last. Measured: the planet is
    // calibrated to Earth's 29% land and came out at 30.4%, and by the march
    // layer that was 12.1% and by the shire layer 8.8%. Two thirds of the
    // world's land drowned on the way down, and what it left behind was a
    // fringe of speckled islands -- land that appears at the edge of a hex and
    // does not continue, because there was nothing left of it to continue.
    // Well inside a cell the layer above has already decided, and detail may
    // not overrule it. Near a boundary the two cells disagree, landness passes
    // through zero, and there the noise decides -- which is where a coastline
    // gets its shape.
    //
    // Read from landness rather than from metres because metres are not
    // symmetric about a coast: land stands 840 m up on average and the sea
    // floor lies 3,688 m down, so a threshold in metres protects the ocean far
    // more strictly than the land, and the noise eats the difference at every
    // layer. Measured before this: a planet solved for 29% land came out at
    // 12% one layer down and 9% the next.
    if (parent.landness > COAST_BAND) e = Math.max(e, 1);
    else if (parent.landness < -COAST_BAND) e = Math.min(e, -1);
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

  // --- climate ---------------------------------------------------------------
  // Split from the biome pass below because the water has to run between them:
  // runoff needs temperature and rainfall, and the biome needs the drainage the
  // water produces. Having both in one loop is what forced the old drainage
  // model to work from elevation alone.
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

    runoffM[c] = elevationM[c] < 0
      ? 0
      : runoffDepthM(precipMm[c], potentialEvapotranspiration(temperatureC[c], sinLat));
  }

  // --- water, with what the layer above is sending us ------------------------
  const resolved = resolveInflow(inflow, basis, dirs, elevationM);
  const isOutlet = new Uint8Array(SUBCELL_COUNT);
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    isOutlet[c] = (ringOf(c) === RADIUS || elevationM[c] < 0) ? 1 : 0;
  }
  const flow = routeWater({
    count: SUBCELL_COUNT,
    neighbours: subNeighbours,
    degree: 6,
    elevationM,
    // A hexagon of circumradius r has area 3*sqrt(3)/2 * r^2 and a spacing of
    // sqrt(3)*r, so this is sqrt(3)/2 * spacing^2. Ninety-one of them come to
    // exactly the parent cell's area, which is what makes the catchment totals
    // reconcile across a layer rather than merely look plausible.
    cellAreaM2: (Math.sqrt(3) / 2) * spacingM * spacingM,
    runoffM,
    isOutlet,
    inflow: resolved,
  });
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    drainage[c] = drainageOf(flow.dischargeM3S[c]);
    alluvial[c] = alluvialFraction(flow.dischargeM3S[c], spacingM);
  }

  // --- everything that reads the water ---------------------------------------
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    const sinLat = dirs[c * 3 + 1];
    // Ordering: waterlogging is needed to classify the biome, and the biome is
    // needed to derive the soil. Waterlogging itself does not read the biome,
    // so it can be computed first with a placeholder.
    waterlogging[c] = calcWaterlogging({
      temperatureC: temperatureC[c],
      precipMm: precipMm[c],
      sinLat,
      slope: slope[c],
      alluvial: alluvial[c],
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

  // --- rock, and what it does to the ground above it -------------------------
  //
  // Last, because it reads the catchment (erosion), the gradient (both) and
  // the biome (root cohesion). The order through this whole function is one
  // long dependency chain and every reordering of it so far has been a bug.
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    const r = rockAt({
      x: dirs[c * 3], y: dirs[c * 3 + 1], z: dirs[c * 3 + 2],
      upliftM: upliftM[c],
      elevationM: elevationM[c],
      oceanic: elevationM[c] < 0 && upliftM[c] < 200,
      sinLat: dirs[c * 3 + 1],
      // Rock provinces are 200 km across and must not stop at a map edge either.
      seed: fieldSeed,
    });
    rock[c] = r;
    erosionMPerYr[c] = erosionRateM(r, flow.catchmentM2[c], slope[c]);
    regolithM[c] = regolithDepthM(r, erosionMPerYr[c], slope[c]);
    stability[c] = factorOfSafety({
      slope: slope[c],
      soilDepthM: regolithM[c],
      rock: r as RockId,
      // Dry, and with the vegetation that is standing. The wet case is what a
      // storm or a felling asks for, and it asks at the tile rather than here,
      // because both are things that happen rather than things that are.
      rootCohesionKPa: rootCohesionKPa(standingCoverOf(biome[c]), 0),
      saturation: 0,
    });
    if (!isFinite(stability[c])) stability[c] = STABILITY_CAP;
  }

  return {
    parent: parentAddress, depth, basis, cellRadiusRad: cellRad, spacingM,
    dirs, elevationM, slope, temperatureC, precipMm, drainage, runoffM, flow,
    alluvial, rock, erosionMPerYr, regolithM, stability,
    hillslopesResolved: spacingM <= A.HILLSLOPE_LENGTH_M,
    waterlogging, nppGm2, biome, upliftM,
    yieldKgPerHa: null,
  };
}

/**
 * Which rim cell each inflow enters at: the lowest one facing its source.
 *
 * The map upstream does not tell us this and does not have to. It says only
 * "this much water is coming from over there"; where it crosses the edge is
 * decided by the edge, and both maps read the same continuous elevation field
 * along it. So the map sending the water and the map receiving it pick the
 * same valley without either one consulting the other, and the river joins up.
 *
 * A face of the hexagon spans 60 degrees, so a rim cell counts as facing the
 * source when it is within 30 degrees of the bearing. If the geometry is odd
 * enough that nothing qualifies -- which the twelve pentagons can manage,
 * their neighbours not being evenly spaced -- the best-facing cell is used
 * rather than dropping the water, because losing a river is worse than
 * putting it one cell off.
 */
const FACE_HALF_ANGLE_COS = Math.sqrt(3) / 2; // cos 30 degrees

function resolveInflow(
  inflow: readonly Boundary[],
  basis: Basis,
  dirs: Float64Array,
  elevationM: Float32Array,
): Boundary[] {
  if (inflow.length === 0) return [];
  const out: Boundary[] = [];

  for (const b of inflow) {
    // The source direction, flattened into this map's tangent plane. Both this
    // and the rim cells' offsets are measured the same way, so comparing them
    // is a plain dot product.
    const dot = b.dir[0] * basis.ox + b.dir[1] * basis.oy + b.dir[2] * basis.oz;
    let wx = b.dir[0] - dot * basis.ox;
    let wy = b.dir[1] - dot * basis.oy;
    let wz = b.dir[2] - dot * basis.oz;
    const wlen = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (wlen < 1e-12) continue; // straight down: no edge to cross
    wx /= wlen; wy /= wlen; wz /= wlen;

    let chosen = -1;
    let chosenElev = Infinity;
    let fallback = -1;
    let fallbackScore = -Infinity;

    for (let c = 0; c < SUBCELL_COUNT; c++) {
      if (ringOf(c) !== RADIUS) continue;
      const cx = dirs[c * 3], cy = dirs[c * 3 + 1], cz = dirs[c * 3 + 2];
      const cd = cx * basis.ox + cy * basis.oy + cz * basis.oz;
      const tx = cx - cd * basis.ox;
      const ty = cy - cd * basis.oy;
      const tz = cz - cd * basis.oz;
      const tlen = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tlen < 1e-12) continue;
      const score = (tx * wx + ty * wy + tz * wz) / tlen;

      if (score > fallbackScore) { fallbackScore = score; fallback = c; }
      if (score >= FACE_HALF_ANGLE_COS && elevationM[c] < chosenElev) {
        chosenElev = elevationM[c];
        chosen = c;
      }
    }

    const cell = chosen >= 0 ? chosen : fallback;
    if (cell >= 0) out.push({ ...b, cell });
  }
  return out;
}

/** Soil for one cell of a generated sub-map. */
export function soilAt(map: SubMap, cell: number): Soil {
  return deriveSoil({
    temperatureC: map.temperatureC[cell],
    precipMm: map.precipMm[cell],
    sinLat: map.dirs[cell * 3 + 1],
    slope: map.slope[cell],
    alluvial: map.alluvial[cell],
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
