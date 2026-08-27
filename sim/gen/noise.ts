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

export function noise2(x: number, y: number, seed: number): number {
  return noise3(x, y, 0.5, seed);
}

/**
 * Fractal Brownian motion: octaves of noise at doubling frequency and halving
 * amplitude. This is what turns smooth blobs into terrain -- the low octaves
 * are the continents, the high ones are the roughness on a hillside.
 *
 * Normalised so the result stays in about [-1, 1] regardless of octave count,
 * which matters because the biome thresholds downstream are absolute.
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
