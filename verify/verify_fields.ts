// The arable, checked against the economy it mirrors and the earthworks.
//
// fields.ts exists because the renderer cannot afford the real catchment
// solve, so its whole worth is fidelity to the two things it stands in for:
// the labour arithmetic workedCells uses, and the ridge-and-furrow that
// survives in the ground. Both are checkable.

import {
  workedHa, fieldRadiusM, ridgesAcross, RIDGE_WAVELENGTH_M, PLOUGH_NPP_FLOOR,
} from '../sim/model/fields.ts';
import { workedCells, buildCatchment } from '../sim/model/settlement.ts';
import { HELD_HECTARE_DAYS_IRON } from '../sim/model/labour.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

suite('the arable', () => {
  // THE DOCUMENTED ANCHOR: five people could work twenty-seven hectares, the
  // figure that recalibrated the catchment search when labour came down to
  // real task rates. The mirror must reproduce it or it mirrors nothing.
  measure('hectares five people work at full effort', workedHa(5, 1));
  check('five people work twenty-seven hectares', workedHa(5, 1), 27, 2);
  measure('and twenty people', workedHa(20, 1));
  check('four times the hands, four times the land',
    workedHa(20, 1), workedHa(5, 1) * 4, 1e-9);
  check('and half the effort is half the land',
    workedHa(20, 0.5), workedHa(20, 1) / 2, 1e-9);
  check('idle hands plough nothing', workedHa(20, 0), 0, 0);

  // The mirror IS the economy's arithmetic, term for term.
  const labour = (20 * A.WORKERS_PER_FAMILY) / 5 * A.WORKING_DAYS_PER_YEAR;
  check('the mirror and workedCells share one labour figure',
    workedHa(20, 1), labour / HELD_HECTARE_DAYS_IRON, 1e-9);

  // THE DISC. A founding village at full effort ploughs a big township; the
  // same village once the decide step trims farmShare to need ploughs an
  // infield a couple of hundred metres across. Both radii are arithmetic.
  measure('field radius at founding effort, m', fieldRadiusM(20, 1));
  measure('and at a settled tenth of effort, m', fieldRadiusM(20, 0.1));
  assert('the settled infield is a village-scale disc',
    fieldRadiusM(20, 0.1) > 120 && fieldRadiusM(20, 0.1) < 260);
  assert('and the radius grows as the root of the area',
    Math.abs(fieldRadiusM(20, 1) / fieldRadiusM(20, 0.25) - 2) < 1e-9);

  // THE EARTHWORKS. Broad rig runs three to ten metres crest to crest; the
  // lattice cell is eighteen metres, so a cell carries three or four ridges.
  assert('the rig is the measured rig',
    RIDGE_WAVELENGTH_M >= 3 && RIDGE_WAVELENGTH_M <= 10);
  measure('ridges across a lattice cell', ridgesAcross(18));
  assert('a cell carries a hand of ridges',
    ridgesAcross(18) >= 3 && ridgesAcross(18) <= 4);
  check('a narrow strip still gets one ridge', ridgesAcross(2), 1, 0);

  // The margin of cultivation sits where grain stops paying: comfortably
  // under a meadow's productivity and above a desert's.
  assert('the plough floor lies between desert and meadow',
    PLOUGH_NPP_FLOOR > 60 && PLOUGH_NPP_FLOOR < 700);

  // The names this suite leans on still exist where the comments say: the
  // real selection lives in workedCells over a built catchment, and the day
  // this import breaks, the mirror is mirroring a memory.
  assert('the economy still has the machinery this mirrors',
    typeof workedCells === 'function' && typeof buildCatchment === 'function');
});
