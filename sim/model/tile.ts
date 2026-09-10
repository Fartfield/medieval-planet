// A tile, assembled.
//
// Nothing here is stored. Everything on this record is computed from the world
// seed and the tile's address the moment somebody asks, and thrown away again
// afterwards. The only bytes that survive are in `TileDelta` at the bottom of
// this file -- what a player changed, and nothing else.
//
// That is the whole storage design in one sentence, and it is why a trillion
// tiles fit on a laptop.

import type { BiomeId } from './biome.ts';
import type { Soil } from './soil.ts';
import type { Deposit } from './resources.ts';
import type { RockId } from './rock.ts';
import type { Address } from '../geo/address.ts';

export const Landform = {
  Plain: 0,
  Hills: 1,
  Mountain: 2,
  Valley: 3,
  Marsh: 4,
  Coast: 5,
  Water: 6,
  Plateau: 7,
} as const;

export type LandformId = (typeof Landform)[keyof typeof Landform];

export const LANDFORM_NAMES: readonly string[] = [
  'plain', 'hills', 'mountain', 'valley', 'marsh', 'coast', 'water', 'plateau',
];

/**
 * Landform, from relief rather than from climate.
 *
 * Biome says what grows; landform says what shape the ground is. They are
 * genuinely independent -- a valley can be forest or desert, a marsh can be
 * tropical or boreal -- and keeping them apart is what lets a player read
 * "upland savanna" or "wooded river valley" off a tile instead of one word.
 *
 * The order of the tests is the argument. Water first, because it overrides
 * everything. Then marsh, which is a relief fact (flat and waterlogged) even
 * though it reads as a biome. Then the slope ladder, with valley split out of
 * it by drainage: a place can be flat because it is a plain or flat because a
 * river cut it flat, and those are different places to live.
 */
export function classifyLandform(
  elevationM: number,
  slope: number,
  drainage: number,
  waterlogging: number,
  nearCoast: boolean,
): LandformId {
  if (elevationM < 0) return Landform.Water;
  if (nearCoast && elevationM < 40) return Landform.Coast;
  if (waterlogging > 0.7 && slope < 0.03) return Landform.Marsh;
  if (slope > 0.25) return Landform.Mountain;
  if (slope > 0.08) return Landform.Hills;
  if (drainage > 0.55) return Landform.Valley;
  if (elevationM > 900) return Landform.Plateau;
  return Landform.Plain;
}

export interface Flora {
  /** Standing timber, tonnes of dry wood per hectare. */
  timberTPerHa: number;
  /** Grain this tile would yield if tilled, kg per hectare per year. */
  grainKgPerHa: number;
  /** Grazing available to livestock, as a share of productivity. */
  forage: number;
}

export interface Fauna {
  /** Standing large game, head per square kilometre. */
  gameHeadPerKm2: number;
  /** Fish, 0..1. Coastal water and big rivers only. */
  fish: number;
}

/** What a player sees when they click a patch of ground. */
export interface GroundTile {
  address: Address;
  /** Position on the sphere, for distance and for drawing. */
  dir: readonly [number, number, number];

  biome: BiomeId;
  landform: LandformId;

  elevationM: number;
  slope: number;
  temperatureC: number;
  precipMm: number;
  aridity: number;
  /**
   * Discharge on the fixed 0..1 scale. Comparable between any two tiles in the
   * world, which it was not while each map normalised against its own biggest
   * channel. Good for drawing and for asking how near a valley floor is; for
   * anything that decides something, use the real numbers below.
   */
  drainage: number;
  /** Mean discharge, cubic metres a second. */
  dischargeM3S: number;
  /** Upstream catchment, square metres. */
  catchmentM2: number;
  /** Standing water on this tile, metres. A lake, if it is more than a puddle. */
  lakeDepthM: number;
  freshWater: number;

  /** Net primary productivity, g/m2/yr. Most of the economy hangs off this. */
  nppGm2: number;

  /** What rock is under this tile. See model/rock.ts. */
  rock: RockId;
  /** Depth of soil over bedrock, metres. Zero is bare rock. */
  regolithM: number;
  /** Surface lowering, metres a year. */
  erosionMPerYr: number;
  /**
   * Factor of safety against a landslide, as the ground stands today.
   *
   * Below one it is already moving. Between one and about 1.3 it is held up by
   * whatever is growing on it, and clearing that is a decision with a delay on
   * it -- root strength decays over a few years, so the hillside comes down
   * some wet season after the timber was taken rather than the same week.
   *
   * Only meaningful where hillslopes are resolved, which is the plot layer
   * down. Above that the gradient is measured across kilometres and means
   * nothing about a hillside.
   */
  stability: number;
  /** Whether the four fields above are being asked at a scale they hold at. */
  hillslopesResolved: boolean;
  soil: Soil;
  flora: Flora;
  fauna: Fauna;
  deposits: Deposit[];

  /** Who lives here, and how they are doing. Zero until somebody settles. */
  population: number;
  populationHealth: number;
  owner: number;

  /** True if any of the above has been changed from what generation produced. */
  modified: boolean;
}

/**
 * The only thing that ever gets written down.
 *
 * A delta is sparse in two senses: there is one only for tiles somebody
 * touched, and it carries only the fields that differ. Soil health moves when
 * land is worked; population moves when people arrive; ownership moves when a
 * border does. Everything else on the tile is still the pure function of the
 * seed, and is still recomputed rather than stored, even on a tile that has a
 * delta.
 *
 * This is what makes the store scale with *play* rather than with world size.
 * A busy world with ten thousand players and a thousand turns behind it holds
 * a few million deltas. The trillion tiles nobody has visited hold nothing.
 */
export interface TileDelta {
  /** Address key, from geo/address.ts. */
  key: string;
  soilHealth?: number;
  population?: number;
  populationHealth?: number;
  owner?: number;
  /** Ore already taken out, 0..1 per deposit index. */
  depleted?: number[];
  /** Timber cut, as a fraction of what stood. Regrows. */
  cleared?: number;
  /**
   * The turn the timber was last cut.
   *
   * Separate from `turn` below, which moves on every write of any kind and so
   * cannot say how long ago the trees came down. The distance from here is
   * what the root-decay curve is read at, and it is the reason a hillside
   * comes down years after the felling rather than the same week.
   */
  clearedTurn?: number;
  /** Grain in the granary, kg. A year's eating is the target. */
  grainStock?: number;
  /** The village herd, head of cattle. Fractional, like population. */
  herdHead?: number;
  /** The herd's condition: weight over proper weight, 1 in full flesh. */
  herdCondition?: number;
  /** The barn, kg of hay. */
  hayKg?: number;
  /** The pasture's standing crop, kg dry. What winter grazing eats down. */
  standingKg?: number;
  /**
   * Hectares actually broken to the plough.
   *
   * Undefined means ESTABLISHED -- a settlement seeded without a record has
   * been there long enough that its land is broken, the same convention the
   * granary uses. A founding sets it to zero explicitly and earns every
   * hectare at the assart price.
   */
  brokenHa?: number;
  /**
   * The hunting range's remaining stock of game, 0 to 1.
   *
   * One is an untouched range. A hard first winter halves it, which is why
   * the second winter is thin where the first was fat. Undefined means
   * untouched, and it clears with the settlement: the regrowth that happens
   * with nobody there to see it is complete by the time anyone returns.
   */
  wildShare?: number;
  /** The sheep flock, head. Fractional like the herd. */
  flockHead?: number;
  flockCondition?: number;
  /** The wool store, kg greasy, waiting for the evenings. */
  woolKg?: number;
  /** The village's cloth, m2. What wears out and what the spinning replaces. */
  clothM2?: number;
  /** Iron in hand, kg. A year's wear is the target. */
  ironStock?: number;
  /**
   * The share of the settlement's hands on the fields rather than in a mine or
   * the woods, 0..1.
   *
   * Carried between turns because it is a *decision*, adjusted from how last
   * year went, and a settlement that recomputed it from scratch each turn would
   * oscillate. It is the one piece of state here that is a plan rather than a
   * quantity.
   */
  farmShare?: number;

  /**
   * Grain sold last turn, kg.
   *
   * Carried so that a settlement can plant for its buyers. Without it a
   * farming town grows exactly what it and its granary need, its population
   * rises until it eats that, and the surplus feeding a mining town simply
   * stops -- measured at year twelve, with the miners going back to farming
   * poor ground. A farmer plants for last year's buyer, and that is the whole
   * of the mechanism.
   */
  soldKg?: number;

  /** Turn number this was last written. Lets old deltas be aged out. */
  turn: number;
}

export function emptyDelta(key: string, turn: number): TileDelta {
  return { key, turn };
}

/** Does this delta still say anything? An all-default delta can be dropped. */
export function deltaIsEmpty(d: TileDelta): boolean {
  return d.soilHealth === undefined
    && d.population === undefined
    && d.populationHealth === undefined
    && d.owner === undefined
    && d.depleted === undefined
    && d.cleared === undefined
    && d.clearedTurn === undefined
    && d.grainStock === undefined
    && d.ironStock === undefined
    && d.farmShare === undefined
    && d.soldKg === undefined;
}
