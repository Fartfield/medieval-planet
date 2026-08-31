// The type checker, as a suite.
//
// `npm run typecheck` has existed for a long time and nothing ever ran it, so
// nothing ever failed for a type error -- the code is executed by Node's
// type-stripping, which discards the annotations without reading them. A type
// that is never checked is a comment that looks like a constraint.
//
// It found eleven real things the first time it was run, and two of them were
// live:
//
//   * `ChildFrame.basis` was typed as `{ lon, sinLat }`, the two fields the old
//     cylindrical layout happened to read. `tilePolygons` now calls
//     `toDirection` with it -- the generator's own transform rather than a
//     third copy -- and that needs the frame's axes. It worked because the
//     object passed in has always been a whole Basis; the type was the only
//     thing that disagreed, and it was the type that would have been believed
//     by the next person reading it.
//   * three callers passed a fourth argument to `tilePolygons`, which takes
//     three. Silently ignored, and silently wrong about what was being drawn.
//
// The rest were a nominal `BiomeId` being fed a plain number off a typed array,
// a possibly-null address, and a Buffer variance. None of them was going to
// crash tomorrow. All of them were a statement in the code that was not true.
//
// WHY A SUITE RATHER THAN A SEPARATE STEP. Because run_all is what gets run.
// A check that lives outside it is a check that waits for somebody to remember,
// and this project has already proved it will not be remembered: the gap was
// recorded in known-gaps.md, correctly, and sat there.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { measure, assert, suite } from './harness.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

suite('the types check', () => {
  // The compiler's own entry point, run through node. Not the .bin shim, which
  // is a .cmd on Windows and needs a shell to launch -- and passing arguments
  // through a shell is both a deprecation warning and a quoting hazard for no
  // gain here.
  const entry = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const tsc = existsSync(entry) ? entry : null;

  // Not installed is a fact worth reporting rather than a pass. A suite that
  // quietly skips is indistinguishable from one that quietly succeeds, which is
  // how this check came to be missing in the first place.
  assert('typescript is installed', tsc !== null);
  if (tsc === null) return;

  const run = spawnSync(process.execPath, [tsc, '--noEmit'], {
    cwd: root,
    encoding: 'utf8',
  });

  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const errors = output.split('\n').filter((l) => l.includes('error TS'));

  measure('type errors', errors.length);
  assert('the project type-checks', errors.length === 0);

  // The first few, so a failure says what broke rather than only that
  // something did.
  for (const line of errors.slice(0, 5)) {
    assert(`clean: ${line.trim().slice(0, 90)}`, false);
  }
});
