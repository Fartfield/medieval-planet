// The village's ground plan, checked against the excavations.
//
// Deserted medieval villages have been dug for a century, so the shape of a
// settlement is measured the way a cow or an oak is: a longhouse is five
// metres by nine because roof timbers and bays made it so, a toft is a
// quarter acre because that is how plots were laid out, and a hamlet of four
// hearths therefore stands on a green about thirty-six metres across. The
// suite holds the derived plan to those numbers, and to the renderer's two
// non-negotiables: determinism, and houses that do not stand inside each
// other.

import { steadOf, personPlan } from '../sim/model/stead.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

suite('the village on the ground', () => {
  // A HAMLET OF TWENTY: four hearths, a green, a byre for its eight beasts.
  const hamlet = steadOf(20, 8, 5000, 12345);
  measure('hearths for twenty people', hamlet.hearths);
  check('a hearth holds five', hamlet.hearths, 20 / A.HOUSE_PEOPLE, 0);
  measure('the hamlet stands on this radius, m', hamlet.radiusM);
  assert('four tofts make a green thirty-odd metres across',
    hamlet.radiusM > 30 && hamlet.radiusM < 42);
  measure('buildings drawn', hamlet.buildings.length);
  assert('four houses and the byre', hamlet.buildings.length === 5
    && hamlet.buildings.filter((b) => b.byre).length === 1);
  measure('figures about the place', hamlet.folk.length);
  check('everyone in a hamlet is somewhere', hamlet.folk.length, 20, 0);

  // THE HOUSES ARE HOUSES: excavated longhouses run 4.5 to 6 by 8 to 15.
  for (const b of hamlet.buildings.filter((x) => !x.byre)) {
    assert('a longhouse is longhouse-sized',
      b.wM > 4.2 && b.wM < 6 && b.lM > 7 && b.lM < 12);
  }
  const byre = hamlet.buildings.find((b) => b.byre)!;
  assert('the byre is the biggest roof in the village',
    byre.wM * byre.lM
      > Math.max(...hamlet.buildings.filter((b) => !b.byre).map((b) => b.wM * b.lM)));

  // NOBODY'S HOUSE STANDS INSIDE ANOTHER. Centres at least a house-width
  // apart is the coarse test that catches a broken ring layout without
  // demanding surveyed boundaries.
  let worstGap = Infinity;
  const homes = hamlet.buildings.filter((b) => !b.byre);
  for (let i = 0; i < homes.length; i++) {
    for (let j = i + 1; j < homes.length; j++) {
      worstGap = Math.min(worstGap,
        Math.hypot(homes[i].x - homes[j].x, homes[i].y - homes[j].y));
    }
  }
  measure('nearest two houses, m apart', worstGap);
  assert('and they stand apart', worstGap > 5);

  // Everything stays on the stead's own ground.
  const reach = Math.max(...hamlet.buildings.map(
    (b) => Math.hypot(b.x, b.y) + Math.hypot(b.wM, b.lM) / 2));
  measure('furthest roof corner from the green, m', reach);
  assert('the village fits its own tofts', reach <= hamlet.radiusM * 1.15);

  // A VILLAGE OF THREE HUNDRED is a different thing, and the same formula.
  const town = steadOf(300, 40, 60000, 999);
  measure('hearths for three hundred', town.hearths);
  measure('its radius, m', town.radiusM);
  assert('sixty hearths stand on a proper village circle',
    town.hearths === 60 && town.radiusM > 120 && town.radiusM < 160);
  assert('but the figures are a street\'s worth, not a census',
    town.folk.length < 300 && town.folk.length >= 50);

  // No herd, no hay: no byre. A byre is not furniture.
  const poor = steadOf(10, 0, 0, 7);
  assert('a place with no beasts builds no byre',
    poor.buildings.every((b) => !b.byre));

  // DETERMINISM, since this draws sixty times a second from a seed.
  const again = steadOf(20, 8, 5000, 12345);
  assert('the same village always stands the same way',
    JSON.stringify(again) === JSON.stringify(hamlet));
  const other = steadOf(20, 8, 5000, 54321);
  assert('and a different seed builds a different one',
    JSON.stringify(other.buildings) !== JSON.stringify(hamlet.buildings));

  // A PERSON is shoulder-wide and no more, from straight above.
  const p = personPlan(3);
  measure('shoulders across, m', p.shoulderWM);
  assert('a person is a shoulder-breadth from overhead',
    p.shoulderWM > 0.38 && p.shoulderWM < 0.47);
  assert('and a head is a head', p.headRM > 0.07 && p.headRM < 0.12);
});
