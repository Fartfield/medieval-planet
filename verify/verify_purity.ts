// The rules, enforced by reading the source.
//
// Two sets of rules in this project are invisible at the point of violation
// and expensive later, so a machine checks them rather than a person
// remembering.
//
// WHAT CANNOT SURVIVE TYPE STRIPPING. Node runs this TypeScript by erasing the
// types -- it never compiles anything -- so any construct whose meaning is
// *generated code* rather than an annotation fails at load. Parameter
// properties are the trap: `constructor(private readonly x: T)` reads like an
// annotation and is actually an assignment the compiler writes for you. It
// cost three separate debugging rounds before this file existed, each time as
// a runtime crash in a file that had just been written.
//
// WHAT CANNOT BE IN THE SIMULATION. `Math.random` is not reproducible.
// `Math.sin`, `Math.exp`, `Math.pow`, `Math.log` and `Math.atan` are specified
// as "implementation-approximated", so two engines may differ in the last bit,
// and in a persistent world one bit moves a coastline. See docs/determinism.md.
//
// Reading the source is a blunt instrument and it will occasionally be wrong
// about a string or a comment. It is still worth it: the alternative found
// these problems by crashing.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { check, measure, suite } from './harness.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * Strip comments and string literals before searching.
 *
 * Without this the checks below flag their own documentation -- this file
 * mentions `Math.random` several times and every one of them is prose. Blunt
 * but adequate: it does not need to understand the code, only to stop reading
 * the parts that are not code.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const allFiles = walk(join(ROOT, 'sim'))
  .concat(walk(join(ROOT, 'server')))
  .concat(walk(join(ROOT, 'client')))
  .concat(walk(join(ROOT, 'verify')));

suite('erasable syntax', () => {
  measure('typescript files', allFiles.length);

  // Constructs Node's strip-only mode rejects, because each one would need
  // generated code rather than merely deleted annotations.
  const banned: [string, RegExp][] = [
    ['parameter property', /constructor\s*\([^)]*\b(?:private|public|protected|readonly)\s+\w+\s*[:)]/],
    ['enum', /(?:^|\s)(?:const\s+)?enum\s+\w+/],
    ['namespace', /(?:^|\s)namespace\s+\w+\s*\{/],
    ['module block', /(?:^|\s)module\s+\w+\s*\{/],
  ];

  const offences: string[] = [];
  for (const file of allFiles) {
    const body = code(readFileSync(file, 'utf8'));
    for (const [name, pattern] of banned) {
      if (pattern.test(body)) offences.push(`${relative(ROOT, file)}: ${name}`);
    }
  }
  for (const o of offences) console.error(`      ${o}`);
  check('no construct that type stripping cannot erase', offences.length, 0, 0);
});

suite('simulation purity', () => {
  // Only sim/ is held to this. The client may use Math.sin to draw a circle
  // and the server may use Date.now to schedule a turn; neither touches world
  // state, and a rule applied where it is not needed gets ignored where it is.
  const simFiles = walk(join(ROOT, 'sim'));
  measure('simulation files', simFiles.length);

  const forbidden: [string, RegExp, string][] = [
    ['Math.random', /\bMath\s*\.\s*random\b/, 'not reproducible; use sim/rng.ts'],
    ['Math.sin', /\bMath\s*\.\s*sin\b/, 'use sim/angle.ts'],
    ['Math.cos', /\bMath\s*\.\s*cos\b/, 'use sim/angle.ts'],
    ['Math.tan', /\bMath\s*\.\s*tan\b/, 'use sim/angle.ts'],
    ['Math.exp', /\bMath\s*\.\s*exp\b/, 'use mathx.dexp'],
    ['Math.log', /\bMath\s*\.\s*log\b/, 'use mathx.dlog'],
    ['Math.pow', /\bMath\s*\.\s*pow\b/, 'use mathx.dpow'],
    ['Math.E', /\bMath\s*\.\s*E\b/, 'only implementation-approximated; use mathx.E'],
    ['Math.SQRT1_2', /\bMath\s*\.\s*SQRT1_2\b/, 'compute it from Math.sqrt instead'],
    ['Date.now', /\bDate\s*\.\s*now\b/, 'the simulation has no clock but the turn counter'],
    ['new Date', /\bnew\s+Date\b/, 'the simulation has no clock but the turn counter'],
  ];

  // sphere.ts uses Math.asin and Math.atan2 in latLon() and in the outline
  // builder. Both are display paths -- a latitude for a label, a corner order
  // for the renderer -- and no generated field reads them. The climate model
  // takes sin(latitude) straight off the y component of the unit vector, which
  // is exact and needs no trigonometry at all.
  const displayOnly = new Set(['geo/sphere.ts']);

  const offences: string[] = [];
  for (const file of simFiles) {
    const rel = relative(join(ROOT, 'sim'), file).replace(/\\/g, '/');
    const body = code(readFileSync(file, 'utf8'));
    for (const [name, pattern, why] of forbidden) {
      if (!pattern.test(body)) continue;
      if (displayOnly.has(rel) && name !== 'Math.random') continue;
      offences.push(`sim/${rel}: ${name} -- ${why}`);
    }
  }
  for (const o of offences) console.error(`      ${o}`);
  check('the simulation uses no unreproducible arithmetic', offences.length, 0, 0);

  // Math.random is banned everywhere in sim/, display path or not.
  let randomUses = 0;
  for (const file of simFiles) {
    if (/\bMath\s*\.\s*random\b/.test(code(readFileSync(file, 'utf8')))) randomUses++;
  }
  check('nothing in the simulation calls Math.random', randomUses, 0, 0);
});

suite('imports', () => {
  // Node resolves what is written, with no extension rewriting. An import of
  // './foo.js' names a file that does not exist and fails at load.
  const offences: string[] = [];
  for (const file of allFiles) {
    const body = readFileSync(file, 'utf8');
    for (const m of body.matchAll(/from\s+'(\.[^']*)'/g)) {
      const spec = m[1];
      if (spec.endsWith('.js')) offences.push(`${relative(ROOT, file)}: imports ${spec}`);
      else if (!spec.endsWith('.ts')) offences.push(`${relative(ROOT, file)}: ${spec} has no extension`);
    }
  }
  for (const o of offences) console.error(`      ${o}`);
  check('every relative import names a real .ts file', offences.length, 0, 0);

  // The seam that makes headless testing and the server possible at all.
  const simFiles = walk(join(ROOT, 'sim'));
  const leaks: string[] = [];
  for (const file of simFiles) {
    const body = code(readFileSync(file, 'utf8'));
    if (/\b(?:document|window|navigator|localStorage|HTMLCanvasElement)\b/.test(body)) {
      leaks.push(relative(ROOT, file));
    }
    if (/from\s+'\.\.\/(?:client|server)\//.test(readFileSync(file, 'utf8'))) {
      leaks.push(`${relative(ROOT, file)} imports upward`);
    }
  }
  for (const l of leaks) console.error(`      ${l}`);
  check('the simulation knows nothing of the browser or the server', leaks.length, 0, 0);
});
