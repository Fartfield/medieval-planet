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
import { CELL_COUNT, centres, neighbours, neighbourCount } from '../geo/sphere.ts';
import { fbm3, ridged3, hash3, unit } from './noise.ts';
import { dexp, clamp, smoothstep } from './mathx.ts';
import { Biome, classify, miamiNPP, type BiomeId } from '../model/biome.ts';

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
}

const PLATES = A.TECTONIC_PLATES;

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
  // How far apart two neighbouring cell centres are, in km. Everything below
  // that is expressed as a real distance has to go through this, because the
  // globe's resolution is a setting and the physics is not.
  const spacingKm = (Math.sqrt(3) * Math.sqrt(
    (4 * Math.PI) / CELL_COUNT / ((3 * Math.sqrt(3)) / 2)) * radiusM) / 1000;
  const plate = new Int16Array(CELL_COUNT).fill(-1);
  const plateOceanic = new Uint8Array(PLATES);
  const plateDrift = new Float64Array(PLATES * 3);

  seedPlates(seed, plate, plateOceanic, plateDrift);
  const elevationM = buildElevation(seed, plate, plateOceanic, plateDrift, spacingKm);
  const oceanDistance = measureOceanDistance(elevationM);
  const temperatureC = buildTemperature(elevationM);
  const precipMm = buildPrecipitation(
    seed, elevationM, temperatureC, oceanDistance, climate, spacingKm);

  const nppGm2 = new Float32Array(CELL_COUNT);
  const biome = new Uint8Array(CELL_COUNT);
  for (let c = 0; c < CELL_COUNT; c++) {
    nppGm2[c] = elevationM[c] < 0 ? 0 : miamiNPP(temperatureC[c], precipMm[c]);
    biome[c] = classify({
      temperatureC: temperatureC[c],
      precipMm: precipMm[c],
      sinLat: centres[c * 3 + 1],
      elevationM: elevationM[c],
    });
  }

  return {
    seed, radiusM, plate, plateOceanic, plateDrift,
    elevationM, temperatureC, precipMm, nppGm2, biome, oceanDistance,
  };
}

// ---------------------------------------------------------------------------
// Tectonics
// ---------------------------------------------------------------------------

/**
 * Scatter plate nuclei and grow them outward.
 *
 * Growth is a cost-weighted flood fill rather than a plain breadth-first one.
 * Plain BFS gives graph-Voronoi cells, whose boundaries are conspicuously
 * straight -- run it once and the planet looks like a football. Perturbing each
 * step's cost with noise makes the seams wander the way real sutures do, at
 * the price of needing a heap instead of a queue.
 */
function seedPlates(
  seed: number,
  plate: Int16Array,
  oceanic: Uint8Array,
  drift: Float64Array,
): void {
  const nuclei: number[] = [];
  let probe = 0;
  while (nuclei.length < PLATES) {
    const h = hash3(probe++, 0x51ed, 0, seed);
    const cell = h % CELL_COUNT;
    if (!nuclei.includes(cell)) nuclei.push(cell);
  }

  for (let p = 0; p < PLATES; p++) {
    const h = hash3(p, 0x0cea, 1, seed);
    // Earth's crust is about 60% oceanic by plate count once the small
    // continental fragments are counted; sea level is solved for separately,
    // so this only has to be in the right neighbourhood.
    oceanic[p] = unit(h) < 0.55 ? 1 : 0;

    // A drift direction in the plate's own tangent plane. Taking an arbitrary
    // 3D vector and removing its radial component is the cheap way to get a
    // uniform tangent direction without any trigonometry.
    const c = nuclei[p];
    const px = centres[c * 3];
    const py = centres[c * 3 + 1];
    const pz = centres[c * 3 + 2];
    let vx = unit(hash3(p, 1, 2, seed)) * 2 - 1;
    let vy = unit(hash3(p, 2, 3, seed)) * 2 - 1;
    let vz = unit(hash3(p, 3, 4, seed)) * 2 - 1;
    const radial = vx * px + vy * py + vz * pz;
    vx -= radial * px;
    vy -= radial * py;
    vz -= radial * pz;
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    const speed = A.PLATE_DRIFT_M_PER_YR * (0.4 + 1.2 * unit(hash3(p, 5, 6, seed)));
    drift[p * 3] = (vx / len) * speed;
    drift[p * 3 + 1] = (vy / len) * speed;
    drift[p * 3 + 2] = (vz / len) * speed;
  }

  const cost = new Float64Array(CELL_COUNT).fill(Infinity);
  const heap = new MinHeap();
  for (let p = 0; p < PLATES; p++) {
    cost[nuclei[p]] = 0;
    plate[nuclei[p]] = p;
    heap.push(nuclei[p], 0);
  }
  while (heap.size > 0) {
    const cur = heap.pop();
    const c = cur.id;
    if (cur.cost > cost[c]) continue;
    for (let i = 0; i < neighbourCount(c); i++) {
      const n = neighbours[c * 6 + i];
      if (n < 0) continue;
      const wobble = 1 + 0.9 * (0.5 + 0.5 * fbm3(
        centres[n * 3] * 4, centres[n * 3 + 1] * 4, centres[n * 3 + 2] * 4, seed ^ 0x51a7, 3,
      ));
      const next = cur.cost + wobble;
      if (next < cost[n]) {
        cost[n] = next;
        plate[n] = plate[c];
        heap.push(n, next);
      }
    }
  }
}

/**
 * Elevation, from what the plates are doing to each other.
 *
 * Convergent boundaries build; divergent ones open. Which of those you get,
 * and how much, depends on what kind of crust meets what kind:
 *
 *   continent + continent, converging -> the crust has nowhere to go but up,
 *     and you get the Himalaya. The biggest signal on the planet.
 *   ocean + continent, converging -> the dense oceanic slab dives under, and
 *     you get a trench offshore and a volcanic cordillera onshore. The Andes.
 *   ocean + ocean, converging -> one subducts under the other and throws up an
 *     island arc. Japan.
 *   anything, diverging -> a rift. On land it drops (the African rift); at sea
 *     it *rises*, because new hot crust is buoyant. The mid-Atlantic ridge is
 *     three kilometres above the abyssal plain either side of it.
 *
 * The uplift is then smeared inland over a few passes, because a mountain
 * range is a hundred kilometres wide and a plate boundary is a line.
 */
function buildElevation(
  seed: number,
  plate: Int16Array,
  oceanic: Uint8Array,
  drift: Float64Array,
  spacingKm: number,
): Float32Array {
  const elev = new Float32Array(CELL_COUNT);
  const uplift = new Float32Array(CELL_COUNT);

  for (let c = 0; c < CELL_COUNT; c++) {
    const pc = plate[c];
    const cx = centres[c * 3];
    const cy = centres[c * 3 + 1];
    const cz = centres[c * 3 + 2];

    for (let i = 0; i < neighbourCount(c); i++) {
      const n = neighbours[c * 6 + i];
      if (n < 0) continue;
      const pn = plate[n];
      if (pn === pc) continue;

      // Direction from c to n, flattened into c's tangent plane.
      let dx = centres[n * 3] - cx;
      let dy = centres[n * 3 + 1] - cy;
      let dz = centres[n * 3 + 2] - cz;
      const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dlen; dy /= dlen; dz /= dlen;

      // Positive when the neighbour's plate is closing on ours.
      const relX = drift[pn * 3] - drift[pc * 3];
      const relY = drift[pn * 3 + 1] - drift[pc * 3 + 1];
      const relZ = drift[pn * 3 + 2] - drift[pc * 3 + 2];
      const closing = -(relX * dx + relY * dy + relZ * dz) / A.PLATE_DRIFT_M_PER_YR;

      const bothLand = !oceanic[pc] && !oceanic[pn];
      const bothSea = oceanic[pc] === 1 && oceanic[pn] === 1;

      if (closing > 0) {
        if (bothLand) uplift[c] += closing * 5200;
        else if (bothSea) uplift[c] += closing * 900;
        else if (!oceanic[pc]) uplift[c] += closing * 3600; // the overriding side
        else uplift[c] -= closing * 4200; // the trench
      } else {
        // Diverging. New crust at sea is buoyant and stands proud; on land the
        // block simply drops.
        uplift[c] += oceanic[pc] ? -closing * 1400 : closing * 1100;
      }
    }
  }

  // Spread the boundary signal inland, because a plate boundary is a line and
  // a cordillera is a few hundred kilometres wide.
  //
  // How many passes that takes depends on how big a cell is, which is a
  // setting rather than a fact about mountains. At 240 km a cell it is two
  // passes; at 2,530 km it is none, and that is the honest answer -- a cell
  // that wide cannot resolve the Andes and pretending otherwise would smear
  // uplift across a continent.
  const passes = Math.max(0, Math.min(6,
    Math.round(A.MOUNTAIN_RANGE_WIDTH_M / 1000 / Math.max(1, spacingKm))));
  let smoothed = uplift;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(CELL_COUNT);
    for (let c = 0; c < CELL_COUNT; c++) {
      let sum = smoothed[c];
      let count = 1;
      for (let i = 0; i < neighbourCount(c); i++) {
        const n = neighbours[c * 6 + i];
        if (n < 0) continue;
        sum += smoothed[n];
        count++;
      }
      // Weighted toward the cell's own value so ranges keep their crests.
      next[c] = 0.45 * smoothed[c] + 0.55 * (sum / count);
    }
    smoothed = next;
  }

  for (let c = 0; c < CELL_COUNT; c++) {
    const x = centres[c * 3];
    const y = centres[c * 3 + 1];
    const z = centres[c * 3 + 2];
    const base = oceanic[plate[c]] ? -3800 : 500;
    // Two noise fields: rolling relief everywhere, plus ridged noise gated to
    // places already being uplifted, so crests appear on mountains and not in
    // the middle of a plain.
    const rolling = fbm3(x * 2.2, y * 2.2, z * 2.2, seed ^ 0x3f21, 6) * 900;
    const crests = ridged3(x * 5.5, y * 5.5, z * 5.5, seed ^ 0x77c3, 4);
    const gate = smoothstep(400, 2600, smoothed[c]);
    elev[c] = base + smoothed[c] + rolling + crests * gate * 2400;
  }

  solveSeaLevel(elev);
  return elev;
}

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
function measureOceanDistance(elev: Float32Array): Int16Array {
  const dist = new Int16Array(CELL_COUNT).fill(-1);
  const queue: number[] = [];
  for (let c = 0; c < CELL_COUNT; c++) {
    if (elev[c] < 0) { dist[c] = 0; queue.push(c); }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    for (let i = 0; i < neighbourCount(c); i++) {
      const n = neighbours[c * 6 + i];
      if (n < 0 || dist[n] >= 0) continue;
      dist[n] = dist[c] + 1;
      queue.push(n);
    }
  }
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
function buildTemperature(elev: Float32Array): Float32Array {
  const t = new Float32Array(CELL_COUNT);
  for (let c = 0; c < CELL_COUNT; c++) {
    const sinLat = centres[c * 3 + 1];
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
  seed: number,
  elev: Float32Array,
  temp: Float32Array,
  oceanDist: Int16Array,
  k: ClimateParams,
  spacingKm: number,
): Float32Array {
  const p = new Float32Array(CELL_COUNT);

  for (let c = 0; c < CELL_COUNT; c++) {
    const x = centres[c * 3];
    const sinLat = centres[c * 3 + 1];
    const z = centres[c * 3 + 2];
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
      for (let i = 0; i < neighbourCount(c); i++) {
        const n = neighbours[c * 6 + i];
        if (n < 0) continue;
        const dx = centres[n * 3] - x;
        const dz = centres[n * 3 + 2] - z;
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
