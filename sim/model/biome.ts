// Biomes, classified rather than chosen.
//
// The temptation in a game like this is to draw a pretty table of biomes and
// assign each one a temperature and rainfall band that feels right. We do not
// need to: ecologists already did the work, by going and looking. Whittaker's
// classification plots real vegetation against mean annual temperature and
// precipitation and finds that the biomes fall into clean regions of that
// plane. The thresholds below are read off that diagram.
//
// Two boundaries come from Koeppen instead, because they are sharper: forest
// gives way to tundra where the warmest month averages under 10 degC, and to
// permanent ice under 0 degC. Those are observed vegetation limits, not fitted
// curves, and they are why the tree line climbs as you approach the equator
// without anything in this file mentioning altitude.

import * as A from '../anchors.ts';
import { dexp, clamp } from '../gen/mathx.ts';

export const Biome = {
  Ocean: 0,
  Ice: 1,
  Tundra: 2,
  Taiga: 3,
  TemperateGrassland: 4,
  TemperateForest: 5,
  TemperateRainforest: 6,
  Desert: 7,
  Savanna: 8,
  TropicalSeasonalForest: 9,
  TropicalRainforest: 10,
  Wetland: 11,
  Alpine: 12,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: readonly string[] = [
  'ocean', 'ice', 'tundra', 'taiga', 'temperate grassland', 'temperate forest',
  'temperate rainforest', 'desert', 'savanna', 'tropical seasonal forest',
  'tropical rainforest', 'wetland', 'alpine',
];

/** Map colours. Presentation only -- no rule reads these. */
export const BIOME_COLOURS: readonly string[] = [
  '#1b3a5c', '#e8f0f5', '#9aa88c', '#2f5340', '#c2bb6b',
  '#3d6b34', '#1f4a2b', '#d9c08a', '#b5a24e', '#4f7a32', '#14502a',
  '#4a6b5a', '#8d8f95',
];

/**
 * The seasonal swing at a latitude, degC between warmest and coldest month.
 *
 * Needed because every classification boundary that matters is stated in terms
 * of the *warmest month*, not the annual mean -- a place averaging 0 degC is
 * taiga if its summers reach 15 and ice if they never clear freezing, and
 * annual means cannot tell those apart.
 *
 * `sinLat` is the y-component of the cell's unit vector, which is sin(latitude)
 * exactly, with no transcendental involved. See sphere.ts.
 */
export function seasonalAmplitude(sinLat: number): number {
  return A.SEASONAL_AMPLITUDE_POLE_C * sinLat * sinLat;
}

export function warmestMonth(annualMeanC: number, sinLat: number): number {
  return annualMeanC + seasonalAmplitude(sinLat) / 2;
}

/**
 * Net primary productivity, g/m2/yr, by the Miami model.
 *
 * Growth is limited by whichever of heat and water is scarcer -- a hot desert
 * and a cold bog are both barren, for opposite reasons, and taking the minimum
 * of two saturating curves reproduces that without a special case. This one
 * number carries most of the economy: it sets how much a field yields, how
 * much timber a wood regrows, and how many deer a forest can feed.
 */
export function miamiNPP(temperatureC: number, precipMm: number): number {
  const byTemp = A.MIAMI_MAX_NPP / (1 + dexp(A.MIAMI_TEMP_A - A.MIAMI_TEMP_B * temperatureC));
  const byWater = A.MIAMI_MAX_NPP * (1 - dexp(-A.MIAMI_PRECIP_K * precipMm));
  return Math.min(byTemp, byWater);
}

/**
 * Biotemperature: the annual mean of monthly temperatures, with each month
 * clamped into the range where plants actually grow. A place that spends half
 * the year frozen has a biotemperature well above its annual mean, because the
 * frozen months contribute zero rather than a negative.
 *
 * Reconstructed from the annual mean and the seasonal swing, using the baked
 * month-phase table so no transcendental is involved.
 */
export function biotemperature(annualMeanC: number, sinLat: number): number {
  const half = seasonalAmplitude(sinLat) / 2;
  let sum = 0;
  for (let m = 0; m < 12; m++) {
    sum += clamp(annualMeanC + half * A.MONTH_PHASE[m], A.BIOTEMP_MIN_C, A.BIOTEMP_MAX_C);
  }
  return sum / 12;
}

/** Potential evapotranspiration, mm/yr, by Holdridge. How much water a place
 *  would lose in a year if it had water to lose. */
export function potentialEvapotranspiration(annualMeanC: number, sinLat: number): number {
  return A.HOLDRIDGE_PET_FACTOR * biotemperature(annualMeanC, sinLat);
}

/**
 * The aridity index: what a place gets over what it needs.
 *
 * This is the moisture axis of the whole classification, and it is the reason
 * the same 200 mm of rain makes a desert in the tropics and a bog in the
 * Arctic. Absolute rainfall thresholds cannot express that and this can.
 */
export function aridityIndex(precipMm: number, annualMeanC: number, sinLat: number): number {
  const pet = potentialEvapotranspiration(annualMeanC, sinLat);
  return pet <= 0 ? Infinity : precipMm / pet;
}

export interface ClimateSample {
  temperatureC: number;
  precipMm: number;
  sinLat: number;
  elevationM: number;
  /** Water table proximity, 0..1. Only the lower layers know this. */
  waterlogging?: number;
}

/**
 * Classify. Order matters: the absolute limits (ocean, ice, tree line) come
 * first, because they override anything the Whittaker plane would say.
 */
export function classify(s: ClimateSample): BiomeId {
  if (s.elevationM < 0) return Biome.Ocean;

  const summer = warmestMonth(s.temperatureC, s.sinLat);
  if (summer < A.ICE_WARMEST_MONTH_C) return Biome.Ice;
  if (summer < A.TREELINE_WARMEST_MONTH_C) {
    // Above the tree line. Whether that reads as tundra or as bare alpine rock
    // is a question of altitude, not climate: high ground sheds its soil.
    return s.elevationM > 2500 ? Biome.Alpine : Biome.Tundra;
  }

  if ((s.waterlogging ?? 0) > 0.72 && s.precipMm > 400) return Biome.Wetland;

  const t = s.temperatureC;
  const arid = aridityIndex(s.precipMm, t, s.sinLat);

  // The moisture axis is aridity, not rainfall. The temperature axis then only
  // has to say which *kind* of forest or grassland grows there.
  if (arid < A.ARIDITY_DESERT) return Biome.Desert;
  if (arid < A.ARIDITY_SEMIARID) return t >= 20 ? Biome.Savanna : Biome.TemperateGrassland;

  if (t < 3) return Biome.Taiga;
  if (arid < A.ARIDITY_SUBHUMID) {
    return t >= 20 ? Biome.Savanna : Biome.TemperateForest;
  }
  if (arid < A.ARIDITY_PERHUMID) {
    return t >= 20 ? Biome.TropicalSeasonalForest : Biome.TemperateForest;
  }
  return t >= 20 ? Biome.TropicalRainforest : Biome.TemperateRainforest;
}

/**
 * How much of a biome's productivity a person can actually eat.
 *
 * A rainforest out-produces a wheat field several times over and feeds almost
 * nobody, because the productivity is locked in hardwood and canopy. This
 * fraction is what separates biomes that support cities from biomes that do
 * not, and it is the reason the great early civilisations sat on floodplains
 * and river deltas rather than in the most fertile-looking green on the map.
 *
 * FREE PARAMETERS: the fractions themselves. They are informed by comparative
 * agricultural yields but no single measurement gives them, so they are ours.
 */
export const EDIBLE_FRACTION: readonly number[] = [
  0.02, // ocean -- fisheries, and only near a coast
  0.00, // ice
  0.03, // tundra -- lichen, and reindeer that eat it
  0.05, // taiga
  0.35, // temperate grassland -- grain and grazing, the best land there is
  0.22, // temperate forest -- good once cleared
  0.14, // temperate rainforest -- wet, hard to clear, hard to dry a harvest
  0.02, // desert
  0.20, // savanna -- excellent grazing, poor tillage
  0.16, // tropical seasonal forest
  0.06, // tropical rainforest -- enormous growth, almost none of it food
  0.18, // wetland -- rice and reeds, once drained or embanked
  0.02, // alpine
];

/** Roughly how much food a hectare yields per year, in kilograms of grain
 *  equivalent, from productivity and how much of it can be eaten. */
export function foodYieldKgPerHa(biome: BiomeId, npp: number, soilHealth: number): number {
  // NPP is g/m2/yr; a hectare is 10,000 m2; 1000 g is a kg. So g/m2 -> kg/ha
  // is a factor of ten exactly.
  return npp * 10 * EDIBLE_FRACTION[biome] * clamp(soilHealth, 0, 1);
}
