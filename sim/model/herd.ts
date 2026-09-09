// How many beasts stand on a piece of ground, and how old they are.
//
// The same job stand.ts does for plants, and it obeys the same rule: the number
// drawn is the number the ground can carry, so the picture is the pasture model
// made visible rather than a picture invented beside it. Count the cattle on a
// hectare and you get what pasture.ts says that hectare supports.
//
// CATTLE ARE NOT WILDLIFE, and this is the honest limit on what can be drawn
// today. A herd belongs to somebody; it stands where it is put; and until a
// settlement owns one and something eats the grass, drawing cattle across every
// meadow on the planet would be a claim the simulation cannot back. So the
// renderer asks for herds only on ground within reach of a settlement, and this
// file answers what such ground would carry.
//
// THE AGE STRUCTURE IS DERIVED, not chosen, and it is a nice derivation. A herd
// that neither grows nor shrinks loses a beast for every one born. Half a herd
// is female and about three fifths of those are old enough to breed, so with a
// calf a cow a year the birth rate is about 0.3 a head a year -- and a
// stationary population under a constant hazard has an exponential age
// structure whose mean is the inverse of that rate. Three and a third years,
// with nobody choosing it.

import * as A from '../anchors.ts';
import { dlog } from '../gen/mathx.ts';
import { uniformAt } from '../gen/noise.ts';
import { type BiomeId } from './biome.ts';
import { type Animal, massAtAge } from './animal.ts';
import { CATTLE } from './cattle.ts';
import { stockingUnitsPerHa } from './pasture.ts';

/** One beast, standing somewhere. */
export interface Beastie {
  animal: Animal;
  /** Metres east and north of the sample cell's centre. */
  x: number;
  y: number;
  ageYears: number;
  seed: number;
}

/** Share of a herd that is female. */
const FEMALE_SHARE = 0.5;

/** Share of the females old enough to be in calf. */
const BREEDING_SHARE = 0.6;

/**
 * Mean age of a herd at replacement, years.
 *
 * Births per head per year is (share female) x (share breeding) x (litters a
 * year) x (litter size); a stationary herd's death rate equals it; and an
 * exponential age structure's mean is one over the hazard.
 */
export function meanHerdAgeYears(a: Animal): number {
  const birthsPerHead = FEMALE_SHARE * BREEDING_SHARE * a.littersPerYear * a.litterSize;
  return birthsPerHead > 0 ? 1 / birthsPerHead : a.matureMassKg;
}

const QUANTILES = 64;

/** Mean live weight of such a herd, kg. */
export function meanHerdMassKg(a: Animal): number {
  const mean = meanHerdAgeYears(a);
  let total = 0;
  for (let i = 0; i < QUANTILES; i++) {
    const u = (i + 0.5) / QUANTILES;
    total += massAtAge(a, -mean * dlog(1 - u));
  }
  return total / QUANTILES;
}

/**
 * Beasts a hectare this ground supports.
 *
 * pasture.ts gives livestock UNITS, which is a five-hundred-kilogramme
 * abstraction and deliberately not an animal. Turning units into animals is
 * dividing by what the average animal in a real herd weighs -- which is well
 * under a mature cow, because most of a herd is young.
 */
export function beastsPerHa(a: Animal, biome: BiomeId, npp: number): number {
  const mean = meanHerdMassKg(a);
  if (mean <= 0) return 0;
  return (stockingUnitsPerHa(biome, npp) * A.LIVESTOCK_UNIT_KG) / mean;
}

/** What a patch of ground is asked about. */
export interface Pasture {
  biome: BiomeId;
  nppGm2: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  radiusM: number;
  /** Side of the square patch being sampled, metres. */
  spacingM: number;
}

export interface Herd {
  beasts: Beastie[];
  omitted: number;
  beastsPerHa: number;
}

/**
 * A uniform draw in [0, 1) for this patch of ground.
 *
 * Hashed rather than sampled from the smooth field, because the question here
 * is a coin and not a landscape: a cow on an eighteen-metre patch is a
 * probability of about a fortieth, and the smooth field cannot deliver a
 * fortieth -- it is bounded and returns a quarter of it. See uniformAt.
 */
function field(
  dirX: number, dirY: number, dirZ: number, scale: number, salt: number,
): number {
  const quantum = 1 / (8 * Math.max(1e-9, scale));
  return Math.max(0, Math.min(0.999999, uniformAt(dirX, dirY, dirZ, quantum, salt)));
}

/**
 * What stands on one patch of grazed ground.
 *
 * The same fractional-count-as-a-probability rule the plants use: a twenty-
 * metre square holds a twentieth of a cow, and rounding that down empties the
 * pasture while rounding it up fills it with a beast a square.
 */
export function herdOn(g: Pasture, animal: Animal = CATTLE, limit = 32): Herd {
  const perHa = beastsPerHa(animal, g.biome, g.nppGm2);
  const beasts: Beastie[] = [];
  if (perHa <= 0 || g.spacingM <= 0) return { beasts, omitted: 0, beastsPerHa: perHa };

  const areaM2 = g.spacingM * g.spacingM;
  const wanted = (perHa * areaM2) / 10000;
  const scale = g.radiusM / Math.max(1e-9, g.spacingM);

  const whole = Math.floor(wanted);
  const spare = wanted - whole;
  let n = whole;
  if (spare > 0 && field(g.dirX, g.dirY, g.dirZ, scale, 0xC0FFEE) < spare) n++;
  let omitted = 0;
  if (n > limit) { omitted = n - limit; n = limit; }

  const meanAge = meanHerdAgeYears(animal);
  for (let i = 0; i < n; i++) {
    const salt = 0xB1A5 + i * 7919;
    const u = field(g.dirX, g.dirY, g.dirZ, scale, salt);
    const v = field(g.dirX, g.dirY, g.dirZ, scale, salt + 1);
    const w = field(g.dirX, g.dirY, g.dirZ, scale, salt + 2);
    beasts.push({
      animal,
      x: (u - 0.5) * g.spacingM,
      y: (v - 0.5) * g.spacingM,
      // Capped at the lifespan, because an exponential has no upper end and a
      // cow does.
      ageYears: Math.min(20, -meanAge * dlog(1 - w)),
      seed: Math.round(w * 1e6) + i,
    });
  }
  return { beasts, omitted, beastsPerHa: perHa };
}
