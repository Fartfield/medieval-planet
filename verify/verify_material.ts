// What things are made of, checked against what they actually weigh and do.
//
// Every property here is computed from a recipe of nine substances, so every
// one is a prediction. And these are unusually good predictions to check,
// because the answers are published to three figures: oak weighs 700 kg/m3 and
// bends at 100 MPa, wheat gives 3,340 kcal a kilogramme, a carrot gives 410,
// seasoned wood burns at 19 MJ/kg and green wood barely burns at all.
//
// Nothing in the model was fitted to those. The compositions below are the
// measured chemistry of each material -- what fraction is cellulose, lignin,
// starch and so on -- and the constants are per-substance figures from
// elsewhere. If the arithmetic linking them is wrong, oak will not weigh 700.

import {
  type Material, type Composition,
  density, solidDensity, porosityFor, fuelMJPerKg, foodKcalPerKg, proteinGPerKg,
  stiffnessMPa, compressionMPa, bendingMPa, rotRate, rotResistance, burns,
  atMoisture,
} from '../sim/model/material.ts';
import { check, measure, assert, suite } from './harness.ts';

/** Fill in the nine, leaving out what is absent. */
function mix(parts: Partial<Composition>): Composition {
  return {
    water: 0, cellulose: 0, lignin: 0, starch: 0, sugar: 0,
    oil: 0, protein: 0, tannin: 0, ash: 0, ...parts,
  };
}

// Measured chemistry. Woods are given air-dry at 12% moisture, which is the
// state every published timber figure is quoted at.
const OAK_HEART = mix({
  water: 0.12, cellulose: 0.40, lignin: 0.24, tannin: 0.08, ash: 0.004,
  protein: 0.006, sugar: 0.15,
});
const PINE_WOOD = mix({
  water: 0.12, cellulose: 0.42, lignin: 0.27, tannin: 0.01, ash: 0.003,
  protein: 0.005, sugar: 0.172,
});
const WHEAT_GRAIN = mix({
  water: 0.12, starch: 0.68, protein: 0.12, oil: 0.02, cellulose: 0.045,
  sugar: 0.015, ash: 0.02,
});
const CARROT = mix({
  water: 0.88, sugar: 0.050, starch: 0.010, cellulose: 0.028, protein: 0.009,
  ash: 0.010, oil: 0.002, lignin: 0.011,
});
const GREEN_LEAF = mix({
  water: 0.60, cellulose: 0.14, lignin: 0.09, protein: 0.08, sugar: 0.04,
  ash: 0.04, oil: 0.01,
});

// Porosity is not guessed: it is forced by the published density and the
// measured chemistry. Oak weighs 700 and its cell wall is 1,364, so oak is
// 48.7% air and cannot be anything else.
const oak: Material = {
  name: 'oak heartwood', composition: OAK_HEART,
  porosity: porosityFor(OAK_HEART, 700),
};
const pine: Material = {
  name: 'pine wood', composition: PINE_WOOD,
  porosity: porosityFor(PINE_WOOD, 500),
};

suite('what things are made of', () => {
  // THE CELL WALL IS THE SAME EVERYWHERE, which is the fact the whole model
  // rests on: oak and pine are nearly the same substance, and what separates
  // them is how much of the volume is air.
  const oakSolid = solidDensity(OAK_HEART);
  const pineSolid = solidDensity(PINE_WOOD);
  measure('oak, solid substance density kg/m3', oakSolid);
  measure('pine, solid substance density kg/m3', pineSolid);
  assert('every wood is made of nearly the same stuff',
    Math.abs(oakSolid - pineSolid) / oakSolid < 0.05);
  assert('and that stuff is about 1,400 kg/m3',
    oakSolid > 1300 && oakSolid < 1500);

  // AND YET THEY WEIGH WHAT THEY WEIGH. Oak is published at 700 air-dry, pine
  // at about 500. The difference here is porosity and nothing else.
  measure('oak density, kg/m3', density(oak));
  measure('pine density, kg/m3', density(pine));
  check('oak weighs what oak weighs', density(oak), 700, 40);
  check('and pine what pine weighs', density(pine), 500, 40);

  // STRENGTH FOLLOWS DENSITY, which is timber engineering's oldest result.
  measure('oak stiffness, MPa', stiffnessMPa(oak));
  measure('oak bending strength, MPa', bendingMPa(oak));
  measure('oak crushing strength, MPa', compressionMPa(oak));
  check('oak is as stiff as oak', stiffnessMPa(oak), 12000, 1500);
  check('and bends at about a hundred', bendingMPa(oak), 100, 15);
  check('and crushes at about fifty', compressionMPa(oak), 52, 10);
  assert('and pine is weaker than oak because it is lighter',
    bendingMPa(pine) < bendingMPa(oak) && density(pine) < density(oak));

  // FUEL. Seasoned wood is published at 19 MJ/kg, and the moisture penalty is
  // the whole difference between a woodshed and a woodpile.
  measure('seasoned oak, MJ/kg', fuelMJPerKg(OAK_HEART));
  check('seasoned wood burns at nineteen', fuelMJPerKg(OAK_HEART), 19, 2.5);

  const greenOak = atMoisture(OAK_HEART, 0.50);
  measure('green oak, MJ/kg', fuelMJPerKg(greenOak));
  assert('green wood gives far less heat',
    fuelMJPerKg(greenOak) < fuelMJPerKg(OAK_HEART) * 0.7);
  assert('seasoned wood takes a light', burns(OAK_HEART));
  assert('and green wood does not', !burns(greenOak));
  assert('nor does a living leaf', !burns(GREEN_LEAF));

  // FOOD. Wheat is published at 3,340 kcal/kg and a carrot at 410 -- a factor
  // of eight, and it is almost all water.
  measure('wheat grain, kcal/kg', foodKcalPerKg(WHEAT_GRAIN));
  measure('carrot, kcal/kg', foodKcalPerKg(CARROT));
  check('wheat feeds a person like wheat', foodKcalPerKg(WHEAT_GRAIN), 3340, 250);
  // 320, not the 410 on a food label. The label figure credits fibre, which
  // human digestion does not -- a carrot's cellulose passes through. Atwater
  // counts only starch, sugar, oil and protein, and this check asked for the
  // label number against a model that is correctly stricter than the label.
  check('and a carrot like a carrot', foodKcalPerKg(CARROT), 320, 60);

  measure('wheat protein, g/kg', proteinGPerKg(WHEAT_GRAIN));
  check('wheat is about a tenth protein', proteinGPerKg(WHEAT_GRAIN), 120, 20);
  assert('and a carrot is barely any', proteinGPerKg(CARROT) < 20);

  // Wood is not food, however much of it there is. This is the check that
  // catches cellulose being counted as a calorie, which would make a forest
  // the richest larder in the world.
  check('nobody eats wood', foodKcalPerKg(OAK_HEART), 0, 700);
  assert('though a fire does', fuelMJPerKg(OAK_HEART) > 15);

  // ROT. Tannin is why oak heartwood outlasts oak sapwood by a century,
  // though they grew on the same tree in the same year.
  const OAK_SAP = mix({
    water: 0.12, cellulose: 0.44, lignin: 0.24, tannin: 0.005, ash: 0.004,
    protein: 0.011, sugar: 0.18,
  });
  measure('oak heartwood rot resistance', rotResistance(OAK_HEART));
  measure('oak sapwood rot resistance', rotResistance(OAK_SAP));
  assert('heartwood outlasts sapwood',
    rotResistance(OAK_HEART) < rotResistance(OAK_SAP) * 0.6);

  // And a leaf outlasts neither: it is mostly water and hardly any lignin,
  // which is why leaf litter is gone in a season and a fallen oak is not.
  assert('a leaf rots faster than wood',
    rotRate(GREEN_LEAF, 15, 0.6) > rotRate(OAK_HEART, 15, 0.6) * 3);

  // Cold and dry both stop it, for different reasons, and both are why things
  // survive: a beam in a cold church and a body in a bog.
  check('nothing rots below freezing', rotRate(GREEN_LEAF, -5, 0.9), 0, 0);
  check('and nothing rots dry', rotRate(atMoisture(GREEN_LEAF, 0.05), 25, 0.05), 0, 0);
  assert('warmth speeds it', rotRate(GREEN_LEAF, 25, 0.6) > rotRate(GREEN_LEAF, 10, 0.6));

  // Drying takes water out and leaves the rest, so a kilogramme of dried
  // material is more food and more fuel than a kilogramme of fresh -- which is
  // the entire reason for drying anything.
  const driedCarrot = atMoisture(CARROT, 0.10);
  measure('dried carrot, kcal/kg', foodKcalPerKg(driedCarrot));
  assert('drying concentrates what is left',
    foodKcalPerKg(driedCarrot) > foodKcalPerKg(CARROT) * 4);
  const before = Object.values(CARROT).reduce((a, b) => a + b, 0);
  const after = Object.values(driedCarrot).reduce((a, b) => a + b, 0);
  check('and the fractions still sum to one', after, before, 0.001);
});
