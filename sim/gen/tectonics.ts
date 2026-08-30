// Plate tectonics, run on a mesh fine enough for the answer to look like a
// planet rather than like the grid it was computed on.
//
// WHY THIS EXISTS
//
// Continents used to be decided at the resolution of the world map: a few hundred cells,
// 1,550 km across. Everything below inherited that and added noise, so a
// coastline's large-scale shape was a cluster of hexagons however much detail
// was painted inside them. No amount of child detail fixes a continent whose
// outline was drawn with a dozen tiles.
//
// So the physics moved off the gameplay grid. Tectonics, elevation and erosion
// run on a band of 196,608 cells at 49 km, and the world map samples that.
// The gameplay ladder is unchanged; it just reads a field that knows about
// mountain belts, rifts, island arcs and river valleys instead of one that
// knows about 546 hexagons.
//
// 49 km is not arbitrary. It is about the width of a large river's floodplain
// and a third the width of a mountain range, so the features that give a
// coastline its shape are resolved rather than implied.
//
// WHAT IS SIMULATED
//
// Plates are rigid caps rotating about Euler poles, which is how plate motion
// is actually described -- a plate does not translate, it turns about an axis
// through the centre of the Earth, and that is why the same plate opens an
// ocean at one end while closing one at the other.
//
// At every boundary the relative velocity is split into the component across
// the boundary and the component along it, and those two numbers decide
// everything:
//
//   closing + both continental   collision, crust thickens, a Himalaya
//   closing + one oceanic        subduction: a trench, and an arc inboard
//   closing + both oceanic       an island arc
//   opening                      a rift, then a ridge and new ocean floor
//   sliding                      a transform fault: little relief, big offset
//
// Elevation then comes from two measured laws rather than from taste. Land
// stands up because crust floats -- Airy isostasy on the thickness the
// collisions built -- and the sea floor sinks as it cools and ages, by the
// half-space law depth = 2500 + 350·sqrt(age), which is why ridges are shallow
// and old basins are deep.
//
// Finally the whole thing erodes: real drainage over the mesh, stream-power
// incision along it, and hillslope diffusion. That is what dissects a
// continental margin into headlands and bays, and it is the step that makes
// coastlines stop looking generated.

import * as A from '../anchors.ts';
import { buildBand, bandCellAt, type Band } from '../geo/band.ts';
import { ROWS, COLS } from '../geo/sphere.ts';
import { fbm3, hash3, unit } from './noise.ts';
import { clamp, dpow } from './mathx.ts';
import { routeWater } from './hydrology.ts';

/**
 * The physics mesh: the world grid, refined.
 *
 * Derived from ROWS and COLS rather than written down again, and that is
 * load-bearing rather than tidy. `BAND_SIN_LIMIT` is 2.72070 x ROWS/COLS, so
 * two grids reach the same latitude if and only if they share that ratio --
 * and the mesh has to reach at least as far as the world map, or the cells in
 * the world's outermost row would be summarising a planet that stops short of
 * them. Refining both counts by the same integer makes the two limits
 * identical by construction, so the ratio cannot be broken by editing one of
 * them.
 *
 * 15 gives 585 x 210 = 122,850 cells at 68.4 km, which is the resolution the
 * tectonic model was calibrated at.
 */
const MESH_REFINE = 15;
export const MESH_COLS = COLS * MESH_REFINE;
export const MESH_ROWS = ROWS * MESH_REFINE;

export interface Tectonics {
  band: Band;
  /** Which plate each mesh cell belongs to. */
  plate: Int16Array;
  /** 1 where the crust is continental. */
  continental: Uint8Array;
  /** Crustal thickness, km. Thickens where plates collide. */
  crustKm: Float32Array;
  /** Distance to the nearest spreading centre, in cells. Sets sea-floor age. */
  ridgeSteps: Int32Array;
  /** Metres relative to sea level, which is exactly zero by construction. */
  elevationM: Float32Array;
  /** How much crust was piled up here by convergence. Drives the ore model. */
  upliftM: Float32Array;
  /**
   * How rough the ground is here: the spread of elevation across a cell and
   * its neighbours, smoothed.
   *
   * The ladder below needs to know how much detail to add, and this is the
   * honest answer -- the simulation has already decided whether this is a
   * mountain belt or an abyssal plain, so ask it rather than a proxy.
   *
   * It has to be a FIELD and not a per-map number. Measuring each sub-map's
   * own inherited relief and scaling from that seems equivalent and is not:
   * two neighbouring maps measure different numbers, so they add different
   * amounts of detail, and they disagree along the boundary they share. The
   * cross-boundary lookup then reads that disagreement as real ground and the
   * next layer down amplifies it. A field is continuous by construction, so
   * neighbouring maps agree because they are reading the same thing.
   */
  reliefM: Float32Array;
}

/**
 * How long the plates are run for, in steps.
 *
 * Not years: the boundary forcing is accumulated and then spread, so what this
 * controls is how far a belt grows rather than a date. Forty is where the
 * mountain belts stop widening appreciably.
 */
const STEPS = 40;

/** How many neighbours a mesh cell has at most. */
const DEGREE = 6;

export function simulateTectonics(seed: number, radiusM: number): Tectonics {
  const band = buildBand(MESH_COLS, MESH_ROWS);
  const n = band.count;

  const plate = new Int16Array(n).fill(-1);
  const continental = new Uint8Array(n);
  const crustKm = new Float32Array(n);
  const upliftM = new Float32Array(n);

  // --- plates ---------------------------------------------------------------
  const poles = seedPlates(seed, band, plate);

  // --- what the crust is ----------------------------------------------------
  //
  // Continental crust is laid down as a multi-fractal field rather than by
  // plate, because on Earth it is not a plate property either: the African
  // plate carries a continent and an ocean, and the Pacific plate carries
  // almost none. The threshold is set to Earth's continental share of the
  // surface, shelves included.
  //
  // THREE OCTAVES, not seven, and that is a measurement rather than a taste.
  // A craton is a compact thing: the median point of Earth's land is 600 km
  // from the sea. At seven octaves this field made gorgeous fractal coastlines
  // around forty-three landmasses whose median point was 417 km from water --
  // an archipelago. At three it makes five, at 625 km, which is Earth.
  //
  // The coastline's roughness is not this field's job. It comes from the
  // elevation octaves below and from the erosion after them, which dissect a
  // compact margin into headlands and bays. Asking one field for both the
  // shape and the edge gets neither.
  const craton = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const x = band.centres[c * 3], y = band.centres[c * 3 + 1], z = band.centres[c * 3 + 2];
    craton[c] = fbm3(x * 1.2, y * 1.2, z * 1.2, seed ^ 0x9c1, 3);
  }
  const threshold = quantile(craton, 1 - A.CONTINENTAL_FRACTION);
  for (let c = 0; c < n; c++) {
    continental[c] = craton[c] > threshold ? 1 : 0;
    crustKm[c] = continental[c] ? A.CRUST_CONTINENTAL_KM : A.CRUST_OCEANIC_KM;
  }

  // --- what the plates do to each other -------------------------------------
  const closing = new Float32Array(n);
  const opening = new Float32Array(n);
  const sliding = new Float32Array(n);
  boundaryForcing(band, plate, poles, radiusM, closing, opening, sliding);

  // Accumulate over the run, spreading inland each step. A collision does not
  // raise a line, it raises a belt: measured orogens are 150 to 500 km wide,
  // which at 49 km cells is three to ten of them, and spreading a little on
  // every step is what turns the boundary into one.
  const thickening = new Float32Array(n);
  const scratch = new Float32Array(n);
  for (let step = 0; step < STEPS; step++) {
    for (let c = 0; c < n; c++) {
      if (closing[c] <= 0) continue;
      // Continental collision piles crust up; subduction builds an arc, which
      // is real but a good deal smaller than a Himalaya.
      const gain = continental[c] === 1
        ? closing[c] * A.COLLISION_THICKENING_KM
        : closing[c] * A.ARC_THICKENING_KM;
      thickening[c] += gain;
    }
    // Rifting thins the crust it pulls apart.
    for (let c = 0; c < n; c++) {
      if (opening[c] > 0) thickening[c] -= opening[c] * A.RIFT_THINNING_KM;
    }
    spread(band, thickening, scratch, A.OROGEN_SPREAD);
  }

  for (let c = 0; c < n; c++) {
    crustKm[c] = Math.max(A.CRUST_MINIMUM_KM, crustKm[c] + thickening[c]);
    // A collision that thickens continental crust also carries the hydrothermal
    // history the ore model wants, so it is recorded in the units that model
    // already speaks.
    upliftM[c] = Math.max(0, thickening[c]) * 1000 * A.ISOSTATIC_FREEBOARD;
  }

  // --- how far the sea floor is from where it was made ----------------------
  const ridgeSteps = ridgeDistance(band, plate, opening);

  // --- elevation ------------------------------------------------------------
  const elevationM = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    if (continental[c] === 1) {
      // Airy isostasy: a crustal column floats on the mantle, and what stands
      // above sea level is the part the density difference will not let sink.
      elevationM[c] = (crustKm[c] * A.ISOSTATIC_FREEBOARD - A.ISOSTATIC_DATUM_KM) * 1000;
    } else {
      // The sea floor sinks as it cools. Age is taken from the distance to the
      // spreading centre that made it, over the spreading rate.
      const km = ridgeSteps[c] * band.cellR * radiusM / 1000;
      const ageMyr = km / A.SPREADING_HALF_RATE_KM_PER_MYR;
      elevationM[c] = -(A.RIDGE_CREST_DEPTH_M
        + A.THERMAL_SUBSIDENCE_COEFF * Math.sqrt(Math.max(0, ageMyr)));
    }
  }

  // Roughness, at every scale, so that nothing in the field has a single
  // characteristic size. Amplitude falls with frequency at the measured Hurst
  // exponent -- the same one the ladder below uses, because it is the same
  // property of the same terrain.
  for (let c = 0; c < n; c++) {
    const x = band.centres[c * 3], y = band.centres[c * 3 + 1], z = band.centres[c * 3 + 2];
    let amp = A.MESH_RELIEF_M;
    let freq = 3.0;
    for (let octave = 0; octave < 6; octave++) {
      elevationM[c] += fbm3(x * freq, y * freq, z * freq, (seed ^ 0x51e) + octave, 3) * amp;
      freq *= 2;
      amp *= dpow(0.5, A.TOPOGRAPHY_HURST);
    }
  }

  solveSeaLevel(elevationM);
  erode(band, elevationM, radiusM, seed);
  drownStormMargin(band, elevationM);
  solveSeaLevel(elevationM);

  // How rough each part of the world came out, measured rather than assumed.
  const reliefM = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    let lo = elevationM[c], hi = elevationM[c];
    for (let d = 0; d < DEGREE; d++) {
      const nb = band.neighbours[c * DEGREE + d];
      if (nb < 0) continue;
      if (elevationM[nb] < lo) lo = elevationM[nb];
      if (elevationM[nb] > hi) hi = elevationM[nb];
    }
    reliefM[c] = hi - lo;
  }
  // Smoothed, so that a single deep cell does not make its whole neighbourhood
  // read as mountains -- roughness is a property of a region, not of a pixel.
  const smooth = new Float32Array(n);
  for (let pass = 0; pass < 3; pass++) spread(band, reliefM, smooth, 0.5);

  return { band, plate, continental, crustKm, ridgeSteps, elevationM, upliftM, reliefM };
}

// ---------------------------------------------------------------------------

/** A plate's motion: an axis through the centre of the Earth, and a rate. */
interface Pole {
  x: number; y: number; z: number;
  /** Radians per year. Speed at the equator of the pole is this times R. */
  rate: number;
}

/**
 * Scatter plate nuclei and grow them outward.
 *
 * Grown breadth-first from the seeds, so a plate's outline follows the mesh
 * rather than a straight Voronoi edge -- and because the frontier advances one
 * ring at a time from a handful of points, the boundaries come out irregular
 * in the way real ones are.
 */
function seedPlates(seed: number, band: Band, plate: Int16Array): Pole[] {
  const n = band.count;
  const poles: Pole[] = [];
  const frontier: number[] = [];

  for (let p = 0; p < A.TECTONIC_PLATES; p++) {
    // Spread the nuclei out by rejecting any that lands on top of another.
    let cell = 0;
    for (let tries = 0; tries < 64; tries++) {
      cell = Math.floor(unit(hash3(p, tries, 11, seed)) * n) % n;
      if (plate[cell] < 0) break;
    }
    plate[cell] = p;
    frontier.push(cell);

    // An Euler pole: a direction, and a rate inside the measured range for
    // plate motion, which is 10 to 100 mm a year.
    let ax = unit(hash3(p, 1, 2, seed)) * 2 - 1;
    let ay = unit(hash3(p, 3, 4, seed)) * 2 - 1;
    let az = unit(hash3(p, 5, 6, seed)) * 2 - 1;
    const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= len; ay /= len; az /= len;
    const speed = A.PLATE_SPEED_MIN_M_PER_YR
      + unit(hash3(p, 7, 8, seed)) * (A.PLATE_SPEED_MAX_M_PER_YR - A.PLATE_SPEED_MIN_M_PER_YR);
    poles.push({ x: ax, y: ay, z: az, rate: speed / A.EARTH_RADIUS_M });
  }

  // Breadth-first growth, one ring at a time, all plates advancing together.
  let head = 0;
  while (head < frontier.length) {
    const c = frontier[head++];
    for (let d = 0; d < DEGREE; d++) {
      const nb = band.neighbours[c * DEGREE + d];
      if (nb < 0 || plate[nb] >= 0) continue;
      plate[nb] = plate[c];
      frontier.push(nb);
    }
  }
  for (let c = 0; c < n; c++) if (plate[c] < 0) plate[c] = 0;
  return poles;
}

/**
 * What each boundary is doing, in metres a year.
 *
 * The relative velocity of two plates at their shared boundary is split into
 * the part across it and the part along it. Across is convergence or
 * divergence and builds or destroys crust; along is a transform fault, which
 * moves a great deal of rock sideways and very little of it up.
 */
function boundaryForcing(
  band: Band,
  plate: Int16Array,
  poles: Pole[],
  radiusM: number,
  closing: Float32Array,
  opening: Float32Array,
  sliding: Float32Array,
): void {
  const n = band.count;
  for (let c = 0; c < n; c++) {
    const pa = plate[c];
    const ax = band.centres[c * 3], ay = band.centres[c * 3 + 1], az = band.centres[c * 3 + 2];
    // Velocity is the Euler pole crossed with the position: that is what a
    // rigid cap turning about an axis does, and it is why a plate's speed
    // varies along its own length.
    const pa_ = poles[pa];
    const vax = (pa_.y * az - pa_.z * ay) * pa_.rate * radiusM;
    const vay = (pa_.z * ax - pa_.x * az) * pa_.rate * radiusM;
    const vaz = (pa_.x * ay - pa_.y * ax) * pa_.rate * radiusM;

    for (let d = 0; d < DEGREE; d++) {
      const nb = band.neighbours[c * DEGREE + d];
      if (nb < 0) continue;
      const pb = plate[nb];
      if (pb === pa) continue;

      const bx = band.centres[nb * 3], by = band.centres[nb * 3 + 1], bz = band.centres[nb * 3 + 2];
      const pb_ = poles[pb];
      const vbx = (pb_.y * bz - pb_.z * by) * pb_.rate * radiusM;
      const vby = (pb_.z * bx - pb_.x * bz) * pb_.rate * radiusM;
      const vbz = (pb_.x * by - pb_.y * bx) * pb_.rate * radiusM;

      // The boundary normal: from here to there, flattened onto the surface.
      let nx = bx - ax, ny = by - ay, nz = bz - az;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-12) continue;
      nx /= nl; ny /= nl; nz /= nl;

      const rx = vax - vbx, ry = vay - vby, rz = vaz - vbz;
      const across = rx * nx + ry * ny + rz * nz;
      const alongX = rx - across * nx;
      const alongY = ry - across * ny;
      const alongZ = rz - across * nz;
      const along = Math.sqrt(alongX * alongX + alongY * alongY + alongZ * alongZ);

      if (across > 0) closing[c] += across;
      else opening[c] += -across;
      sliding[c] += along;
    }
  }
}

/**
 * How many cells each piece of sea floor is from the nearest spreading centre.
 *
 * A breadth-first sweep out from every divergent boundary. The result stands in
 * for age: sea floor is made at a ridge and carried away from it at the
 * spreading rate, so distance over rate is how long it has had to cool.
 *
 * Where a plate has no ridge at all the distance stays at the far end of the
 * sweep, which reads as old, cold, deep basin -- which is what an ocean with no
 * spreading centre in it would be.
 */
function ridgeDistance(band: Band, plate: Int16Array, opening: Float32Array): Int32Array {
  const n = band.count;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;

  for (let c = 0; c < n; c++) {
    if (opening[c] > 0) { dist[c] = 0; queue[tail++] = c; }
  }
  // No ridge anywhere: everything is equally old.
  if (tail === 0) { dist.fill(40); return dist; }

  while (head < tail) {
    const c = queue[head++];
    for (let d = 0; d < DEGREE; d++) {
      const nb = band.neighbours[c * DEGREE + d];
      if (nb < 0 || dist[nb] >= 0) continue;
      dist[nb] = dist[c] + 1;
      queue[tail++] = nb;
    }
  }
  for (let c = 0; c < n; c++) if (dist[c] < 0) dist[c] = 200;
  return dist;
}

/** One pass of neighbour averaging, weighted so the centre keeps most of itself. */
function spread(band: Band, field: Float32Array, scratch: Float32Array, rate: number): void {
  const n = band.count;
  for (let c = 0; c < n; c++) {
    let sum = 0, count = 0;
    for (let d = 0; d < DEGREE; d++) {
      const nb = band.neighbours[c * DEGREE + d];
      if (nb < 0) continue;
      sum += field[nb];
      count++;
    }
    scratch[c] = count === 0 ? field[c] : field[c] * (1 - rate) + (sum / count) * rate;
  }
  scratch.forEach((v, i) => { field[i] = v; });
}

/**
 * Wear the landscape down: real drainage, stream-power incision, and creep.
 *
 * This is the step that stops a coastline looking generated. A tectonic field
 * gives mountain belts and basins and nothing in between; erosion cuts the
 * valleys that turn a smooth margin into headlands and bays, and it does it
 * along the drainage the water actually takes rather than along a filter.
 *
 * The routing is the same priority-flood the gameplay layers use -- it is
 * generic over a neighbour graph, so it runs on 196,608 cells as readily as on
 * 91 -- which means the rivers on the world map and the rivers on a parish map
 * are computed by one piece of code.
 */
function erode(band: Band, elevationM: Float32Array, radiusM: number, seed: number): void {
  const n = band.count;
  const cellAreaM2 = (Math.sqrt(3) / 2) * (Math.sqrt(3) * band.cellR * radiusM) ** 2;
  const spacingM = Math.sqrt(3) * band.cellR * radiusM;
  const runoff = new Float32Array(n).fill(0.3);
  const isOutlet = new Uint8Array(n);
  const scratch = new Float32Array(n);

  for (let pass = 0; pass < A.MESH_EROSION_PASSES; pass++) {
    for (let c = 0; c < n; c++) isOutlet[c] = elevationM[c] < 0 ? 1 : 0;

    const flow = routeWater({
      count: n,
      neighbours: band.neighbours,
      degree: DEGREE,
      elevationM,
      cellAreaM2,
      runoffM: runoff,
      isOutlet,
      inflow: [],
    });

    for (let c = 0; c < n; c++) {
      if (elevationM[c] <= 0) continue;
      const to = flow.downstream[c];
      const drop = to < 0 ? 0 : Math.max(0, elevationM[c] - elevationM[to]);
      const slope = drop / spacingM;
      // Stream power: E = K·sqrt(A)·S, the same law and the same exponents the
      // tile layer uses. Scaled to a pass rather than to a year, because what
      // is wanted here is the shape a landscape settles into and not a date.
      const cut = A.MESH_EROSION_RATE * Math.sqrt(flow.catchmentM2[c]) * slope;
      elevationM[c] = Math.max(elevationM[c] - cut, elevationM[c] * 0.5);
    }

    // Creep: hillslopes round off between the channels, which is what stops
    // the result looking like a drainage network drawn on a plain.
    spread(band, elevationM, scratch, A.MESH_CREEP);
  }
}

/**
 * No land touches the storms.
 *
 * The two caps are permanent storms rather than ice, and nothing makes
 * landfall against them: the last thing before the wall of weather is open
 * water. So the outermost row of world cells -- the ones whose missing
 * neighbours ARE the cap -- is drowned outright.
 *
 * The width is taken from the grid rather than chosen. "No land touches it"
 * means no cell that borders a cap may be land, a cell that borders a cap is
 * exactly one that sits in the outermost row, and a world row is
 * `1.5 x CELL_R` of sine-latitude tall. That is the whole derivation. The
 * taper over the half-row inside it is the one free part, and it is there so
 * the coast recedes rather than ending on a drawn circle of latitude.
 *
 * WORTH KNOWING WHAT THIS COSTS. Sine-latitude compresses towards the pole, so
 * one row up there is a great deal of latitude: the outermost row spans 56.8
 * to 77.6 degrees, and drowning it means this world has no land above about 57
 * degrees at all. There is no Scandinavia and no Siberia. That is inherent in
 * "no land touches the caps" rather than a knob -- a whole cell is land or it
 * is not -- and it suits a world whose poles are a permanent storm nobody
 * sails into.
 *
 * Run before the final `solveSeaLevel`, which is what keeps the planet honest:
 * the sea level is re-solved to Earth's land fraction afterwards, so the land
 * drowned here comes back at lower latitudes instead of being lost.
 */
function drownStormMargin(band: Band, elev: Float32Array): void {
  // The WORLD row height, not the mesh's. The mesh is the world grid refined
  // by an integer, so one world row is that many mesh rows.
  const rowH = 1.5 * band.cellR * MESH_REFINE;
  const outer = band.sinLimit - rowH;
  const inner = band.sinLimit - 1.5 * rowH;

  // Deep water of this planet's own making rather than a depth typed in here.
  const deep = quantile(elev, 0.10);

  for (let c = 0; c < elev.length; c++) {
    const s = band.sinLat[c] < 0 ? -band.sinLat[c] : band.sinLat[c];
    if (s <= inner) continue;
    const u = clamp((s - inner) / (outer - inner), 0, 1);
    const t = u * u * (3 - 2 * u);
    elev[c] = elev[c] * (1 - t) + deep * t;
  }
}

/**
 * Put the shoreline where Earth's is.
 *
 * Rather than picking a sea level and hoping the land fraction comes out
 * plausible, take the elevation that leaves exactly LAND_FRACTION of the
 * surface above it, then stretch each side of the shoreline so the mean land
 * height and mean ocean depth match Earth's as well. The hypsometric curve
 * pinned at three points instead of one.
 */
function solveSeaLevel(elev: Float32Array): void {
  const sea = quantile(elev, 1 - A.LAND_FRACTION);
  for (let c = 0; c < elev.length; c++) elev[c] -= sea;

  let landSum = 0, landCount = 0, seaSum = 0, seaCount = 0;
  for (let c = 0; c < elev.length; c++) {
    if (elev[c] > 0) { landSum += elev[c]; landCount++; }
    else { seaSum += elev[c]; seaCount++; }
  }
  const landScale = landCount > 0 ? A.MEAN_LAND_ELEVATION_M / (landSum / landCount) : 1;
  const seaScale = seaCount > 0 ? -A.MEAN_OCEAN_DEPTH_M / (seaSum / seaCount) : 1;
  for (let c = 0; c < elev.length; c++) {
    elev[c] *= elev[c] > 0 ? landScale : seaScale;
    elev[c] = clamp(elev[c], A.MAX_DEPTH_M, A.MAX_ELEVATION_M);
  }
}

/** The value at a given fraction of the way up a field, without sorting it in place. */
function quantile(field: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(field).sort();
  return sorted[Math.floor(clamp(fraction, 0, 1) * (sorted.length - 1))];
}

/**
 * The simulated planet for a seed, built once.
 *
 * Memoised because it costs a few seconds and the World is constructed dozens
 * of times over a test run, always from the same handful of seeds. This is not
 * state: it is a pure function of the seed, thrown away and rebuilt identically
 * whenever it is wanted, which is the same contract every other generated
 * thing in the project has. It is only cached because it is dear.
 *
 * Two entries, because a run has a main world and occasionally one other, and
 * each is nine megabytes.
 */
const cache = new Map<number, Tectonics>();

export function tectonicsFor(seed: number, radiusM: number): Tectonics {
  const key = seed;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const built = simulateTectonics(seed, radiusM);
  if (cache.size >= 2) cache.delete(cache.keys().next().value as number);
  cache.set(key, built);
  return built;
}

/** Which mesh cell holds a point, given its projection coordinates. */
export function meshCellAt(t: Tectonics, lon: number, sinLat: number): number {
  return bandCellAt(t.band, lon, sinLat);
}
