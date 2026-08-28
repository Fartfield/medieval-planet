// A settlement, and the land it can actually reach.
//
// This is the system the whole design was waiting on. Before it, a settlement
// ate only the tile it stood on -- 506 square metres, about a tenth of what one
// person needs -- so twenty settlers starved immediately and correctly, and the
// game was unplayable.
//
// WHAT BOUNDS A SETTLEMENT
//
// Two limits, with very different shapes, and the difference between them is
// most of what a player will feel.
//
//   LABOUR is the near limit. A hectare of held arable costs 23 man-days a
//   year with iron tools and 34 without -- added up task by task from measured
//   medieval rates in model/labour.ts -- and a worker walking to a distant
//   field spends the day walking. So a settlement can only farm as much land as
//   it has hands for, and the further out it reaches the fewer hours each hand
//   gives. This falls off fast, and it is why settlements are compact.
//
//   TRANSPORT is the far limit. Hauling the crop home eats some of the crop.
//   This falls off slowly -- at two kilometres a cart loses under half a
//   percent -- and it only starts to bite at the scale of feeding a city from
//   another province. Which is exactly when water stops being scenery.
//
// WHAT DOES NOT BOUND IT
//
// Nothing. There is no population cap and no settlement-size cap, by design.
// A settlement grows until it runs out of hands, land, or food, and if it has
// a river it can keep going a very long way past what a landlocked one can.
// That is the promise the design made -- "you can sustain whatever you can
// sustain" -- and it is now literally what the code does.

import * as A from '../anchors.ts';
import { SOLDIER_GRAIN_KG_PER_DAY } from '../derive.ts';
import type { Address } from '../geo/address.ts';
import { SUBCELL_COUNT, subNeighbours } from '../geo/hexgrid.ts';
import { clamp } from '../gen/mathx.ts';
import { yieldsFor, type SubMap } from '../gen/submap.ts';
import { hectareDays, threshDays, HELD_HECTARE_DAYS_IRON } from './labour.ts';
import { WOODY_FRACTION } from './resources.ts';
import { NAVIGABLE_M3_PER_S } from '../derive.ts';

import {
  Transport, TRANSPORT_NAMES, modeFor, reachFactor, labourEfficiency, delivered,
  type TransportId,
} from './supply.ts';

/** The share of a harvest held back for next year's sowing. */
export const SEED_CORN_FRACTION = 1 / A.MEDIEVAL_YIELD_RATIO;

/** Grain one person eats in a year. */
export const GRAIN_PER_PERSON_PER_YEAR = SOLDIER_GRAIN_KG_PER_DAY * 365.25;

export interface WorkedTile {
  /** Index within its own sub-map. */
  cell: number;
  /** Which sub-map, as an index into the catchment's `maps`. */
  map: number;
  distanceM: number;
  mode: TransportId;
  /** Grain reaching the settlement per year, after the walk and the haul. */
  deliveredKgPerYear: number;
  /**
   * Hectares of *effective* field work: the real area, divided by how much of
   * a day survives the walk to it. Multiplied by the current cost of a hectare
   * to get days, so that a change in iron supply does not require rebuilding
   * the catchment.
   */
  fieldHa: number;
  /** Days to thresh what this tile yields. Scales with grain, not with area. */
  threshDays: number;
  /** Days at full iron supply. What the ranking is built on. */
  labourDays: number;
  /** Delivered grain per person-day. The number that decides what gets farmed. */
  returnPerDay: number;
}

/**
 * Days to work a tile at a given iron supply.
 *
 * The ranking in a catchment is built once at full iron and not rebuilt when
 * supply changes. That is an approximation and a small one: field work scales
 * with iron and threshing does not, but threshing is under a tenth of the
 * total, so the order two tiles come in is almost never affected. The absolute
 * labour is always current, which is what the harvest actually spends.
 */
export function daysFor(tile: WorkedTile, ironSupply: number): number {
  return tile.fieldHa * hectareDays(ironSupply) + tile.threshDays;
}

export interface Catchment {
  /** Sub-maps consulted, home first. */
  maps: SubMap[];
  mapAddresses: Address[];
  /** Every workable tile, best return first. */
  candidates: WorkedTile[];
  /** How far out the search went. */
  radiusM: number;
  /** Hectares in one cell, so the harvest can report area worked. */
  cellHa: number;
  /**
   * Wood the catchment grows in a year, kg.
   *
   * Not the standing timber -- the annual increment, because a settlement that
   * cuts more than that is deforesting rather than harvesting. It is the real
   * limit on ironworking: a kilogramme of iron eats twenty kilogrammes of
   * timber as charcoal, and ironworks historically moved when the woods gave
   * out rather than when the ore did.
   */
  timberKgPerYear: number;
}

export interface Harvest {
  /** Person-days the population can supply in a year. */
  labourAvailable: number;
  /** Person-days actually spent. */
  labourUsed: number;
  /** Tiles actually farmed. */
  tilesWorked: number;
  /** Tiles inside the search radius that are nearer to somebody else. */
  tilesLostToNeighbours: number;
  /** Hectares actually farmed. */
  hectaresWorked: number;
  /** Grain arriving at the settlement, before seed corn. */
  grossKgPerYear: number;
  /** After seed corn is held back. This is what people eat. */
  netKgPerYear: number;
  /** What the population needs in a year. */
  needKgPerYear: number;
  /** Fraction of need met. Above 1 the settlement can grow. */
  ration: number;
  /** How many people this land could feed if fully worked. */
  potentialPopulation: number;
  /**
   * What stopped the ploughing. The most useful number on this record.
   *
   *   'fed'    it grew what it set out to grow and stopped. Hands to spare.
   *   'labour' it ran out of people before it ran out of ground.
   *   'land'   it ran out of ground. More people would not help.
   */
  limitedBy: 'labour' | 'land' | 'fed';
  usedWater: boolean;
  furthestWorkedM: number;
}

/**
 * Every tile a settlement could reach, ranked by what it returns per day of
 * work.
 *
 * The ranking is the whole decision. A rich tile far away and a poor one close
 * by are directly comparable once both are expressed as delivered grain per
 * person-day, and sorting on that reproduces von Thunen's rings without
 * anything in here mentioning rings: intensive near, extensive far, and the
 * boundary falling wherever the arithmetic puts it.
 *
 * `maps` are supplied by the caller rather than fetched here, because
 * generating one costs 75 ms and the caller knows how many it can afford.
 */
export function buildCatchment(
  maps: SubMap[],
  mapAddresses: Address[],
  home: number,
  originCell: number,
  radiusM: number,
  cellAreaM2: number,
): Catchment {
  const origin = maps[home];
  const ox = origin.dirs[originCell * 3];
  const oy = origin.dirs[originCell * 3 + 1];
  const oz = origin.dirs[originCell * 3 + 2];
  const originDischarge = origin.flow.dischargeM3S[originCell];
  const areaHa = cellAreaM2 / 10000;
  const radiusRad = radiusM / A.EARTH_RADIUS_M;

  const candidates: WorkedTile[] = [];
  let timberKgPerYear = 0;

  for (let m = 0; m < maps.length; m++) {
    const map = maps[m];
    const yields = yieldsFor(map);
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      if (map.elevationM[c] < 0) continue;

      // Chord distance first: it needs no trigonometry and is within 0.002% of
      // the arc at these ranges, so it does the rejecting and the survivors
      // never need anything more expensive.
      const dx = map.dirs[c * 3] - ox;
      const dy = map.dirs[c * 3 + 1] - oy;
      const dz = map.dirs[c * 3 + 2] - oz;
      const chord = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (chord > radiusRad) continue;

      const distanceM = chord * A.EARTH_RADIUS_M;
      const km = distanceM / 1000;

      // Wood grows on every tile in reach, farmed or not -- the woods are not
      // in competition with the fields for this, they are what is left over.
      // g/m2/yr to kg/ha/yr is a factor of ten exactly.
      timberKgPerYear += map.nppGm2[c] * 10 * WOODY_FRACTION[map.biome[c]] * areaHa;

      const labourFactor = labourEfficiency(km);
      if (labourFactor <= 0) continue;

      const yieldKgPerHa = yields[c];
      if (yieldKgPerHa <= 0) continue;

      const mode = modeFor(
        originDischarge, map.flow.dischargeM3S[c], NAVIGABLE_M3_PER_S);
      const survives = delivered(mode, km);

      const deliveredKgPerYear = yieldKgPerHa * areaHa * survives;
      // Working a distant field costs more days for the same hectare, because
      // the walk comes out of the working day.
      const fieldHa = areaHa / labourFactor;
      const thresh = threshDays(yieldKgPerHa * areaHa);
      const labourDays = fieldHa * HELD_HECTARE_DAYS_IRON + thresh;
      if (labourDays <= 0) continue;

      candidates.push({
        cell: c,
        map: m,
        distanceM,
        mode,
        deliveredKgPerYear,
        fieldHa,
        threshDays: thresh,
        labourDays,
        returnPerDay: deliveredKgPerYear / labourDays,
      });
    }
  }

  // Best return first. Ties broken by distance then by address, so the answer
  // is a property of the land and not of the order the maps were generated in.
  candidates.sort((a, b) =>
    b.returnPerDay - a.returnPerDay
    || a.distanceM - b.distanceM
    || a.map - b.map
    || a.cell - b.cell);

  return { maps, mapAddresses, candidates, radiusM, cellHa: areaHa, timberKgPerYear };
}

/**
 * Spend a population's labour on the best land it can reach.
 *
 * Greedy down the ranked list, which is optimal here: every tile is
 * independent, so taking the highest return per day until the days run out
 * cannot be beaten. That would stop being true the moment two tiles compete
 * for the same ox or the same road, which is a problem for later.
 */
/**
 * Where a neighbour's fields begin.
 *
 * Two settlements a mile apart cannot both farm the same field, and until this
 * existed they both did -- each built its catchment as though it were alone on
 * the continent, so a farming town and a mining town two kilometres apart each
 * counted the whole valley and neither ever needed the other. Trade had
 * nothing to do, because nobody was ever short.
 *
 * A tile goes to whichever settlement is nearest it. That is a Voronoi
 * partition, and it is also just what village territories were: the boundary
 * between two villages ran where the walk from one became longer than the walk
 * from the other, and the parish map of almost anywhere still shows it.
 */
export interface Competitor {
  x: number;
  y: number;
  z: number;
}

export function harvest(
  catchment: Catchment,
  population: number,
  ironSupply = 1,
  labourShare = 1,
  competitors: readonly Competitor[] = [],
  targetKgPerYear = Infinity,
): Harvest {
  // Only the share of the settlement's hands that is farming. The rest is
  // down a mine or in the woods, and is why a town can specialise at all.
  const labourAvailable =
    (population * A.WORKERS_PER_FAMILY) / 5 * A.WORKING_DAYS_PER_YEAR * clamp(labourShare, 0, 1);

  // What it is trying to grow. A village farms what it can use, not every
  // hectare it can walk to.
  //
  // Without this a hundred people with land to spare ploughed five and a half
  // square kilometres and grew five times what they ate, because nothing ever
  // told them to stop. That drove a population explosion -- migration is
  // pulled by headroom, and headroom was four times the population -- and it
  // made every harvest scan seventy thousand tiles whether it needed them or
  // not. Stopping when the barn is full fixes the economics and the speed at
  // the same time, which is usually a sign the model was wrong rather than
  // merely slow.
  const target = targetKgPerYear;

  let labourUsed = 0;
  let gross = 0;
  let tilesWorked = 0;
  let hectares = 0;
  let usedWater = false;
  let furthest = 0;
  let potentialGross = 0;
  let contested = 0;
  let ranOutOfLand = true;
  let enough = false;

  for (const tile of catchment.candidates) {
    if (competitors.length > 0 && belongsToNeighbour(catchment, tile, competitors)) {
      contested++;
      continue;
    }
    potentialGross += tile.deliveredKgPerYear;

    if (enough) continue;

    // Grown enough. Stop ploughing; the rest of the hands are free.
    if (gross * (1 - SEED_CORN_FRACTION) >= target) {
      enough = true;
      ranOutOfLand = false;
      continue;
    }

    const cost = daysFor(tile, ironSupply);
    if (labourUsed + cost > labourAvailable) {
      // Part of a tile can still be worked -- a field is not indivisible.
      const remaining = labourAvailable - labourUsed;
      if (remaining > 0) {
        const share = remaining / cost;
        gross += tile.deliveredKgPerYear * share;
        labourUsed = labourAvailable;
        hectares += catchment.cellHa * share;
        if (tile.mode === Transport.Water) usedWater = true;
        furthest = Math.max(furthest, tile.distanceM);
      }
      ranOutOfLand = false;
      enough = true;
      continue;
    }
    labourUsed += cost;
    gross += tile.deliveredKgPerYear;
    tilesWorked++;
    hectares += catchment.cellHa;
    if (tile.mode === Transport.Water) usedWater = true;
    furthest = Math.max(furthest, tile.distanceM);
  }

  const net = gross * (1 - SEED_CORN_FRACTION);
  const need = population * GRAIN_PER_PERSON_PER_YEAR;

  const potentialPopulation =
    (potentialGross * (1 - SEED_CORN_FRACTION)) / GRAIN_PER_PERSON_PER_YEAR;

  const limitedBy: Harvest['limitedBy'] = need <= 0
    ? 'fed'
    : ranOutOfLand ? 'land'
      : labourUsed >= labourAvailable - 1 ? 'labour' : 'fed';

  return {
    labourAvailable,
    labourUsed,
    tilesWorked,
    tilesLostToNeighbours: contested,
    hectaresWorked: hectares,
    grossKgPerYear: gross,
    netKgPerYear: net,
    needKgPerYear: need,
    ration: need <= 0 ? 1 : clamp(net / need, 0, 4),
    potentialPopulation,
    limitedBy,
    usedWater,
    furthestWorkedM: furthest,
  };
}

/**
 * How far out to look, for a settlement of this size.
 *
 * Searching the full commute limit -- 25 km -- would mean generating three
 * hundred sub-maps at 75 ms each, so the radius grows with the settlement
 * instead. A hamlet looks at its own ground map; a town reaches into its
 * neighbours. The number of maps is what costs, not the radius, so this is
 * expressed in whatever radius the maps already fetched can support.
 */
export function radiusForPopulation(population: number, cellAreaM2: number): number {
  // How much ground these hands could actually work in a year, which is the
  // binding physical quantity -- not how much they need to eat.
  //
  // The first version floored the search at sixty-four tiles, about 3 hectares,
  // and derived the rest from calories. Once labour came down to the real
  // medieval task rates, five people could work twenty-seven hectares and were
  // being handed three: every small settlement came out land-limited on an
  // empty continent, which is nonsense. A search radius has to cover what the
  // settlement could plausibly reach, and then the harvest decides how much of
  // it is worth having.
  const workableHa =
    ((population * A.WORKERS_PER_FAMILY) / 5 * A.WORKING_DAYS_PER_YEAR)
    / HELD_HECTARE_DAYS_IRON;

  // Times a margin, because the best land inside the radius is what gets
  // farmed and clipping the search at exactly the area needed would leave the
  // settlement working whatever happened to fall inside a circle.
  const areaM2 = Math.max(cellAreaM2 * 64, workableHa * 10000 * 2.5);
  return Math.sqrt(areaM2 / Math.PI);
}

/**
 * Is this tile nearer to some other settlement than to ours?
 *
 * Chord distance, squared, so there is no square root and no trigonometry in
 * the inner loop -- this runs over every candidate tile for every settlement
 * every turn, and it is the hottest code in the economy.
 */
function belongsToNeighbour(
  catchment: Catchment,
  tile: WorkedTile,
  competitors: readonly Competitor[],
): boolean {
  const map = catchment.maps[tile.map];
  const tx = map.dirs[tile.cell * 3];
  const ty = map.dirs[tile.cell * 3 + 1];
  const tz = map.dirs[tile.cell * 3 + 2];

  // Ours, as a squared chord, from the distance already stored on the tile.
  const oursChord = tile.distanceM / A.EARTH_RADIUS_M;
  const ours = oursChord * oursChord;

  for (const c of competitors) {
    const dx = tx - c.x;
    const dy = ty - c.y;
    const dz = tz - c.z;
    if (dx * dx + dy * dy + dz * dz < ours) return true;
  }
  return false;
}

/** Neighbouring cells of a sub-map cell, for expanding a catchment outward. */
export function neighboursOf(cell: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 6; d++) {
    const n = subNeighbours[cell * 6 + d];
    if (n >= 0) out.push(n);
  }
  return out;
}

/**
 * Which cells of one sub-map a settlement actually farms, and how much of each.
 *
 * The same greedy walk `harvest` does, stopped at the same place, but reporting
 * the tiles instead of the total. The renderer draws these, and what a player
 * sees when they do is von Thunen's rings -- intensive near, extensive far,
 * the frontier pushing outward as the settlement grows -- without a line
 * anywhere in this file mentioning a ring.
 */
export function workedCells(
  catchment: Catchment,
  population: number,
  mapIndex: number,
  ironSupply = 1,
  labourShare = 1,
  competitors: readonly Competitor[] = [],
): Map<number, number> {
  const labourAvailable =
    (population * A.WORKERS_PER_FAMILY) / 5 * A.WORKING_DAYS_PER_YEAR * clamp(labourShare, 0, 1);
  const out = new Map<number, number>();
  let used = 0;

  for (const tile of catchment.candidates) {
    if (used >= labourAvailable) break;
    if (competitors.length > 0 && belongsToNeighbour(catchment, tile, competitors)) continue;
    const cost = daysFor(tile, ironSupply);
    const share = Math.min(1, (labourAvailable - used) / cost);
    if (tile.map === mapIndex) out.set(tile.cell, share);
    used += cost;
  }
  return out;
}

export { reachFactor, labourEfficiency, Transport, TRANSPORT_NAMES, type TransportId };
