// Fixed-point arithmetic for the simulation.
//
// WHY THIS EXISTS AT ALL
//
// Deterministic lockstep means every client runs the same simulation from the
// same commands and must arrive at bit-identical state. Floating point breaks
// that in two places. The arithmetic operators (+ - * / sqrt) are actually
// safe -- IEEE 754 pins them to correctly-rounded results and ECMAScript
// requires IEEE 754 doubles -- but the transcendentals are not: the spec says
// Math.sin and friends return an "implementation-approximated" value, so two
// engines, or one engine on two CPUs, may legally disagree in the last bit.
// The second hole is subtler and worse: float addition is not associative, so
// the moment we sum forces in an order that depends on network arrival, we
// desync even on one machine.
//
// Integers close both holes. Every quantity below is a JS number that is
// always an exact integer, so + - * are exact, order of summation is
// irrelevant, and there is no rounding to disagree about.
//
// THE SCALE
//
// One fixed unit is 1/4096 of a metre, so the quantum is 0.24 mm. That is
// solved against two constraints, not chosen by feel.
//
// The ceiling: a JS number holds integers exactly up to 2^53. If both operands
// of a multiply stay under 2^26 raw their product is at most 2^52 -- still
// exact -- and the divide by SCALE that follows needs at most 52 significant
// bits. 2^26 raw at this scale is 16,384 m, so the arithmetic is provably
// exact anywhere inside a 16 km square, which is larger than any battle we
// intend to fit on one map.
//
// The floor: a unit walking at 1.40 m/s under a 32 Hz tick moves 0.0437 m per
// tick. That displacement is computed once and then added every tick, so the
// rounding error in it does not cancel -- it accumulates linearly, and a unit
// that is 1% slow arrives at the flank a full second late over 100 m. At 1/4096
// the per-tick step rounds to 179 units against a true 179.2, an error of 0.1%.
// At 1/1024 it would round to 45 against 44.8, an error of 0.4%, and the map
// would gain 49 km nobody asked for. See the "fixed point" suite in
// verify/verify_math.ts, which walks both limits. This used to name
// verify_fixed.ts and verify_derive.ts, neither of which existed.

export const SHIFT = 12;
export const SCALE = 1 << SHIFT; // 4096
export const HALF = SCALE >> 1;

/** Largest raw magnitude either operand of `mul` may carry and stay exact. */
export const MUL_LIMIT = 1 << 26; // 16,384 m

/** Real metres -> fixed. Only for authoring constants, never in the hot loop. */
export function fromFloat(v: number): number {
  return Math.round(v * SCALE);
}

/** Fixed -> real metres. Presentation only: never feed this back into the sim. */
export function toFloat(v: number): number {
  return v / SCALE;
}

/** Whole number -> fixed. */
export function fromInt(v: number): number {
  return v * SCALE;
}

/**
 * a * b, both fixed. Floors toward negative infinity, which is a choice rather
 * than a fact -- what matters for determinism is only that it is the *same*
 * choice everywhere, and floor is the one primitive JS gives us that behaves
 * identically for negatives without a branch.
 */
export function mul(a: number, b: number): number {
  if (DEBUG_GUARDS) guardMul(a, b);
  return Math.floor((a * b) / SCALE);
}

/** a / b, both fixed. Throws on divide-by-zero rather than returning Infinity. */
export function div(a: number, b: number): number {
  if (b === 0) throw new RangeError('fixed.div by zero');
  if (DEBUG_GUARDS) guardMul(a, SCALE);
  return Math.floor((a * SCALE) / b);
}

/**
 * Integer square root of a fixed value, returned fixed.
 *
 * Deliberately not Math.sqrt. IEEE does pin sqrt to correct rounding, so
 * Math.sqrt would in fact be safe today -- but it returns a double, and the
 * conversion back to our integer grid is one more place for a platform to
 * surprise us. Newton on integers is provably identical everywhere and costs
 * about five iterations at our magnitudes.
 */
export function sqrt(x: number): number {
  if (x < 0) throw new RangeError('fixed.sqrt of negative');
  if (x === 0) return 0;
  // sqrt(x/S) in fixed = sqrt(x*S). x*S must stay exact: x <= 2^43.
  const n = x * SCALE;
  if (DEBUG_GUARDS && n > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`fixed.sqrt overflow: ${x}`);
  }
  return isqrt(n);
}

/** Floor of the integer square root of a non-negative integer. */
export function isqrt(n: number): number {
  if (n < 2) return n;
  // Seed from the float sqrt, then correct by integer arithmetic. The seed is
  // allowed to be platform-dependent because the correction loop below erases
  // any difference: it converges to the unique integer r with r*r <= n <
  // (r+1)*(r+1), so the answer does not depend on where we started.
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Exact length of a fixed vector, via the squared length in fixed. */
export function length(x: number, y: number): number {
  return sqrt(mul(x, x) + mul(y, y));
}

/** Squared length. Prefer this for comparisons -- it skips the sqrt entirely. */
export function lengthSq(x: number, y: number): number {
  return mul(x, x) + mul(y, y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function abs(v: number): number {
  return v < 0 ? -v : v;
}

export function sign(v: number): number {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

// Guards are on by default and cost one comparison. Turn them off only with a
// profile in hand showing they matter, and say so in docs/fix-attempts.md.
export const DEBUG_GUARDS = true;

function guardMul(a: number, b: number): void {
  if (a >= MUL_LIMIT || a <= -MUL_LIMIT || b >= MUL_LIMIT || b <= -MUL_LIMIT) {
    throw new RangeError(
      `fixed.mul operand outside the exact range: ${a} * ${b} ` +
        `(limit +/-${MUL_LIMIT} raw = +/-${MUL_LIMIT / SCALE} m)`,
    );
  }
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    // A non-integer here means a float leaked into the sim, which is the exact
    // failure this module exists to prevent. Fail loudly at the seam.
    throw new TypeError(`fixed.mul on a non-integer: ${a} * ${b}`);
  }
}
