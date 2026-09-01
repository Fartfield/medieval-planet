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
  toPixel, pixelOfAxial, fromPixel, nearestCell, ringOf,
} from '../geo/hexgrid.ts';
import {
  CELL_COUNT, CELL_R, cellRadiusScale, centres, neighbours, neighbourCount, cellAt,
} from '../geo/sphere.ts';
import { addressSeed, SALT, type Address } from '../geo/address.ts';
import { fbm3, ridged3 } from './noise.ts';
import { clamp, smoothstep, dpow, lerp, dsin, dcos, datan2, PI } from './mathx.ts';
import { patchFor, cellRadiusForAddress, HEX_PATCH, type Patch } from '../geo/patch.ts';
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
import { meshCellAt, MESH_COLS } from './tectonics.ts';

/**
 * A local frame, in the units the world map itself is laid out in.
 *
 * Not a tangent plane. The world map is a hex grid in (longitude, sine of
 * latitude) -- see geo/sphere.ts -- so a cell up there is a regular hexagon in
 * THAT space and a stretched one on the sphere: at 53 degrees it is 2.7 times
 * taller than it is wide. Children laid out isotropically in a tangent plane
 * therefore cannot tile it, and did not. Measured: at the equator 85 of a
 * region's 91 children fell inside their own parent, which is the same as a
 * flat sub-map manages and is fine; at 53 degrees only 61 did. A third of
 * every polar region's tiles belonged somewhere else.
 *
 * So the axes carry the projection's own scale factors. A step of one unit
 * east is one radian of LONGITUDE, which is cos(lat) radians of arc; a step of
 * one unit north is one unit of SINE OF LATITUDE, which is 1/cos(lat) radians
 * of arc. Offsets handed to `toDirection` are then projection offsets, the
 * children land in the same space their parent is drawn in, and the nesting
 * closes at every latitude for the same reason it always did on flat maps.
 *
 * The projection is applied EXACTLY rather than linearised into scaled axes.
 * A first attempt did the latter -- east times cos(lat), north over cos(lat),
 * and the usual `origin + x·east + y·north` -- which is correct to first order
 * and nowhere near good enough here, because a region spans 2,500 km and the
 * scale factor it linearises is precisely what varies across that span. It
 * left one cell's tiles reaching 76% of its own outline, and dropped the
 * relief between two layers by a factor of 124 where the ladder should lose
 * about five.
 *
 * So the frame carries its anchor in projection coordinates. `toDirection`
 * adds the offset there and converts once, and `cellContaining` converts back
 * the same way. The east and north vectors are kept because a few callers want
 * a direction rather than a coordinate, and for those a first-order frame is
 * exactly right.
 */
export interface Basis {
  ox: number; oy: number; oz: number;
  ex: number; ey: number; ez: number;
  nx: number; ny: number; nz: number;
  /** The anchor, in the projection the world map is laid out in. */
  lon: number;
  sinLat: number;
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
  /** The lowest and highest ground on this map. Bounds what a child may inherit. */
  loM: number;
  hiM: number;
  /** The roughness field, carried down unchanged from the mesh. */
  reliefM: Float32Array;
  /**
   * Which lattice this map is built on, and how many cells it has.
   *
   * 91 hexagons for a hexagonal parent, 76 for a pentagonal one. Everything
   * that used to read SUBCELL_COUNT and assume it applied reads this instead.
   */
  patch: Patch;
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
  /** How rough the simulation says this place is; see tectonics.reliefM. */
  reliefM: number;
}

/**
 * The number a factor of safety is reported as when nothing can slide -- flat
 * ground, or bare rock. Infinity is the honest answer and it does not survive
 * a Float32Array or a JSON round trip, so it is capped where it is stored.
 */
export const STABILITY_CAP = 99;

/** Circumradius of a layer-0 cell in radians, and the ratio per layer down. */
/**
 * A layer-0 cell's circumradius, in the projection's units.
 *
 * Taken from the world grid itself rather than derived from an equal-area
 * hexagon, because the world grid IS the definition now: CELL_R is what makes
 * the band close on itself going east.
 *
 * Every layer divides it by the square root of the child count, which keeps
 * the AREA exactly right -- 91 children of a ninety-first the area. It leaves
 * the arrangement spanning 90.8% of the parent, which is the stepped edge a
 * hexagon of hexagons always has and which the flat maps have always had.
 */
const SHRINK = Math.sqrt(SUBCELL_COUNT);

export function cellRadiusRad(depth: number): number {
  let r = CELL_R;
  for (let i = 0; i < depth; i++) r /= SHRINK;
  return r;
}

/**
 * Build a tangent frame at a point on the sphere.
 *
 * `toward` ORIENTS IT, and that is the load-bearing part rather than a
 * convenience. A sub-map is a hexagon of hexagons laid out in this frame, with
 * its lattice running east: cell 0's first neighbour sits at azimuth zero, and
 * the patch's own corners fall 30 degrees off that. So the frame's east decides
 * which way the whole patch is turned inside its parent.
 *
 * Left to itself the frame took east from the pole, which points somewhere
 * unrelated to the cell it is covering. On the wrapped band that was harmless:
 * every cell there was a hexagon in one shared projection, at one shared
 * orientation, so an arbitrary east happened to line up. On a geodesic each
 * cell is turned differently -- measured, their corners sat at 59, 87, 88, 30
 * and 34 degrees in their own frames -- and the patch was rotated by that much
 * inside its cell. The tiles were all drawn and none of them lined up with the
 * cell holding them, which reads exactly like the constituent parts not being
 * drawn at all.
 *
 * Pointing east at the cell's own first neighbour makes the patch's lattice and
 * the cell's lattice the same lattice.
 */
export function basisAt(
  ox: number, oy: number, oz: number,
  tx?: number, ty?: number, tz?: number,
): Basis {
  let ex: number, ey: number, ez: number;

  if (tx !== undefined && ty !== undefined && tz !== undefined) {
    // The part of the target that lies in this point's tangent plane.
    const dot = tx * ox + ty * oy + tz * oz;
    ex = tx - dot * ox;
    ey = ty - dot * oy;
    ez = tz - dot * oz;
  } else {
    // No target: east from the pole, which is fine only where nothing depends
    // on which way the frame is turned.
    ex = oz; ey = 0; ez = -ox;
  }

  let len = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (len < 1e-9) { ex = oz; ey = 0; ez = -ox; len = Math.sqrt(ex * ex + ez * ez); }
  if (len < 1e-9) { ex = 1; ey = 0; ez = 0; len = 1; }
  ex /= len; ey /= len; ez /= len;

  const nx = oy * ez - oz * ey;
  const ny = oz * ex - ox * ez;
  const nz = ox * ey - oy * ex;

  return {
    ox, oy, oz, ex, ey, ez, nx, ny, nz,
    lon: datan2(oz, ox),
    sinLat: oy,
  };
}

/**
 * A local offset back to a direction on the sphere.
 *
 * LAMBERT AZIMUTHAL EQUAL-AREA, tangent at the map's own centre. Isotropic --
 * the two axes are scaled alike -- and exactly area-preserving: a cap of
 * angular radius t maps to a disc of radius 2.sin(t/2), whose area pi.rho^2 is
 * 2.pi.(1 - cos t), which is the cap's solid angle exactly. So `CELL_R`, solved
 * from a cell's area, is its circumradius here with no conversion at all.
 *
 * IT USED TO BE THE WORLD MAP'S OWN CYLINDRICAL PROJECTION, offsetting
 * longitude and sine-of-latitude directly, and that was right while the world
 * map was a band: a band's cells ARE regular hexagons in that projection, so
 * laying a child map out the same way made it exactly fill its parent. A
 * geodesic's cells are near-regular on the SPHERE instead, and a cylindrical
 * layout would miss them by more the further from the equator it got -- the
 * same complaint, in reverse, that moved this to the projection in the first
 * place. Measured before that move: at 53 degrees only 61 of a map's 91
 * children landed inside their own parent.
 *
 * An isotropic tangent frame is what matches a near-regular cell, so this
 * returns to one. What was wrong before was not the tangent plane, it was that
 * the cells it was asked to cover were not isotropic.
 */
export function toDirection(b: Basis, x: number, y: number, out: Float64Array, at: number): void {
  const rho = Math.sqrt(x * x + y * y);
  if (rho < 1e-12) {
    out[at] = b.ox; out[at + 1] = b.oy; out[at + 2] = b.oz;
    return;
  }
  const theta = 2 * Math.asin(Math.min(1, rho / 2));
  const c = dcos(theta);
  const sn = dsin(theta);
  const ux = x / rho, uy = y / rho;
  const tx = ux * b.ex + uy * b.nx;
  const ty = ux * b.ey + uy * b.ny;
  const tz = ux * b.ez + uy * b.nz;
  out[at] = c * b.ox + sn * tx;
  out[at + 1] = c * b.oy + sn * ty;
  out[at + 2] = c * b.oz + sn * tz;
}

/**
 * A direction back to a local offset: the exact inverse of `toDirection`.
 *
 * ONE FUNCTION, called by everything that needs it. There used to be two
 * inverses written out separately -- one in `cellContaining` and one inlined in
 * `sampleSubMapRaw` -- and when the forward map was changed only one of them
 * followed. Every map was then laid out by one transform and read back by
 * another, exactly at the map centre and by a mean of 247 m everywhere else,
 * and land drained off the world one layer at a time. A forward transform and
 * its inverse are one fact; this is that fact written once.
 */
export function toLocal(b: Basis, x: number, y: number, z: number): { x: number; y: number } {
  const dot = clamp(x * b.ox + y * b.oy + z * b.oz, -1, 1);
  const theta = Math.acos(dot);
  const rho = 2 * dsin(theta / 2);

  let tx = x - dot * b.ox;
  let ty = y - dot * b.oy;
  let tz = z - dot * b.oz;
  const len = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (len < 1e-12) return { x: 0, y: 0 };
  tx /= len; ty /= len; tz /= len;

  return {
    x: rho * (tx * b.ex + ty * b.ey + tz * b.ez),
    y: rho * (tx * b.nx + ty * b.ny + tz * b.nz),
  };
}

/**
 * A direction on the sphere back to the sub-map cell containing it, or -1.
 *
 * TAKES THE PATCH, because the answer depends on which lattice is being asked
 * about. Defaulting to the hexagonal one was fine while there was only one;
 * once pentagons had 76 cells this returned indices up to 90 for them, and a
 * caller built an address naming cell 83 of a 76-cell map.
 */
export function cellContaining(
  b: Basis,
  radiusRad: number,
  x: number,
  y: number,
  z: number,
  patch: Patch = HEX_PATCH,
): number {
  const p = toLocal(b, x, y, z);
  return patch.at(p.x, p.y, radiusRad);
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
  // Straight off the tectonic mesh, not interpolated between the world map's
  // 546 cells.
  //
  // That is the whole point of the mesh existing. Interpolating 546 cells
  // 1,550 km across can only ever give back a coastline shaped like a dozen
  // hexagons, however much detail is added underneath; reading a field
  // simulated at 49 km gives back mountain belts, island arcs, rift valleys
  // and dissected margins, and the layers below add detail to THAT.
  //
  // Precipitation still comes from the world map, because rainfall is a
  // planetary-scale field -- Hadley cells and ocean distance -- and the layers
  // below apply their own orographic correction on top of it as they always
  // did.
  const t = planet.mesh.tect;
  const mesh = meshCellAt(t, datan2(z, x), y);

  // BARYCENTRIC, not inverse-distance, and the difference is the whole field.
  //
  // Inverse-distance weighting has a flat spot at every node -- the gradient
  // goes to zero exactly at a cell centre -- so on a mesh whose neighbours
  // differ by kilometres it degenerates into nearest-neighbour: 69 km plateaus
  // with cliffs between them. Every layer below then inherits those cliffs and
  // rebuilds them, and the relief RISES down the ladder instead of falling.
  // Measured: 177 m across a 200 km map, then 1,603 m across a 21 km one.
  //
  // This is the same mistake as the sub-map sampler's, in a new place, and it
  // has the same answer: barycentric weights over the triangle of cell centres
  // containing the point reproduce a linear field exactly, so a planar
  // hillside stays planar and nothing manufactures a step.
  const g = t.band;
  let dlon = datan2(z, x) - g.lon[mesh];
  if (dlon > PI) dlon -= 2 * PI;
  if (dlon < -PI) dlon += 2 * PI;
  const dsinLat = y - g.sinLat[mesh];

  let we = t.elevationM[mesh];
  let wu = t.upliftM[mesh];
  let wr = t.reliefM[mesh];
  for (let i = 0; i < 6; i++) {
    const na = g.neighbours[mesh * 6 + i];
    const nb = g.neighbours[mesh * 6 + ((i + 1) % 6)];
    if (na < 0 || nb < 0) continue;
    const ax = wrapLon(g.lon[na] - g.lon[mesh]);
    const ay = g.sinLat[na] - g.sinLat[mesh];
    const bx = wrapLon(g.lon[nb] - g.lon[mesh]);
    const by = g.sinLat[nb] - g.sinLat[mesh];

    const det = (ay - by) * (0 - bx) + (bx - ax) * (0 - by);
    if (det === 0) continue;
    const w0 = ((ay - by) * (dlon - bx) + (bx - ax) * (dsinLat - by)) / det;
    const w1 = ((by - 0) * (dlon - bx) + (0 - bx) * (dsinLat - by)) / det;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;

    we = w0 * t.elevationM[mesh] + w1 * t.elevationM[na] + w2 * t.elevationM[nb];
    wu = w0 * t.upliftM[mesh] + w1 * t.upliftM[na] + w2 * t.upliftM[nb];
    wr = w0 * t.reliefM[mesh] + w1 * t.reliefM[na] + w2 * t.reliefM[nb];
    break;
  }

  // Rainfall from the world map, interpolated as before.
  const c = cellAt(x, y, z);
  let wp = 0, psum = 0;
  const addP = (cell: number): void => {
    const dx = centres[cell * 3] - x;
    const dy = centres[cell * 3 + 1] - y;
    const dz = centres[cell * 3 + 2] - z;
    const w = 1 / (dx * dx + dy * dy + dz * dz + 1e-9);
    wp += planet.precipMm[cell] * w;
    psum += w;
  };
  addP(c);
  for (let i = 0; i < neighbourCount(c); i++) {
    const nb = neighbours[c * 6 + i];
    if (nb >= 0) addP(nb);
  }

  return {
    elevationM: we,
    precipMm: wp / psum,
    upliftM: wu,
    reliefM: wr,
  };
}

/** Longitude difference, taken the short way round. */
function wrapLon(d: number): number {
  if (d > PI) return d - 2 * PI;
  if (d < -PI) return d + 2 * PI;
  return d;
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
 * The patch cell nearest a point, clamped in rather than refused.
 *
 * hexgrid has `nearestCell`, which cube-rounds and then scans if the point
 * falls outside. A five-fold lattice has nothing to round with -- no axial
 * coordinates, which is the same reason it has no neighbour table -- so this
 * scans outright. Seventy-six comparisons, only on a pentagon's own map, of
 * which there are ten in the world.
 */
function nearestPatchCell(patch: Patch, x: number, y: number, size: number): number {
  const inside = patch.at(x, y, size);
  if (inside >= 0) return inside;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < patch.count; i++) {
    const p = patch.centre(i, size);
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
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
  const s = sampleSubMapRaw(map, x, y, z, outside);
  // A CHILD CANNOT INHERIT GROUND ITS PARENT DOES NOT HAVE.
  //
  // Interpolating a bounded field gives a bounded answer, and the one thing
  // that legitimately reaches past the parent's own span is the cross-boundary
  // lookup -- a neighbour just outside the map really can be higher than
  // anything in it. One map's span is a generous allowance for that and a hard
  // stop on the alternative.
  //
  // The alternative happened. A depth-7 map, two metres across, inherited
  // 2,197 m of relief from a parent holding one; the ladder then added detail
  // in proportion and produced vertical cliffs at the finest layer. Relief that
  // RISES going down the ladder cannot be right whatever the cause, so this
  // says so directly rather than waiting to find the next cause.
  //
  // Bounded by the parent's own range and not a margin around it. A child map
  // fills ONE CELL of its parent, so every point of it lies inside the parent,
  // and the parent's highest ground is a ceiling on what any of it can inherit.
  // The rim overhangs by a fraction of a cell, which is the one place this is
  // an approximation and the smallest one available -- an allowance of a whole
  // map span instead let each layer treble the last one's relief, which is a
  // slower runaway rather than none.
  return {
    elevationM: clamp(s.elevationM, map.loM, map.hiM),
    precipMm: s.precipMm,
    upliftM: s.upliftM,
    reliefM: s.reliefM,
  };
}

function sampleSubMapRaw(
  map: SubMap,
  x: number,
  y: number,
  z: number,
  outside: Neighbouring | null = null,
): ParentSample {
  const b = map.basis;

  // Through `toLocal`, which is the same inverse `cellContaining` uses and the
  // exact inverse of the map's own layout. This used to be a second copy of the
  // arithmetic and it drifted; see the note on toLocal.
  const local = toLocal(b, x, y, z);
  const lx = local.x;
  const ly = local.y;

  const c = map.patch.sides === 6
    ? nearestCell(lx, ly, map.cellRadiusRad)
    : nearestPatchCell(map.patch, lx, ly, map.cellRadiusRad);

  const p0 = map.patch.centre(c, map.cellRadiusRad);

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
  for (let i = 0; i < 6; i++) {
    const na = map.patch.neighbours[c * 6 + i];
    const nb = map.patch.neighbours[c * 6 + ((i + 1) % 6)];
    if (na < 0 || nb < 0) continue;
    const p1 = map.patch.centre(na, map.cellRadiusRad);
    const p2 = map.patch.centre(nb, map.cellRadiusRad);

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
      reliefM: w0 * map.reliefM[c] + w1 * map.reliefM[na] + w2 * map.reliefM[nb],
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
      reliefM: map.reliefM[c],
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
  let sxe = 0, sye = 0, sxp = 0, syp = 0, sxu = 0, syu = 0;
  const e0 = map.elevationM[c];
  const pr0 = map.precipMm[c];
  const u0 = map.upliftM[c];

  for (let i = 0; i < 6; i++) {
    const n = map.patch.neighbours[c * 6 + i];
    if (n < 0) continue;
    const pn = map.patch.centre(n, map.cellRadiusRad);
    const dx = pn.x - p0.x;
    const dy = pn.y - p0.y;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    sxe += dx * (map.elevationM[n] - e0); sye += dy * (map.elevationM[n] - e0);
    sxp += dx * (map.precipMm[n] - pr0); syp += dy * (map.precipMm[n] - pr0);
    sxu += dx * (map.upliftM[n] - u0); syu += dy * (map.upliftM[n] - u0);
  }

  const det = sxx * syy - sxy * sxy;
  const qx = lx - p0.x;
  const qy = ly - p0.y;

  // Guarded against near-degeneracy, not just exact zero. A rim cell keeps
  // three neighbours and they can sit almost in a line, which leaves `det`
  // small rather than zero -- and dividing by it turns a plane fit into an
  // arbitrarily steep one. It produced -Infinity: one cell of one map came
  // back infinitely deep, the map's inherited range became infinite with it,
  // and every layer below inherited a world clamped between Everest and
  // Challenger Deep. What it looked like was relief that RISES down the
  // ladder, which is the signature of the staircase and was not one.
  //
  // The scale to compare against is the lattice's own: sxx and syy are sums of
  // squared offsets, so their product is the natural size of this determinant.
  if (!(det > 1e-9 * (sxx * syy + 1e-30))) {
    return { elevationM: e0, precipMm: pr0, upliftM: u0, reliefM: map.reliefM[c] };
  }

  // And bounded by what the neighbours actually show. A plane fitted to a
  // handful of points and evaluated outside them is an extrapolation, and an
  // extrapolation is only honest inside the range of what it was fitted to:
  // beyond that it is inventing ground nobody measured.
  let vlo = e0, vhi = e0;
  for (let i = 0; i < 6; i++) {
    const nb = map.patch.neighbours[c * 6 + i];
    if (nb < 0) continue;
    if (map.elevationM[nb] < vlo) vlo = map.elevationM[nb];
    if (map.elevationM[nb] > vhi) vhi = map.elevationM[nb];
  }

  const at = (sx: number, sy: number, base: number): number => {
    const a = (syy * sx - sxy * sy) / det;
    const b = (sxx * sy - sxy * sx) / det;
    const v = base + a * qx + b * qy;
    return Number.isFinite(v) ? v : base;
  };

  return {
    elevationM: clamp(at(sxe, sye, e0), vlo, vhi),
    precipMm: Math.max(0, at(sxp, syp, pr0)),
    upliftM: Math.max(0, at(sxu, syu, u0)),
    reliefM: map.reliefM[c],
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
  // Scaled by how big THIS cell actually is. Cells are near-uniform but the ten
  // pentagons are 0.679 of the mean, and a map sized for the average covers
  // ground its parent does not own. See cellRadiusScale.
  // WHICH LATTICE, and therefore how many cells. A pentagonal cell gets 76 and
  // a hexagonal one 91; see geo/patch.ts for why the pentagons run down the
  // centre of a branch and nowhere else.
  const patch = patchFor(parentAddress);
  const N = patch.count;

  // Walked layer by layer rather than raised to a power, because a pentagonal
  // layer divides by sqrt(76) where a hexagonal one divides by sqrt(91).
  const cellRad = cellRadiusForAddress(
    parentAddress, CELL_R, cellRadiusScale(parentAddress[0]));
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

  const dirs = new Float64Array(N * 3);
  // The parent's fields at each of our cells. Kept rather than re-sampled in
  // the climate pass below: sampling walks the parent's neighbour ring, and
  // doing it twice for 9,919 cells doubled the cost of opening a map.
  const parentElev = new Float32Array(N);
  const parentPrecip = new Float32Array(N);
  const elevationM = new Float32Array(N);
  const precipMm = new Float32Array(N);
  const upliftM = new Float32Array(N);
  const temperatureC = new Float32Array(N);
  const slope = new Float32Array(N);
  const drainage = new Float32Array(N);
  const runoffM = new Float32Array(N);
  const reliefM = new Float32Array(N);
  const rock = new Uint8Array(N);
  const erosionMPerYr = new Float32Array(N);
  const regolithM = new Float32Array(N);
  const stability = new Float32Array(N);
  const alluvial = new Float32Array(N);
  const waterlogging = new Float32Array(N);
  const nppGm2 = new Float32Array(N);
  const biome = new Uint8Array(N);

  // Detail frequency: the noise wavelength has to shrink with the cells, or a
  // ground map inherits the same three hills its region already had. Tie it to
  // the cell size so every layer adds roughness at its own scale.
  const detailFreq = 0.45 / cellRad;

  // Do not invent detail the simulation already has.
  //
  // The planet is simulated on a mesh whose cells are about 69 km, and that
  // mesh carries real mountain belts, rifts and river valleys. A layer whose
  // own cells are coarser than that is a downsample of it and should add
  // nothing; a layer far finer has nothing to read and should add everything.
  //
  // Without this the two are summed and the same landscape is built twice at
  // the same wavelength, which is not more detail -- it is the same detail
  // twice, out of phase with itself, and it shows up as relief that will not
  // fall from one layer to the next.
  const meshSpacingM = (2 * Math.PI * radiusM) / MESH_COLS;
  const belowMesh = clamp((meshSpacingM - spacingM) / (meshSpacingM * 0.75), 0, 1);

  for (let c = 0; c < N; c++) {
    const p = patch.centre(c, cellRad);
    toDirection(basis, p.x, p.y, dirs, c * 3);
    const parent = sample(dirs[c * 3], dirs[c * 3 + 1], dirs[c * 3 + 2]);
    upliftM[c] = parent.upliftM;
    reliefM[c] = parent.reliefM;
    parentElev[c] = parent.elevationM;
    parentPrecip[c] = parent.precipMm;
  }

  // HOW MUCH DETAIL TO ADD, AS A FIELD RATHER THAN A NUMBER.
  //
  // The simulation has already decided how rough each part of the world is, so
  // the ladder asks it: `reliefM` is the elevation spread across a mesh cell,
  // carried down through every layer. Relief goes as the span to the Hurst
  // exponent, so at a cell of `spacingM` the missing detail is that roughness
  // scaled by (spacingM / meshSpacing)^H -- and zero once a layer's own cells
  // are coarser than the mesh, because then the mesh has already supplied it.
  //
  // Per cell, and that is the load-bearing part. Two earlier versions used one
  // number for the whole map -- first the tectonic uplift at its centre, then
  // the map's own observed relief -- and both are discontinuous at a map
  // boundary: neighbouring maps compute different numbers, add different
  // amounts of detail, and disagree along the edge they share. The
  // cross-boundary lookup then reads that disagreement as real ground and the
  // layer below amplifies it. Measured, that ran away to a two-metre map
  // inheriting 2,197 m of relief. A field is continuous by construction, so
  // neighbours agree because they are reading the same thing.

  for (let c = 0; c < N; c++) {
    const x = dirs[c * 3], y = dirs[c * 3 + 1], z = dirs[c * 3 + 2];

    // Rolling detail everywhere, plus ridges gated to ground that is already
    // being pushed up -- the same trick the planet uses, one scale down.
    const rolling = fbm3(x * detailFreq, y * detailFreq, z * detailFreq, fieldSeed ^ 0x1d, 5);
    const crest = ridged3(x * detailFreq * 2.3, y * detailFreq * 2.3, z * detailFreq * 2.3, fieldSeed ^ 0x2e, 3);
    const gate = smoothstep(300, 2800, upliftM[c]);
    const detailAmp = reliefM[c] * dpow(spacingM / meshSpacingM, A.TOPOGRAPHY_HURST) * belowMesh;

    let e = parentElev[c] + rolling * detailAmp + crest * gate * detailAmp * 0.8;

    // NO COASTLINE GUARD -- see the note in fix-attempts.md. The one bound kept
    // is the planet's own: no point on Earth is above Everest or below
    // Challenger Deep, and both are anchored.
    elevationM[c] = clamp(e, A.MAX_DEPTH_M, A.MAX_ELEVATION_M);
  }

  let mapLo = Infinity;
  let mapHi = -Infinity;
  for (let c = 0; c < N; c++) {
    if (elevationM[c] < mapLo) mapLo = elevationM[c];
    if (elevationM[c] > mapHi) mapHi = elevationM[c];
  }

  // --- slope, from the neighbours we have -----------------------------------
  for (let c = 0; c < N; c++) {
    let worst = 0;
    for (let d = 0; d < 6; d++) {
      const n = patch.neighbours[c * 6 + d];
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
  for (let c = 0; c < N; c++) {
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
  const resolved = resolveInflow(inflow, basis, dirs, elevationM, patch);
  const isOutlet = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    isOutlet[c] = (patch.ring(c) === patch.radius || elevationM[c] < 0) ? 1 : 0;
  }
  const flow = routeWater({
    count: N,
    neighbours: patch.neighbours,
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
  for (let c = 0; c < N; c++) {
    drainage[c] = drainageOf(flow.dischargeM3S[c]);
    alluvial[c] = alluvialFraction(flow.dischargeM3S[c], spacingM);
  }

  // --- everything that reads the water ---------------------------------------
  for (let c = 0; c < N; c++) {
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
  for (let c = 0; c < N; c++) {
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
    loM: mapLo, hiM: mapHi, reliefM, patch,
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
  patch: Patch,
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

    for (let c = 0; c < patch.count; c++) {
      if (patch.ring(c) !== patch.radius) continue;
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
  const out = new Float32Array(map.patch.count);
  for (let c = 0; c < map.patch.count; c++) {
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
