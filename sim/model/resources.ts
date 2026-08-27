// What is on a tile and what is under it.
//
// The rule here is the same as everywhere: the numbers come from somewhere.
// The relative rarity of the metals is not a design decision -- it is crustal
// abundance divided by how far a deposit has to be enriched above that
// abundance before it is worth digging. Iron is 56,300 ppm of the crust and
// needs enriching fivefold; tin is 2.3 ppm and needs enriching four
// hundredfold. That ratio is four orders of magnitude, and it is the entire
// reason a bronze age is a thing that happens to a civilisation and then stops.
//
// Nobody had to decide that tin should be scarce and awkward and found in a
// handful of places. It simply is, and the map inherits it.

import * as A from '../anchors.ts';
import { hash3, unit, fbm3 } from '../gen/noise.ts';
import { clamp, smoothstep, dpow } from '../gen/mathx.ts';
import { Biome, type BiomeId } from './biome.ts';

export const Mineral = {
  Stone: 0,
  Clay: 1,
  Peat: 2,
  Salt: 3,
  Coal: 4,
  Iron: 5,
  Copper: 6,
  Lead: 7,
  Tin: 8,
  Silver: 9,
  Gold: 10,
} as const;

export type MineralId = (typeof Mineral)[keyof typeof Mineral];

export const MINERAL_NAMES: readonly string[] = [
  'stone', 'clay', 'peat', 'salt', 'coal', 'iron',
  'copper', 'lead', 'tin', 'silver', 'gold',
];

/**
 * How often a workable deposit turns up, before geology is consulted.
 *
 * Crustal abundance over required enrichment, compressed by a fourth root.
 * FREE PARAMETER: the fourth root. The raw ratio spans four orders of
 * magnitude and would make copper thirty thousand times rarer than iron, which
 * is not what a geological map looks like -- workable deposits are far less
 * spread out than bulk abundance, because the processes that concentrate them
 * are the same processes for most metals. The exponent compresses that. What
 * it does NOT do is choose the ordering or the spacing, which come from the
 * measured abundances and survive any exponent.
 */
function baseFrequency(ppm: number, enrichment: number): number {
  return dpow(ppm / enrichment, 0.25);
}

const FREQ = {
  iron: baseFrequency(A.CRUST_PPM_IRON, A.ORE_ENRICHMENT_IRON),
  copper: baseFrequency(A.CRUST_PPM_COPPER, A.ORE_ENRICHMENT_COPPER),
  lead: baseFrequency(A.CRUST_PPM_LEAD, A.ORE_ENRICHMENT_COPPER),
  tin: baseFrequency(A.CRUST_PPM_TIN, A.ORE_ENRICHMENT_TIN),
  silver: baseFrequency(A.CRUST_PPM_SILVER, A.ORE_ENRICHMENT_PRECIOUS),
  gold: baseFrequency(A.CRUST_PPM_GOLD, A.ORE_ENRICHMENT_PRECIOUS),
};

// Scaled so iron, the commonest, appears on rather less than half of the
// ground that suits it. Everything else follows from its own abundance.
const FREQ_SCALE = 0.42 / FREQ.iron;

export interface GeologyContext {
  /** Tectonic uplift at this cell, metres. Proxy for hydrothermal activity. */
  upliftM: number;
  /** Sea floor spreading or continental crust. */
  oceanic: boolean;
  elevationM: number;
  slope: number;
  /** Normalised upstream catchment, 0..1. */
  drainage: number;
  waterlogging: number;
  biome: BiomeId;
  aridity: number;
}

export interface Deposit {
  kind: MineralId;
  /** 0..1. Multiply by the tile area to get something extractable. */
  richness: number;
}

/**
 * What is under this tile.
 *
 * Metals want hydrothermal history, which means they want to be near where
 * plates have collided -- the uplift field from the planet generator is
 * standing in for that, and it is a good proxy because the same convergence
 * that builds a mountain range drives the fluids that concentrate ore in it.
 * Cornwall's tin, the Erzgebirge's silver and the Andean copper belt are all
 * sitting on old subduction.
 *
 * The sedimentary minerals want the opposite: coal wants a drowned forest, so
 * a low, flat, formerly swampy basin; clay wants a floodplain; salt wants an
 * arid basin that evaporated.
 */
export function deposits(seed: number, tileSeed: number, g: GeologyContext): Deposit[] {
  const out: Deposit[] = [];
  const roll = (salt: number): number => unit(hash3(tileSeed, salt, 0, seed));

  // Hydrothermal favourability. Convergent uplift is the driver; a little is
  // always present so that a flat continent is not entirely metal-free.
  const hydro = clamp(0.12 + smoothstep(200, 3500, g.upliftM), 0, 1);
  // Exposure: ore you can actually reach. Deep soil buries it, bare rock shows
  // it, which is why mining towns are in the hills.
  const exposure = clamp(0.25 + smoothstep(0.04, A.SLOPE_EROSION_LIMIT, g.slope), 0, 1);
  const metal = hydro * exposure;

  const tryMetal = (kind: MineralId, freq: number, salt: number, bias = 1): void => {
    const chance = freq * FREQ_SCALE * metal * bias;
    const r = roll(salt);
    if (r < chance) {
      // Richness is the tail of the same roll, so a metal that barely made it
      // is a poor seam and one that cleared the bar easily is a good one.
      out.push({ kind, richness: clamp(0.25 + 0.75 * (1 - r / chance), 0, 1) });
    }
  };

  tryMetal(Mineral.Iron, FREQ.iron, 11);
  tryMetal(Mineral.Copper, FREQ.copper, 12);
  tryMetal(Mineral.Lead, FREQ.lead, 13);
  // Tin is not merely rare, it is clustered: it comes out of granite intrusions
  // and those come in provinces. The noise term makes tin regional rather than
  // sprinkled, which is what made the tin trade worth crossing Europe for.
  //
  // The multiplier is centred on one rather than added to one. Written as
  // 1 + 6*province it clustered correctly and also raised tin's *global* rate
  // above copper's -- measured 0.32% against 0.30%, where copper should be
  // three times commoner. A clustering term has to redistribute a metal, not
  // create more of it, so the coefficients are set to average out at about 1:
  // 0.10 outside a province and 2.8 inside, a 28-fold contrast that leaves the
  // worldwide frequency where crustal abundance put it.
  const tinProvince = smoothstep(0.35, 0.75,
    0.5 + 0.5 * fbm3(g.upliftM * 0.0008, g.elevationM * 0.0004, tileSeed * 1e-7, seed ^ 0x71a, 3));
  tryMetal(Mineral.Tin, FREQ.tin, 14, 0.10 + 2.70 * tinProvince);
  tryMetal(Mineral.Silver, FREQ.silver, 15);
  // Placer gold, for the same reason and with the same correction: a river
  // concentrates gold that is already there, it does not conjure more.
  tryMetal(Mineral.Gold, FREQ.gold, 16, 0.50 + 1.50 * clamp(g.drainage, 0, 1));

  // Sedimentary. Coal is a drowned forest that never rotted: low, flat, wet,
  // and warm enough to have grown something worth burying.
  const basin = (1 - smoothstep(0.01, 0.10, g.slope)) * (1 - smoothstep(0, 900, g.elevationM));
  const coal = basin * clamp(g.waterlogging + 0.25, 0, 1)
    * (g.biome === Biome.Wetland || g.biome === Biome.TemperateForest
      || g.biome === Biome.TropicalSeasonalForest || g.biome === Biome.Taiga ? 1 : 0.35);
  if (roll(21) < coal * 0.30) out.push({ kind: Mineral.Coal, richness: clamp(coal, 0.2, 1) });

  // Salt wants a basin that dried out and stayed dry.
  const evaporite = basin * (1 - smoothstep(A.ARIDITY_DESERT, A.ARIDITY_SEMIARID, g.aridity));
  if (roll(22) < evaporite * 0.45) out.push({ kind: Mineral.Salt, richness: clamp(evaporite, 0.2, 1) });

  // Clay is a floodplain. Peat is a bog that is still a bog.
  const clay = clamp(g.drainage * (1 - smoothstep(0.02, 0.12, g.slope)), 0, 1);
  if (roll(23) < 0.20 + clay * 0.55) out.push({ kind: Mineral.Clay, richness: clamp(0.2 + clay, 0, 1) });
  if (g.waterlogging > 0.6 && roll(24) < g.waterlogging) {
    out.push({ kind: Mineral.Peat, richness: clamp(g.waterlogging, 0, 1) });
  }

  // Stone is everywhere; what varies is whether you have to dig for it.
  out.push({ kind: Mineral.Stone, richness: clamp(0.15 + 0.85 * exposure, 0, 1) });

  return out;
}

// ---------------------------------------------------------------------------
// What grows and what walks about on it
// ---------------------------------------------------------------------------

/**
 * The share of a biome's productivity that a large grazing animal can reach.
 *
 * FREE PARAMETERS, and the honest reason they are needed: net primary
 * productivity counts everything a place grows, and a rainforest puts almost
 * all of it forty metres up in the canopy where nothing with hooves will ever
 * eat it. A savanna puts most of it in grass. This is why savanna carries ten
 * times the ungulate biomass of a forest that out-produces it, and no single
 * measurement gives the fractions.
 */
export const GRAZEABLE_FRACTION: readonly number[] = [
  0.00, // ocean
  0.00, // ice
  0.35, // tundra -- low growth, but all of it is lichen and moss within reach
  0.10, // taiga
  0.80, // temperate grassland
  0.12, // temperate forest -- understory only
  0.08, // temperate rainforest
  0.05, // desert
  0.70, // savanna
  0.15, // tropical seasonal forest
  0.03, // tropical rainforest -- it is all canopy
  0.45, // wetland -- reeds and sedge
  0.12, // alpine
];

/** The scale factor that turns grazeable productivity into standing animal
 *  biomass, fixed by the one measured point we have: savanna. */
const HERBIVORE_SCALE =
  A.SAVANNA_HERBIVORE_KG_PER_KM2 / (900 * GRAZEABLE_FRACTION[Biome.Savanna]);

/** Standing biomass of large game, kg per km2. */
export function gameBiomassKgPerKm2(biome: BiomeId, npp: number): number {
  return npp * GRAZEABLE_FRACTION[biome] * HERBIVORE_SCALE;
}

/** Roughly how many deer-sized animals that is. */
export function gameHeadPerKm2(biome: BiomeId, npp: number): number {
  return gameBiomassKgPerKm2(biome, npp) / A.DEER_MASS_KG;
}

/** The share of productivity standing as wood rather than as leaf or grass. */
export const WOODY_FRACTION: readonly number[] = [
  0, 0, 0.02, 0.75, 0.05, 0.80, 0.85, 0.03, 0.15, 0.75, 0.88, 0.20, 0.02,
];

/** Standing timber, tonnes of dry wood per hectare. Anchored so that a
 *  temperate forest at its reference productivity carries 150 t/ha. */
export function timberTPerHa(biome: BiomeId, npp: number): number {
  const scale = A.TIMBER_TEMPERATE_T_PER_HA
    / (A.TIMBER_TEMPERATE_REFERENCE_NPP * WOODY_FRACTION[Biome.TemperateForest]);
  return npp * WOODY_FRACTION[biome] * scale;
}

/** Fresh water, 0..1: what a settlement here could actually draw on. */
export function freshWater(drainage: number, precipMm: number, waterlogged: number): number {
  return clamp(0.7 * clamp(drainage, 0, 1) + 0.25 * smoothstep(50, 1200, precipMm) + 0.2 * waterlogged, 0, 1);
}
