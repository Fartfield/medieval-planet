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
import { CELL_COUNT, centres, cellAt, neighbours } from './geo/sphere.ts';
import { SUBCELL_COUNT, subNeighbours } from './geo/hexgrid.ts';
import {
  type Address, toKey, fromKey, addressSeed, SALT, MAX_DEPTH, GROUND_DEPTH,
  layerName, parent as parentOf,
} from './geo/address.ts';
import { generatePlanet, type Planet } from './gen/planet.ts';
import type { Boundary } from './gen/hydrology.ts';
import {
  generateSubMap, basisAt, samplePlanet, sampleSubMap, soilAt, aridityAt,
  STABILITY_CAP, cellContaining,
  cellRadiusRad, type SubMap, type Neighbouring,
} from './gen/submap.ts';
import { classify, type BiomeId } from './model/biome.ts';
import {
  factorOfSafety, rootCohesionAfterClearing, standingCoverOf, type RockId,
} from './model/rock.ts';
import { grainYieldKgPerHa, cropSuitability } from './model/soil.ts';
import {
  deposits, gameHeadPerKm2, timberTPerHa, freshWater, GRAZEABLE_FRACTION,
} from './model/resources.ts';
import { classifyLandform, type GroundTile, type TileDelta, deltaIsEmpty } from './model/tile.ts';
import { createPolity, type Polity } from './model/polity.ts';
import {
  buildCatchment, harvest, radiusForPopulation,
  type Catchment, type Harvest, type Competitor,
} from './model/settlement.ts';
import { clamp, dlog } from './gen/mathx.ts';

export interface WorldOptions {
  seed: number;
  radiusM?: number;
  /**
   * How many sub-maps to keep generated.
   *
   * A map is 91 cells now rather than 9,919, so one is about 4 kB and a
   * catchment touches over a hundred of them plus every ancestor on the way
   * down. The old default of 96 was sized for the old maps and made the cache
   * thrash so badly that a forty-year run went from ten seconds to over ten
   * minutes -- without ever being wrong, which is what makes that kind of
   * regression hard to notice.
   */
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

  /**
   * Kingdoms. Not derivable from the seed -- a polity is a thing that happened
   * -- so these are persisted alongside the deltas.
   *
   * A tile's `owner` is a polity id, not a player id. Players own a polity;
   * so does every NPC kingdom, and the rules do not distinguish them.
   */
  readonly polities = new Map<number, Polity>();
  private nextPolity = 0;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.radiusM = opts.radiusM ?? A.EARTH_RADIUS_M;
    this.cacheSize = opts.cacheSize ?? 16384;
    this.planet = generatePlanet(this.seed, this.radiusM);
  }

  // --- geometry -------------------------------------------------------------

  get regionCount(): number { return CELL_COUNT; }
  get subCellCount(): number { return SUBCELL_COUNT; }

  /** Total cells at a depth. Layer 2 is 1,007,675,157,762. */
  totalCellsAt(depth: number): number {
    // Approximate now, and only here: ten branches divide by 76 rather than 91,
    // so the true count is a shade lower. Used for reporting, not for indexing.
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
    let inflow: Boundary[];

    if (depth === 1) {
      const region = address[0];
      if (region < 0 || region >= CELL_COUNT) throw new RangeError(`no region ${region}`);
      // Turned to face the region's own first neighbour, so the 91 tiles lie
      // on the same lattice the region does. See basisAt.
      const nb = neighbours[region * 6] >= 0 ? neighbours[region * 6] : neighbours[region * 6 + 1];
      basis = basisAt(
        centres[region * 3], centres[region * 3 + 1], centres[region * 3 + 2],
        centres[nb * 3], centres[nb * 3 + 1], centres[nb * 3 + 2]);
      sample = (x, y, z) => samplePlanet(this.planet, x, y, z);
      inflow = inflowFromPlanet(this.planet, region);
    } else {
      const above = this.subMap(parentOf(address));
      const cell = address[address.length - 1];
      if (cell < 0 || cell >= above.patch.count) throw new RangeError(`no cell ${cell}`);
      // Same rule one layer down: face this cell's first neighbour inside the
      // map that holds it, so every layer's lattice agrees with its parent's.
      let nb = -1;
      for (let i = 0; i < 6 && nb < 0; i++) nb = subNeighbours[cell * 6 + i];
      basis = nb >= 0
        ? basisAt(
          above.dirs[cell * 3], above.dirs[cell * 3 + 1], above.dirs[cell * 3 + 2],
          above.dirs[nb * 3], above.dirs[nb * 3 + 1], above.dirs[nb * 3 + 2])
        : basisAt(above.dirs[cell * 3], above.dirs[cell * 3 + 1], above.dirs[cell * 3 + 2]);
      sample = (x, y, z) => sampleSubMap(above, x, y, z, this.neighbouring(depth - 1));
      inflow = inflowFromSubMap(above, cell);
    }

    const map = generateSubMap(
      this.seed, address, depth, basis, sample, this.radiusM, inflow);

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
   * A lookup for cells of a layer that a given map does not itself hold.
   *
   * A map's rim cells are missing two or three neighbours, and those
   * neighbours are not nowhere -- they sit in a sibling map under a different
   * grandparent. A map cannot reach sideways to find them; the World can, by
   * descending from the globe to the cell containing the point. Same answer as
   * `cellsWithin`, applied to one cell instead of to an area.
   *
   * Without it, a third of every map -- the rim of a radius-5 hexagon is 30
   * cells of 91 -- had children built on a guess, and the guess showed as a
   * cliff along every map edge at every layer.
   *
   * Bound once per generated map rather than per sample so the closure is not
   * rebuilt ninety-one times.
   */
  private neighbouring(layerDepth: number): Neighbouring | null {
    if (layerDepth < 1) return null;
    return (x, y, z) => {
      // A layer-N cell has an address of length N+1: the map holding it is at
      // depth N, and the last component is the index within that map.
      const address = this.addressAt(x, y, z, layerDepth + 1);
      if (address === null) return null;
      const holder = this.subMap(address.slice(0, -1));
      const cell = address[address.length - 1];
      return {
        elevationM: holder.elevationM[cell],
        precipMm: holder.precipMm[cell],
        upliftM: holder.upliftM[cell],
      };
    };
  }

  /**
   * The address of the layer-`length` cell containing a point, found by
   * descending rather than by searching.
   *
   * Each step asks one map which of its cells holds the point, so the cost is
   * the depth and not the width. A cell's territory is a Voronoi region and
   * the hexagon we draw for it is only approximately that, so a point can miss
   * every cell by a hair; the nearest centre is then the honest answer rather
   * than a failure.
   */
  addressAt(x: number, y: number, z: number, length: number): Address | null {
    if (length < 1) return null;
    const address: number[] = [cellAt(x, y, z)];
    while (address.length < length) {
      const map = this.subMap(address);
      let cell = cellContaining(map.basis, map.cellRadiusRad, x, y, z, map.patch);
      if (cell < 0) {
        let best = 0;
        let bestD = Infinity;
        for (let c = 0; c < map.patch.count; c++) {
          const dx = map.dirs[c * 3] - x;
          const dy = map.dirs[c * 3 + 1] - y;
          const dz = map.dirs[c * 3 + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD) { bestD = d2; best = c; }
        }
        cell = best;
      }
      address.push(cell);
    }
    return address;
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
    if (c < 0 || c >= map.patch.count) throw new RangeError(`no cell ${c}`);

    const key = toKey(address);
    const delta = this.deltas.get(key);
    const areaM2 = this.cellAreaAt(address.length);
    const areaHa = areaM2 / 10000;
    const areaKm2 = areaM2 / 1e6;

    const biome = map.biome[c];
    const npp = map.nppGm2[c];
    const drainage = map.drainage[c];
    const dischargeM3S = map.flow.dischargeM3S[c];
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
      biome: biome as BiomeId,
      aridity,
    });
    if (delta?.depleted) {
      for (let i = 0; i < ore.length && i < delta.depleted.length; i++) {
        ore[i] = { kind: ore[i].kind, richness: clamp(ore[i].richness * (1 - delta.depleted[i]), 0, 1) };
      }
    }

    const cleared = delta?.cleared ?? 0;
    const standing = timberTPerHa(biome as BiomeId, npp) * (1 - clamp(cleared, 0, 1));

    // Whether this hillside is still standing up, as it is TODAY rather than
    // as generated. The generated field assumes whatever the biome grows; this
    // one knows what has been cut off it and how long ago, which is the whole
    // difference between a hazard map and a consequence.
    //
    // Saturation is the tile's own waterlogging: how much of the year the
    // ground is actually wet. That is what makes a marshy hillside marginal
    // and a dry one safe at the same gradient, without any rule saying so.
    const yearsSinceCleared = delta?.clearedTurn === undefined
      ? 0
      : Math.max(0, this.turn - delta.clearedTurn) / A.TURNS_PER_YEAR;
    const stability = map.hillslopesResolved
      ? Math.min(STABILITY_CAP, factorOfSafety({
        slope: map.slope[c],
        soilDepthM: map.regolithM[c],
        rock: map.rock[c] as RockId,
        rootCohesionKPa: rootCohesionAfterClearing(
          standingCoverOf(biome), cleared, yearsSinceCleared),
        saturation: waterlog,
      }))
      : STABILITY_CAP;

    return {
      address,
      dir: [map.dirs[c * 3], map.dirs[c * 3 + 1], map.dirs[c * 3 + 2]],
      biome: biome as BiomeId,
      landform: classifyLandform(map.elevationM[c], map.slope[c], drainage, waterlog, nearCoast),
      elevationM: map.elevationM[c],
      slope: map.slope[c],
      temperatureC: map.temperatureC[c],
      precipMm: map.precipMm[c],
      aridity,
      drainage,
      dischargeM3S,
      rock: map.rock[c] as RockId,
      regolithM: map.regolithM[c],
      erosionMPerYr: map.erosionMPerYr[c],
      stability,
      hillslopesResolved: map.hillslopesResolved,
      catchmentM2: map.flow.catchmentM2[c],
      lakeDepthM: map.flow.lakeDepthM[c],
      freshWater: freshWater(drainage, map.precipMm[c], waterlog),
      nppGm2: npp,
      soil,
      flora: {
        timberTPerHa: standing,
        grainKgPerHa: grainYieldKgPerHa(soil, npp, suitability),
        forage: GRAZEABLE_FRACTION[biome] * clamp(npp / A.MIAMI_MAX_NPP, 0, 1),
      },
      fauna: {
        gameHeadPerKm2: gameHeadPerKm2(biome as BiomeId, npp),
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
   * How much ground a catchment may actually look at, in square metres.
   *
   * THIS IS A COMPUTE BUDGET WEARING PHYSICAL UNITS, and it is stated this way
   * on purpose. It used to be a count -- 127 sub-maps -- and a count is a
   * quantity of *work*, not a quantity of *world*, so what a settlement could
   * reach depended on how finely the planet happened to be divided.
   *
   * That went wrong exactly as you would expect. Re-gridding the world from 24
   * by 8 to 39 by 14 made a ground tile 149.7 m2 instead of 425.7, and the same
   * 127 maps then covered 1.73 km2 instead of 4.92. Every settlement in the
   * world lost nearly two thirds of its farmland to a change of map resolution:
   * carrying capacity fell from 490 people to 209, towns hit their land limit
   * three times sooner, and a kingdom that used to throw seven daughters in
   * forty years threw seventy-nine. None of that was geography.
   *
   * Worse, the cap bound at EVERY population once tiles were that small -- even
   * a hamlet of twenty asked for 3.2 km2 and was given 1.73 -- so "limited by
   * land" had stopped meaning the land had run out and started meaning the
   * search had.
   *
   * As an area it is invariant: the map count is derived from it and the tile
   * size, so a finer grid costs more maps to cover the same ground rather than
   * quietly covering less. 4.92 km2 is what the old cap worked out to, and it
   * is a defensible figure to have inherited -- 492 hectares is about what a
   * village of a few hundred works once waste, wood and pasture are counted --
   * but it is a budget and not a measurement, so it is labelled as one.
   *
   * The real limit on how far a settlement reaches is `radiusForPopulation`,
   * which is solved from what the people need and what the ground yields. This
   * only stops that search becoming unbounded.
   */
  static readonly CATCHMENT_REACH_M2 = 4.92e6;

  /**
   * The land a settlement at `address` can reach, with the maps it needs
   * generated and the result cached.
   *
   * The cache key buckets the radius, because a settlement growing by one
   * person a week would otherwise rebuild the whole catchment every turn to
   * get the same answer. A bucket is a factor of 1.25 in radius, so the
   * rebuild happens when the reachable area has changed by half.
   */
  catchmentFor(address: Address, population: number): Catchment {
    if (address.length !== GROUND_DEPTH + 1) {
      throw new RangeError(`settlements stand on layer ${GROUND_DEPTH} tiles`);
    }
    const areaM2 = this.cellAreaAt(GROUND_DEPTH);

    // The radius is quantised, and the quantised value is what gets used.
    //
    // Bucketing only the cache *key* while building with the raw radius made
    // the catchment depend on call history: two populations landing in the same
    // bucket shared whichever catchment the first one built, so the same world
    // could give different answers depending on the order it was asked. That is
    // exactly the class of bug docs/determinism.md exists to prevent.
    //
    // dlog rather than Math.log for the same reason -- see determinism.md.
    const wanted = radiusForPopulation(population, areaM2);
    const bucket = Math.round(dlog(Math.max(1, wanted)) / dlog(1.25));
    const radiusM = 1.25 ** bucket;
    const key = `${toKey(address)}@${bucket}`;

    const hit = this.catchments.get(key);
    if (hit !== undefined) return hit;

    // Derived from the reach, so the same ground is searched at any resolution.
    const mapCap = Math.max(
      // SUBCELL_COUNT rather than the patch's own count: this sizes a budget
      // over many maps, almost all of them hexagonal, and a pentagon's 76
      // would only make the cap 20% generous on ten maps in the world.
      1, Math.ceil(World.CATCHMENT_REACH_M2 / (SUBCELL_COUNT * areaM2)));
    const { maps, addresses } = this.mapsAround(address, radiusM, mapCap);
    const built = buildCatchment(
      maps, addresses, 0, address[address.length - 1], radiusM, areaM2);

    this.catchments.set(key, built);
    if (this.catchments.size > 64) {
      const oldest = this.catchments.keys().next().value;
      if (oldest !== undefined) this.catchments.delete(oldest);
    }
    return built;
  }

  /**
   * Every cell of a given address length whose centre lies within `radiusM`
   * of a point, wherever it is and whatever it belongs to.
   *
   * THIS IS THE CROSS-BOUNDARY QUERY, and it took the world getting smaller to
   * force it. The previous version walked neighbours inside one sub-map, which
   * worked when a map was 9,919 cells and hid a real limitation. At 91 cells a
   * settlement's entire reachable world became 91 x 91 tiles -- exactly what it
   * farms -- so there was never anywhere to put a daughter village, and
   * expansion stopped for good.
   *
   * The method is to descend rather than to walk. At the globe every cell is
   * reachable, so take the ones near the point; then inside each of those take
   * the sub-cells near the point; and so on down. Boundaries are crossed for
   * free, because at every level *all* the parents that reach the disc are
   * considered, not just the one the point happens to sit in.
   *
   * What this does not solve is tile-to-tile adjacency across a boundary --
   * a cell on a rim still has five neighbours. Area queries are the case that
   * matters for catchments, trade and settlement, and this is them.
   */
  cellsWithin(
    x: number, y: number, z: number,
    radiusM: number,
    addressLength: number,
    cap = 4096,
    minRadiusM = 0,
  ): Address[] {
    const len = Math.max(1, Math.min(addressLength, MAX_DEPTH));
    // Addresses start at length one -- a globe cell -- and each descent adds a
    // number, so reaching length L takes L-1 steps. Running L of them returned
    // cells one whole layer too deep, and put the annulus filter on the wrong
    // layer as well, which is why a founding party kept being handed the
    // thousand tiles nearest its own front door.
    const steps = len - 1;

    // Level 0: the globe, where every cell is reachable from every other.
    const slack0 = cellRadiusRad(0) * this.radiusM;
    let level: Address[] = [];
    for (let c = 0; c < CELL_COUNT; c++) {
      const dx = centres[c * 3] - x;
      const dy = centres[c * 3 + 1] - y;
      const dz = centres[c * 3 + 2] - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * this.radiusM;
      if (d <= radiusM + slack0) level.push([c]);
    }
    // Always at least the cell the point is in, so a tiny radius still returns
    // something rather than an empty list.
    if (level.length === 0) level = [[cellAt(x, y, z)]];

    for (let depth = 1; depth <= steps; depth++) {
      // A cell of this depth can reach the disc if its centre is within the
      // radius plus its own size; anything further cannot overlap.
      const slack = cellRadiusRad(depth) * this.radiusM;
      const next: Address[] = [];

      // Distance is computed once and carried, not recomputed inside the
      // comparator. Sorting with a comparator that re-derived it turned a
      // few-millisecond query into minutes.
      const scored: { address: Address; d: number }[] = [];
      for (const parent of level) {
        const map = this.subMap(parent);
        for (let c = 0; c < map.patch.count; c++) {
          const dx = map.dirs[c * 3] - x;
          const dy = map.dirs[c * 3 + 1] - y;
          const dz = map.dirs[c * 3 + 2] - z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * this.radiusM;
              // An annulus, not a disc, when a minimum is given.
          //
          // The cap keeps the nearest cells, which is right for a catchment
          // and exactly wrong for a founding party: asked for somewhere 3.6 km
          // out it was handed the thousand closest tiles, all of them inside
          // the parent's own fields, and reported no site available for ever.
          if (d > radiusM + slack) continue;
          // The inner edge only applies at the layer actually being returned.
          // Applying it on the way down would discard parents that straddle it
          // and lose everything beyond.
          if (depth === steps && d < minRadiusM) continue;
          scored.push({ address: [...parent, c], d });
        }
      }
      if (scored.length === 0) break;

      // Nearest first, so a cap keeps the closest rather than an arbitrary
      // slice, and the order never depends on how the parents were listed.
      scored.sort((a, b) => a.d - b.d || compareAddress(a.address, b.address));
      const kept = scored.length > cap ? scored.slice(0, cap) : scored;
      for (const item of kept) next.push(item.address);
      level = next;
    }
    return level;
  }

  /**
   * The sub-maps a settlement at `address` can draw on, out to `radiusM`.
   *
   * Home first, so the catchment's own index 0 is always the settlement's map.
   */
  private mapsAround(
    address: Address,
    radiusM: number,
    cap: number,
    minRadiusM = 0,
  ): { maps: SubMap[]; addresses: Address[] } {
    const home = address.slice(0, -1);
    const dir = this.tile(address).dir;
    const found = this.cellsWithin(
      dir[0], dir[1], dir[2], radiusM, home.length, cap, minRadiusM);

    const homeKey = toKey(home);
    const ordered = [home, ...found.filter((a) => toKey(a) !== homeKey)];

    const maps: SubMap[] = [];
    const addresses: Address[] = [];
    for (const a of ordered) {
      maps.push(this.subMap(a));
      addresses.push(a);
    }
    return { maps, addresses };
  }

  /**
   * Every sub-map within `radiusM` of an address, however many that takes.
   *
   * A catchment is capped, because nobody walks to a field on the far side of
   * the county twice a day. A founding party is not going to a field -- it is
   * leaving -- so its search is allowed a much larger budget.
   */
  mapsWithin(
    address: Address,
    radiusM: number,
    minRadiusM = 0,
  ): { maps: SubMap[]; addresses: Address[] } {
    return this.mapsAround(address, radiusM, 1024, minRadiusM);
  }

  harvestFor(
    address: Address,
    population: number,
    ironSupply = 1,
    labourShare = 1,
    competitors: readonly Competitor[] = [],
    targetKgPerYear = Infinity,
  ): Harvest {
    const catchment = this.catchmentFor(address, population);
    return harvest(
      catchment, population, ironSupply, labourShare,
      this.nearbyCompetitors(address, catchment.radiusM, competitors),
      targetKgPerYear);
  }

  /**
   * Competitors close enough to actually take a tile from this catchment.
   *
   * Exact rather than a heuristic: a rival at distance D can only claim tiles
   * that are nearer to it than to us, and every such tile is at least D/2 away
   * from us. So a rival further than twice our search radius cannot touch a
   * single tile we can see, and dropping it changes no answer.
   *
   * Worth doing because the check inside the harvest runs per tile per rival.
   * With sixty settlements on one continent that was three hundred million
   * distance tests a turn and the economy stopped being able to keep up; this
   * takes it to a handful of rivals each.
   */
  private nearbyCompetitors(
    address: Address,
    radiusM: number,
    all: readonly Competitor[],
  ): readonly Competitor[] {
    if (all.length === 0) return all;
    const me = this.tile(address).dir;
    const limit = (2 * radiusM) / A.EARTH_RADIUS_M;
    const limitSq = limit * limit;

    const near: Competitor[] = [];
    for (const c of all) {
      const dx = me[0] - c.x;
      const dy = me[1] - c.y;
      const dz = me[2] - c.z;
      if (dx * dx + dy * dy + dz * dz <= limitSq) near.push(c);
    }
    return near;
  }

  /** Which region a direction on the sphere falls in. */
  regionAt(x: number, y: number, z: number): number {
    return cellAt(x, y, z);
  }

  // --- kingdoms -------------------------------------------------------------

  /** Found a kingdom. Returns the new polity. */
  foundPolity(capital: string, player: number | null = null): Polity {
    const polity = createPolity(this.nextPolity++, capital, this.turn, this.seed, player);
    this.polities.set(polity.id, polity);
    return polity;
  }

  /** The polity a player is steering, or undefined if they have none yet. */
  polityOf(player: number): Polity | undefined {
    for (const p of this.polities.values()) if (p.player === player) return p;
    return undefined;
  }

  /** The id the next polity will take. Expansion needs it to pre-allocate. */
  get nextPolityId(): number { return this.nextPolity; }

  loadPolities(list: Polity[]): void {
    for (const p of list) {
      this.polities.set(p.id, p);
      if (p.id >= this.nextPolity) this.nextPolity = p.id + 1;
    }
  }

  allPolities(): Polity[] {
    return [...this.polities.values()].sort((a, b) => a.id - b.id);
  }

  /** Settlements belonging to a polity, by address key. */
  settlementsOf(polity: number): string[] {
    const out: string[] = [];
    for (const [key, d] of this.deltas) {
      if (d.owner === polity && (d.population ?? 0) > 0) out.push(key);
    }
    return out.sort();
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
    // Stamp the felling, and only a felling. Clearing more ground restarts the
    // clock, which is right: the newest stumps are the ones still holding.
    if (patch.cleared !== undefined && patch.cleared > (existing.cleared ?? 0)) {
      next.clearedTurn = this.turn;
    }
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
    const ground = this.totalCellsAt(GROUND_DEPTH);
    return [
      `world ${this.seed}`,
      `${CELL_COUNT} regions, ${ground.toLocaleString('en')} ground tiles`,
      `${Math.round(this.cellAreaAt(GROUND_DEPTH))} m2 each`,
      `turn ${this.turn}, ${this.deltas.size} deltas, `
        + `${this.polities.size} polities, ${this.cache.size} maps cached`,
    ].join(' | ');
  }
}

export { toKey, fromKey, layerName, type Address, type GroundTile, type TileDelta };
export type { Catchment, Harvest, Competitor, Polity };

/** A total order on addresses, so nothing depends on iteration order. */
function compareAddress(a: Address, b: Address): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Water crossing a layer
// ---------------------------------------------------------------------------
//
// A map inherits its water from its parent and never from its neighbours. Two
// sources add up to everything crossing its edge:
//
//   1. Parent neighbours that drain into this cell. The parent routed its own
//      water and knows which of its neighbours point here and how much each
//      carries.
//
//   2. What the parent itself was handed from outside. If water entered the
//      parent map at this very cell, it has to keep going -- and it has to
//      keep the direction it arrived from, because this map has to find its
//      own edge with it. Dropping this term is the subtle way to lose a
//      trunk river: it survives one layer of descent and vanishes on the next.
//
// The two together conserve catchment exactly. What leaves a child through its
// rim equals what its parent said crossed that cell, and verify_hydrology
// checks the equality rather than trusting it.

function inflowFromPlanet(planet: Planet, region: number): Boundary[] {
  const out: Boundary[] = [];
  for (let d = 0; d < 6; d++) {
    const n = neighbours[region * 6 + d];
    if (n < 0) continue;
    if (planet.flow.downstream[n] !== region) continue;
    out.push({
      cell: -1,
      dir: [centres[n * 3], centres[n * 3 + 1], centres[n * 3 + 2]],
      areaM2: planet.flow.catchmentM2[n],
      dischargeM3S: planet.flow.dischargeM3S[n],
    });
  }
  return out;
}

function inflowFromSubMap(above: SubMap, cell: number): Boundary[] {
  const out: Boundary[] = [];
  for (let d = 0; d < 6; d++) {
    const n = subNeighbours[cell * 6 + d];
    if (n < 0) continue;
    if (above.flow.downstream[n] !== cell) continue;
    out.push({
      cell: -1,
      dir: [above.dirs[n * 3], above.dirs[n * 3 + 1], above.dirs[n * 3 + 2]],
      areaM2: above.flow.catchmentM2[n],
      dischargeM3S: above.flow.dischargeM3S[n],
    });
  }
  // And whatever crossed into the parent map at this cell keeps going.
  for (const b of above.flow.injected) {
    if (b.cell !== cell) continue;
    out.push({ ...b, cell: -1 });
  }
  return out;
}
