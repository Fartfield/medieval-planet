// Every suite, and a diff of every measurement, in one command.
//
//   node verify/run_all.ts            run everything, diff against the baseline
//   node verify/run_all.ts --anchor   accept the current numbers as the baseline
//
// Anchoring is not a way to make a red run green. It is what you do *after*
// deciding a measurement moved for a reason, and the commit message is
// expected to say which measurement and why. A silent re-anchor throws away
// the only record of what the world used to look like.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { results, reset, type Measurement } from './harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, '_baseline.json');
const anchor = process.argv.includes('--anchor');

reset();

const suiteFiles = readdirSync(here)
  .filter((f) => f.startsWith('verify_') && f.endsWith('.ts'))
  .sort();

if (suiteFiles.length === 0) {
  console.error('no suites found in verify/');
  process.exit(1);
}

for (const file of suiteFiles) {
  // pathToFileURL, not the bare path: on Windows an absolute path starts with
  // a drive letter, and the ESM loader reads "c:" as an unsupported URL scheme.
  await import(pathToFileURL(join(here, file)).href);
}

const { measurements, failures } = results();

// --- assertion failures -----------------------------------------------------

const failed = measurements.filter((m) => !m.ok);
if (failed.length > 0) {
  console.log(`\n${failed.length} FAILING CHECK${failed.length === 1 ? '' : 'S'}\n`);
  for (const m of failed) {
    const exp = m.expected === null ? '' : ` expected ${fmt(m.expected)} +/- ${fmt(m.tolerance ?? 0)}`;
    console.log(`  ${m.suite} / ${m.name}`);
    console.log(`      got ${fmt(m.value)}${exp}`);
  }
}

// --- baseline diff ----------------------------------------------------------

const current: Record<string, number> = {};
for (const m of measurements) current[`${m.suite}/${m.name}`] = round(m.value);

if (anchor) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`\nanchored ${Object.keys(current).length} measurements to verify/_baseline.json`);
  process.exit(failures > 0 ? 1 : 0);
}

let moved = 0;
let added = 0;
let removed = 0;

if (existsSync(baselinePath)) {
  const base: Record<string, number> = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const lines: string[] = [];

  for (const [key, value] of Object.entries(current)) {
    if (!(key in base)) { added++; lines.push(`  + ${key} = ${fmt(value)}`); continue; }
    if (!same(base[key], value)) {
      moved++;
      const delta = value - base[key];
      const pct = base[key] !== 0 ? ` (${delta > 0 ? '+' : ''}${((delta / Math.abs(base[key])) * 100).toFixed(1)}%)` : '';
      lines.push(`  ~ ${key}: ${fmt(base[key])} -> ${fmt(value)}${pct}`);
    }
  }
  for (const key of Object.keys(base)) {
    if (!(key in current)) { removed++; lines.push(`  - ${key}`); }
  }

  if (lines.length > 0) {
    console.log(`\nBASELINE DIFF  (${moved} moved, ${added} added, ${removed} removed)\n`);
    for (const line of lines) console.log(line);
    console.log('\n  If a measurement moved and you meant it, re-run with --anchor');
    console.log('  and say in the commit message which one moved and why.');
  }
} else {
  console.log('\nno baseline yet -- run with --anchor to create one');
}

// --- summary ----------------------------------------------------------------

const bySuite = new Map<string, { total: number; failed: number }>();
for (const m of measurements) {
  const s = bySuite.get(m.suite) ?? { total: 0, failed: 0 };
  s.total++;
  if (!m.ok) s.failed++;
  bySuite.set(m.suite, s);
}

console.log('');
for (const [name, s] of bySuite) {
  const mark = s.failed === 0 ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${name.padEnd(28)} ${s.total - s.failed}/${s.total}`);
}
console.log(`\n${suiteFiles.length} files, ${measurements.length} measurements, ${failures} failing, ${moved} moved\n`);

process.exit(failures > 0 ? 1 : 0);

// ---------------------------------------------------------------------------

function round(v: number): number {
  if (!Number.isFinite(v)) return v;
  // Six significant figures. Enough to catch a real change, loose enough that
  // the last-bit noise of a float sum does not show up as a moved measurement
  // every single run.
  return Number(v.toPrecision(6));
}

function same(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return round(a) === round(b);
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return v.toPrecision(6).replace(/\.?0+$/, '');
}

export type { Measurement };
