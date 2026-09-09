// A cow, checked against a cow.
//
// Almost everything here is a power of one number -- 450 kg -- so almost
// everything is a prediction, and the useful ones are the husbandry figures
// that were never used to build it. A cow eats about eleven kilogrammes of dry
// matter a day. She drinks forty litres. She carries a calf nine months. She
// dresses out at a bit over half her live weight. A working ox eats half again
// as much as a dry cow. None of those numbers is in a source file.
//
// THE CHECK THAT TIES THE WHOLE PROJECT TOGETHER is whether she can live on the
// grass the flora model puts on the ground. The plant model says what a sward
// is made of; the material model says what is in it; the process model says
// what a rumen can get out of it; and this says how much she needs. Four
// independent chains have to meet on one number or the kingdom starves.

import {
  basalKcalPerDay, needKcalPerDay, intakeKgPerDay, gutCapacityKg, canLiveOn,
  waterDrunkLPerDay, lifespanYears, gestationDays, growthRate, massAtAge, ageAtMass,
  maxDryIntakeKgPerDay,
  feedForYearKg, slaughter, dressingPercentage, milk, dung,
} from '../sim/model/animal.ts';
import { CATTLE } from '../sim/model/cattle.ts';
import {
  harvest, compositionOf, digestibleKcalPerKg, digestibility, fibreDigestibility,
  HUMAN, PIG, RUMINANT,
} from '../sim/model/process.ts';
import { GRASS, WHEAT, OAK } from '../sim/model/species.ts';
import { Part } from '../sim/model/plant.ts';
import { foodKcalPerKg, density } from '../sim/model/material.ts';
import { WEEKS_PER_YEAR } from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;
const COW = 450;

// The feeds, taken from the plants rather than written down here.
const grass = harvest(GRASS, 3, 1, 30, W, 1).find((p) => p.part === Part.Leaf)!;
const straw = harvest(WHEAT, 0.8, 1, 30, W, 1).find((p) => p.part === Part.Branch)!;
const grain = harvest(WHEAT, 0.8, 1, 30, W, 1).find((p) => p.part === Part.Seed)!;
const GRASS_C = compositionOf(grass);
const STRAW_C = compositionOf(straw);
const GRAIN_C = compositionOf(grain);

suite('a cow', () => {
  // KLEIBER. One law, and the whole shape of husbandry follows from its
  // exponent being three quarters rather than one.
  measure('basal metabolism of a 450 kg cow, kcal/day', basalKcalPerDay(COW));
  measure('and of a 2 kg hen', basalKcalPerDay(2));
  measure('and of a 70 kg man', basalKcalPerDay(70));
  check('a man burns about the basal figure he is measured at',
    basalKcalPerDay(70), 1700, 300);
  // A cow is 225 times a hen and burns 58 times as much. That ratio IS the
  // exponent, and it is why small stock convert feed better than large.
  measure('a cow burns this many times a hen', basalKcalPerDay(COW) / basalKcalPerDay(2));
  check('which is the three-quarter power of the mass ratio',
    basalKcalPerDay(COW) / basalKcalPerDay(2), Math.pow(225, 0.75), 0.01);

  measure('what she actually spends at pasture, kcal/day', needKcalPerDay(COW));
  measure('and pulling a plough', needKcalPerDay(COW, true));
  assert('work costs half as much again as standing about',
    needKcalPerDay(COW, true) > needKcalPerDay(COW) * 1.5);

  // INTAKE IS DERIVED FROM BOTH ENDS: her need from her mass, the feed's worth
  // from its composition and her rumen. Nothing states an intake anywhere.
  const onGrass = intakeKgPerDay(CATTLE, COW, GRASS_C);
  measure('fresh grass she must eat a day, kg', onGrass);
  measure('which is this share of her body weight', onGrass / COW);
  measure('and as dry matter, kg', onGrass * (1 - GRASS_C.water));
  // NEED AND APPETITE ARE DIFFERENT QUANTITIES, and the first version of this
  // check confused them. What the model computes is the maintenance
  // REQUIREMENT -- about 6 kg of dry matter, which is what a dry cow needs and
  // is what the published maintenance figures give. The 11 kg everyone quotes
  // is what a productive modern cow VOLUNTARILY EATS, which is a different
  // number about a different animal, and a landrace at maintenance does not
  // reach it. Both are checked, separately.
  check('a dry cow needs about six kilogrammes of dry matter a day',
    onGrass * (1 - GRASS_C.water), 6, 2);
  const appetite = maxDryIntakeKgPerDay(CATTLE, COW, GRASS_C);
  measure('and what she could physically eat, kg dry', appetite);
  measure('which is this share of her body weight', appetite / COW);
  check('appetite on good grass is about two and a half per cent of her',
    appetite / COW, 0.025, 0.006);
  assert('so on good grass she eats what she needs and has room to spare',
    appetite > onGrass * (1 - GRASS_C.water));

  // DIGESTIBILITY, and the lignin that sets it. Two feeds, both mostly fibre,
  // and the difference between them is what makes one fodder and one bedding.
  measure('fibre digestibility of fresh grass to a rumen',
    fibreDigestibility(GRASS_C, RUMINANT));
  measure('and of straw', fibreDigestibility(STRAW_C, RUMINANT));
  check('young grass fibre is three quarters available',
    fibreDigestibility(GRASS_C, RUMINANT), 0.75, 0.06);
  check('and straw fibre under half', fibreDigestibility(STRAW_C, RUMINANT), 0.45, 0.06);
  assert('and to a person, neither is worth anything at all',
    fibreDigestibility(GRASS_C, HUMAN) === 0);
  assert('a pig is in between', fibreDigestibility(GRASS_C, PIG) > 0
    && fibreDigestibility(GRASS_C, PIG) < fibreDigestibility(GRASS_C, RUMINANT));
  measure('dry-matter digestibility of grass', digestibility(GRASS_C, RUMINANT));
  measure('and of straw', digestibility(STRAW_C, RUMINANT));

  // THE JOIN. The grass is the grass the map grows, its worth is what the
  // material model says, and the rumen is the one in process.ts.
  measure('what a kilogramme of that grass is worth to her, kcal',
    digestibleKcalPerKg(GRASS_C, RUMINANT));
  assert('a cow lives on grass', canLiveOn(CATTLE, COW, GRASS_C));
  measure('her gut capacity, kg', gutCapacityKg(COW));

  // AND SHE DOES NOT LIVE ON STRAW ALONE, which is the whole winter problem.
  const onStraw = intakeKgPerDay(CATTLE, COW, STRAW_C);
  const strawAppetite = maxDryIntakeKgPerDay(CATTLE, COW, STRAW_C);
  measure('straw she would need a day, kg', onStraw);
  measure('and the most she could get through, kg dry', strawAppetite);
  measure('which is this share of her body weight', strawAppetite / COW);
  // SHE STARVES IN A FULL YARD, and this is the mechanism rather than a rule:
  // what fills a rumen is the part that will not ferment, so the worse the
  // forage the LESS of it she can physically eat. Straw is 45% digestible
  // against grass at 75%, so she gets through half as much of it and it is
  // worth less a kilogramme besides.
  assert('straw alone will not keep her', !canLiveOn(CATTLE, COW, STRAW_C));
  assert('and not because there is none of it: she fills up before she is fed',
    strawAppetite < appetite);
  measure('kcal she can get from a day of straw',
    (strawAppetite / (1 - STRAW_C.water)) * digestibleKcalPerKg(STRAW_C, RUMINANT));
  measure('against what she needs', needKcalPerDay(COW));

  // A BIG ANIMAL CAN LIVE ON WORSE FOOD THAN A SMALL ONE, and this falls out of
  // two exponents rather than a rule: gut goes as mass and metabolism as mass
  // to the three quarters, so the bigger beast has proportionally more gut per
  // unit of need. It is why an ox winters on hay and a hen cannot.
  const bigRatio = intakeKgPerDay(CATTLE, 900, STRAW_C) / maxDryIntakeKgPerDay(CATTLE, 900, STRAW_C);
  const smallRatio = intakeKgPerDay(CATTLE, 50, STRAW_C) / maxDryIntakeKgPerDay(CATTLE, 50, STRAW_C);
  measure('a 900 kg ox: straw needed over gut it has', bigRatio);
  measure('a 50 kg calf: the same', smallRatio);
  assert('the big beast has the easier time of poor forage', bigRatio < smallRatio);

  // WATER, GESTATION, LIFE. All the same quarter-power clock.
  // WATER DRUNK IS NOT WATER NEEDED, and the gap is the feed. A cow turns over
  // four and a half litres for every kilogramme of dry matter; on spring grass
  // that is 72% water she has most of it already and barely visits the trough,
  // and on straw she drinks the lot. That difference decides where stock can be
  // kept, and it comes out of two numbers rather than a rule about troughs.
  measure('water she drinks a day on grass, litres',
    waterDrunkLPerDay(CATTLE, COW, GRASS_C));
  measure('and on straw', waterDrunkLPerDay(CATTLE, COW, STRAW_C));
  assert('a beast on dry fodder drinks far more than one at grass',
    waterDrunkLPerDay(CATTLE, COW, STRAW_C)
      > waterDrunkLPerDay(CATTLE, COW, GRASS_C) * 2);
  check('and on dry feed it is tens of litres a day',
    waterDrunkLPerDay(CATTLE, COW, STRAW_C), 30, 15);
  measure('gestation, days', gestationDays(COW));
  check('and carries a calf nine months', gestationDays(COW), 283, 20);
  measure('lifespan, years', lifespanYears(COW));
  check('and lives about twenty years', lifespanYears(COW), 20, 4);
  // The same clock on a smaller beast, as a check that it IS one clock.
  measure('a 70 kg sheep would live, years', lifespanYears(70));
  measure('and gestate, days', gestationDays(70));
  assert('a smaller animal lives shorter and gestates quicker',
    lifespanYears(70) < lifespanYears(COW) && gestationDays(70) < gestationDays(COW));

  // GROWTH.
  measure('her growth rate, per year', growthRate(COW));
  measure('weight at birth, kg', massAtAge(CATTLE, 0));
  measure('at one year, kg', massAtAge(CATTLE, 1));
  measure('at two, kg', massAtAge(CATTLE, 2));
  measure('at five, kg', massAtAge(CATTLE, 5));
  assert('a calf is born at forty kilogrammes', Math.abs(massAtAge(CATTLE, 0) - 40) < 0.01);
  assert('and is a beast by two', massAtAge(CATTLE, 2) > COW * 0.6);
  assert('and never exceeds its own mature weight',
    massAtAge(CATTLE, 30) <= COW * 1.0001);
  measure('age at half her weight, years', ageAtMass(CATTLE, COW / 2));
  check('half grown in about a year', ageAtMass(CATTLE, COW / 2), 1, 0.5);

  // WHAT A YEAR OF HER COSTS. The number that decides whether keeping a beast
  // is worth it, and it is integrated over her growth rather than taken at her
  // final weight, because she is lighter for most of the year.
  const yearOnGrass = feedForYearKg(CATTLE, 1, GRASS_C);
  measure('fresh grass a growing beast eats in its second year, kg', yearOnGrass);
  measure('as dry matter, tonnes', (yearOnGrass * (1 - GRASS_C.water)) / 1000);
  // A cow eats about 4 tonnes of dry matter a year, which is what a couple of
  // acres of good pasture grows.
  // Maintenance again, not appetite: about two tonnes of dry matter, which is
  // what a good acre and a half of pasture grows.
  check('a beast needs a couple of tonnes of dry matter a year',
    (yearOnGrass * (1 - GRASS_C.water)) / 1000, 2, 0.7);

  // SLAUGHTER. The carcass as piles, so every verb in process.ts can act on it.
  const carcass = slaughter(CATTLE, COW);
  measure('tissues off one beast', carcass.length);
  const kg = (name: string): number => carcass.find((p) => p.what === name)?.massKg ?? 0;
  measure('beef, kg', kg('beef'));
  measure('tallow, kg', kg('tallow'));
  measure('bone, kg', kg('bone'));
  measure('hide, kg', kg('hide'));
  check('everything she is made of adds up to all of her',
    carcass.reduce((a, p) => a + p.massKg, 0), COW, 0.5);
  measure('dressing percentage', dressingPercentage(CATTLE));
  check('a beast dresses out at fifty-five per cent',
    dressingPercentage(CATTLE), 0.55, 0.03);
  measure('and this share of her is food of some kind',
    CATTLE.tissues.filter((t) => t.edible).reduce((a, t) => a + t.share, 0));

  // THE NINE CONSTITUENTS DESCRIBE AN OX, which is the claim being tested by
  // reusing them rather than adding animal ones. If beef does not come out at
  // what beef is published at, they were the wrong nine.
  const beef = carcass.find((p) => p.what === 'beef')!;
  const tallow = carcass.find((p) => p.what === 'tallow')!;
  const bone = carcass.find((p) => p.what === 'bone')!;
  measure('beef, kcal/kg', foodKcalPerKg(compositionOf(beef)));
  check('which is what lean beef is published at',
    foodKcalPerKg(compositionOf(beef)), 1400, 250);
  measure('tallow, kcal/kg', foodKcalPerKg(compositionOf(tallow)));
  assert('and fat is the richest thing a village owns',
    foodKcalPerKg(compositionOf(tallow)) > 7000);
  measure('bone density, kg/m3', density({
    name: 'bone', composition: compositionOf(bone), porosity: 0,
  }));
  assert('bone is heavier than meat, being half mineral',
    bone.densityKgM3 > beef.densityKgM3);

  // A whole beast's worth of food, against what a person needs in a year.
  const edibleKcal = carcass
    .filter((p) => ['beef', 'tallow', 'offal', 'blood'].includes(p.what))
    .reduce((a, p) => a + p.massKg * foodKcalPerKg(compositionOf(p)), 0);
  measure('kcal in one beast', edibleKcal);
  measure('person-years of food that is', edibleKcal / (2400 * 365));
  assert('one beast feeds a family for a season, not a village for a year',
    edibleKcal / (2400 * 365) > 0.5 && edibleKcal / (2400 * 365) < 4);

  // MILK.
  const year = milk(CATTLE, 365);
  measure('milk a year, kg', year.massKg);
  measure('milk, kcal/kg', foodKcalPerKg(compositionOf(year)));
  check('whole milk is about six hundred and fifty a litre',
    foodKcalPerKg(compositionOf(year)) * 1.03, 650, 60);
  measure('kcal a cow gives in milk a year', year.massKg * foodKcalPerKg(compositionOf(year)));
  measure('person-years of that',
    (year.massKg * foodKcalPerKg(compositionOf(year))) / (2400 * 365));
  // A LANDRACE COW, NOT A MODERN ONE. Six hundred litres, and she cannot feed a
  // household on it -- which is why a medieval village ate mostly bread.
  assert('a medieval cow does not feed a household on milk alone',
    (year.massKg * foodKcalPerKg(compositionOf(year))) / (2400 * 365) < 0.5);

  // She cannot give more energy in milk than she eats, which is the bound the
  // sheet is inside and the reason the yield is on the sheet at all.
  const milkKcal = year.massKg * foodKcalPerKg(compositionOf(year));
  const eatenKcal = needKcalPerDay(COW) * 365;
  measure('share of her year that goes into the pail', milkKcal / eatenKcal);
  assert('and no cow secretes more than she eats', milkKcal < eatenKcal);

  // DUNG, where the ring closes: what goes in and is not absorbed comes out,
  // and its nitrogen goes back on the field.
  const d = dung(CATTLE, COW, GRASS_C);
  measure('dung, kg dry a day', d.massKgPerDay);
  measure('nitrogen returned, kg a day', d.nitrogenKgPerDay);
  measure('and a year, kg', d.nitrogenKgPerDay * 365);
  // A cow drops about 60 kg of nitrogen a year, which is what a hectare of
  // cereal takes out of the ground. One beast manures about a hectare.
  check('a cow manures about a hectare of cereal a year',
    d.nitrogenKgPerDay * 365, 60, 30);
  assert('and what comes out is less than what went in',
    d.massKgPerDay < intakeKgPerDay(CATTLE, COW, GRASS_C));

  // GRAIN IS TOO GOOD TO FEED HER, which is the argument every winter.
  const onGrain = intakeKgPerDay(CATTLE, COW, GRAIN_C);
  measure('grain she would need a day, kg', onGrain);
  measure('people that grain would feed instead',
    (onGrain * digestibleKcalPerKg(GRAIN_C, HUMAN)) / 2400);
  assert('a day of her grain would feed more than one person',
    (onGrain * digestibleKcalPerKg(GRAIN_C, HUMAN)) / 2400 > 1);

  // And acorns, which is what a pig is for and a cow is not.
  const acorn = harvest(OAK, 120, 1, 42, W, 1).find((p) => p.part === Part.Seed)!;
  measure('acorns to a ruminant, kcal/kg',
    digestibleKcalPerKg(compositionOf(acorn), RUMINANT));
  assert('a cow could live on acorns if there were enough of them',
    canLiveOn(CATTLE, COW, compositionOf(acorn)));

  // AND A LEAF IS BROWSE, NOT FODDER, which the lignin curve says without ever
  // being told there is such a thing as browse.
  const oakLeaf = harvest(OAK, 120, 1, 30, W, 1).find((p) => p.part === Part.Leaf)!;
  measure('fibre digestibility of an oak leaf',
    fibreDigestibility(compositionOf(oakLeaf), RUMINANT));
  assert('oak leaves are poorer fibre than grass',
    fibreDigestibility(compositionOf(oakLeaf), RUMINANT)
      < fibreDigestibility(GRASS_C, RUMINANT));
});
