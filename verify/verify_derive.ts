// The derivations, checked against themselves.
//
// This file is named in three places that assumed it existed: derive.ts says
// "verify_derive.ts asserts only that it stays inside 0.35-0.9", fixed.ts sends
// the reader here for the drift measurement, and anchors.ts says "derive.ts
// asserts both" of the transport cross-checks. None of that was true. derive.ts
// contains no assertion of any kind; the transport figures are checked, but in
// verify_supply.ts; and the fixed-point walk is in verify_math.ts under
// "fixed point".
//
// Four cross-references, all confidently wrong, and none of them costly --
// which is the point. A comment claiming a check exists is worse than no
// comment, because it stops the next person looking for one. The pointers are
// corrected where the checks live elsewhere, and what genuinely did not exist
// is here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WARBOW_IMPLIED_EFFICIENCY } from '../sim/derive.ts';
import { measure, assert, check, suite } from './harness.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

suite('the derivations check themselves', () => {
  // THE BOW, which is the check derive.ts said was here.
  //
  // Stored energy comes from the draw weight and draw length; delivered energy
  // comes from the arrow's mass and measured speed. Their ratio is the bow's
  // efficiency, and nothing in the derivation forces it to be sensible -- it
  // falls out of two independent measurements. A real self bow puts somewhere
  // between a third and nine tenths of its stored energy into the arrow, so a
  // ratio outside that says one of the two measurements is wrong, or that they
  // are not describing the same bow.
  measure('warbow implied efficiency', WARBOW_IMPLIED_EFFICIENCY);
  assert('the bow is neither lossless nor useless',
    WARBOW_IMPLIED_EFFICIENCY > 0.35 && WARBOW_IMPLIED_EFFICIENCY < 0.9);

  // THE FREE PARAMETER COUNT, which derive.ts polices in its own header:
  // "There are four of them at the time of writing; if that count grows,
  // something has gone wrong."
  //
  // There are five. The count grew and nobody noticed, because the sentence
  // was a promise with nothing behind it. This is that sentence with something
  // behind it -- and the number below is the header's, so the two cannot drift
  // apart again without one of them failing.
  //
  // Growing it is not forbidden. It is a decision, and this makes it one
  // somebody has to take deliberately rather than by adding a constant.
  const source = readFileSync(join(root, 'sim', 'derive.ts'), 'utf8');
  const declared = source.match(/FREE PARAMETER \d+:/g) ?? [];
  measure('free parameters in derive.ts', declared.length);
  check('as many free parameters as the file says it has', declared.length, 5, 0);

  // Numbered without gaps, so "FREE PARAMETER 7" cannot appear beside four
  // others and pass a count.
  const numbers = declared
    .map((m) => Number(m.replace(/\D+/g, '')))
    .sort((a, b) => a - b);
  let contiguous = true;
  for (let i = 0; i < numbers.length; i++) if (numbers[i] !== i + 1) contiguous = false;
  assert('and numbered one to five with no gaps', contiguous);
});
