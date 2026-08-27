// The world, as something you can ask questions of.
//
// Everything above this file is generation. This is the facade the server and
// the client both talk to, and it enforces the two rules that matter:
//
//   a tile is a pure function of (seed, address), and
//   the only bytes that persist are the deltas.
//
// The cache in the middle is not a correctness feature -- drop it and every
// answer is identical, just slower. It exists because opening a region means
// generating 9,919 cells, and a player panning around re-asks for the same
// map several times a second.

import * as A from './anchors.ts';
import { CELL_COUNT, centres, cellAt } from './geo/sphere.ts';
import { SUBCELL_COUNT, subNeighbours } from './geo/hexgrid.ts';
import {
  type Address, toKey, fromKey, addressSeed, SALT, MAX_DEPTH, layerName, parent as parentOf,
} from './geo/address.ts';
import { generatePlanet, type Planet } from './gen/planet.ts';
import {
  generateSubMap, basisAt, samplePlanet, sampleSubMap, soilAt, aridityAt,
  type SubMap,
} from './gen/submap.ts';
import { classify } from './model/biome.ts';
import { grainYieldKgPerHa, cropSuitability } from './model/soil.ts';
import {
  deposits, gameHeadPerKm2, timberTPerHa, freshWater, GRAZEABLE_FRACTION,
} from './model/resources.ts';
import { classifyLandform, type GroundTile, type TileDelta, deltaIsEmpty } from './model/tile.ts';
import {
  buildCatchment, harvest, radiusForPopulation,
  type Catchment, type Harvest,
} from './model/settlement.ts';
import { clamp, dlog } from './gen/mathx.ts';

export interface WorldOptions {
  seed: number;
  radiusM?: number;
  /** How many sub-maps to keep generated. Each is about 400 kB. */
  cacheSize?: number;
}

export class World {
  readonly seed: number;
  readonly radiusM: number;
  readonly planet: Planet;

  /** Turn number. One turn is one game-week. */
  turn = 0;

  private readonly cache = new Map<string, SubMap>();
  private readonly cacheSize: number;
  private readonly deltas = new Map<string, TileDelta>();
  private readonly catchments = new Map<string, Catchment>();

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.radiusM = opts.radiusM ?? A.EARTH_RADIUS_M;
    this.cacheSize = opts.cacheSize ?? 96;
    this.planet = generatePlanet(this.seed, this.radiusM);
  }

  // --- geometry -------------------------------------------------------------

  get regionCount(): number { return CELL_COUNT; }
  get subCellCount(): number { return SUBCELL_COUNT; }

  /** Total cells at a depth. Layer 2 is 1,007,675,157,762. */
  totalCellsAt(depth: number): number {
    return CELL_COUNT * SUBCELL_COUNT ** depth;
  }

  /** Area of one cell at a depth, m2. */
  cellAreaAt(depth: number): number {
    return (4 * Math.PI * this.radiusM ** 2) / this.totalCellsAt(depth);
  }

  // --- generation -----------------------------------------------------------

  /**
   * The sub-map filling `address`. Address `[4821]` gives the realm map inside
   * region 4821; `[4821, 3307]` gives the ground map inside that realm.
   *
   * Recursive, and the recursion is the point: a ground map needs its realm
   * map to inherit from, which needs the planet. Depth is bounded by MAX_DEPTH
   * so a malformed address cannot walk forever.
   */
  subMap(address: Address): SubMap {
    if (address.length < 1 || address.length > MAX_DEPTH - 1) {
      throw new RangeError(`no sub-map at depth ${address.length}`);
    }
    const key = toKey(address);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      // Refresh its place in the eviction order.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }

    const depth = address.length;
    let basis;
    let sample: (x: number, y: number, z: number) => ReturnType<typeof samplePlanet>;

    if (depth === 1) {
      const region = address[0];
      if (region < 0 || region >= CELL_COUNT) throw new RangeError(`no region ${region}`);
      basis = basisAt(centres[region * 3], centres[region * 3 + 1], centres[region * 3 + 2]);
      sample = (x, y, z) => samplePlanet(this.planet, x, y, z);
    } else {
      const above = this.subMap(parentOf(address));
      const cell = address[address.length - 1];
      if (cell < 0 || cell >= SUBCELL_COUNT) throw new RangeError(`no cell ${cell}`);
      basis = basisAt(above.dirs[cell * 3], above.dirs[cell * 3 + 1], above.dirs[cell * 3 + 2]);
      sample = (x, y, z) => sampleSubMap(above, x, y, z);
    }

    const map = generateSubMap(this.seed, address, depth, basis, sample, this.radiusM);

    this.cache.set(key, map);
    if (this.cache.size > this.cacheSize) {
      // Oldest first. A Map iterates in insertion order, and the refresh above
      // re-inserts on every hit, so this is a plain LRU with no bookkeeping.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return map;
  }

  /**
   * The full record for one tile.
   *
   * `address` is the tile's own address, so `[4821, 3307, 9912]` is a patch of
   * ground: its sub-map is `[4821, 3307]` and its index within that is 9912.
   */
  tile(address: Address): GroundTile {
    if (address.length < 2) throw new RangeError('tiles start at the realm layer');
    const map = this.subMap(parentOf(address));
    const c = address[address.length - 1];
    if (c < 0 || c >= SUBCELL_COUNT) throw new RangeError(`no cell ${c}`);

    const key = toKey(address);
    const delta = this.deltas.get(key);
    const areaM2 = this.cellAreaAt(address.length);
    const areaHa = areaM2 / 10000;
    const areaKm2 = areaM2 / 1e6;

    const biome = map.biome[c];
    const npp = map.nppGm2[c];
    const drainage = map.drainage[c];
    const waterlog = map.waterlogging[c];

    // Coastal: any neighbour under water. Only checks within this sub-map,
    // so a tile on the rim beside the sea in the next map reads as inland.
    // See docs/known-gaps.md -- cross-boundary adjacency.
    let nearCoast = false;
    for (let d = 0; d < 6; d++) {
      const n = subNeighbours[c * 6 + d];
      if (n >= 0 && map.elevationM[n] < 0) { nearCoast = true; break; }
    }

    const soil = soilAt(map, c);
    if (delta?.soilHealth !== undefined) soil.health = delta.soilHealth;
    const suitability = cropSuitability(
      map.precipMm[c], map.temperatureC[c], map.dirs[c * 3 + 1]);

    const aridity = aridityAt(map, c);
    const tileSeed = addressSeed(this.seed, address, SALT.ore);
    const ore = deposits(this.seed, tileSeed, {
      upliftM: map.upliftM[c],
      oceanic: map.elevationM[c] < 0,
      elevationM: map.elevationM[c],
      slope: map.slope[c],
      drainage,
      waterlogging: waterlog,
      biome,
      aridity,
    });
    if (delta?.depleted) {
      for (let i = 0; i < ore.length && i < delta.depleted.length; i++) {
        ore[i] = { kind: ore[i].kind, richness: clamp(ore[i].richness * (1 - delta.depleted[i]), 0, 1) };
      }
    }

    const cleared = delta?.cleared ?? 0;
    const standing = timberTPerHa(biome, npp) * (1 - clamp(cleared, 0, 1));

    return {
      address,
      dir: [map.dirs[c * 3], map.dirs[c * 3 + 1], map.dirs[c * 3 + 2]],
      biome,
      landform: classifyLandform(map.elevationM[c], map.slope[c], drainage, waterlog, nearCoast),
      elevationM: map.elevationM[c],
      slope: map.slope[c],
      temperatureC: map.temperatureC[c],
      precipMm: map.precipMm[c],
      aridity,
      drainage,
      freshWater: freshWater(drainage, map.precipMm[c], waterlog),
      nppGm2: npp,
      soil,
      flora: {
        timberTPerHa: standing,
        grainKgPerHa: grainYieldKgPerHa(soil, npp, suitability),
        forage: GRAZEABLE_FRACTION[biome] * clamp(npp / A.MIAMI_MAX_NPP, 0, 1),
      },
      fauna: {
        gameHeadPerKm2: gameHeadPerKm2(biome, npp),
        fish: map.elevationM[c] < 0 || drainage > 0.7
          ? clamp(0.35 + 0.65 * drainage, 0, 1)
          : 0,
      },
      deposits: ore,
      population: delta?.population ?? 0,
      populationHealth: delta?.populationHealth ?? 1,
      owner: delta?.owner ?? -1,
      modified: delta !== undefined,
    };
  }

  // --- what a settlement can reach ------------------------------------------

  /**
   * How far a catchment search may spread, in sub-maps.
   *
   * The home ground map plus its six neighbours: seven maps, 35 km2, enough to
   * feed roughly three thousand people. Going further is not a code change but
   * a cost one -- each map is 75 ms to generate and 400 kB to hold, and a
   * radius covering the full 25 km commute limit would want three hundred of
   * them. A settlement that outgrows seven maps is the signal to build the
   * incremental version, and it is in docs/known-gaps.md.
   */
  static readonly CATCHMENT_MAPS = 7;

  /**
   * The land a settlement at `address` can reach, with the maps it needs
   * generated and the result cached.
   *
   * The cache key buckets the radius, because a settlement growing by one
   * person a week would otherwise rebuild a 69,000-tile catchment every turn
   * to get the same answer. A bucket is a factor of 1.25 in radius, so the
   * rebuild happens when the reachable area has changed by half.
   */
  catchmentFor(address: Address, population: number): Catchment {
    if (address.length !== 3) throw new RangeError('settlements stand on ground tiles');
    const areaM2 = this.cellAreaAt(2);

    // The radius is quantised, and then the quantised value is what gets used.
    //
    // Bucketing only the cache *key* while building with the raw radius made
    // the catchment depend on call history: two populations landing in the same
    // bucket shared whichever catchment the first one happened to build, so the
    // same world could give different answers depending on the order it was
    // asked. That is exactly the class of bug docs/determinism.md exists to
    // prevent, and it is invisible until two machines disagree.
    //
    // dlog rather than Math.log for the same reason -- see determinism.md.
    const wanted = radiusForPopulation(population, areaM2);
    const bucket = Math.round(dlog(Math.max(1, wanted)) / dlog(1.25));
    const radiusM = 1.25 ** bucket;
    const key = `${toKey(address)}@${bucket}`;
    const hit = this.catchments.get(key);
    if (hit !== undefined) return hit;

    const region = address[0];
    const realmCell = address[1];
    const maps: SubMap[] = [this.subMap([region, realmCell])];
    const addresses: Address[] = [[region, realmCell]];

    // Outward through the realm map's own adjacency. A settlement on the rim
    // of a realm map gets fewer neighbours than one in the middle, which is
    // the cross-boundary gap showing through -- it under-feeds rim
    // settlements rather than crashing, which is the right way to be wrong.
    for (let d = 0; d < 6 && maps.length < World.CATCHMENT_MAPS; d++) {
      const n = subNeighbours[realmCell * 6 + d];
      if (n < 0) continue;
      maps.push(this.subMap([region, n]));
      addresses.push([region, n]);
    }

    const built = buildCatchment(
      maps, addresses, 0, address[2], radiusM, areaM2);

    this.catchments.set(key, built);
    if (this.catchments.size > 64) {
      const oldest = this.catchments.keys().next().value;
      if (oldest !== undefined) this.catchments.delete(oldest);
    }
    return built;
  }

  /** What that land actually delivers, for a population of this size. */
  harvestFor(address: Address, population: number): Harvest {
    return harvest(this.catchmentFor(address, population), population);
  }

  /** Which region a direction on the sphere falls in. */
  regionAt(x: number, y: number, z: number): number {
    return cellAt(x, y, z);
  }

  // --- the only mutable state -----------------------------------------------

  getDelta(address: Address): TileDelta | undefined {
    return this.deltas.get(toKey(address));
  }

  /**
   * Write a change. Returns the delta as it now stands.
   *
   * A delta that has been emptied out -- everything set back to what generation
   * would produce -- is deleted rather than kept as an empty record, so that
   * abandoning a settlement gives the storage back.
   */
  setDelta(address: Address, patch: Partial<Omit<TileDelta, 'key' | 'turn'>>): TileDelta {
    const key = toKey(address);
    const existing = this.deltas.get(key) ?? { key, turn: this.turn };
    const next: TileDelta = { ...existing, ...patch, key, turn: this.turn };
    if (deltaIsEmpty(next)) {
      this.deltas.delete(key);
      return next;
    }
    this.deltas.set(key, next);
    return next;
  }

  get deltaCount(): number { return this.deltas.size; }

  allDeltas(): TileDelta[] { return [...this.deltas.values()]; }

  loadDeltas(list: TileDelta[]): void {
    for (const d of list) this.deltas.set(d.key, d);
  }

  /** Deltas whose address begins with this prefix. A scan today; see gaps. */
  deltasUnder(prefix: Address): TileDelta[] {
    const p = `${toKey(prefix)}.`;
    const out: TileDelta[] = [];
    for (const [key, d] of this.deltas) if (key.startsWith(p)) out.push(d);
    return out;
  }

  // --- diagnostics ----------------------------------------------------------

  describe(): string {
    const ground = this.totalCellsAt(2);
    return [
      `world ${this.seed}`,
      `${CELL_COUNT} regions, ${ground.toLocaleString('en')} ground tiles`,
      `${Math.round(this.cellAreaAt(2))} m2 each`,
      `turn ${this.turn}, ${this.deltas.size} deltas, ${this.cache.size} maps cached`,
    ].join(' | ');
  }
}

export { toKey, fromKey, layerName, type Address, type GroundTile, type TileDelta };
export type { Catchment, Harvest };
