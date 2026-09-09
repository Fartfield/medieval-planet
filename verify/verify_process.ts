// The verbs, checked against what those verbs actually do to real things.
//
// Every rule here reads a composition and nothing else, so every answer is a
// prediction about a material the rule has never been told the name of. The
// good checks are the ones where two materials the model thinks are similar
// have to come out different, or the other way round:
//
//   a green log and a seasoned one are the same wood and one will not light
//   a hazel rod and an oak beam are the same substance and one rots in a decade
//   straw and grain are the same plant and one of them feeds a person
//   grass feeds a cow and does not feed a person, and one number says why
//
// THE EATING CHECK IS THE ONE THAT MATTERS MOST, because it is the seam between
// the plant model and everything a kingdom does. If a cow cannot live on grass
// the pasture model is a fiction, and if a person can, the whole point of grain
// disappears.

import {
  type Pile, burn, burnsOutInHours, rot, halfLifeYears, dry, seasoningHours,
  equilibriumMoisture, harvest, thresh, eat, digestibleKcalPerKg, sustains,
  compositionOf, materialOf, thicknessM, volumeM3,
  HUMAN, PIG, RUMINANT,
} from '../sim/model/process.ts';
import { OAK, HAZEL, WHEAT, GRASS, CARROT } from '../sim/model/species.ts';
import { Part } from '../sim/model/plant.ts';
import { density, fuelMJPerKg } from '../sim/model/material.ts';
import { WEEKS_PER_YEAR } from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;

function pile(species: typeof OAK, part: number, massKg: number, moisture: number): Pile {
  return { species, part: part as never, massKg, moisture };
}

suite('what happens to stuff', () => {
  // A LOG. Ten kilogrammes of seasoned oak heartwood, which is one good log.
  const log = pile(OAK, Part.Heartwood, 10, 0.12);
  measure('a 10 kg oak log, m3', volumeM3(log));
  measure('and how thick it is, m', thicknessM(log));
  measure('and what it weighs a cubic metre', density(materialOf(log)));

  const hour = burn(log, 1);
  measure('kg of it a fire eats in an hour', hour.consumedKg);
  measure('MJ that gives', hour.heatMJ);
  measure('ash left, kg', hour.ashKg);
  assert('a seasoned log takes a light', hour.lit);
  // A domestic fire gets through a few kilogrammes an hour and a heaped one
  // more. Nothing here was told that: it is the charring rate and the cube.
  assert('a fire eats a log at a few kilogrammes an hour',
    hour.consumedKg > 1 && hour.consumedKg < 25);
  measure('hours to burn the log out', burnsOutInHours(log));

  // FIRE IS A SURFACE PROCESS, which is why kindling lights a log and not the
  // reverse. Mass goes as the cube of size and burning surface as the square,
  // so the same wood split small burns far faster.
  // Measured over six minutes rather than an hour, because in an hour both are
  // most of the way gone and the ratio flattens -- the first version compared
  // them at an hour, read 1.00 against 0.72, and called the rule broken.
  const split = pile(OAK, Part.Heartwood, 0.1, 0.12);
  const splitRate = burn(split, 0.1).consumedKg / 0.1;
  const logRate = burn(log, 0.1).consumedKg / 10;
  measure('share of a 100 g stick gone in six minutes', splitRate);
  measure('share of a 10 kg log gone in six minutes', logRate);
  assert('split small, the same wood burns far faster', splitRate > logRate * 3);
  measure('hours to burn out a 100 g stick', burnsOutInHours(split));
  // A hundredfold less mass burns out in the cube root of the time, which is
  // the surface law and is not written down anywhere in the code.
  check('a hundredfold split burns out four to five times sooner',
    burnsOutInHours(log) / burnsOutInHours(split), Math.cbrt(100), 0.01);

  // GREEN WOOD WILL NOT LIGHT, and it is the same wood.
  const green = pile(OAK, Part.Heartwood, 10, 0.55);
  assert('a green log does not take a light', !burn(green, 1).lit);
  check('and gives nothing at all', burn(green, 4).heatMJ, 0, 0);

  // SEASONING. A year an inch, which sets how long the woodshed has to be full
  // before winter -- and it is the pile's own thickness that says how long.
  measure('the air-dry moisture at 65% humidity', equilibriumMoisture(0.65));
  check('which is the twelve per cent every timber figure is quoted at',
    equilibriumMoisture(0.65), 0.12, 0.01);
  const seasoned = dry(green, 0.65, 8766 * 2);
  measure('moisture of that log after two years', seasoned.moisture);
  measure('and what it now weighs, kg', seasoned.massKg);
  assert('two years in a shed makes it fuel', burn(seasoned, 1).lit);
  assert('and it has lost weight, being mostly the water',
    seasoned.massKg < green.massKg * 0.85);
  measure('hours before a green log will light', seasoningHours(green, 0.65));
  measure('which is this many months', seasoningHours(green, 0.65) / 730);
  assert('a log takes months to season, not days',
    seasoningHours(green, 0.65) > 730 && seasoningHours(green, 0.65) < 8766 * 3);

  // AND NOTHING SEASONS IN A WET CLIMATE. The equilibrium is above the point at
  // which it would burn, so it never gets there however long you wait.
  // NOT "never burns", which is what this first claimed and is wrong about
  // what humidity is. Wood standing in saturated AIR comes to rest near the
  // fibre saturation point and will, eventually and badly, burn. Wood in a bog
  // is holding liquid water, which is a different thing the model does not
  // reach through humidity at all.
  measure('air-dry moisture at 95% humidity', equilibriumMoisture(0.95));
  measure('and in saturated air', equilibriumMoisture(1.0));
  measure('hours to season the same log in saturated air', seasoningHours(green, 1.0));
  assert('a wet climate makes the wait half again as long',
    seasoningHours(green, 1.0) > seasoningHours(green, 0.65) * 1.4);
  assert('and never gets it below a fifth water',
    equilibriumMoisture(1.0) > 0.2);

  // ROT. Oak heartwood against oak sapwood: same tree, same year, and the
  // tannin in one makes it last. This is the check material.ts sets up and this
  // one turns into a number of years.
  const heart = pile(OAK, Part.Heartwood, 10, 0.30);
  const sap = pile(OAK, Part.Sapwood, 10, 0.30);
  measure('oak heartwood half-life in warm damp ground, years',
    halfLifeYears(heart, 20, 0.6));
  measure('oak sapwood half-life, years', halfLifeYears(sap, 20, 0.6));
  // A DURABLE TIMBER AND A PERISHABLE ONE, and both figures are anchored: oak
  // sapwood in ground contact is durability class 5 and gone in a few years,
  // heartwood is class 2 and lasts a couple of decades. This check reading 2.05
  // is what sent the rot constants back to be solved from measurements rather
  // than chosen for their shape -- see the note on rotResistance.
  measure('and the ratio between them', halfLifeYears(heart, 20, 0.6) / halfLifeYears(sap, 20, 0.6));
  // The same beam soaked. It rots faster because it is wet, and NOT because
  // being wet changed what it is made of -- which is what the numbers said
  // until rotResistance started reading the dry matter.
  const soaked = { ...heart, moisture: 0.45 };
  measure('a soaked oak beam, half-life in years', halfLifeYears(soaked, 20, 0.6));
  check('wetting a beam does not change its chemistry',
    halfLifeYears(soaked, 20, 0.6), halfLifeYears(heart, 20, 0.6), 0.01);
  check('oak sapwood in the ground is gone in a few years',
    halfLifeYears(sap, 20, 0.6), 3, 1);
  check('and oak heartwood lasts a couple of decades',
    halfLifeYears(heart, 20, 0.6), 20, 6);

  const leaf = pile(OAK, Part.Leaf, 10, 0.60);
  measure('leaf litter half-life, years', halfLifeYears(leaf, 15, 0.6));
  check('leaf litter loses half its mass in about a year',
    halfLifeYears(leaf, 15, 0.6), 1.15, 0.35);

  // Integrating properly means a century does not give a negative mass, which
  // a per-step subtraction would.
  const century = rot(leaf, 15, 0.6, 8766 * 100);
  measure('what is left of ten kg of leaves after a century, kg', century.left.massKg);
  assert('nothing rots past nothing',
    century.left.massKg >= 0 && century.left.massKg < 0.001);
  // And a long step is the same answer as many short ones, which is the whole
  // claim behind a rate that is integrated rather than stepped.
  let stepped = { ...leaf };
  for (let i = 0; i < 52; i++) stepped = rot(stepped, 15, 0.6, 168).left;
  const oneGo = rot(leaf, 15, 0.6, 8736).left.massKg;
  measure('a year of rot in one step, kg left', oneGo);
  measure('and in fifty-two, kg left', stepped.massKg);
  check('a long step is the same as many short ones', stepped.massKg / oneGo, 1, 0.001);

  check('nothing rots below freezing', rot(leaf, -5, 0.9, 8766).lostKg, 0, 0);
  // A DRY pile, stated rather than dried: the first version dried a ten-kilo
  // heap of leaves for five years and it was still 40% water, because a heap
  // that size has a 15 cm path to its own surface. That is the drying model
  // being right and the test asking the wrong question.
  const driedLeaf = { ...leaf, moisture: 0.05 };
  check('nor bone dry', rot(driedLeaf, 25, 0.05, 8766).lostKg, 0, 0);

  // THRESHING is a partition by part, not a rule about wheat.
  const sheaf = harvest(WHEAT, 0.8, 1, 30, W, 1000);
  measure('parts a thousand wheat plants carry in week 30', sheaf.length);
  const out = thresh(sheaf);
  const kg = (ps: readonly Pile[]): number => ps.reduce((a, p) => a + p.massKg, 0);
  measure('grain, kg', kg(out.grain));
  measure('chaff, kg', kg(out.chaff));
  measure('straw, kg', kg(out.straw));
  measure('grain lost in the chaff, kg', out.lostKg);
  assert('threshing gives grain, chaff and straw',
    out.grain.length > 0 && out.chaff.length > 0 && out.straw.length > 0);
  assert('and loses a twentieth of the grain to the floor',
    out.lostKg > 0 && out.lostKg < kg(out.grain) * 0.1);
  assert('the straw outweighs the grain, which is why thatch was free',
    kg(out.straw) > kg(out.grain));
  measure('anything else, kg', kg(out.other));
  check('and nothing is created or destroyed',
    kg(out.grain) + kg(out.chaff) + kg(out.straw) + kg(out.other),
    sheaf.reduce((a, p) => a + p.massKg, 0), 0.001);
  // REAPING LEAVES THE ROOTS. A fifth of a wheat plant stays in the ground, and
  // the conservation check above is what found it: the sheaf weighed 5.82 kg
  // and threshing accounted for 4.65, and the missing kilogramme was roots that
  // a scythe never lifted.
  const pulled = harvest(WHEAT, 0.8, 1, 30, W, 1000, true);
  measure('a reaped wheat crop, kg', sheaf.reduce((a, p) => a + p.massKg, 0));
  measure('and the same crop pulled up whole, kg',
    pulled.reduce((a, p) => a + p.massKg, 0));
  assert('the roots are a fifth of the plant and stay in the field',
    pulled.reduce((a, p) => a + p.massKg, 0)
      > sheaf.reduce((a, p) => a + p.massKg, 0) * 1.15);

  // THE SAME MACHINERY ON A DIFFERENT PLANT, with no code that knows about it.
  const nuts = harvest(HAZEL, 8, 1, 38, W, 10);
  const hazelOut = thresh(nuts);
  measure('hazelnuts off ten stools, kg', kg(hazelOut.grain));
  assert('a hazel threshes too, having the same parts', kg(hazelOut.grain) > 0);

  // EATING. The seam between the plant model and everything a kingdom does.
  const grainPile = out.grain[0];
  const strawPile = out.straw.find((p) => p.part === Part.Branch)!;
  const grassLeaf = harvest(GRASS, 3, 1, 30, W, 1).find((p) => p.part === Part.Leaf)!;

  measure('wheat grain to a person, kcal/kg',
    digestibleKcalPerKg(compositionOf(grainPile), HUMAN));
  check('which is what wheat is published at',
    digestibleKcalPerKg(compositionOf(grainPile), HUMAN), 3340, 300);

  const grassToCow = digestibleKcalPerKg(compositionOf(grassLeaf), RUMINANT);
  const grassToMan = digestibleKcalPerKg(compositionOf(grassLeaf), HUMAN);
  measure('fresh grass to a cow, kcal/kg', grassToCow);
  measure('fresh grass to a person, kcal/kg', grassToMan);
  assert('a cow gets far more out of grass than a person does',
    grassToCow > grassToMan * 1.5);
  // ONE NUMBER SEPARATES THEM, and this is the check that it is that number.
  assert('and the difference is the cellulose and nothing else',
    Math.abs((grassToCow - grassToMan * (0.75 / 0.95))
      - compositionOf(grassLeaf).cellulose * 4000 * 0.5) < 1);

  const strawToCow = digestibleKcalPerKg(compositionOf(strawPile), RUMINANT);
  measure('straw to a cow, kcal/kg', strawToCow);
  // Straw is measured at about 6 MJ of metabolisable energy a kg of dry matter,
  // which is 1,430 kcal. It keeps a cow alive and does not fatten one.
  check('straw is poor winter fodder and is fodder', strawToCow, 1430, 400);
  assert('and it is worse than grass', strawToCow < grassToCow * 4);

  // A PIG IS IN BETWEEN, which is why a pig could be turned into the woods to
  // eat acorns and a cow could not.
  const acorn = harvest(OAK, 120, 1, 42, W, 1).find((p) => p.part === Part.Seed)!;
  measure('acorns to a pig, kcal/kg', digestibleKcalPerKg(compositionOf(acorn), PIG));
  assert('a pig does better on fibre than a person and worse than a cow',
    digestibleKcalPerKg(compositionOf(grassLeaf), PIG) > grassToMan
    && digestibleKcalPerKg(compositionOf(grassLeaf), PIG) < grassToCow);

  // CAN A COW LIVE ON IT. A 450 kg cow needs about 20,000 kcal a day and eats
  // about 11 kg of dry matter, which is 40 kg of fresh grass at 72% water.
  assert('a cow lives on grass', sustains(grassLeaf, RUMINANT, 20000, 40));
  assert('and a person does not', !sustains(grassLeaf, HUMAN, 2400, 2));
  assert('but a person lives on bread',
    sustains(grainPile, HUMAN, 2400, 1));

  // Eating takes it away, which is the part a grazing model needs.
  const bite = eat(grassLeaf, RUMINANT, grassLeaf.massKg / 2);
  measure('kcal in half a grass plant, to a cow', bite.kcal);
  check('and half of it is left', bite.left.massKg, grassLeaf.massKg / 2, 1e-9);

  // A CARROT IS FOOD AND ITS TOP IS NOT MUCH, which the same rule says without
  // being told there is such a thing as a carrot.
  // DUG, not reaped: the whole point of a carrot is the part a scythe misses.
  const carrotCrop = harvest(CARROT, 0.6, 1, 36, W, 1, true);
  const root = carrotCrop.find((p) => p.part === Part.Storage)!;
  const top = carrotCrop.find((p) => p.part === Part.Leaf)!;
  measure('carrot to a person, kcal/kg', digestibleKcalPerKg(compositionOf(root), HUMAN));
  measure('carrot top to a person, kcal/kg', digestibleKcalPerKg(compositionOf(top), HUMAN));
  // The right comparison is what the WHOLE root is worth against the whole top,
  // not what a kilogramme of each is: the root is 62% of the plant and the
  // leaves 28%, and that is most of why it is worth digging.
  const rootMeal = root.massKg * digestibleKcalPerKg(compositionOf(root), HUMAN);
  const topMeal = top.massKg * digestibleKcalPerKg(compositionOf(top), HUMAN);
  measure('kcal in one carrot', rootMeal);
  measure('kcal in its top', topMeal);
  assert('the root is worth digging for', rootMeal > topMeal * 3);

  // FUEL AND FOOD ARE DIFFERENT QUESTIONS about the same pile, and straw is the
  // material that makes the point: it will not feed a person and it will roof
  // a house and heat it.
  measure('straw as fuel, MJ/kg', fuelMJPerKg(compositionOf(strawPile)));
  assert('straw burns even though nobody can eat it',
    fuelMJPerKg(compositionOf(strawPile)) > 12
    && digestibleKcalPerKg(compositionOf(strawPile), HUMAN) < 1200);
});
