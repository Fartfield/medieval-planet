// A household, checked against the historical record it was never given.
//
// Everything below runs from Kleiber's law and the plant sheets upward: no
// ration, no acreage, no cord of wood is written anywhere in the model. The
// record it has to land on is unusually good, because the medieval household
// is one of the most-studied economic units there is:
//
//   a person on farm work eats about 2,900 kcal a day
//   a household burns a faggot of wood a day, two tonnes and more a year
//   a villein family held a VIRGATE, seven to nine hectares
//   a loaf of bread reads about 2,500 kcal a kilogramme
//
// THE VIRGATE CHECK IS THE ONE THAT MATTERS. It is the whole project's chain in
// one number -- climate, plant, harvest, seed corn, diet, rotation -- and the
// standard holding of one family is what that chain must produce, or a
// millennium of manorial accounting disagrees with something upstream.

import {
  SOULS_PER_HOUSEHOLD, ADULT_EQUIVALENTS, personKcalPerDay, grainNeedKgPerYear,
  aleGrainKgPerYear, hearthMJPerWeek, firewoodKgPerYear, householdWeek,
  arableNeededHa, holdingHa, breadFromGrain, GRAIN_SHARE_OF_DIET,
  TITHE_SHARE, RENT_SHARE, type Larder,
} from '../sim/model/household.ts';
import { harvest, compositionOf, digestibleKcalPerKg, HUMAN } from '../sim/model/process.ts';
import { foodKcalPerKg } from '../sim/model/material.ts';
import { WHEAT, OAK } from '../sim/model/species.ts';
import { Part } from '../sim/model/plant.ts';
import { temperatureAtWeek, WEEKS_PER_YEAR } from '../sim/model/season.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;
const MEAN_C = 9;
const SIN_LAT = Math.sin((52 * Math.PI) / 180);

const grainPile = harvest(WHEAT, 0.8, 1, 30, W, 1).find((p) => p.part === Part.Seed)!;
const GRAIN_C = compositionOf(grainPile);
const oakPile = harvest(OAK, 120, 1, 30, W, 1).find((p) => p.part === Part.Heartwood)!;
// Seasoned, as a woodshed holds it.
const WOOD_C = { ...compositionOf(oakPile) };

suite('a household', () => {
  // THE PERSON. Kleiber's law fits a human: basal 1,550 at 62 kg, and the
  // measured activity level of subsistence farming multiplies it.
  measure('a farm-working adult, kcal/day', personKcalPerDay());
  check('which is the medieval ration', personKcalPerDay(), 2900, 300);
  measure('souls in the household', SOULS_PER_HOUSEHOLD);
  measure('eating as this many adults', ADULT_EQUIVALENTS);

  // BREAD. Three quarters of those calories as grain.
  const grainYear = grainNeedKgPerYear(GRAIN_C);
  measure('grain a household eats in a year, kg', grainYear);
  const aleYear = aleGrainKgPerYear(GRAIN_C);
  measure('and sends to the brewhouse, kg', aleYear);
  // The classic consumption figure -- about a kilogramme of grain an adult a
  // day, bread and ale together -- and it is a check on the whole chain, since
  // nothing here was given a ration in kilogrammes.
  check('about a kilogramme of grain an adult a day, bread and ale',
    (grainYear + aleYear) / ADULT_EQUIVALENTS / 365, 1.0, 0.25);

  // THE HEARTH, solved from the house and the week's weather.
  const coldest = temperatureAtWeek(MEAN_C, SIN_LAT, 1);
  measure('the coldest week at 52 north, C', coldest);
  measure('the hearth that week, MJ', hearthMJPerWeek(coldest));
  measure('and in high summer, MJ', hearthMJPerWeek(temperatureAtWeek(MEAN_C, SIN_LAT, 26)));
  assert('the summer hearth is only the cooking fire',
    hearthMJPerWeek(temperatureAtWeek(MEAN_C, SIN_LAT, 26)) === 0);

  const woodYear = firewoodKgPerYear(WOOD_C, MEAN_C, SIN_LAT);
  measure('firewood a year at 52 north, kg', woodYear);
  // Every estimate of medieval domestic fuel lands between one and a half and
  // three tonnes a hearth a year. Nothing here was told that: it is a leaky
  // room, a smoky hearth, and the winter the orbit gives that latitude.
  check('a couple of tonnes of firewood a year', woodYear, 2200, 800);
  measure('which is this many kilogrammes a winter day', woodYear / 365 * 2);

  // A warm coast against a cold plain, because the winter is the weeks and not
  // a constant.
  const warm = firewoodKgPerYear(WOOD_C, 16, Math.sin((38 * Math.PI) / 180));
  measure('the same house at 38 north, kg', warm);
  assert('a southern house burns far less', warm < woodYear * 0.55);

  // THE VIRGATE. The chain from Kleiber to the manorial roll.
  const yieldKgPerHa = 900; // the period's measured wheat yield
  const arable = arableNeededHa(GRAIN_C, yieldKgPerHa, A.MEDIEVAL_YIELD_RATIO);
  const holding = holdingHa(GRAIN_C, yieldKgPerHa, A.MEDIEVAL_YIELD_RATIO);
  measure('arable a household must sow, ha', arable);
  measure('with fallow, the holding, ha', holding);
  measure('seed corn share of the harvest', 1 / A.MEDIEVAL_YIELD_RATIO);
  measure('spoken for before the bread: seed, tithe and rent',
    1 / A.MEDIEVAL_YIELD_RATIO + TITHE_SHARE + RENT_SHARE);
  check('and the holding is a virgate', holding, 8, 1.5);
  // The subsistence-only figure, kept as the measurement of what the
  // obligations cost: a free household on its own land needs well under half
  // the virgate, and the difference IS the feudal economy.
  measure('what a household with no lord would need, ha', (() => {
    const kept = 1 - 1 / A.MEDIEVAL_YIELD_RATIO;
    return ((grainYear + aleYear) / kept / yieldKgPerHa) * 2;
  })());

  // THE WEEK LOOP. A QUARTER of a year's stores against half a year of winter,
  // which is a bad harvest, and the point of the check is that both wants
  // arrive -- hunger and cold -- and arrive before spring does.
  const need = personKcalPerDay() * ADULT_EQUIVALENTS * 7;
  let larder: Larder = {
    grainKg: grainYear / 4,
    otherKcal: need * 26 * (1 - GRAIN_SHARE_OF_DIET) * 0.5,
    firewoodKg: woodYear / 4,
  };
  let hungry = 0;
  let cold = 0;
  for (let i = 0; i < 26; i++) {
    const week = (44 + i) % W;
    const out = householdWeek(larder, GRAIN_C, WOOD_C, temperatureAtWeek(MEAN_C, SIN_LAT, week));
    larder = out.larder;
    if (out.hunger > 0) hungry++;
    if (out.cold > 0) cold++;
  }
  measure('a bad-harvest larder: weeks hungry', hungry);
  measure('weeks cold', cold);
  measure('grain left in spring, kg', larder.grainKg);
  assert('a quarter larder runs out before spring',
    hungry > 4 && cold > 4 && larder.grainKg < 1);

  // A FULL larder winters the household without want, which is what a good
  // harvest buys and what the whole year of work was for. Run over the whole
  // year from the harvest, because the wood bill has a summer too.
  let full: Larder = {
    grainKg: grainYear * 1.01,
    otherKcal: need * 52 * (1 - GRAIN_SHARE_OF_DIET) * 1.01,
    firewoodKg: woodYear * 1.01,
  };
  let anyWant = false;
  // Whole weeks: WEEKS_PER_YEAR is 52.18, and iterating i < W runs a 53rd week
  // against 52 weeks of stores -- the household starved on a fencepost error.
  for (let i = 0; i < Math.floor(W); i++) {
    const week = (36 + i) % W;
    const out = householdWeek(full, GRAIN_C, WOOD_C, temperatureAtWeek(MEAN_C, SIN_LAT, week));
    full = out.larder;
    if (out.hunger > 0 || out.cold > 0) anyWant = true;
  }
  assert('a full larder keeps the household fed and warm the whole year round',
    !anyWant);
  measure('and what is left of it, kg grain', full.grainKg);

  // BREAD, the last link of the longest chain.
  const sack = { ...grainPile, massKg: 100 };
  const loaf = breadFromGrain(sack);
  measure('bread from a hundredweight of grain, kg', loaf.massKg);
  measure('bread, kcal/kg', foodKcalPerKg(compositionOf(loaf)));
  check('a loaf reads what a loaf reads',
    foodKcalPerKg(compositionOf(loaf)), 2500, 300);
  assert('milling and baking trade mass for keeping and digestibility',
    loaf.massKg > sack.massKg && foodKcalPerKg(compositionOf(loaf))
      < digestibleKcalPerKg(GRAIN_C, HUMAN));

  // The diet's shape is a stated social fact, restated so nobody mistakes it
  // for a derivation.
  check('three quarters of the diet is grain', GRAIN_SHARE_OF_DIET, 0.75, 0);
});
