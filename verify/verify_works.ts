// What a town builds to defend itself, against the spade and the record.
//
// This suite holds the model that retires war.ts's last stand-in: a
// settlement's fortification is no longer a curve on its population but the
// labour it has actually sunk into earth, timber and stone. So the numbers to
// check are the ones the spade and the mason set -- how much earth a ditch is,
// how fast a man moves it, how long a stone circuit takes -- and the one
// military judgement, the assault ratio a wall is worth, anchored to the force
// an attacker needed to storm it.
//
// THE CLAIMS. A ditch and bank is the work of a season; a stone wall is the
// work of years, which is why only a wealthy town ever finished one. The
// circuit grows as the square root of the people, so a city walls itself at a
// fraction of the per-head cost a hamlet would pay -- the real reason cities had
// stone. And what turns the fight is what stands: an unwalled town, however
// large, has nothing, where the old curve would have granted it a wall for its
// size alone.

import {
  defendedPerimeterM, tierCosts, maxWorksDays, buildWorks, fortificationOf,
  worksName, RAMPART_DAYS_PER_M, WALL_DAYS_PER_M,
  RAMPART_FORT, PALISADE_FORT, WALL_FORT, FORT_CAP,
  WORKS_NONE, WORKS_RAMPART, WORKS_WALL,
} from '../sim/model/works.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

/** A settlement's total labour in a year, man-days -- the economy's own figure. */
function labourDaysPerYear(population: number): number {
  return (population * A.WORKERS_PER_FAMILY) / 5 * A.WORKING_DAYS_PER_YEAR;
}

suite('the works', () => {
  // THE SPADE AND THE MASON set the per-metre costs. Earth moves fast, stone
  // slow -- an order of magnitude between them, which is the whole reason a
  // rampart went up in a season and a wall took years.
  measure('man-days to dig a metre of rampart', RAMPART_DAYS_PER_M);
  measure('man-days to lay a metre of stone wall', WALL_DAYS_PER_M);
  assert('stone is an order of magnitude slower than earth',
    WALL_DAYS_PER_M / RAMPART_DAYS_PER_M > 8);

  // THE CIRCUIT grows as the square root of the people: four times the
  // population is twice the wall, not four times.
  const p100 = defendedPerimeterM(100);
  const p400 = defendedPerimeterM(400);
  measure('a hundred souls wall this many metres', p100);
  measure('four hundred souls wall this many metres', p400);
  check('four times the people is twice the wall', p400, p100 * 2, p100 * 0.01);

  // PER-HEAD COST falls with size: the city's wall is cheap by the head, the
  // hamlet's ruinous. This is why stone clustered in the cities.
  const perHead = (pop: number): number => tierCosts(pop).wall / pop;
  measure('man-days of stone wall per head, hamlet of 80', perHead(80));
  measure('man-days of stone wall per head, city of 10000', perHead(10000));
  assert('a city walls itself far cheaper by the head than a hamlet',
    perHead(10000) < perHead(80) * 0.25);

  // A SEASON FOR EARTH, YEARS FOR STONE. Give a thousand-soul town a twentieth
  // of its labour for building -- a plausible share after the fields -- and time
  // each work.
  const pop = 1000;
  const sparePerYear = labourDaysPerYear(pop) * 0.05;
  const c = tierCosts(pop);
  measure('a town\'s building labour a year, man-days', Math.round(sparePerYear));
  measure('years to raise the town\'s rampart', c.rampart / sparePerYear);
  measure('years to raise its stone wall', maxWorksDays(pop, true, true) / sparePerYear);
  assert('the rampart is the work of a season', c.rampart / sparePerYear < 1);
  assert('the stone wall is the work of years',
    maxWorksDays(pop, true, true) / sparePerYear > 2);

  // THE WALL IS WORTH THE ASSAULT RATIO LESS ONE. Each work completed adds its
  // share of the multiplier the clash reads.
  const full = maxWorksDays(pop, true, true);
  measure('fortification of a finished rampart', fortificationOf(c.rampart, pop, true, true));
  measure('fortification with the palisade up', fortificationOf(c.rampart + c.palisade, pop, true, true));
  measure('fortification of the full stone circuit', fortificationOf(full, pop, true, true));
  check('a rampart is worth the ditch-and-bank ratio', fortificationOf(c.rampart, pop, true, true), RAMPART_FORT, 1e-9);
  check('the palisade brings it to the two-to-one ratio',
    fortificationOf(c.rampart + c.palisade, pop, true, true), RAMPART_FORT + PALISADE_FORT, 1e-9);
  check('the stone wall reaches the cap',
    fortificationOf(full, pop, true, true), RAMPART_FORT + PALISADE_FORT + WALL_FORT, 1e-9);
  assert('and the works cap where a wall becomes a blockade',
    fortificationOf(full * 10, pop, true, true) <= FORT_CAP + 1e-9);
  // Half a rampart is half its worth -- partial works give partial cover.
  check('a half-built rampart gives half its fortification',
    fortificationOf(c.rampart * 0.5, pop, true, true), RAMPART_FORT * 0.5, 1e-9);

  // MATERIALS GATE THE WORKS. No timber, no palisade; no rock, no wall -- the
  // missing tier's labour is neither spent nor earned, and the rest still
  // stands.
  measure('fortification with no timber for a palisade',
    fortificationOf(maxWorksDays(pop, false, true), pop, false, true));
  assert('a treeless place skips the palisade but keeps rampart and stone',
    Math.abs(fortificationOf(maxWorksDays(pop, false, true), pop, false, true)
      - (RAMPART_FORT + WALL_FORT)) < 1e-9);
  assert('a place with neither wood nor stone can raise only a rampart',
    Math.abs(fortificationOf(maxWorksDays(pop, false, false), pop, false, false)
      - RAMPART_FORT) < 1e-9);

  // BUILDING ACCUMULATES AND CAPS. A year adds its labour; the walls, once
  // finished, take no more.
  let w = 0;
  for (let y = 0; y < 3; y++) w = buildWorks(w, sparePerYear, pop, true, true);
  measure('works after three years of building', Math.round(w));
  assert('three years of building has not yet finished the stone',
    w < full);
  let done = w;
  for (let y = 0; y < 40; y++) done = buildWorks(done, sparePerYear, pop, true, true);
  check('and building cannot exceed what the materials allow', done, full, 1e-6);

  // THE KEY DIFFERENCE FROM THE OLD CURVE: fortification is earned, not
  // granted. An unwalled town, however large, has none -- where the stand-in
  // gave a town of two thousand a wall for its size alone.
  check('an unwalled settlement has no fortification',
    fortificationOf(0, 4000, true, true), 0, 0);
  measure('a great unwalled town\'s fortification', fortificationOf(0, 4000, true, true));

  // THE WORKS HAVE NAMES, for the chronicle.
  assert('open ground before the first spade', worksName(0, pop, true, true) === WORKS_NONE);
  assert('a ditch and bank when the rampart stands',
    worksName(c.rampart, pop, true, true) === WORKS_RAMPART);
  assert('a stone wall when the circuit is laid',
    worksName(full, pop, true, true) === WORKS_WALL);
});
