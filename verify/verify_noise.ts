// The noise, measured rather than described.
//
// noise.ts says fbm3 "stays in about [-1, 1]". It does not: measured, it spans
// about -0.52 to 0.53. That sentence was harmless while nothing depended on
// the amplitude meaning anything, and stopped being harmless when the sub-map
// ladder started handing fbm3 a relief in metres and expecting a relief in
// metres back. It delivers about a third of what it is given, and the world
// came out two thirds as rough as the law it is anchored to.
//
// FBM_LOCAL_RELIEF_RESPONSE is that third. It is a measured property of our
// own code, so unlike an anchor it can be re-measured exactly, and this suite
// does it every run: if fbm3 changes, or its octave count changes, or the
// ladder's spacing-to-wavelength ratio changes, the constant stops matching
// and says so. A calibration nobody re-measures is a constant that has quietly
// become wrong.

import { fbm3, FBM_LOCAL_RELIEF_RESPONSE } from '../sim/gen/noise.ts';
import { check, measure, assert, suite } from './harness.ts';

/** The six neighbours of a hex cell, in lattice steps. */
const DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [0.5, 0.8660254], [-0.5, 0.8660254],
  [-1, 0], [-0.5, -0.8660254], [0.5, -0.8660254],
];

suite('the noise delivers what it is given', () => {
  // The ladder's geometry exactly: cells sqrt(3)*cellRad apart, noise at
  // 0.45/cellRad, five octaves. Only the RATIO of the two matters, so cellRad
  // is arbitrary and one measurement covers every depth.
  const cellRad = 1e-3;
  const spacing = Math.sqrt(3) * cellRad;
  const freq = 0.45 / cellRad;
  const SIDE = 70;

  const ranges: number[] = [];
  const values: number[] = [];

  // Several noise seeds, because one seed measures one landscape.
  for (let s = 0; s < 8; s++) {
    const seed = 0x1d ^ (s * 0x9e3779b1);
    const grid = new Float64Array(SIDE * SIDE);
    for (let j = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++) {
        const x = (i + (j % 2) * 0.5) * spacing;
        const y = j * spacing * 0.8660254;
        grid[j * SIDE + i] = fbm3(x * freq, y * freq, 0.37 * freq, seed, 5);
      }
    }
    // Interior only: a cell on the edge has no ring to take a range over.
    for (let j = 2; j < SIDE - 2; j++) {
      for (let i = 2; i < SIDE - 2; i++) {
        const v = grid[j * SIDE + i];
        values.push(v);
        let lo = v, hi = v;
        for (const [dx, dy] of DIRS) {
          const u = grid[Math.round(j + dy * 1.1547) * SIDE + Math.round(i + dx)];
          if (u < lo) lo = u;
          if (u > hi) hi = u;
        }
        ranges.push(hi - lo);
      }
    }
  }

  const sorted = [...ranges].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);

  measure('fbm3 samples taken', ranges.length);
  measure('fbm3 lowest value', lo);
  measure('fbm3 highest value', hi);
  measure('fbm3 local relief per unit amplitude', median);

  // THE CALIBRATION ITSELF. Tolerance is 0.01, which is wider than the spread
  // across these eight seeds and far narrower than any change that would
  // matter downstream -- the ladder divides by this number, so a 3% drift is a
  // 3% error in every relief in the world.
  check('the ladder is calibrated to the noise it actually has',
    median, FBM_LOCAL_RELIEF_RESPONSE, 0.01);

  // And the docstring that started it, so it cannot be written again. This is
  // a statement about fbm3's range, not about the calibration: if a future
  // fbm3 really did span [-1, 1] this would pass and the check above would
  // fail, which is the right way round.
  assert('fbm3 does not reach the [-1, 1] its comment once claimed',
    lo > -0.9 && hi < 0.9);
});
