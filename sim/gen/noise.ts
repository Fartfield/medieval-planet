// Noise that rebuilds the same planet forever.
//
// A persistent world can never be regenerated differently. If a player's city
// sits on a hill, that hill has to still be there after a server restart, a
// Node upgrade, a move to different hardware, and a rewrite of the renderer.
// That is a stronger requirement than a normal game's world gen faces, and it
// rules out two things people reach for by habit:
//
//   Math.random -- not reproducible at all, not even twice in one process.
//   Transcendentals -- Math.sin, Math.pow, Math.exp are "implementation-
//   approximated" by the ECMAScript spec, so two engines may differ in the
//   last bit. One bit at the wrong moment moves a coastline.
//
// Everything below uses integer hashing and + - * / only. Those are pinned by
// IEEE 754 to a correctly-rounded result that every conforming engine must
// reproduce exactly, so the same seed gives the same world on any machine that
// runs JavaScript at all.

import { dexp } from './mathx.ts';

/** 32-bit integer hash. Three rounds of multiply-xorshift; no table, no state. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export function hash2(x: number, y: number, seed: number): number {
  return hash3(x, y, 0, seed);
}

/**
 * The quintic fade, 6t^5 - 15t^4 + 10t^3.
 *
 * Perlin's original cubic 3t^2-2t^3 has a discontinuous second derivative at
 * cell boundaries, which shows up as faint grid-aligned creases -- and on a
 * hex world those creases run diagonally across the map where nothing else
 * does, so the eye finds them immediately. The quintic costs two more
 * multiplies and removes them.
 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Twelve gradient directions, the edge midpoints of a cube.
 *
 * Not random unit vectors: a fixed well-spread set avoids the clumping that
 * makes naive gradient noise show directional bias. Selected by three bits of
 * the hash, so choosing one costs a mask and an array read.
 */
const GRAD: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function gradDot(h: number, x: number, y: number, z: number): number {
  const g = GRAD[h % 12];
  return g[0] * x + g[1] * y + g[2] * z;
}

/** Gradient noise in three dimensions, roughly in [-1, 1]. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  const n = (dx: number, dy: number, dz: number): number =>
    gradDot(hash3(xi + dx, yi + dy, zi + dz, seed), xf - dx, yf - dy, zf - dz);

  return lerp(
    lerp(lerp(n(0, 0, 0), n(1, 0, 0), u), lerp(n(0, 1, 0), n(1, 1, 0), u), v),
    lerp(lerp(n(0, 0, 1), n(1, 0, 1), u), lerp(n(0, 1, 1), n(1, 1, 1), u), v),
    w,
  );
}

/**
 * The same noise, put through its own distribution so a threshold means what
 * it says.
 *
 * GRADIENT NOISE IS NOT UNIFORM, and this is the trap that has now been fallen
 * into twice in this project by two different callers, which is why the
 * correction lives here instead of in either of them.
 *
 * `noise3` is a sum of interpolated gradients, so the central limit theorem
 * applies and the result is bell-shaped: measured over 200,000 samples it sits
 * about 0.5 with a standard deviation of 0.130 once mapped to [0, 1]. Ask it
 * for "values below 0.8" expecting four fifths of the ground and it gives
 * 99.4%. Ask it for a plant's age through -mean.ln(1-u) expecting an
 * exponential spread and every plant comes out within a whisker of the median,
 * so a wood has no old trees in it and weighs two thirds of what it should.
 * That second one was measured at 0.646 of the model's timber before this
 * function existed.
 *
 * A logistic is a close enough stand-in for the normal CDF here, and 1.702 is
 * the constant that matches the two: measured after correction, asking for 0.25
 * gives 0.272, 0.50 gives 0.499 and 0.80 gives 0.780.
 */
export const NOISE_MEAN = 0.5;
export const NOISE_SD = 0.1303;

export function uniform3(x: number, y: number, z: number, seed: number): number {
  const raw = (noise3(x, y, z, seed) + 1) / 2;
  return 1 / (1 + dexp((-1.702 * (raw - NOISE_MEAN)) / NOISE_SD));
}

/**
 * AND IT STILL CANNOT DELIVER A RARE EVENT, because gradient noise is BOUNDED.
 *
 * Measured over 100,000 samples, noise3 mapped to [0, 1] runs from 0.089 to
 * 0.907 and never leaves that band -- it is a weighted average of eight
 * gradients, so it cannot reach the extremes a normal distribution has. No
 * correction can produce a value the underlying function never takes.
 *
 * The consequence is sharp and measured. Against a wanted probability:
 *
 *     wanted   got      wanted   got
 *     0.005    0.000    0.300    0.312
 *     0.010    0.000    0.500    0.501
 *     0.027    0.007    0.800    0.796
 *     0.050    0.028    0.900    0.914
 *     0.100    0.086    0.950    0.972
 *
 * Fine from a fifth to four fifths, and useless below a twentieth -- which is
 * exactly the range a scattered thing lives in. Asking "is there a cow on this
 * eighteen-metre patch" is asking for 0.027, and the answer came back at a
 * quarter of the herd there should have been.
 *
 * SO USE THE FIELD FOR WHAT IS SMOOTH AND A HASH FOR WHAT IS INDEPENDENT. A
 * canopy is spatially correlated -- trees stand in woods -- and wants the
 * field. Whether one particular patch holds one particular animal is a coin,
 * and a coin wants a hash, which is uniform by construction at every
 * probability there is.
 */
export function uniformAt(
  x: number, y: number, z: number, quantum: number, seed: number,
): number {
  // QUANTISED, which is what makes it stable. The same ground reached through
  // two different maps gives directions agreeing to about a part in 1e12; a
  // quantum some six orders of magnitude coarser than that cannot straddle a
  // boundary in practice, and if it ever did, one patch of ground would gain or
  // lose one animal. Hashing the raw float instead would reshuffle the world
  // every time the projection rounded differently.
  const q = quantum > 0 ? quantum : 1;
  const h = hash3(Math.round(x / q), Math.round(y / q), Math.round(z / q), seed);
  return (h >>> 0) / 4294967296;
}

export function noise2(x: number, y: number, seed: number): number {
  return noise3(x, y, 0.5, seed);
}

/**
 * Fractal Brownian motion: octaves of noise at doubling frequency and halving
 * amplitude. This is what turns smooth blobs into terrain -- the low octaves
 * are the continents, the high ones are the roughness on a hillside.
 *
 * Normalised so the result stays in a FIXED range regardless of octave count,
 * which matters because the biome thresholds downstream are absolute.
 *
 * That range is not [-1, 1], which this comment claimed for a long time.
 * Measured over 34,848 samples it is -0.521 to 0.528, with an rms of 0.134 --
 * see verify_noise.ts, which measures it every run. The claim was harmless
 * while callers only wanted a shape, and stopped being harmless when the
 * sub-map ladder began handing this function a relief in metres and expecting
 * a relief in metres back; see FBM_LOCAL_RELIEF_RESPONSE at the foot of this
 * file.
 */
export function fbm3(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves: number,
  lacunarity = 2.0,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(fx, fy, fz, seed + i * 0x9e37);
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
    fz *= lacunarity;
  }
  return sum / norm;
}

export function fbm2(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  lacunarity = 2.0,
  gain = 0.5,
): number {
  return fbm3(x, y, 0.5, seed, octaves, lacunarity, gain);
}

/**
 * Ridged noise: |noise| inverted, which turns the zero crossings into sharp
 * crests. This is how mountain ranges get ridgelines instead of rolling humps.
 */
export function ridged3(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves: number,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(fx, fy, fz, seed + i * 0x9e37));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
    fz *= 2;
  }
  return sum / norm;
}

/** A deterministic float in [0, 1) from an integer hash. */
export function unit(h: number): number {
  return (h >>> 8) / 0x1000000;
}

/**
 * What fraction of its nominal amplitude `fbm3` actually delivers as LOCAL
 * RELIEF, across a cell and its six neighbours, at the ladder's geometry.
 *
 * A measured property of our own noise function, not of the world -- which is
 * why it lives here beside fbm3 rather than in anchors.ts, where everything is
 * a measurement of the real one. verify_noise.ts re-measures it every run, so
 * it cannot drift if fbm3 or its octave count changes.
 *
 * WHY IT IS NEEDED. The sub-map ladder decides how rough ground should be from
 * a measured relief law -- 900 m per 10 km in mountains, 18 on a plain -- and
 * then hands that figure to fbm3 as an amplitude. Those are not the same
 * quantity. The comment above says fbm3 stays "in about [-1, 1]"; measured over
 * 34,848 samples it spans -0.521 to 0.528 and has an rms of 0.134, and the
 * range between a cell and its neighbours -- which is what local relief means
 * -- comes to about a third of the nominal amplitude:
 *
 *     10th 0.219   median 0.349   mean 0.356   90th 0.503
 *
 * The median is used because local relief is reported as a typical figure for
 * a landscape, not as a mean over one.
 *
 * It depends only on the RATIO of cell spacing to noise wavelength, and the
 * ladder fixes that ratio by construction: cells sit sqrt(3)*cellRad apart and
 * the noise runs at 0.45/cellRad, at every depth. So one number covers every
 * layer. Change either constant in submap.ts and this one has to be measured
 * again -- which is what the suite is for.
 */
export const FBM_LOCAL_RELIEF_RESPONSE = 0.349;
