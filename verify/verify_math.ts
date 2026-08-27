// The arithmetic the world is built out of.
//
// Two separate claims are under test here and they are easy to confuse.
//
// EXACTNESS: the fixed-point layer must be exact inside its stated range, and
// must fail loudly outside it rather than silently losing bits. That range is
// not a guess -- it is derived in fixed.ts from the 2^53 integer limit -- so
// the test walks right up to the boundary and over it.
//
// AGREEMENT: the deterministic transcendentals must agree with the library
// ones to well inside a double's precision. If they did not, they would be
// wrong. That they *also* give the same answer on every engine is the reason
// they exist, and is the one property this suite cannot prove by running on
// one machine -- so the baseline carries their exact values, and a run on any
// other machine that diffs clean is the real evidence.

import {
  SCALE, MUL_LIMIT, fromFloat, toFloat, mul, div, sqrt, isqrt, length, lengthSq,
} from '../sim/fixed.ts';
import { dexp, dlog, dpow, ipow, E, bump, logistic } from '../sim/gen/mathx.ts';
import { noise3, fbm3, ridged3, hash3, unit } from '../sim/gen/noise.ts';
import { sin, cos, atan2, diff, wrap, radiusSq, ANGLE_TURN } from '../sim/angle.ts';
import { seed, next, below, chance, clone } from '../sim/rng.ts';
import { Hasher } from '../sim/hash.ts';
import { check, measure, assert, suite } from './harness.ts';

suite('fixed point', () => {
  check('scale', SCALE, 4096, 0);
  check('quantum in mm', (1 / SCALE) * 1000, 0.244, 0.001);
  check('exact range in metres', MUL_LIMIT / SCALE, 16384, 0);

  // Round-tripping a metre value must be exact to under the quantum.
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const v = (i - 1000) * 3.7;
    worst = Math.max(worst, Math.abs(toFloat(fromFloat(v)) - v));
  }
  check('float round-trip stays inside one quantum', worst, 0, 1 / SCALE);

  // Multiplication must be exact: every operand and result an integer.
  let nonInteger = 0;
  for (let i = 0; i < 5000; i++) {
    const a = fromFloat((i % 500) - 250 + 0.5);
    const b = fromFloat(((i * 7) % 300) - 150 + 0.25);
    const r = mul(a, b);
    if (!Number.isInteger(r)) nonInteger++;
  }
  check('mul always returns an integer', nonInteger, 0, 0);

  check('mul by one is identity', mul(fromFloat(3.25), SCALE), fromFloat(3.25), 0);
  check('mul is commutative', mul(1234, 5678) - mul(5678, 1234), 0, 0);
  check('div then mul round-trips', toFloat(mul(div(fromFloat(7), fromFloat(3)), fromFloat(3))), 7, 0.002);

  // The guard must fire outside the derived range rather than losing bits.
  let threw = false;
  try { mul(MUL_LIMIT + 1, MUL_LIMIT + 1); } catch { threw = true; }
  assert('mul rejects operands past the exact range', threw);

  let threwFloat = false;
  try { mul(1.5, 2); } catch { threwFloat = true; }
  assert('mul rejects a non-integer operand', threwFloat);

  // Integer sqrt must be the exact floor, not a rounded float.
  let badSqrt = 0;
  for (let i = 0; i < 3000; i++) {
    const n = i * i * 3 + i;
    const r = isqrt(n);
    if (r * r > n || (r + 1) * (r + 1) <= n) badSqrt++;
  }
  check('isqrt is the exact floor', badSqrt, 0, 0);
  check('sqrt of four is two', toFloat(sqrt(fromFloat(4))), 2, 0.001);

  // 3-4-5, the triangle that says the vector helpers agree with each other.
  check('length of a 3-4 vector', toFloat(length(fromFloat(3), fromFloat(4))), 5, 0.001);
  check('lengthSq of a 3-4 vector', toFloat(lengthSq(fromFloat(3), fromFloat(4))), 25, 0.01);
});

suite('angles', () => {
  check('turn size', ANGLE_TURN, 1024, 0);
  check('sin at zero', sin(0), 0, 0);
  check('sin at a quarter turn', sin(256), SCALE, 0);
  check('cos at zero', cos(0), SCALE, 0);
  check('sin at a half turn', sin(512), 0, 0);
  check('sin at three quarters', sin(768), -SCALE, 0);

  // The table has to describe a circle, not an oval.
  let worstRadius = 0;
  for (let a = 0; a < ANGLE_TURN; a++) worstRadius = Math.max(worstRadius, Math.abs(radiusSq(a) - 1));
  check('sin^2 + cos^2 stays at one', worstRadius, 0, 0.002);

  // Wrapping must be exact for negatives, which is where masking earns itself.
  check('wrap of a negative angle', wrap(-1), ANGLE_TURN - 1, 0);
  check('wrap past a full turn', wrap(ANGLE_TURN + 7), 7, 0);

  // Signed difference must take the short way round in both directions.
  check('difference the short way forward', diff(1000, 10), 34, 0);
  check('difference the short way back', diff(10, 1000), -34, 0);
  check('difference is zero for equal angles', diff(400, 400), 0, 0);

  // atan2 against the library, which is allowed here because this is a test of
  // agreement, not a use in the sim.
  let worstAtan = 0;
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2 - Math.PI;
    const x = Math.round(Math.cos(a) * 100000);
    const y = Math.round(Math.sin(a) * 100000);
    const got = atan2(y, x);
    const want = wrap(Math.round(((a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2)) * ANGLE_TURN));
    const err = Math.abs(diff(want, got));
    worstAtan = Math.max(worstAtan, err);
  }
  check('atan2 within a step of the library', worstAtan, 0, 2);
});

suite('deterministic transcendentals', () => {
  // Agreement with the library, across the range the generator actually uses.
  let worstExp = 0;
  for (let i = -60; i <= 60; i++) {
    const x = i / 4;
    const rel = Math.abs(dexp(x) - Math.exp(x)) / Math.max(1e-300, Math.abs(Math.exp(x)));
    worstExp = Math.max(worstExp, rel);
  }
  check('dexp matches Math.exp', worstExp, 0, 1e-13);

  let worstLog = 0;
  for (let i = 1; i <= 400; i++) {
    const x = i / 7;
    worstLog = Math.max(worstLog, Math.abs(dlog(x) - Math.log(x)));
  }
  check('dlog matches Math.log', worstLog, 0, 1e-12);

  check('dexp of zero', dexp(0), 1, 0);
  check('dlog of one', dlog(1), 0, 1e-15);
  check('dlog of e', dlog(E), 1, 1e-14);
  check('ipow is exact on integers', ipow(2, 40), 1099511627776, 0);
  check('dpow with an integer exponent is exact', dpow(3, 5), 243, 0);
  check('dpow with a fractional exponent', dpow(2, 0.5), Math.SQRT2, 1e-12);

  check('bump peaks at its centre', bump(2, 2, 1), 1, 0);
  check('bump falls off', bump(4, 2, 1), Math.exp(-4), 1e-13);
  check('logistic is a half at its midpoint', logistic(5, 5, 1), 0.5, 1e-15);

  // Repeated calls must be identical, which rules out any hidden state.
  let drift = 0;
  for (let i = 0; i < 500; i++) if (dexp(i / 13) !== dexp(i / 13)) drift++;
  check('dexp is a pure function', drift, 0, 0);
});

suite('noise', () => {
  // Reproducibility is the whole point: same input, same output, always.
  let differs = 0;
  for (let i = 0; i < 2000; i++) {
    const x = i * 0.017, y = i * 0.031, z = i * 0.007;
    if (noise3(x, y, z, 99) !== noise3(x, y, z, 99)) differs++;
  }
  check('noise is a pure function', differs, 0, 0);

  // Range: gradient noise must stay bounded or the biome thresholds downstream
  // are meaningless.
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let i = 0; i < 20000; i++) {
    const v = noise3(i * 0.013, i * 0.029, i * 0.041, 7);
    lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; n++;
  }
  check('noise stays inside its range', Math.max(Math.abs(lo), Math.abs(hi)) <= 1.2 ? 1 : 0, 1, 0);
  check('noise is centred on zero', sum / n, 0, 0.05);
  measure('noise minimum', lo);
  measure('noise maximum', hi);

  // A different seed must give a genuinely different field.
  let same = 0;
  for (let i = 0; i < 1000; i++) {
    if (noise3(i * 0.11, 0.3, 0.7, 1) === noise3(i * 0.11, 0.3, 0.7, 2)) same++;
  }
  check('a different seed gives a different field', same, 0, 2);

  // fBm must stay in range too, and ridged noise must be non-negative.
  let fLo = Infinity, fHi = -Infinity, rLo = Infinity;
  for (let i = 0; i < 5000; i++) {
    const f = fbm3(i * 0.019, i * 0.023, i * 0.037, 5, 6);
    const r = ridged3(i * 0.019, i * 0.023, i * 0.037, 5, 4);
    fLo = Math.min(fLo, f); fHi = Math.max(fHi, f); rLo = Math.min(rLo, r);
  }
  check('fbm stays inside its range', Math.max(Math.abs(fLo), Math.abs(fHi)) <= 1.1 ? 1 : 0, 1, 0);
  check('ridged noise is non-negative', rLo >= 0 ? 1 : 0, 1, 0);

  // The hash must spread. A biased hash makes terrain that bands.
  const buckets = new Array(16).fill(0);
  for (let i = 0; i < 32000; i++) buckets[Math.floor(unit(hash3(i, i * 3, i * 7, 5)) * 16)]++;
  const expect = 32000 / 16;
  let worstBucket = 0;
  for (const b of buckets) worstBucket = Math.max(worstBucket, Math.abs(b - expect) / expect);
  check('hash spreads evenly', worstBucket, 0, 0.06);
});

suite('rng and hashing', () => {
  const a = seed(1);
  const b = seed(1);
  let diverged = 0;
  for (let i = 0; i < 10000; i++) if (next(a) !== next(b)) diverged++;
  check('same seed gives the same stream', diverged, 0, 0);

  // Adjacent seeds must not correlate -- match setup hands out 1, 2, 3.
  const s1 = seed(1), s2 = seed(2);
  let collisions = 0;
  for (let i = 0; i < 10000; i++) if (next(s1) === next(s2)) collisions++;
  check('adjacent seeds do not correlate', collisions, 0, 3);

  // below() must be uniform, including in the tail that naive modulo skews.
  const s = seed(77);
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 70000; i++) counts[below(s, 7)]++;
  let worstBias = 0;
  for (const c of counts) worstBias = Math.max(worstBias, Math.abs(c - 10000) / 10000);
  check('below is uniform', worstBias, 0, 0.05);

  const sc = seed(5);
  let hits = 0;
  for (let i = 0; i < 40000; i++) if (chance(sc, 1, 4)) hits++;
  check('chance respects its probability', hits / 40000, 0.25, 0.01);

  // clone must fork without consuming.
  const orig = seed(9);
  next(orig);
  const forked = clone(orig);
  check('a clone continues the same stream', next(forked), next(orig), 0);

  // The state hash must notice a single changed integer.
  const h1 = new Hasher().int(1).int(2).int(3).value();
  const h2 = new Hasher().int(1).int(2).int(4).value();
  assert('hash notices a one-unit change', h1 !== h2);
  check('hash is stable', new Hasher().int(1).int(2).int(3).value(), h1, 0);
  measure('reference hash', h1);

  let threwOnFloat = false;
  try { new Hasher().int(1.5); } catch { threwOnFloat = true; }
  assert('hash rejects a float', threwOnFloat);
});
