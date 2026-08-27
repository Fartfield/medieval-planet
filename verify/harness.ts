// The test harness, such as it is.
//
// Two ideas, both borrowed from medieval3d because they earned it there.
//
// FIRST: a check records a measurement, it does not merely pass or fail. Every
// `check` writes its actual value into a baseline file, and run_all diffs the
// whole set run to run. That turns "did anything change?" from a question you
// have to think about into one line of output -- and it catches the changes
// nobody wrote a test for, which are most of them. A refactor that quietly
// moves the mean land elevation by 40 m passes every assertion and shows up
// immediately in the diff.
//
// SECOND: a failing check is a question, not a verdict. About half the failures
// in a project like this are stale assertions describing behaviour that was
// deliberately changed. Work out which kind you have before you edit either
// side -- and when it is the test that was wrong, say so plainly in the commit
// rather than quietly widening a tolerance until it goes green.

export interface Measurement {
  suite: string;
  name: string;
  value: number;
  expected: number | null;
  tolerance: number | null;
  ok: boolean;
}

const measurements: Measurement[] = [];
let currentSuite = '(none)';
let failures = 0;

export function suite(name: string, body: () => void): void {
  currentSuite = name;
  try {
    body();
  } catch (err) {
    failures++;
    measurements.push({
      suite: name, name: '(threw)', value: NaN, expected: null, tolerance: null, ok: false,
    });
    console.error(`  ${name}: threw ${(err as Error).message}`);
  } finally {
    currentSuite = '(none)';
  }
}

/**
 * Assert a value is within tolerance, and record it either way.
 *
 * A tolerance of exactly 0 means "must be identical", which is what the
 * determinism checks want -- there, near enough is precisely not good enough.
 */
export function check(name: string, actual: number, expected: number, tolerance: number): void {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  measurements.push({ suite: currentSuite, name, value: actual, expected, tolerance, ok });
}

/** Record a number without judging it. The baseline diff does the judging. */
export function measure(name: string, value: number): void {
  measurements.push({ suite: currentSuite, name, value, expected: null, tolerance: null, ok: true });
}

/** Assert a condition. Recorded as 1 or 0 so it still lands in the baseline. */
export function assert(name: string, condition: boolean): void {
  check(name, condition ? 1 : 0, 1, 0);
}

export function results(): { measurements: Measurement[]; failures: number } {
  return { measurements, failures };
}

export function reset(): void {
  measurements.length = 0;
  failures = 0;
}
