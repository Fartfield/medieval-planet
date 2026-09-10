// Wool, flax and the loom, checked against the trade they were.
//
// The sheep is the allometry's first second opinion: every number the cow's
// machinery predicts gets re-asked at a thirteenth of her mass, and the
// measured answers -- a ewe lambs at 147 days, lives ten years, stands
// seven tenths of a metre -- are what decide whether the machinery
// generalises or merely fit one animal.
//
// THE CHECK THAT MATTERS is the seven-to-one. Every textile history repeats
// that it took seven spinners to keep one weaver in yarn; nothing below
// states that ratio anywhere. The spindle gets its measured day-rate and
// the loom gets its own, and seven has to fall out of the division.

import {
  shear, scour, ret, spinningDays, weavingDays, clothM2,
  SCOURING_YIELD, SPIN_KG_PER_DAY, WEAVE_KG_PER_DAY, CLOTH_KG_PER_M2,
  RETTING_DAYS, FIBRE_YIELD,
} from '../sim/model/craft.ts';
import { SHEEP, FLEECE_KG_PER_YEAR } from '../sim/model/sheep.ts';
import { CATTLE } from '../sim/model/cattle.ts';
import {
  gestationDays, lifespanYears, dressingPercentage, slaughter, milk,
  needKcalPerDay, massAtAge,
} from '../sim/model/animal.ts';
import { buildOf, beastOf } from '../sim/model/beastform.ts';
import { FLAX, GRASS } from '../sim/model/species.ts';
import { harvest, compositionOf, digestibleKcalPerKg, RUMINANT } from '../sim/model/process.ts';
import { foodKcalPerKg, fuelMJPerKg, burns } from '../sim/model/material.ts';
import { Part } from '../sim/model/plant.ts';
import { WEEKS_PER_YEAR } from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;

suite('the sheep', () => {
  // THE ALLOMETRY'S SECOND OPINION. The quarter-power clock was anchored on
  // the cow at 450 kg; the sheep at 35 is a prediction thirteen-fold away,
  // and the shepherd's numbers are the judges.
  measure('a ewe carries her lamb, days', gestationDays(SHEEP.matureMassKg));
  check('and lambs at a hundred and forty-seven', gestationDays(35), 147, 8);
  measure('and lives, years', lifespanYears(35));
  assert('a sheep\'s ten to twelve years',
    lifespanYears(35) > 8.5 && lifespanYears(35) < 13);
  measure('what she needs a day at pasture, kcal', needKcalPerDay(35));

  // The sheet adds up and butchers true.
  check('a sheep is all of herself',
    SHEEP.tissues.reduce((a, t) => a + t.share, 0), 1, 1e-9);
  measure('dressing percentage', dressingPercentage(SHEEP));
  check('a sheep dresses at half', dressingPercentage(SHEEP), 0.5, 0.03);
  const carcass = slaughter(SHEEP, 35);
  measure('mutton off one ewe, kg',
    carcass.find((p) => p.what === 'mutton')!.massKg);
  measure('the pelt, kg', carcass.find((p) => p.what === 'pelt')!.massKg);

  // Ewe's milk is the rich one, and the same nine constituents say so.
  const eweMilk = milk(SHEEP, 365);
  const cowMilk = milk(CATTLE, 365);
  measure('ewe\'s milk, kcal/kg', foodKcalPerKg(compositionOf(eweMilk)));
  assert('half again as rich as the cow\'s',
    foodKcalPerKg(compositionOf(eweMilk))
      > foodKcalPerKg(compositionOf(cowMilk)) * 1.4);

  // The same body formula that built the cow stands her up.
  const build = buildOf(35);
  measure('a sheep at the shoulder, m', build.shoulderHeightM);
  assert('knee-high to a person, as a sheep is',
    build.shoulderHeightM > 0.55 && build.shoulderHeightM < 0.85);
  const drawn = beastOf(SHEEP, 4, 77);
  assert('and she draws with the same pieces as the ox',
    drawn.strokes.length === 8 && drawn.blobs.length === 6);
});

suite('the loom', () => {
  // FLEECE TO CLOTH, at the trade's own rates.
  const flock = shear(10);
  measure('ten ewes\' year of wool, kg', flock.massKg);
  check('the customs roll\'s fleece', FLEECE_KG_PER_YEAR, 1.4, 0.01);
  const { clean, greaseKg } = scour(flock);
  measure('scoured, kg', clean.massKg);
  measure('the grease kept, kg', greaseKg);
  check('scouring keeps seven tenths', clean.massKg / flock.massKg, SCOURING_YIELD, 1e-9);

  measure('a winter of spinning it, days', spinningDays(clean.massKg));
  measure('the loom\'s share, days', weavingDays(clean.massKg));
  measure('cloth off ten ewes, m2', clothM2(clean.massKg));

  // THE SEVEN-TO-ONE, emerging. Nothing states it; the spindle's rate
  // against the loom's has to produce it, and for six centuries it did.
  const ratio = WEAVE_KG_PER_DAY / SPIN_KG_PER_DAY;
  measure('spinners one weaver keeps busy', ratio);
  assert('seven spinners to the weaver, as every source repeats',
    ratio > 6 && ratio < 9);

  // A fleece is a garment, not a wardrobe: two or three square metres.
  const perFleece = clothM2(FLEECE_KG_PER_YEAR * SCOURING_YIELD);
  measure('cloth in one fleece, m2', perFleece);
  assert('a fleece clothes a hood and a tunic, not a household',
    perFleece > 1.5 && perFleece < 5);
  // Clothing a person took two to four kilogrammes of wool a year, which is
  // the arithmetic behind every manor's flock size.
  measure('sheep to keep one person clothed, at 2.5 kg a year',
    2.5 / FLEECE_KG_PER_YEAR);

  // Cloth is cloth-weight.
  assert('ordinary cloth weighs what cloth weighs',
    CLOTH_KG_PER_M2 > 0.25 && CLOTH_KG_PER_M2 < 0.5);
});

suite('the retting pond', () => {
  // Flax off the field: the whole plant, reaped in its harvest weeks.
  const crop = harvest(FLAX, 0.8, 1, 30, W, 1000);
  const straw = crop.find((p) => p.part === Part.Branch)!;
  const seed = crop.find((p) => p.part === Part.Seed)!;
  measure('a thousand plants\' straw, kg', straw.massKg);
  measure('and linseed, kg', seed.massKg);

  // THE POND. Fibre and shive, and nothing vanishes.
  const { fibre, shive } = ret(straw);
  measure('long fibre, kg', fibre.massKg);
  measure('shive, kg', shive.massKg);
  check('an eighth to a fifth comes out as fibre',
    fibre.massKg / straw.massKg, FIBRE_YIELD, 1e-9);
  check('and the pond destroys nothing',
    fibre.massKg + shive.massKg, straw.massKg, 1e-9);
  assert('retting is days in warm water, not a season',
    RETTING_DAYS >= 7 && RETTING_DAYS <= 14);

  // WHY FLAX RETS AND STRAW DOES NOT: the stem's own low lignin. The same
  // composition that lets the pond work in ten days.
  const flaxStem = compositionOf(straw);
  measure('lignin share of the flax stem\'s fibre',
    flaxStem.lignin / (flaxStem.lignin + flaxStem.cellulose));
  assert('flax fibre is barely lignified',
    flaxStem.lignin / (flaxStem.lignin + flaxStem.cellulose) < 0.2);

  // Linen burns and wool chars: cellulose against keratin, and the model
  // says so from the recipes alone.
  assert('linen is tinder', burns(compositionOf(fibre)));

  // LINSEED. A third oil: the lamp and the paint.
  const linseed = compositionOf(seed);
  measure('linseed oil share', linseed.oil);
  assert('a third of the seed is oil', linseed.oil > 0.3);
  measure('linseed as lamp fuel, MJ/kg', fuelMJPerKg(linseed));
  assert('it out-burns seasoned oak', fuelMJPerKg(linseed) > 19);
  // And the cake that is left after pressing fed the plough ox better than
  // anything else on the farm -- protein a fifth of it.
  measure('linseed to a ruminant, kcal/kg', digestibleKcalPerKg(linseed, RUMINANT));
  assert('the ox agrees', digestibleKcalPerKg(linseed, RUMINANT)
    > digestibleKcalPerKg(compositionOf(
      harvest(GRASS, 3, 1, 30, W, 1).find((p) => p.part === Part.Leaf)!,
    ), RUMINANT) * 3);
});
