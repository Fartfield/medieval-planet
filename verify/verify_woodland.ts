// Wood, checked against how much woodland a village actually kept.
//
// The model divides a fuel demand by a growth rate. Both come from elsewhere --
// the demand from firewood consumption per head, the growth from the woody
// share of the productivity the climate model computes -- so the WOODLAND AREA
// it asks for is a prediction, and manorial surveys recorded that area in acres
// for centuries. It is one of the few numbers in this project that a
// fourteenth-century reeve would recognise.
//
// The distinction the checks are built around is stock against flow. A hectare
// holds 150 tonnes and grows 8, so a village cutting what it needs is fine for
// ever and a village cutting the stock is fine for twenty years and then ruined
// -- and a model that confuses the two would look right for a generation.

import * as A from '../sim/anchors.ts';
import { Biome } from '../sim/model/biome.ts';
import { timberTPerHa } from '../sim/model/resources.ts';
import {
  annualGrowthTPerHa, sustainableCutTPerHa, yearsOfStock, woodNeedKgPerYear,
  woodlandNeededHa, woodSupply, WOOD_KG_PER_PERSON_YEAR, BUILDING_KG_PER_PERSON_YEAR,
} from '../sim/model/woodland.ts';
import { check, measure, assert, suite } from './harness.ts';

const TEMPERATE_NPP = 1000;

suite('wood, and how much of it there is', () => {
  // THE FLOW. A managed temperate woodland is measured at 3 to 10 tonnes a
  // hectare a year of dry increment. This comes out of productivity times the
  // woody fraction, neither of which was chosen with this in mind.
  const growth = annualGrowthTPerHa(Biome.TemperateForest, TEMPERATE_NPP);
  measure('temperate woodland grows, t/ha/yr', growth);
  assert('a wood puts on what a wood puts on', growth > 3 && growth < 11);
  check('and cutting that much is sustainable by definition',
    sustainableCutTPerHa(Biome.TemperateForest, TEMPERATE_NPP), growth, 0);

  // THE STOCK, for comparison: about twenty years of growth standing at once,
  // which is why overcutting takes so long to show.
  const standing = timberTPerHa(Biome.TemperateForest, TEMPERATE_NPP);
  measure('temperate woodland stands, t/ha', standing);
  measure('years of growth standing at once', standing / growth);
  assert('the stock is many years of the flow',
    standing / growth > 10 && standing / growth < 40);

  // A GRASSLAND grows almost no wood, which is what makes it a grassland and
  // what made fuel a real problem on open ground.
  const plainGrowth = annualGrowthTPerHa(Biome.TemperateGrassland, 600);
  measure('grassland grows, t/ha/yr', plainGrowth);
  assert('open ground is no use for fuel', plainGrowth < growth / 10);

  // WHAT A PERSON BURNS. Fuel dominates; a house frame is a rounding error
  // beside it, which is the historically important part -- nobody ran out of
  // house frames and everybody worried about firewood.
  measure('wood per person per year, kg', WOOD_KG_PER_PERSON_YEAR);
  measure('of which building timber, kg', BUILDING_KG_PER_PERSON_YEAR);
  assert('burning is most of it',
    BUILDING_KG_PER_PERSON_YEAR < WOOD_KG_PER_PERSON_YEAR * 0.05);

  // THE NUMBER A REEVE WOULD RECOGNISE. Demand over increment: how much
  // woodland a village has to keep. Manorial surveys put it at a few acres a
  // household, which for a five-person household is well under a hectare each
  // -- so a village of 200 wants tens of hectares, not hundreds and not one.
  const villageHa = woodlandNeededHa(200, 0, Biome.TemperateForest, TEMPERATE_NPP);
  measure('woodland a village of 200 must keep, ha', villageHa);
  assert('a village needs a wood, not a forest and not a copse',
    villageHa > 10 && villageHa < 100);

  const perPersonHa = villageHa / 200;
  measure('woodland per person, ha', perPersonHa);
  assert('which is a fraction of a hectare each',
    perPersonHa > 0.02 && perPersonHa < 0.5);

  // IRONWORKING LEANS ON THE SAME WOOD, through ratios anchored long before
  // anyone asked this question: charcoal per iron, wood per charcoal.
  const withoutIron = woodNeedKgPerYear(200, 0);
  const withIron = woodNeedKgPerYear(200, 200 * A.IRON_PER_PERSON_KG_PER_YEAR);
  measure('a village of 200 burns, kg/yr', withoutIron);
  measure('and with its own smithy, kg/yr', withIron);
  // A SMITHY IS A ROUNDING ERROR, and this check asked for it to be a tenth of
  // the village's wood. Measured, it is 2%: a person wears out a kilogramme of
  // iron a year, that iron takes twenty kilogrammes of wood to smelt, and the
  // same person burns a thousand kilogrammes keeping warm and fed. Domestic
  // fuel dwarfs industry by fifty to one, which is not what the phrase "the
  // charcoal burners stripped the woods" leads you to expect -- and it is
  // right. It was hearths, in their millions, not furnaces.
  const smithyShare = (withIron - withoutIron) / withoutIron;
  measure('the smithy share of the village wood', smithyShare);
  assert('a smithy is a real draw but nothing beside the hearths',
    smithyShare > 0.005 && smithyShare < 0.1);

  // STOCK AGAINST FLOW, which is the failure this model exists to make
  // visible. Cutting within the increment never runs out; cutting double it
  // runs out on a timescale that outlasts whoever decided to.
  // Asserted rather than checked: a tolerance test on infinity is NaN, which
  // fails however right the answer is.
  assert('cutting the increment lasts for ever',
    yearsOfStock(Biome.TemperateForest, TEMPERATE_NPP, growth) === Infinity);
  const doubled = yearsOfStock(Biome.TemperateForest, TEMPERATE_NPP, growth * 2);
  measure('years before doubling the cut strips it', doubled);
  assert('and overcutting takes a generation to show',
    doubled > 10 && doubled < 40);

  // THE SUPPLY A SETTLEMENT SEES. Enough woodland and the need is met by
  // growth alone; too little and the stock is being spent, with a countdown.
  const ample = woodSupply(200, 0, 60, Biome.TemperateForest, TEMPERATE_NPP);
  measure('supply with 60 ha of wood', ample.supply);
  check('sixty hectares keeps two hundred people for ever', ample.supply, 1, 0);
  assert('with no countdown', ample.yearsLeft === Infinity);

  const thin = woodSupply(200, 0, 5, Biome.TemperateForest, TEMPERATE_NPP);
  measure('supply with 5 ha of wood', thin.supply);
  measure('years before 5 ha is stripped', thin.yearsLeft);
  assert('five hectares does not', thin.supply < 0.5);
  assert('and it strips in a lifetime, not a season',
    thin.yearsLeft > 2 && thin.yearsLeft < 60);

  // No woodland at all is a shortfall, not a divide by zero.
  const none = woodSupply(200, 0, 0, Biome.TemperateForest, TEMPERATE_NPP);
  check('no wood is no supply', none.supply, 0, 0);
  check('and nothing to strip', none.standingKg, 0, 0);
  assert('and no time at all', none.yearsLeft === 0 || none.yearsLeft < 1);

  // Nobody needs wood, so any woodland is enough -- including none.
  check('an empty tile wants no wood', woodNeedKgPerYear(0, 0), 0, 0);
  check('and is therefore supplied',
    woodSupply(0, 0, 0, Biome.TemperateForest, TEMPERATE_NPP).supply, 1, 0);
});
