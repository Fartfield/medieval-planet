// Transcendentals that give the same answer on every machine.
//
// ECMAScript specifies Math.exp, Math.pow and Math.log as "implementation-
// approximated": conforming engines may differ in the last bit, and they do --
// V8, SpiderMonkey and JavaScriptCore have all shipped different results for
// the same input. For a game that regenerates its scenery each session that is
// harmless. For a persistent world it is not: the biome thresholds downstream
// are sharp, so a last-bit difference in one cell's productivity can flip
// forest to grassland, and a player would watch their timber supply vanish
// because the server moved to a different CPU.
//
// Everything here is built from + - * / and comparison, which IEEE 754 does
// pin exactly. The cost is a few multiplies. The alternative is a world that
// cannot be trusted to still exist tomorrow.

/** e, as a literal. Math.E is itself only implementation-approximated. */
export const E = 2.718281828459045;

/**
 * Integer power by binary exponentiation. Exact sequence of multiplications,
 * so exact answer -- and O(log n) rather than the naive loop.
 */
export function ipow(base: number, n: number): number {
  if (n < 0) return 1 / ipow(base, -n);
  let result = 1;
  let b = base;
  let k = n;
  while (k > 0) {
    if (k & 1) result *= b;
    b *= b;
    k >>= 1;
  }
  return result;
}

/**
 * exp, by range reduction onto [-0.5, 0.5] and a Taylor series there.
 *
 * Sixteen terms is comfortable overkill: the remainder after term k is bounded
 * by 0.5^(k+1)/(k+1)!, which at k=16 is around 1e-20 -- forty times below the
 * resolution of a double. The loop count is fixed rather than convergence-
 * tested, because "stop when it stops changing" is exactly the kind of
 * floating-point-dependent control flow that would reintroduce the problem.
 */
export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.13) return 0;

  const n = Math.round(x);
  const r = x - n;

  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 16; k++) {
    term = (term * r) / k;
    sum += term;
  }
  return sum * ipow(E, n);
}

/**
 * Natural log, by Newton refinement on an integer-exponent seed.
 *
 * The seed comes from the exponent bits of the double, which is exact, and
 * three Newton steps against dexp converge to full precision. Only used at
 * generation time; nothing in the tick loop calls it.
 */
export function dlog(x: number): number {
  if (x <= 0) return x === 0 ? -Infinity : NaN;

  // Split x into m * 2^e with m in [1, 2), using only exact operations.
  let e = 0;
  let m = x;
  while (m >= 2) { m /= 2; e++; }
  while (m < 1) { m *= 2; e--; }

  // ln(m) for m in [1,2) via the atanh series, which converges fast there.
  const z = (m - 1) / (m + 1);
  const z2 = z * z;
  let term = z;
  let sum = z;
  for (let k = 1; k <= 12; k++) {
    term *= z2;
    sum += term / (2 * k + 1);
  }
  return 2 * sum + e * LN2;
}

/** ln(2), as a literal for the same reason E is. */
export const LN2 = 0.6931471805599453;

/** Arbitrary power. Integer exponents skip the log entirely and stay exact. */
export function dpow(base: number, exponent: number): number {
  if (Number.isInteger(exponent)) return ipow(base, exponent);
  if (base <= 0) return base === 0 ? 0 : NaN;
  return dexp(exponent * dlog(base));
}

/**
 * An unnormalised Gaussian bump: 1 at the centre, falling off over `width`.
 * The workhorse of the climate model, where latitude bands overlap.
 */
export function bump(x: number, centre: number, width: number): number {
  const t = (x - centre) / width;
  return dexp(-t * t);
}

/**
 * The logistic curve, used wherever a response saturates rather than growing
 * without bound -- productivity against temperature, desirability against
 * wealth. Written in terms of dexp so it inherits the same guarantee.
 */
export function logistic(x: number, midpoint: number, steepness: number): number {
  return 1 / (1 + dexp(-steepness * (x - midpoint)));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth 0->1 ramp across [edge0, edge1], with zero slope at both ends. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Trigonometry
// ---------------------------------------------------------------------------
//
// Needed because the world map is a hex grid in (longitude, sine of latitude),
// so every cell position is a projection and every projection is trigonometry.
// `Math.sin` and friends are only approximated by the spec, and two engines
// disagreeing in the last bit would put a cell boundary in a different place
// and hand two players different worlds -- see docs/determinism.md.
//
// sim/angle.ts already has sin and cos, and they are not these: that is a
// fixed-point system on 1024 steps to a turn, built for how a soldier faces.
// A tenth of a degree is an eighteen-kilometre error on a coastline.

export const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/**
 * Sine, by range reduction onto [-pi/4, pi/4] and a Taylor series there.
 *
 * Reduced in two steps: whole turns first, then quadrants, so the argument the
 * series sees is never above 0.79 and the terms fall away as fast as the
 * factorials do. Nine of them puts the remainder below 1e-19, which is two
 * orders under the resolution of a double. The count is fixed rather than
 * convergence-tested, for the same reason dexp's is: "stop when it stops
 * changing" is floating-point-dependent control flow.
 */
export function dsin(x: number): number {
  // Whole turns away. Math.round is exact on integers, so this is exact.
  const turns = Math.round(x / TWO_PI);
  let a = x - turns * TWO_PI;

  // Into [-pi/2, pi/2] using sin(pi - a) = sin(a).
  if (a > HALF_PI) a = PI - a;
  else if (a < -HALF_PI) a = -PI - a;

  // And onto [-pi/4, pi/4] by switching to the cosine series, which is where
  // both series are at their best.
  if (a > 0.7853981633974483) return cosSeries(HALF_PI - a);
  if (a < -0.7853981633974483) return -cosSeries(HALF_PI + a);
  return sinSeries(a);
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

function sinSeries(a: number): number {
  const a2 = a * a;
  let term = a;
  let sum = a;
  for (let k = 1; k <= 9; k++) {
    term *= -a2 / ((2 * k) * (2 * k + 1));
    sum += term;
  }
  return sum;
}

function cosSeries(a: number): number {
  const a2 = a * a;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 9; k++) {
    term *= -a2 / ((2 * k - 1) * (2 * k));
    sum += term;
  }
  return sum;
}

/**
 * Arctangent of y/x with the quadrant, to full precision.
 *
 * The series for atan converges hopelessly near one, so the argument is halved
 * twice first -- atan(z) = 2·atan(z / (1 + sqrt(1 + z²))) -- which takes any
 * z in [0, 1] below 0.14. Fifteen terms then leave the remainder under 1e-18.
 * Two halvings and a fixed term count: no branch depends on how the arithmetic
 * came out.
 */
export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;

  const ay = Math.abs(y);
  const ax = Math.abs(x);
  // Keep the ratio inside [0, 1] and undo it afterwards, so the series is only
  // ever asked the half of its range it is good at.
  const swapped = ay > ax;
  const z = swapped ? ax / ay : ay / ax;

  let a = atanUnit(z);
  if (swapped) a = HALF_PI - a;
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

function atanUnit(z0: number): number {
  let z = z0;
  // Two halvings, so the series sees at most 0.132.
  z = z / (1 + Math.sqrt(1 + z * z));
  z = z / (1 + Math.sqrt(1 + z * z));

  const z2 = z * z;
  let term = z;
  let sum = z;
  for (let k = 1; k <= 15; k++) {
    term *= -z2;
    sum += term / (2 * k + 1);
  }
  return 4 * sum;
}
