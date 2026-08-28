// Soil.
//
// THE COUNTERINTUITIVE PART
//
// The most productive vegetation on Earth grows on some of its worst soil, and
// the best farmland on the planet grows unremarkable grass. A tropical
// rainforest fixes three or four times the carbon a prairie does and its soil
// is thin, acid and nearly barren; the chernozem under the Ukrainian steppe is
// a metre of black earth and fed half of Europe.
//
// If you derive fertility from productivity you get this exactly backwards,
// and you get a game where the right move is always to settle in the jungle.
//
// Three mechanisms decide it, and the first version of this file had only one
// of them -- which is why it produced a rainforest more fertile than a prairie,
// the exact error it was written to avoid. Measured: rainforest 0.280 against
// grassland 0.275.
//
//   WHERE THE PRODUCTION GOES. Grasses put three quarters of what they make
//   into roots, which die back each year and become humus where the next crop
//   needs it. A tree puts its production into a trunk that stands for two
//   centuries and then rots on the surface.
//
//   HOW FAST IT ROTS. Decomposition roughly doubles per 10 degC. This is why
//   boreal soils hold a third of the soil carbon on the planet and tropical
//   ones hold almost none: in the tropics the litter is gone in weeks.
//
//   WHAT THE RAIN TAKES. Rain beyond what a place can evaporate has to go
//   somewhere, and on the way down it carries the soluble bases out of the
//   root zone. The surplus is something we can already compute -- rainfall
//   minus the potential evapotranspiration the aridity index needed anyway.
//
// Multiply the three and temperate grassland wins, because it is the only
// combination that puts its production underground, keeps it there, and never
// gets enough rain to wash it out. That is why every great grain belt on Earth
// is semi-arid, and none of it had to be decided.

import * as A from '../anchors.ts';
import { clamp, smoothstep, dpow } from '../gen/mathx.ts';
import {
  potentialEvapotranspiration, biotemperature, seasonalAmplitude, miamiNPP, type BiomeId,
} from './biome.ts';

export interface SoilSample {
  temperatureC: number;
  precipMm: number;
  sinLat: number;
  /** Local gradient, rise over run. */
  slope: number;
  /**
   * How much of this tile is floodplain, 0..1.
   *
   * From the river's real discharge and the tile's real width, so it means the
   * same thing at every layer -- see hydrology.alluvialFraction. It replaced a
   * normalised drainage rank, which meant something different on every map.
   */
  alluvial: number;
  /** What grows here, which decides where the production goes. */
  biome: BiomeId;
}

export interface Soil {
  /** Topsoil depth, cm. */
  depthCm: number;
  /** Plant-available nutrients, 0..1. This is the one the economy reads. */
  fertility: number;
  /** How much of the year the soil holds usable water, 0..1. */
  moisture: number;
  /** Condition, 0..1. Starts at fertility and falls as land is worked. */
  health: number;
  /** Fraction of rainfall percolating past the roots, 0..1. */
  leaching: number;
}

/**
 * The share of rainfall that drains past the root zone.
 *
 * Precipitation beyond potential evapotranspiration has nowhere else to go.
 * Below that threshold there is no surplus at all and nothing is carried away,
 * which is why the number is zero across every semi-arid grassland on Earth
 * and why those are the soils worth farming.
 */
export function leachingFraction(precipMm: number, temperatureC: number, sinLat: number): number {
  const pet = potentialEvapotranspiration(temperatureC, sinLat);
  // Frozen ground does not leach. A place whose biotemperature is zero never
  // has liquid water moving through it, and the naive formula gets this
  // exactly backwards -- it reads PET of zero as infinite surplus and declares
  // the Arctic the most heavily leached soil on the planet.
  if (pet <= 0) return 0;
  if (precipMm <= pet) return 0;
  return (precipMm - pet) / precipMm;
}

/**
 * How much of the standing organic matter is actually available to a plant.
 *
 * Tundra soils hold enormous quantities of organic matter -- permafrost peat
 * is a third of the soil carbon on Earth -- and are still barren, because
 * nothing mineralises it. Nutrients locked in undecomposed peat over an eight
 * week growing season may as well not be there.
 *
 * Biotemperature is exactly the right measure of that, having already thrown
 * away the months when nothing happens. Scaled against 10 degC, near
 * Holdridge's boundary between the boreal and temperate belts.
 */
export function nutrientAvailability(temperatureC: number, sinLat: number): number {
  return clamp(biotemperature(temperatureC, sinLat) / A.BIOTEMP_AVAILABILITY_C, 0, 1);
}

/**
 * Topsoil depth.
 *
 * Two things fight: organic matter piles up in proportion to what grows, and
 * gravity takes it off anything steep. Above a gradient of about 0.30 erosion
 * outpaces formation and there is nothing left but rock -- which is why
 * mountains are bare however wet and warm they are.
 *
 * Drainage adds the third term: material stripped off the slopes has to land
 * somewhere, and where it lands is a floodplain. That is the deepest soil in
 * any landscape and it is why river valleys are where people are.
 */
export function topsoilDepth(s: SoilSample, npp: number): number {
  const organic = clamp(npp / A.MIAMI_MAX_NPP, 0, 1);
  const held = 1 - smoothstep(A.SLOPE_WATERLOGGING_LIMIT, A.SLOPE_EROSION_LIMIT, s.slope);
  const alluvial = 1 + 1.4 * clamp(s.alluvial, 0, 1) * held;

  const depth = A.TOPSOIL_THIN_CM
    + (A.TOPSOIL_DEEPEST_CM - A.TOPSOIL_THIN_CM) * organic * held * alluvial;
  return clamp(depth, 0, A.TOPSOIL_DEEPEST_CM * 1.5);
}

/**
 * How fast litter rots here, relative to a temperate 10 degC. Q10 of 2, so
 * decomposition doubles per 10 degC. Written with dpow rather than Math.pow
 * because a world has to rebuild identically -- see docs/determinism.md.
 */
export function decompositionRate(temperatureC: number): number {
  return dpow(A.SOIL_Q10, (temperatureC - A.SOIL_DECOMP_REFERENCE_C) / 10);
}

/**
 * Standing soil organic matter: input over decay, less what the water took.
 *
 * The steady state of a stock with a constant input and a first-order loss is
 * input over rate, which is why this is a division rather than a simulation.
 */
export function soilOrganicMatter(s: SoilSample, npp: number): number {
  const input = npp * A.BELOWGROUND_FRACTION[s.biome];
  const decay = decompositionRate(s.temperatureC);
  const leach = leachingFraction(s.precipMm, s.temperatureC, s.sinLat);
  return (input / decay) * (1 - leach);
}

/**
 * Fertility, 0..1, scaled so undisturbed temperate grassland sits near the top
 * -- because on Earth it does, and every other soil is read against it.
 */
export function fertility(s: SoilSample, npp: number, depthCm: number): number {
  const som = soilOrganicMatter(s, npp) / A.SOM_CHERNOZEM_REFERENCE;

  // Depth matters on its own: a rich centimetre is still only a centimetre.
  const body = clamp(depthCm / A.TOPSOIL_TYPICAL_CM, 0, 1.6) / 1.6;

  // Alluvium arrives pre-enriched, stripped off somewhere upstream.
  const alluvial = 1 + 0.45 * clamp(s.alluvial, 0, 1);

  // And none of it counts if nothing can mineralise it.
  const available = nutrientAvailability(s.temperatureC, s.sinLat);

  return clamp(som * (0.35 + 0.65 * body) * alluvial * available, 0, 1);
}

/**
 * Soil moisture: how much of the year there is water in the root zone.
 *
 * Not the same as rainfall and not the same as aridity. A cold wet flat holds
 * water it cannot evaporate and is a bog; a hot wet slope sheds it and is dry
 * by August. Being on a floodplain raises it, slope lowers it.
 */
export function soilMoisture(s: SoilSample): number {
  const pet = potentialEvapotranspiration(s.temperatureC, s.sinLat);
  const supply = pet <= 0 ? 2 : s.precipMm / pet;
  const shed = smoothstep(A.SLOPE_WATERLOGGING_LIMIT, A.SLOPE_EROSION_LIMIT * 2, s.slope);
  return clamp(supply * (1 - 0.55 * shed) + 0.5 * s.alluvial, 0, 2) / 2;
}

/**
 * How waterlogged a place is, 0..1 -- the input the biome classifier needs to
 * call something a marsh. Flat, wet and collecting other people's runoff.
 */
export function waterlogging(s: SoilSample): number {
  const flat = 1 - smoothstep(A.SLOPE_WATERLOGGING_LIMIT, A.SLOPE_EROSION_LIMIT, s.slope);
  const wet = soilMoisture(s);
  return clamp(flat * (0.45 * wet + 0.75 * clamp(s.alluvial, 0, 1)), 0, 1);
}

/** Everything at once, which is what the tile generator wants. */
export function deriveSoil(s: SoilSample): Soil {
  const npp = miamiNPP(s.temperatureC, s.precipMm);
  const depthCm = topsoilDepth(s, npp);
  const fert = fertility(s, npp, depthCm);
  return {
    depthCm,
    fertility: fert,
    moisture: soilMoisture(s),
    // Health is one on virgin ground, and it is *not* a second copy of
    // fertility. Fertility is what the climate and the vegetation built up over
    // ten thousand years; health is what farming has taken out of it since, and
    // nothing has farmed this yet.
    //
    // Starting it at fertility made the yield formula square the fertility term
    // -- 0.35 became 0.12 -- and dropped median grain yield to 41 kg/ha against
    // a medieval 330-450. Two plausible-looking numbers multiplied into one
    // wrong one, which is the failure mode that is hardest to see.
    health: 1,
    leaching: leachingFraction(s.precipMm, s.temperatureC, s.sinLat),
  };
}

/**
 * Grain yield, kg per hectare per year.
 *
 * Anchored at the medieval figure rather than the modern one: English manor
 * accounts put unfertilised wheat at 7-10 bushels an acre, which is 470-670
 * kg/ha, and the best land in the best years reached about 1,000. That is the
 * top of this scale, and it is reached only where fertility and health are
 * both near one.
 */
export function grainYieldKgPerHa(
  soil: Soil,
  npp: number,
  suitability: number,
): number {
  // Times the cropped fraction, because a third of any holding is lying fallow.
  // Leaving it out put the best land at 0.37 ha per person against a measured
  // historical 0.5-1.5; with it, 0.55.
  return A.MEDIEVAL_GRAIN_KG_PER_HA * soil.fertility * soil.health
    * suitability * A.CROPPED_FRACTION_THREE_FIELD;
}

/**
 * Whether wheat can grow here at all, 0..1 -- water and season, whichever is
 * scarcer.
 *
 * This replaced a term that scaled with net primary productivity, which was a
 * double-count: fertility already carries NPP through the organic matter it
 * builds, so the same quantity was being applied twice under two names. Worse,
 * it was the wrong quantity. NPP says what a *landscape* grows; it says
 * nothing about whether a *crop* will ripen, and the two come apart exactly
 * where it matters -- a rainforest hillside has enormous NPP and will not make
 * a wheat field.
 *
 * Wheat's own requirements are measured, so use those.
 */
export function cropSuitability(precipMm: number, temperatureC: number, sinLat: number): number {
  const water = clamp(precipMm / A.WHEAT_WATER_REQUIREMENT_MM, 0, 1.15);
  // The season term is a threshold, not a proportion. A crop that needs 120
  // days and gets 90 does not yield three quarters -- it does not ripen, and
  // you get nothing. Written linearly it gave sub-Arctic tundra a suitability
  // of 0.6 off a three-month summer.
  const season = smoothstep(
    A.WHEAT_GROWING_DAYS * 0.75, A.WHEAT_GROWING_DAYS,
    growingDays(temperatureC, sinLat));
  return Math.min(water, season);
}

/**
 * Days a year above wheat's base temperature.
 *
 * Reconstructed from the annual mean and the seasonal swing with the same
 * baked month table biotemperature uses, so it needs no transcendental and
 * agrees with the rest of the climate model about what a year looks like.
 */
export function growingDays(annualMeanC: number, sinLat: number): number {
  const half = seasonalAmplitude(sinLat) / 2;
  let months = 0;
  for (let m = 0; m < 12; m++) {
    if (annualMeanC + half * A.MONTH_PHASE[m] >= A.WHEAT_BASE_TEMP_C) months++;
  }
  return (months * 365.25) / 12;
}
