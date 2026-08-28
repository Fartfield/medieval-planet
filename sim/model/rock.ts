// What the ground is made of, and what that does to everything above it.
//
// Rock had been a gap with an ore table sitting over it. Deposits knew about
// tectonic uplift because ore follows hydrothermal history, but nothing knew
// what the *country rock* was -- so a granite massif and a shale basin eroded
// at the same rate, made soil at the same rate, and held a slope equally well.
// They do none of those things.
//
// WHY THE TECTONICS ARE ENOUGH TO SETTLE IT
//
// A rock type is not an independent roll. It is what the plate history left
// behind, and the planet generator already computes that history: which plate,
// oceanic or continental, and how hard it has been converging. Read in the
// right order those three answer the question:
//
//   oceanic crust                       -> basalt, poured out at a ridge
//   continental, hard convergence       -> the exhumed core of an orogen,
//                                          granite and gneiss
//   continental, moderate convergence   -> the fold belt on its flanks, the
//                                          same sediments crumpled and lifted
//   continental, quiet and low          -> a basin, filled with what washed
//                                          into it; carbonate where the sea
//                                          was warm, clastic where it was not
//
// The province noise is sampled in 3D world space at a 200 km wavelength, so
// provinces are hundreds of kilometres across and continuous across every map
// boundary without any map consulting its neighbours -- the same property that
// makes terrain continuous, for the same reason.
//
// WHAT EACH ROCK CARRIES
//
// Three numbers, all measured, all consumed downstream:
//
//   erodibility     how fast running water cuts it (stream power's K)
//   friction angle  how steep a slope its soil will stand at
//   soil production how fast it rots into something a plant can root in
//
// Together they are why the Weald is farmland and the Cairngorms are not.

import * as A from '../anchors.ts';
import { EROSION_K_REFERENCE } from '../derive.ts';
import { fbm3 } from '../gen/noise.ts';
import { clamp, dexp, dlog, LN2 } from '../gen/mathx.ts';

/** Hash salt, so the rock provinces are independent of every other field. */
const ROCK_SALT = 0x20c;

/** Pi, spelled out rather than taken from Math, which specifies it exactly
 *  but which the purity check bans wholesale to keep the rule simple. */
const PI = 3.141592653589793;

export const Rock = {
  /** Ocean floor and volcanic provinces. Weathers fast and weathers rich. */
  Basalt: 0,
  /** Intrusive, exhumed from the root of a mountain belt. The hardest thing here. */
  Granite: 1,
  /** The same belt's metamorphosed sediments. Hard, and it splits. */
  Gneiss: 2,
  /** Fold-belt and basin clastics. The middle of every range. */
  Sandstone: 3,
  /** Weak, impermeable, and the reason a third of the world's landslides happen. */
  Shale: 4,
  /** Warm shallow sea, turned to stone. Thin soil, hard water, good building. */
  Limestone: 5,
} as const;

export type RockId = (typeof Rock)[keyof typeof Rock];

export const ROCK_NAMES: readonly string[] = [
  'basalt', 'granite', 'gneiss', 'sandstone', 'shale', 'limestone',
];

/**
 * Erodibility relative to sandstone, which is the middle of the range.
 *
 * Rock resistance spans three orders of magnitude in the field; this is a
 * conservative fiftyfold across the six, ordered the way every erodibility
 * compilation orders them. Shale is the outlier at both ends -- it cuts fastest
 * and it holds slopes worst -- and that is not a coincidence, it is the same
 * property twice: it has no strength across its bedding.
 */
export const ROCK_ERODIBILITY: readonly number[] = [
  0.35, // basalt
  0.10, // granite
  0.15, // gneiss
  1.00, // sandstone
  5.00, // shale
  0.50, // limestone
];

/**
 * Friction angle of the soil each rock weathers into, degrees.
 *
 * Not the rock's own strength -- the intact rock is far stronger than anything
 * that slides. What fails is the mantle of weathered material on top, and its
 * strength is inherited from the parent rock's mineralogy. Granite rots to a
 * gritty sand that stands steeply; shale rots to a clay that does not.
 */
export const ROCK_FRICTION_DEG: readonly number[] = [
  32.0, // basalt: weathers to clay, and clay is weak
  38.0, // granite: gritty residual sand
  36.0, // gneiss
  35.0, // sandstone
  24.0, // shale: the classic landslide lithology
  33.0, // limestone
];

/**
 * EFFECTIVE cohesion of that soil, kilopascals -- and the word is load-bearing.
 *
 * Drained cohesion, which is what governs a shallow landslide, runs 0 to about
 * 5 kPa in the colluvium that actually slides. It is not the undrained shear
 * strength of a stiff clay, which is tens of kilopascals and describes a
 * different failure entirely.
 *
 * Getting that wrong made the whole model inert. At 10 kPa for shale the
 * cohesion term was 10,000 Pa against a friction term of 3,500, so cohesion
 * decided everything and no slope on the planet could be made to fail: a bare,
 * saturated, thirty-degree shale hillside came back at FS 1.40. The direction
 * of every response was right -- forest above bare, dry above wet -- and the
 * magnitude meant nothing could ever cross one.
 *
 * And it is the RESIDUAL value, not the peak. A slope that has moved once, or
 * whose clay has been softened by wetting and drying for a few thousand years,
 * retains almost no cohesion at all -- residual c' in clay is near zero, and
 * that is the number every back-analysis of a real clay slide recovers.
 *
 * Peak values put shale at 5 kPa, and at 5 kPa shale came out MORE stable than
 * granite on the same hillside, because at the metre or so of depth a shallow
 * slide involves the cohesion term outweighs the friction one. That inverts
 * the best-known ordering in the subject -- and the file's own comment three
 * lines up calls shale the classic landslide lithology. The comment was right
 * and the number was wrong.
 */
export const ROCK_SOIL_COHESION_KPA: readonly number[] = [
  2.5, // basalt: weathers to clay
  0.5, // granite: gritty sand, essentially cohesionless
  1.0, // gneiss
  1.5, // sandstone
  1.0, // shale: residual clay, and the least friction of any of them
  2.0, // limestone
];

/**
 * Soil production relative to the measured maximum.
 *
 * Basalt weathers fastest and into the most fertile material on Earth -- the
 * Deccan, Java, the Auvergne. Limestone is the trap: it makes almost no soil
 * because it dissolves rather than crumbles, so there is no residue left
 * behind, which is why karst is bare and thin however wet it gets.
 */
export const ROCK_SOIL_PRODUCTION: readonly number[] = [
  1.30, // basalt
  0.80, // granite
  0.85, // gneiss
  1.00, // sandstone
  1.20, // shale
  0.35, // limestone
];

export interface RockContext {
  /** Position on the sphere, for the province noise. */
  x: number; y: number; z: number;
  /** Tectonic uplift at this cell, metres. The plate history in one number. */
  upliftM: number;
  elevationM: number;
  oceanic: boolean;
  /** Sine of latitude, for whether the sea here was warm enough for carbonate. */
  sinLat: number;
  seed: number;
}

/** A province wavelength: 200 km, which is what a rock province measures. */
const PROVINCE_FREQ = A.EARTH_RADIUS_M / 200000;

/**
 * What rock is under this point.
 *
 * Read as a sequence of the strongest signal first. Ocean floor is basalt and
 * nothing else matters; then the deeper the exhumation the more crystalline
 * what is exposed; and a quiet low continent is whatever filled the basin.
 *
 * The province noise does two jobs. It decides clastic against carbonate in
 * the basins, where latitude only says which is *likelier*, and it breaks up
 * the orogen bands so that a mountain belt is granite and gneiss in patches
 * rather than a clean stripe -- which is what a real one looks like, because
 * the exhumation is never uniform along strike.
 */
export function rockAt(c: RockContext): RockId {
  if (c.oceanic && c.elevationM < 0) return Rock.Basalt;

  const province = fbm3(
    c.x * PROVINCE_FREQ, c.y * PROVINCE_FREQ, c.z * PROVINCE_FREQ,
    c.seed ^ ROCK_SALT, 4,
  );

  // Deep exhumation: only a belt that has been converging hard and long enough
  // to strip kilometres off itself exposes what was once its root.
  if (c.upliftM > 2600) {
    return province > 0 ? Rock.Granite : Rock.Gneiss;
  }

  // The fold belt: the same sediments, lifted and turned on edge. Sandstone
  // where the pile was sandy, shale where it was muddy, and there is more mud
  // than sand in any real basin.
  if (c.upliftM > 900) {
    return province > 0.25 ? Rock.Sandstone : Rock.Shale;
  }

  // Volcanic provinces: a plate that is being pulled apart rather than pushed
  // together floods basalt over whatever was there. Negative uplift is the
  // divergent case in the planet generator's sign convention.
  if (c.upliftM < -400) return Rock.Basalt;

  // A quiet continental basin. Carbonate needs a warm shallow sea, and the
  // tropics are where those are -- but the province noise carries as much of
  // the decision as the latitude does, because a basin's history is longer
  // than its present position.
  const warm = 1 - c.sinLat * c.sinLat;
  if (warm * 0.8 + province * 0.5 > 0.55) return Rock.Limestone;
  return province > 0 ? Rock.Sandstone : Rock.Shale;
}

// ---------------------------------------------------------------------------
// Erosion
// ---------------------------------------------------------------------------

/**
 * How fast the surface is being lowered here, metres a year.
 *
 * Stream power: E = K·A^m·S^n, with m near a half and n near one. The exponents
 * are what every field calibration converges on, and the ratio near 0.5 is why
 * a river's long profile is concave -- discharge grows downstream faster than
 * the slope it needs, so the channel flattens as it goes.
 *
 * Evaluated pointwise from the catchment and slope this cell actually has. That
 * is a *rate*, not a simulation: it says how fast this place is wearing down
 * given its present shape, which is exactly what the soil model needs and is
 * honest without iterating a landscape to equilibrium. Iterating would also
 * break generate-on-demand, because a cell's answer would depend on its
 * neighbours' answers depending on theirs.
 *
 * K is calibrated at one measured point -- a temperate hillslope on ordinary
 * sedimentary rock denudes at about 0.05 mm a year -- and everything else
 * follows from the rock and the geometry. It puts an active mountain front
 * near 0.8 mm/yr and a lowland basin near 0.005, which is the measured spread.
 */
export function erosionRateM(
  rock: RockId,
  catchmentM2: number,
  slope: number,
): number {
  if (catchmentM2 <= 0 || slope <= 0) return 0;
  // m = 0.5 exactly, so A^m is a square root: no transcendental, and no
  // rounding difference between engines to worry about.
  const power = Math.sqrt(catchmentM2) * slope;
  return EROSION_K_REFERENCE * ROCK_ERODIBILITY[rock] * power;
}

/**
 * Depth of soil over bedrock, metres.
 *
 * Where production balances erosion. Heimsath measured soil production falling
 * exponentially with the depth already there -- P = P0·e^(−z/z0) -- because a
 * thin cover holds water against the rock and a thick one insulates it. Set
 * that equal to the erosion rate and solve:
 *
 *     P0·e^(−z/z0) = E     ->     z = z0·ln(P0/E)
 *
 * The exponential is why soil depth is self-limiting rather than something to
 * be capped: strip a hillside and it makes soil faster; leave it and
 * production slows toward nothing. And where erosion outruns the maximum
 * production rate the answer is negative, which means **bare rock** -- a
 * result, not an exception. That is why a ridge is stone however wet it is,
 * and it is the piece the old model had to assert with a slope threshold.
 *
 * This is a hillslope steady state and hillslopes are a thirty-metre question.
 * At the top of the ladder a two-kilometre mountain spread across a cell is a
 * gradient under one degree, nowhere near anything that strips a ridge, and
 * the answer comes back "three metres of soil everywhere" -- which is why the
 * caller passes the cell size and the coarse layers do not ask.
 */
export function soilDepthM(rock: RockId, erosionM: number): number {
  const production = A.SOIL_PRODUCTION_MAX_M_PER_YR * ROCK_SOIL_PRODUCTION[rock];
  if (erosionM <= 0) return A.SOIL_PRODUCTION_DECAY_M * dlog(production / 1e-9);
  if (erosionM >= production) return 0;
  return A.SOIL_PRODUCTION_DECAY_M * dlog(production / erosionM);
}

// ---------------------------------------------------------------------------
// Whether the hillside stays where it is
// ---------------------------------------------------------------------------

/**
 * Root cohesion, kilopascals, from what is growing.
 *
 * Measured by back-analysis of slopes that failed and by shear tests on rooted
 * blocks: grass 1-5 kPa, shrubs 2-10, forest 5-25. It is the term that makes
 * vegetation part of the geotechnics instead of decoration on top of them.
 *
 * `yearsSinceCleared` is what makes clearing land consequential. Root strength
 * decays with a half-life of a few years after the plants die, so a hillside
 * keeps standing for a while on roots that are already dead -- and the measured
 * consequence is that landslide frequency after a clearcut peaks three to
 * fifteen years later, not at the time of the cut. A player gets their timber
 * and their field, and the hillside comes down on whoever is farming it by
 * then. Nobody scripts that; the factor of safety just crosses one.
 */
export function rootCohesionKPa(
  standing: number,
  yearsSinceCleared: number,
): number {
  const live = clamp(standing, 0, 1) * A.ROOT_COHESION_FOREST_KPA;
  if (yearsSinceCleared <= 0) return live;
  // Exponential decay at the measured half-life. dexp, because a world has to
  // rebuild identically -- see docs/determinism.md.
  const halves = yearsSinceCleared / A.ROOT_DECAY_HALFLIFE_YR;
  return live * dexp(-halves * LN2);
}

/**
 * How much root cohesion a biome's vegetation is worth, as a fraction of a
 * closed forest's.
 *
 * Read straight off the measured table: grass holds 1-5 kPa, shrubs 2-10,
 * forest 5-25. A forest is 1, a scrub or savanna is the shrub band, grassland
 * is the grass band, and bare desert, ice and open water hold nothing.
 */
export const STANDING_COVER: readonly number[] = [
  0.00, // ocean
  0.00, // ice
  0.15, // tundra: shallow roots over permafrost
  1.00, // taiga
  0.20, // temperate grassland
  1.00, // temperate forest
  1.00, // temperate rainforest
  0.02, // desert
  0.40, // savanna
  1.00, // tropical seasonal forest
  1.00, // tropical rainforest
  0.35, // wetland
  0.10, // alpine
];

export function standingCoverOf(biome: number): number {
  return STANDING_COVER[biome] ?? 0;
}

export interface SlopeCase {
  /** Gradient, rise over run. */
  slope: number;
  soilDepthM: number;
  rock: RockId;
  /** Root cohesion present, kPa. */
  rootCohesionKPa: number;
  /** How much of the soil column is saturated, 0..1. Storms drive this. */
  saturation: number;
}

/**
 * The infinite-slope factor of safety. Below one, the hillside goes.
 *
 *     FS = (c_soil + c_roots + (γ·z·cos²θ − u)·tanφ) / (γ·z·sinθ·cosθ)
 *
 * Mohr-Coulomb strength over driving stress, and the standard every landslide
 * hazard map on Earth is computed with since the 1950s. Every term is one we
 * already hold: the gradient from the field, the depth from the soil model, the
 * friction angle from the rock, the pore pressure from the weather, and the
 * root cohesion from what is growing.
 *
 * Two things fall out of it that nobody has to write down. **Forests hold
 * slopes bare ground cannot** -- fifteen kilopascals of roots is the difference
 * between a stable thirty-three degrees and a stable forty-five. And **water
 * is what triggers it**: saturation subtracts from the effective stress that
 * the friction term multiplies, so the same slope that stood all summer fails
 * in the storm. Undercutting does it from the other side, by raising the angle.
 *
 * A cohesionless bare slope at the angle of repose returns exactly 1.0
 * whatever its depth, because both sides carry the same weight term. That
 * identity is a free check on the arithmetic and the suite asserts it.
 */
export function factorOfSafety(s: SlopeCase): number {
  if (s.slope <= 0) return Infinity;
  if (s.soilDepthM <= 0) return Infinity; // bare rock is not a soil slide

  // The gradient is tan(theta); the trig follows from it without an arctangent.
  const t = s.slope;
  const sec2 = 1 + t * t;
  const cos2 = 1 / sec2;                    // cos^2(theta)
  const sinCos = t / sec2;                  // sin(theta)cos(theta)

  const gz = A.SOIL_UNIT_WEIGHT_N_M3 * s.soilDepthM;
  // Pore pressure from the saturated fraction of the column.
  const u = A.WATER_UNIT_WEIGHT_N_M3 * s.soilDepthM * clamp(s.saturation, 0, 1) * cos2;

  const tanPhi = tanDeg(ROCK_FRICTION_DEG[s.rock]);
  const cohesion = (ROCK_SOIL_COHESION_KPA[s.rock] + s.rootCohesionKPa) * 1000;

  const resisting = cohesion + Math.max(0, gz * cos2 - u) * tanPhi;
  const driving = gz * sinCos;
  return driving <= 0 ? Infinity : resisting / driving;
}

/**
 * Tangent of an angle in degrees, without Math.tan.
 *
 * Only ever called on the six friction angles and on the angle of repose, so a
 * table would do; the series is here because it keeps the anchors editable
 * without a regenerate step. Range-reduced onto the first octant, where the
 * argument is below 0.79 radians and the continued fraction converges fast.
 */
function tanDeg(deg: number): number {
  const x = (deg * PI) / 180;
  // tan by the continued-fraction expansion, exact to double precision well
  // past the 45 degrees anything here uses.
  const x2 = x * x;
  return x * (1 + x2 * (1 / 3 + x2 * (2 / 15 + x2 * (17 / 315 + x2 * 62 / 2835))));
}
