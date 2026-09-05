// Grazing, checked at the scale a hamlet is actually kept at.
//
// The model divides what a hectare grows by what an animal eats. Both come from
// elsewhere -- productivity from the climate model, the grazeable share from
// resources.ts, the appetite from a fortieth of body mass a day -- so the
// STOCKING RATE is a prediction, and stocking rates are recorded in acres per
// beast on every manorial survey there is.
//
// The checks start from a hamlet rather than an abstraction, because that is
// the scale the numbers have to be right at first: five households with a
// couple of oxen, a cow and a few sheep between them is a thing history
// records, and a model that cannot produce it is not going to be saved by
// scaling up.

import { Biome } from '../sim/model/biome.ts';
import {
  stockingUnitsPerHa, pastureNeededHa, grazing, forageKgPerHaYear,
  INTAKE_KG_PER_UNIT_YEAR,
} from '../sim/model/pasture.ts';
import { check, measure, assert, suite } from './harness.ts';

const GRASS_NPP = 600;
const FOREST_NPP = 1000;
const SAVANNA_NPP = 700;

suite('what the grass will feed', () => {
  // WHAT AN ANIMAL EATS. Half a tonne of cow at a fortieth of itself a day is
  // four and a half tonnes of dry fodder a year -- which is why hay meadows
  // and winter feed were the whole difficulty of keeping stock through a
  // northern winter.
  measure('a livestock unit eats, kg dry a year', INTAKE_KG_PER_UNIT_YEAR);
  assert('a cow eats a few tonnes a year',
    INTAKE_KG_PER_UNIT_YEAR > 3000 && INTAKE_KG_PER_UNIT_YEAR < 6000);

  // THE STOCKING RATE ON GOOD GRASS. Medieval permanent pasture in lowland
  // England ran about a beast to one or two acres, which is 1.2 to 2.5 units a
  // hectare on the best of it, and rough grazing very much less. Unimproved
  // grassland sitting below the best lowland figure is right.
  const grass = stockingUnitsPerHa(Biome.TemperateGrassland, GRASS_NPP);
  measure('temperate grassland carries, units per hectare', grass);
  assert('good grass carries something near a beast a hectare',
    grass > 0.2 && grass < 2.5);
  measure('hectares per beast on grassland', 1 / grass);

  // AND UNDER TREES, which is the comparison that makes the number mean
  // something. A forest out-produces a grassland and grazes far worse, because
  // its production is forty feet up. This is why wood pasture was a distinct
  // and carefully managed thing rather than just letting cattle into the wood.
  const wood = stockingUnitsPerHa(Biome.TemperateForest, FOREST_NPP);
  measure('temperate forest carries, units per hectare', wood);
  assert('a forest grows more and grazes less than a grassland',
    FOREST_NPP > GRASS_NPP && wood < grass);

  // A SAVANNA is the best grazing there is, which is why the great herds are
  // there and not in the rainforest that out-produces it many times over.
  const savanna = stockingUnitsPerHa(Biome.Savanna, SAVANNA_NPP);
  const jungle = stockingUnitsPerHa(Biome.TropicalRainforest, 2200);
  measure('savanna carries, units per hectare', savanna);
  measure('rainforest carries, units per hectare', jungle);
  assert('savanna out-grazes rainforest despite growing far less',
    savanna > jungle * 3);

  // Desert and ice carry almost nothing and nothing at all.
  assert('a desert barely grazes',
    stockingUnitsPerHa(Biome.Desert, 50) < grass / 20);
  check('ice grazes nothing', stockingUnitsPerHa(Biome.Ice, 0), 0, 0);
  check('and so does the sea', forageKgPerHaYear(Biome.Ocean, 0), 0, 0);

  // THE HAMLET, which is the test that matters. Five households, and between
  // them a pair of oxen for the plough, a couple of cows and a dozen sheep --
  // call it six livestock units. How much grazing does that want?
  const HAMLET_UNITS = 6;
  const hamletHa = pastureNeededHa(HAMLET_UNITS, Biome.TemperateGrassland, GRASS_NPP);
  measure('grazing a hamlet of six units needs, ha', hamletHa);
  assert('a hamlet grazes a few tens of hectares at most',
    hamletHa > 2 && hamletHa < 60);

  // In acres, which is the unit the survey would have used.
  measure('the same in acres', hamletHa * 2.471);

  // A VILLAGE ploughing with oxen. Forty households at two oxen a plough team
  // shared between four households is twenty teams -- but the beasts eat
  // whether they plough or not, and that is the point: draught animals were
  // kept in the numbers the pasture allowed, not the numbers the fields wanted.
  const villageUnits = 60;
  const villageHa = pastureNeededHa(villageUnits, Biome.TemperateGrassland, GRASS_NPP);
  measure('grazing a village herd of 60 units needs, ha', villageHa);
  assert('a village herd wants a real commons',
    villageHa > 30 && villageHa < 600);

  // OVERSTOCKING is the failure the model exists to show, and unlike wood it
  // has no reserve to eat into: too many beasts on too little grass is short
  // of feed this year, not in twenty.
  const ample = grazing(6, hamletHa * 2, Biome.TemperateGrassland, GRASS_NPP);
  check('twice the grazing feeds the herd', ample.supply, 1, 0);
  const tight = grazing(6, hamletHa / 3, Biome.TemperateGrassland, GRASS_NPP);
  measure('a third of the grazing feeds', tight.supply);
  assert('a third of the grazing does not', tight.supply > 0.2 && tight.supply < 0.5);

  // No beasts is not a shortage.
  check('no herd is always fed', grazing(0, 0, Biome.TemperateGrassland, GRASS_NPP).supply, 1, 0);
  // No grass and beasts is a total shortage, not a divide by zero.
  check('no grass feeds nothing', grazing(6, 0, Biome.TemperateGrassland, GRASS_NPP).supply, 0, 0);
  assert('and asking for pasture where none grows is impossible',
    pastureNeededHa(6, Biome.Ice, 0) === Infinity);
});
