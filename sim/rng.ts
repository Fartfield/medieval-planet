// Deterministic pseudo-randomness.
//
// The simulation needs chance -- which arrow finds a gap in the mail, which
// levy breaks and runs -- and it must be the *same* chance on every client.
// Math.random cannot be used at all: it is seeded per process and is not
// reproducible even on one machine across two runs.
//
// xorshift128 is the choice because its whole state is four 32-bit words and
// its step is five integer operations, all of which JS performs exactly (`^`,
// `<<` and `>>>` are specified on int32, unlike anything involving a double).
// Its period is 2^128-1, which is far past what a match consumes. It is not
// cryptographic and must never be used where a player must not predict the
// result -- match seeds included.
//
// Every stream is explicitly seeded and explicitly threaded through the code.
// There is deliberately no global RNG: a global gets drawn from a different
// number of times on a client that happens to also render a hit spark, and
// that is a desync with a cause nobody will ever find.

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Seed a stream. Any 32-bit integer works; zero is remapped, not rejected. */
export function seed(n: number): RngState {
  // SplitMix32 the seed before use, so that adjacent seeds -- exactly what
  // match setup hands out when it seeds per player id 1, 2, 3 -- do not
  // produce visibly correlated streams for the first few thousand draws.
  let x = (n | 0) === 0 ? 0x9e3779b9 : n | 0;
  const mix = (): number => {
    x = (x + 0x9e3779b9) | 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
  return { a: mix(), b: mix(), c: mix(), d: mix() };
}

/** Next raw 32-bit value, advancing the state in place. */
export function next(s: RngState): number {
  const t = s.a ^ (s.a << 11);
  s.a = s.b;
  s.b = s.c;
  s.c = s.d;
  s.d = (s.d ^ (s.d >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
  return s.d;
}

/** Uniform integer in [0, n). Rejection-sampled, so the tail is not biased. */
export function below(s: RngState, n: number): number {
  if (n <= 0 || !Number.isInteger(n)) {
    throw new RangeError('rng.below needs a positive integer bound');
  }
  // The naive next() % n over-weights the low residues by up to n/2^32. That
  // is invisible at n=6 and very visible at the n=1e9 scale a large battle
  // resolves at, so reject the ragged top of the range instead of folding it.
  const limit = Math.floor(0x100000000 / n) * n;
  let v = next(s);
  while (v >= limit) v = next(s);
  return v % n;
}

/** Uniform integer in [lo, hi], inclusive at both ends. */
export function range(s: RngState, lo: number, hi: number): number {
  return lo + below(s, hi - lo + 1);
}

/** True with probability num/den. */
export function chance(s: RngState, num: number, den: number): boolean {
  return below(s, den) < num;
}

/** Copy, for speculative work that must not consume the real stream. */
export function clone(s: RngState): RngState {
  return { a: s.a, b: s.b, c: s.c, d: s.d };
}
