// Angles, as integers.
//
// A facing is a "binary angle": 1024 units to a full turn, so one unit is
// 0.352 degrees and the whole range fits a small integer that wraps by
// masking. Radians would drag floating point back into the sim through the
// front door -- see the header of fixed.ts for why that is fatal here.
//
// 1024 steps is not a feel choice. A facing only has to be fine enough that no
// player can see it snap: at 30 m, the arc subtended by one step is
// 30 * (2*PI/1024) = 18 cm, comfortably under the width of the man being
// drawn. Going finer would cost table size for a difference nothing resolves.

import { SCALE } from './fixed.ts';
import { ANGLE_TURN, QUARTER, ATAN_STEPS, SIN_QUARTER, ATAN_TABLE } from './tables.ts';

export { ANGLE_TURN, QUARTER };

export const HALF_TURN = ANGLE_TURN >> 1;
const MASK = ANGLE_TURN - 1;
const QMASK = QUARTER - 1;

/** Fold any integer angle into [0, ANGLE_TURN). Exact for negatives too. */
export function wrap(a: number): number {
  return a & MASK;
}

/** sin, fixed-point, from the baked quarter wave by quadrant symmetry. */
export function sin(a: number): number {
  const w = a & MASK;
  const q = w >> 8; // QUARTER is 256, so the quadrant is just the high bits
  const r = w & QMASK;
  switch (q) {
    case 0: return SIN_QUARTER[r];
    case 1: return SIN_QUARTER[QUARTER - r];
    case 2: return -SIN_QUARTER[r];
    default: return -SIN_QUARTER[QUARTER - r];
  }
}

/** cos, fixed-point. */
export function cos(a: number): number {
  return sin(a + QUARTER);
}

/**
 * Signed shortest difference, `to - from`, in [-HALF_TURN, HALF_TURN).
 * This is what a unit steers by: the sign says which way to turn, the
 * magnitude says how much turning is left.
 */
export function diff(from: number, to: number): number {
  return (((to - from) & MASK) ^ HALF_TURN) - HALF_TURN;
}

/**
 * atan2 over integers, returning a binary angle in [0, ANGLE_TURN).
 *
 * Reduced to the first half-octant (both operands non-negative, |y| <= |x|)
 * and read from the baked table; every other case is a reflection of that one.
 * The lookup truncates rather than interpolating, which costs at most half a
 * table step -- 0.18 degrees, a third of one facing unit -- and buys an answer
 * that cannot vary by platform.
 */
export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;

  // Angle up from the +x axis, within the first quadrant.
  const a = ax >= ay
    ? ATAN_TABLE[Math.floor((ay * ATAN_STEPS) / ax)]
    : QUARTER - ATAN_TABLE[Math.floor((ax * ATAN_STEPS) / ay)];

  if (x >= 0) return y >= 0 ? a : wrap(-a);
  return y >= 0 ? HALF_TURN - a : wrap(HALF_TURN + a);
}

/** Unit vector for a facing: fixed-point components of length ~SCALE. */
export function unitX(a: number): number { return cos(a); }
export function unitY(a: number): number { return sin(a); }

/** Degrees, for logs and the debug overlay only. Never call this in the sim. */
export function toDegrees(a: number): number {
  return (wrap(a) * 360) / ANGLE_TURN;
}

/** Degrees to binary angle. For authoring constants, not for the hot loop. */
export function fromDegrees(d: number): number {
  return wrap(Math.round((d * ANGLE_TURN) / 360));
}

/** Used by the suites: the table has to actually describe a unit circle. */
export function radiusSq(a: number): number {
  const c = cos(a);
  const s = sin(a);
  return (c * c + s * s) / (SCALE * SCALE);
}
