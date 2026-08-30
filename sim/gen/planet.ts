// Layer zero: build a world.
//
// This runs once per world seed and produces all 10,242 regions at once. That
// is a deliberate exception to the generate-on-demand rule everywhere else,
// and it is forced by the physics: plate boundaries, sea level and distance to
// the ocean are all *global* properties. You cannot know whether a cell is
// coastal by looking only at that cell. Ten thousand cells is nothing -- the
// whole planet builds in a few milliseconds and is then the fixed context that
// every lower layer inherits.
//
// THE ORDER IS THE ARGUMENT
//
// Tectonics decide where the mountains are. Mountains and latitude decide the
// climate. Climate decides the vegetation. Each step reads only from steps
// above it, which is why the world comes out looking like somewhere rather
// than like noise: the Atacama is dry because it sits behind the Andes, and if
// you generate rainfall before relief you cannot express that.

import * as A from '../anchors.ts';
import { routeWater, runoffM as runoffDepthM, drainageOf, type Flow } from './hydrology.ts';
import { tectonicsFor, meshCellAt, type Tectonics } from './tectonics.ts';
import {
  CELL_COUNT, centres, neighbours, neighbourCount, cellAt,
} from '../geo/sphere.ts';
import { fbm3, ridged3, hash3, unit } from './noise.ts';
import { dexp, clamp, smoothstep, datan2 } from './mathx.ts';
import {
  Biome, classify, miamiNPP, potentialEvapotranspiration, type BiomeId,
} from '../model/biome.ts';

export interface Planet {
  seed: number;
  radiusM: number;
  /** Which plate each cell belongs to. */
  plate: Int16Array;
  /** Per plate: 1 if oceanic crust. */
  plateOceanic: Uint8Array;
  /** Per plate: drift as a tangent vector, m/yr, packed xyz. */
  plateDrift: Float64Array;
  /** Metres relative to sea level, which is exactly zero by construction. */
  elevationM: Float32Array;
  temperatureC: Float32Array;
  precipMm: Float32Array;
  nppGm2: Float32Array;
  biome: Uint8Array;
  /** Steps to the nearest ocean cell. Zero for ocean itself. */
  oceanDistance: Int16Array;

  /** Depth of water leaving each cell in a year, metres. */
  runoffM: Float32Array;
  /**
   * Where the water goes at continental scale.
   *
   * At 2,922 km a cell this is not a river and is not claimed to be one. It is
   * the divide structure -- which way each part of a continent tilts -- and
   * that is exactly and only what a sub-map needs from it to know how much
   * water crosses its own edge. See gen/hydrology.ts.
   */
  flow: Flow;
  /** Discharge on the 0..1 scale, for drawing and for the soil model. */
  drainage: Float32Array;

  /**
   * The planet the world map is a summary of.
   *
   * Every layer below reads this directly rather than interpolating between
   * the world map's 546 cells, which is what stops a coastline's shape being
   * decided by a dozen hexagons.
   */
  mesh: PlanetMesh;
}

/** The planet at mesh resolution: what was simulated, before it was summarised. */
export interface PlanetMesh {
  tect: Tectonics;
  temperatureC: Float32Array;
  precipMm: Float32Array;
  nppGm2: Float32Array;
  biome: Uint8Array;
  oceanDistance: Int16Array;
}


/**
 * The climate knobs, gathered so that calibration can sweep them.
 *
 * They exist as a parameter rather than as bare constants because the fit that
 * matters is not to any single one of them -- it is to the *land cover the
 * whole model produces*, which only emerges after tectonics, temperature,
 * rainfall and classification have all run. verify/calibrate_climate.ts sweeps
 * this object against Earth's observed forest/grass/desert/tundra fractions
 * and reports the best fit. Shipping defaults come from anchors.ts and are the
 * output of that sweep.
 */
export interface ClimateParams {
  itczMm: number;
  itczWidth: number;
  frontMm: number;
  frontCentre: number;
  frontWidth: number;
  backgroundMm: number;
  /** Rain lost per kilometre of travel inland. */
  continentality: number;
  /** Metres of ascent that doubles the rainfall on a windward slope. */
  orographicM: number;
  /** Metres of descent that drives a lee slope to its driest. */
  leeM: number;
  /** How dry a rain shadow can get, as a fraction of what it would have had. */
  leeFloor: number;
}

export const DEFAULT_CLIMATE: ClimateParams = {
  itczMm: A.PRECIP_ITCZ_MM,
  itczWidth: A.PRECIP_ITCZ_WIDTH,
  frontMm: A.PRECIP_POLAR_FRONT_MM,
  frontCentre: A.PRECIP_POLAR_FRONT_CENTRE,
  frontWidth: A.PRECIP_POLAR_FRONT_WIDTH,
  backgroundMm: A.PRECIP_BACKGROUND_MM,
  continentality: A.CONTINENTALITY_PER_KM,
  orographicM: A.OROGRAPHIC_DOUBLING_M,
  leeM: A.RAIN_SHADOW_M,
  leeFloor: A.RAIN_SHADOW_FLOOR,
};

export function generatePlanet(
  seed: number,
  radiusM = A.EARTH_RADIUS_M,
  climate: ClimateParams = DEFAULT_CLIMATE,
): Planet {
  // THE MESH IS THE PLANET. Tectonics, elevation, erosion, climate and biome
  // are all computed on 122,850 cells at 68 km, and the world map's 546 cells
  // are a summary of that rather than the thing itself.
  //
  // That inversion is the whole change. Before it, a coastline's shape was
  // decided by a few hundred hexagons 1,550 km across and every layer below inherited
  // that outline; now every layer reads a field that knows about mountain
  // belts, rifts, island arcs and river valleys, and adds its own detail to it.
  //
  // The climate runs on the mesh too, and that matters as much as the
  // elevation: a rain shadow is 100 km wide, so on the old grid it could not
  // exist at all. Here it lands on the mountain that casts it.
  const mesh = planetMesh(seed, radiusM, climate);
  const t = mesh.tect;

  const spacingKm = (Math.sqrt(3) * Math.sqrt(
    (4 * Math.PI) / CELL_COUNT / ((3 * Math.sqrt(3)) / 2)) * radiusM) / 1000;

  // --- the world map, as a summary of the mesh ------------------------------
  //
  // By MEDIAN for elevation, not mean, and the difference is every coastline.
  // A world cell covers about six hundred mesh cells; average one that is half
  // mountain and half abyss and the answer is deep ocean, so averaging turned a
  // mesh that is 29.2% land into a world map that was 16.1% land. Every coastal
  // region drowned -- which is exactly the class of region that matters.
  const buckets = bucketMesh(t);
  const elevationM = new Float32Array(CELL_COUNT);
  const temperatureC = new Float32Array(CELL_COUNT);
  const precipMm = new Float32Array(CELL_COUNT);
  const nppGm2 = new Float32Array(CELL_COUNT);
  const biome = new Uint8Array(CELL_COUNT);
  const plate = new Int16Array(CELL_COUNT);
  const plateOceanic = new Uint8Array(A.TECTONIC_PLATES);
  const plateDrift = new Float64Array(A.TECTONIC_PLATES * 3);

  const scratch: number[] = [];
  for (let c = 0; c < CELL_COUNT; c++) {
    const cells = buckets[c];
    if (cells.length === 0) continue;

    scratch.length = 0;
    for (const m of cells) scratch.push(t.elevationM[m]);
    scratch.sort((x, y) => x - y);
    elevationM[c] = scratch[scratch.length >> 1];

    let temp = 0, rain = 0, npp = 0;
    const votes = new Map<number, number>();
    let oceanic = 0;
    for (const m of cells) {
      temp += mesh.temperatureC[m];
      rain += mesh.precipMm[m];
      npp += mesh.nppGm2[m];
      votes.set(mesh.biome[m], (votes.get(mesh.biome[m]) ?? 0) + 1);
      if (t.continental[m] === 0) oceanic++;
    }
    temperatureC[c] = temp / cells.length;
    precipMm[c] = rain / cells.length;
    nppGm2[c] = npp / cells.length;

    // The biome a region IS, which is the one most of it is. An average of
    // two biomes is a third biome that is not there.
    let best = 0, bestVotes = -1;
    for (const [b, v] of votes) if (v > bestVotes) { bestVotes = v; best = b; }
    biome[c] = best;

    plate[c] = t.plate[cells[cells.length >> 1]];
    if (oceanic * 2 > cells.length) plateOceanic[plate[c]] = 1;
  }

  const oceanDistance = measureOceanDistance(worldGrid(spacingKm), elevationM);

  // --- water on the world map ----------------------------------------------
  // The sphere is closed, so there is no rim and no inflow: the only way out
  // is the sea. Everything else drains to it, which is what makes this the
  // boundary condition for every map below rather than a thing needing one.
  const runoffM = new Float32Array(CELL_COUNT);
  const isOutlet = new Uint8Array(CELL_COUNT);
  for (let c = 0; c < CELL_COUNT; c++) {
    const sinLat = centres[c * 3 + 1];
    runoffM[c] = elevationM[c] < 0
      ? 0
      : runoffDepthM(precipMm[c], potentialEvapotranspiration(temperatureC[c], sinLat));
    isOutlet[c] = elevationM[c] < 0 ? 1 : 0;
  }
  const flow = routeWater({
    count: CELL_COUNT,
    neighbours,
    degree: 6,
    elevationM,
    cellAreaM2: (4 * Math.PI * radiusM * radiusM) / CELL_COUNT,
    runoffM,
    isOutlet,
    inflow: [],
  });
  const drainage = new Float32Array(CELL_COUNT);
  for (let c = 0; c < CELL_COUNT; c++) drainage[c] = drainageOf(flow.dischargeM3S[c]);

  return {
    seed, radiusM, plate, plateOceanic, plateDrift,
    elevationM, temperatureC, precipMm, nppGm2, biome, oceanDistance,
    runoffM, flow, drainage, mesh,
  };
}

/** The world map, as something the climate model can be run on. */
function worldGrid(spacingKm: number): ClimateGrid {
  return { count: CELL_COUNT, centres, neighbours, spacingKm };
}

/**
 * Which mesh cells fall in which world cell.
 *
 * Every mesh cell is walked once and dropped into whichever world cell holds
 * it -- O(mesh) rather than O(world x mesh) -- and each gets exactly one vote,
 * because the projection is equal-area and they really are the same size.
 */
function bucketMesh(t: Tectonics): number[][] {
  const out: number[][] = new Array(CELL_COUNT);
  for (let c = 0; c < CELL_COUNT; c++) out[c] = [];
  for (let m = 0; m < t.band.count; m++) {
    const c = cellAt(t.band.centres[m * 3], t.band.centres[m * 3 + 1], t.band.centres[m * 3 + 2]);
    out[c].push(m);
  }
  return out;
}

/**
 * The whole planet, at mesh resolution: tectonics, then climate on top of it.
 *
 * NOT memoised, deliberately, though the tectonics underneath it is. The
 * tectonics is what costs seconds and depends only on the seed; the climate on
 * top of it is a tenth of a second and depends on the climate parameters as
 * well. Caching the pair by seed alone would hand the calibration sweep the
 * same answer for every parameter set it tried, which is the sort of bug that
 * reads as "the sweep found nothing".
 */
export function planetMesh(
  seed: number,
  radiusM: number,
  climate: ClimateParams,
): PlanetMesh {
  const tect = tectonicsFor(seed, radiusM);
  const g: ClimateGrid = {
    count: tect.band.count,
    centres: tect.band.centres,
    neighbours: tect.band.neighbours,
    spacingKm: (Math.sqrt(3) * tect.band.cellR * radiusM) / 1000,
  };

  const oceanDistance = measureOceanDistance(g, tect.elevationM);
  const temperatureC = buildTemperature(g, tect.elevationM);
  const precipMm = buildPrecipitation(
    g, seed, tect.elevationM, temperatureC, oceanDistance, climate);

  const nppGm2 = new Float32Array(g.count);
  const biome = new Uint8Array(g.count);
  for (let c = 0; c < g.count; c++) {
    nppGm2[c] = tect.elevationM[c] < 0 ? 0 : miamiNPP(temperatureC[c], precipMm[c]);
    biome[c] = classify({
      temperatureC: temperatureC[c],
      precipMm: precipMm[c],
      sinLat: g.centres[c * 3 + 1],
      elevationM: tect.elevationM[c],
    });
  }

  return { tect, temperatureC, precipMm, nppGm2, biome, oceanDistance };
}

// ---------------------------------------------------------------------------
// Tectonics
// ---------------------------------------------------------------------------



/**
 * Put the shoreline where Earth's is.
 *
 * Rather than picking a sea level and hoping the land fraction comes out
 * plausible, take the elevation that leaves exactly LAND_FRACTION of the
 * surface above it. Sea level is then derived from a measurement -- 29.2% of
 * Earth is land -- and no amount of fiddling with the noise amplitudes above
 * can drown or flood the world. Then stretch each side of the shoreline
 * separately so the mean land height and mean ocean depth match Earth's too,
 * which is the hypsometric curve pinned at three points instead of one.
 */
function solveSeaLevel(elev: Float32Array): void {
  const sorted = Float32Array.from(elev).sort();
  const idx = Math.floor((1 - A.LAND_FRACTION) * (CELL_COUNT - 1));
  const sea = sorted[idx];
  for (let c = 0; c < CELL_COUNT; c++) elev[c] -= sea;

  let landSum = 0, landCount = 0, seaSum = 0, seaCount = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (elev[c] > 0) { landSum += elev[c]; landCount++; }
    else { seaSum += elev[c]; seaCount++; }
  }
  const landScale = landCount > 0 ? A.MEAN_LAND_ELEVATION_M / (landSum / landCount) : 1;
  const seaScale = seaCount > 0 ? -A.MEAN_OCEAN_DEPTH_M / (seaSum / seaCount) : 1;
  for (let c = 0; c < CELL_COUNT; c++) {
    elev[c] *= elev[c] > 0 ? landScale : seaScale;
    elev[c] = clamp(elev[c], A.MAX_DEPTH_M, A.MAX_ELEVATION_M);
  }
}

// ---------------------------------------------------------------------------
// Climate
// ---------------------------------------------------------------------------

/** Steps to the nearest sea cell. Drives continentality and, later, trade. */
/**
 * A grid the climate can be computed on: the world map, or the mesh.
 *
 * The climate model never cared which. It wants positions, adjacency and a
 * spacing, and both grids have all three -- so it runs on the 196,608-cell
 * mesh, where a rain shadow lands on the mountain that casts it, instead of on
 * 546 cells 930 km across, where it barely can.
 */
export interface ClimateGrid {
  count: number;
  centres: Float64Array;
  neighbours: Int32Array;
  spacingKm: number;
}

function measureOceanDistance(g: ClimateGrid, elev: Float32Array): Int16Array {
  const dist = new Int16Array(g.count).fill(-1);
  const queue = new Int32Array(g.count);
  let tail = 0;
  for (let c = 0; c < g.count; c++) {
    if (elev[c] < 0) { dist[c] = 0; queue[tail++] = c; }
  }
  for (let head = 0; head < tail; head++) {
    const c = queue[head];
    for (let i = 0; i < 6; i++) {
      const n = g.neighbours[c * 6 + i];
      if (n < 0 || dist[n] >= 0) continue;
      dist[n] = Math.min(32000, dist[c] + 1);
      queue[tail++] = n;
    }
  }
  for (let c = 0; c < g.count; c++) if (dist[c] < 0) dist[c] = 0;
  return dist;
}

/**
 * Temperature from latitude and altitude.
 *
 * `sinLat` is read straight off the cell's unit vector -- the y component of a
 * point on a unit sphere IS the sine of its latitude, exactly, with no
 * trigonometry involved. That is worth noticing: the one place a planet really
 * wants a transcendental turns out not to need one.
 */
function buildTemperature(g: ClimateGrid, elev: Float32Array): Float32Array {
  const t = new Float32Array(g.count);
  for (let c = 0; c < g.count; c++) {
    const sinLat = g.centres[c * 3 + 1];
    const u = sinLat * sinLat;
    const seaLevelT = A.TEMP_EQUATOR_C - A.TEMP_QUAD_COEFF * u - A.TEMP_CUBIC_COEFF * u * u * u;
    t[c] = seaLevelT - A.LAPSE_RATE_PER_M * Math.max(0, elev[c]);
  }
  return t;
}

/**
 * Rainfall: latitude bands, then what the land does to them.
 *
 * The bands are the Hadley circulation seen from outside -- air rises at the
 * equator and dumps its water, sinks dry at thirty degrees making every desert
 * belt on Earth, rises again at the polar front. Then three corrections, each
 * of which is visible on a real map:
 *
 *   warm air holds more water, so the same circulation delivers less rain
 *     where it is cold. This is why the poles are deserts by rainfall.
 *   rain falls out of an air mass as it travels, so continental interiors are
 *     dry however wet their latitude.
 *   air forced up a slope rains; air descending the far side does not. The
 *     upwind neighbour test below is the whole of orographic rainfall, and it
 *     is what puts a desert immediately behind a mountain range.
 */
function buildPrecipitation(
  g: ClimateGrid,
  seed: number,
  elev: Float32Array,
  temp: Float32Array,
  oceanDist: Int16Array,
  k: ClimateParams,
): Float32Array {
  const p = new Float32Array(g.count);
  const spacingKm = g.spacingKm;

  for (let c = 0; c < g.count; c++) {
    const x = g.centres[c * 3];
    const sinLat = g.centres[c * 3 + 1];
    const z = g.centres[c * 3 + 2];
    const u = Math.abs(sinLat);

    const itcz = k.itczMm * gauss(u, 0, k.itczWidth);
    const front = k.frontMm * gauss(u, k.frontCentre, k.frontWidth);
    let mm = itcz + front + k.backgroundMm;

    // Cold air carries little water. Linear between -25 and +25 degC, which is
    // a coarse stand-in for the Clausius-Clapeyron relation and is flagged in
    // docs/known-gaps.md as the next thing to replace with real physics.
    mm *= clamp(0.15 + 0.85 * ((temp[c] + 25) / 50), 0.15, 1.35);

    // Continentality: rain wrings out as the air travels inland.
    if (elev[c] >= 0) mm *= dexp(-k.continentality * Math.max(0, oceanDist[c]) * spacingKm);

    // Orographic. Prevailing wind is easterly in the tropics, westerly in the
    // mid-latitudes, easterly again at the poles -- the three-cell structure.
    if (elev[c] > 0) {
      const westerly = u >= 0.5 && u < 0.866;
      const sign = westerly ? 1 : -1;
      // East in the tangent plane is the pole crossed with the position.
      let ex = z * sign;
      let ez = -x * sign;
      const elen = Math.sqrt(ex * ex + ez * ez) || 1;
      ex /= elen; ez /= elen;

      let upwind = -1;
      let best = -Infinity;
      for (let i = 0; i < 6; i++) {
        const n = g.neighbours[c * 6 + i];
        if (n < 0) continue;
        const dx = g.centres[n * 3] - x;
        const dz = g.centres[n * 3 + 2] - z;
        const align = -(dx * ex + dz * ez);
        if (align > best) { best = align; upwind = n; }
      }
      if (upwind >= 0) {
        const rise = elev[c] - Math.max(0, elev[upwind]);
        // Climbing air rains; sinking air does not. The asymmetry is what makes
        // a rain shadow much drier than the windward side is wet.
        mm *= rise > 0
          ? 1 + Math.min(1.6, rise / k.orographicM)
          : clamp(1 + rise / k.leeM, k.leeFloor, 1);
      }
    }

    // A little noise so the bands are not razor-straight across a continent.
    mm *= 0.82 + 0.36 * (0.5 + 0.5 * fbm3(x * 3.1, sinLat * 3.1, z * 3.1, seed ^ 0x2b19, 4));
    p[c] = Math.max(0, mm);
  }
  return p;
}

function gauss(x: number, centre: number, width: number): number {
  const t = (x - centre) / width;
  return dexp(-t * t);
}

// ---------------------------------------------------------------------------

interface HeapNode { id: number; cost: number; }

/** A plain binary heap. Node's standard library has no priority queue and the
 *  plate fill is the only place that needs one. */
class MinHeap {
  private items: HeapNode[] = [];

  get size(): number { return this.items.length; }

  push(id: number, cost: number): void {
    const items = this.items;
    items.push({ id, cost });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= items[i].cost) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): HeapNode {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < items.length && items[l].cost < items[small].cost) small = l;
        if (r < items.length && items[r].cost < items[small].cost) small = r;
        if (small === i) break;
        [items[small], items[i]] = [items[i], items[small]];
        i = small;
      }
    }
    return top;
  }
}

export { Biome, type BiomeId };

/** Longitude of a world-map cell, from its centre. */
function lonOf(cell: number): number {
  return datan2(centres[cell * 3 + 2], centres[cell * 3]);
}

/**
 * Summarise a mesh field over each world-map cell, by MEDIAN.
 *
 * Not the mean, and the difference is the whole coastline. A world cell covers
 * about a thousand mesh cells; average the elevation of one that is half
 * mountain and half abyss and the answer is deep ocean, so averaging turned a
 * mesh that is 29.2% land into a world map that was 16.1% land. Every coastal
 * region drowned, which is exactly the class of region that matters.
 *
 * A median is land precisely when the region is mostly land, which is what a
 * cell 1,550 km across can honestly claim about itself. It is also robust: one
 * trench in the corner does not move it.
 *
 * Every mesh cell is walked once and dropped into whichever world cell holds
 * it -- O(mesh) rather than O(world x mesh) -- and every one gets exactly one
 * vote, because the projection is equal-area and they really are the same size.
 */
function medianFromMesh(
  t: Tectonics,
  read: (t: Tectonics, mesh: number) => number,
): Float32Array {
  const buckets: number[][] = new Array(CELL_COUNT);
  for (let c = 0; c < CELL_COUNT; c++) buckets[c] = [];
  for (let m = 0; m < t.band.count; m++) {
    const c = cellAt(t.band.centres[m * 3], t.band.centres[m * 3 + 1], t.band.centres[m * 3 + 2]);
    buckets[c].push(read(t, m));
  }
  const out = new Float32Array(CELL_COUNT);
  for (let c = 0; c < CELL_COUNT; c++) {
    const b = buckets[c];
    if (b.length === 0) continue;
    b.sort((x, y) => x - y);
    out[c] = b[b.length >> 1];
  }
  return out;
}
