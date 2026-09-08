// Five plants, checked against what those plants actually do.
//
// Everything about an individual is computed from (species, age, site, week),
// so everything is a prediction. The five were picked to be as unlike each
// other as possible, and the checks lean on the differences: an oak should take
// a human lifetime to get half its size and wheat should take four months; a
// hazelnut should be oil where an acorn is starch; a carrot's crop should be
// invisible from above and a bramble's should not.
//
// THE GROWTH CHECK IS SPLIT IN TWO ON PURPOSE. Site quality was made to scale
// both the final size and the pace, which is realistic and is the hardest thing
// here to test, because a single wrong answer could come from either half. So
// final size and time-to-maturity are measured separately and each is held to
// its own claim.

import {
  massAt, spreadAt, ageAtFraction, partMass, partMaterial, partColour,
  siteQuality, germinatedBy, germinationChance, isBuried, isPresent,
  senescenceOf, Part, PART_NAMES,
} from '../sim/model/plant.ts';
import { OAK, HAZEL, BRAMBLE, WHEAT, CARROT, SPECIES } from '../sim/model/species.ts';
import { foodKcalPerKg, fuelMJPerKg, density, proteinGPerKg } from '../sim/model/material.ts';
import { WEEKS_PER_YEAR } from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;
const GOOD = 1.0;

suite('five plants', () => {
  // EVERY SPECIES ADDS UP. Part shares are fractions of the whole plant, so a
  // species whose parts sum to 1.2 is 20% heavier than it thinks it is, and
  // nothing else would ever say so.
  let worstSum = 0;
  for (const s of SPECIES) {
    const total = s.parts.reduce((a, p) => a + p.share, 0);
    measure(`${s.name}: parts sum to`, total);
    worstSum = Math.max(worstSum, Math.abs(total - 1));
  }
  check('every plant is all of itself', worstSum, 0, 0.02);

  // GROWTH, SIZE HALF. On good ground each species reaches its own mature mass
  // and no more -- the asymptote is the species' figure.
  for (const s of SPECIES) {
    const old = massAt(s, s.lifespanYears, GOOD);
    measure(`${s.name}: mass at its full age, kg`, old);
    assert(`${s.name} approaches its mature mass without passing it`,
      old <= s.matureMassKg * 1.001 && old > s.matureMassKg * 0.7);
  }

  // GROWTH, TIME HALF. An oak takes about eighty years to reach half its size,
  // a hazel about seven -- which is why the coppice cycle is seven years -- and
  // wheat about a third of one. These are the numbers the growth rates were set
  // from, and they are what separates a tree from a crop.
  const oakHalf = ageAtFraction(OAK, 0.5, GOOD);
  const hazelHalf = ageAtFraction(HAZEL, 0.5, GOOD);
  const wheatHalf = ageAtFraction(WHEAT, 0.5, GOOD);
  measure('oak reaches half its size at, years', oakHalf);
  measure('hazel reaches half its size at, years', hazelHalf);
  measure('wheat reaches half its size at, years', wheatHalf);
  assert('an oak takes a lifetime', oakHalf > 50 && oakHalf < 120);
  assert('a hazel takes a coppice cycle', hazelHalf > 4 && hazelHalf < 12);
  assert('and wheat takes a season', wheatHalf > 0.1 && wheatHalf < 0.5);

  // POOR GROUND MAKES A SMALLER TREE AND A SLOWER ONE, and the two are checked
  // apart. This is the claim the design chose and the one most able to hide a
  // mistake, so neither half is allowed to stand in for the other.
  const POOR = 0.4;
  // AT SATURATION, which is the point of splitting the check. Measured at 400
  // years the ratio came to 0.377 rather than 0.400, and that is not the
  // ceiling being wrong -- it is the PACE, because the poor tree is also
  // slower and at four hundred years has not quite finished arriving. Reading
  // the ceiling off an unsaturated curve measures both effects at once, which
  // is exactly the confusion this pair of checks exists to avoid.
  const oakPoorFinal = massAt(OAK, 4000, POOR);
  const oakGoodFinal = massAt(OAK, 4000, GOOD);
  measure('oak on good ground, saturated kg', oakGoodFinal);
  measure('oak on poor ground, saturated kg', oakPoorFinal);
  check('poor ground gives a smaller tree, in proportion',
    oakPoorFinal / oakGoodFinal, POOR, 0.01);
  // And the unsaturated figure, kept as the measurement that showed why.
  measure('the same ratio read at 400 years', massAt(OAK, 400, POOR) / massAt(OAK, 400, GOOD));

  const oakPoorHalf = ageAtFraction(OAK, 0.5, POOR);
  measure('oak on poor ground reaches half at, years', oakPoorHalf);
  check('and a slower one, in the same proportion',
    oakHalf / oakPoorHalf, POOR, 0.02);

  // A stunted oak is OLD and small, not young. This is the thing the chosen
  // model asserts and the alternative denies.
  const stunted = massAt(OAK, 300, POOR);
  const youngGood = massAt(OAK, 20, GOOD);
  measure('a 300-year oak on chalk, kg', stunted);
  measure('a 20-year oak on good ground, kg', youngGood);
  assert('a stunted old oak has stopped growing',
    stunted > massAt(OAK, 200, POOR) * 0.98);

  // SITE QUALITY is a plain ratio and clamps at both ends.
  check('ideal ground is quality one', siteQuality(1000, 1000), 1, 0);
  check('barren ground is quality zero', siteQuality(0, 1000), 0, 0);
  check('and nothing exceeds its own optimum', siteQuality(5000, 1000), 1, 0);
  check('nothing grows on nothing', massAt(OAK, 100, 0), 0, 0);

  // THE PARTS DIFFER IN KIND, not merely in amount. A hazelnut is oil and an
  // acorn is starch, which is the whole reason one fed people through winter
  // and the other fed pigs.
  const acorn = OAK.parts.find((p) => p.part === Part.Seed)!;
  const nut = HAZEL.parts.find((p) => p.part === Part.Seed)!;
  measure('acorn, kcal/kg', foodKcalPerKg(acorn.composition));
  measure('hazelnut, kcal/kg', foodKcalPerKg(nut.composition));
  assert('a hazelnut is far richer than an acorn',
    foodKcalPerKg(nut.composition) > foodKcalPerKg(acorn.composition) * 2);
  assert('because it is oil where the acorn is starch',
    nut.composition.oil > 0.4 && acorn.composition.starch > 0.3);
  assert('and the acorn is bitter with tannin', acorn.composition.tannin > 0.05);

  // GRAIN AND CHAFF are different parts of the same plant, which is what makes
  // threshing a separation rather than a special case.
  const grain = WHEAT.parts.find((p) => p.part === Part.Seed)!;
  const chaff = WHEAT.parts.find((p) => p.part === Part.Husk)!;
  const straw = WHEAT.parts.find((p) => p.part === Part.Branch)!;
  measure('wheat grain, kcal/kg', foodKcalPerKg(grain.composition));
  measure('chaff, kcal/kg', foodKcalPerKg(chaff.composition));
  measure('straw, kcal/kg', foodKcalPerKg(straw.composition));
  assert('grain feeds a person', foodKcalPerKg(grain.composition) > 3000);
  assert('chaff does not', foodKcalPerKg(chaff.composition) < 900);
  assert('and neither does straw', foodKcalPerKg(straw.composition) < 900);
  assert('though straw burns and thatches',
    fuelMJPerKg(straw.composition) > 12);

  // HEARTWOOD AND SAPWOOD, same tree and same year.
  const heart = OAK.parts.find((p) => p.part === Part.Heartwood)!;
  const sap = OAK.parts.find((p) => p.part === Part.Sapwood)!;
  measure('oak heartwood density', density(partMaterial(heart)));
  measure('oak sapwood density', density(partMaterial(sap)));
  assert('heartwood carries the tannin that makes it last',
    heart.composition.tannin > sap.composition.tannin * 8);
  const bark = OAK.parts.find((p) => p.part === Part.Bark)!;
  assert('and the bark carries more still, which is what tans leather',
    bark.composition.tannin > heart.composition.tannin * 2);

  // WHAT YOU CANNOT SEE. A carrot keeps five sixths of itself underground,
  // which is exactly why finding it is a skill.
  const buriedShare = CARROT.parts
    .filter((p) => isBuried(p.part)).reduce((a, p) => a + p.share, 0);
  measure('share of a carrot that is underground', buriedShare);
  assert('most of a carrot is out of sight', buriedShare > 0.6);
  const brambleBuried = BRAMBLE.parts
    .filter((p) => isBuried(p.part)).reduce((a, p) => a + p.share, 0);
  assert('where most of a bramble is not', brambleBuried < 0.5);
  assert('and the carrot itself is a storage organ, not a root',
    CARROT.parts.some((p) => p.part === Part.Storage && p.share > 0.5));

  // THE YEAR. An oak has leaves in summer and none in winter, and the same
  // machinery gives wheat a harvest and a bare field.
  const oakLeaf = OAK.parts.find((p) => p.part === Part.Leaf)!;
  assert('an oak is in leaf at midsummer', isPresent(oakLeaf.phenology, 26, W));
  assert('and bare at midwinter', !isPresent(oakLeaf.phenology, 1, W));
  assert('an oak keeps its wood all year',
    isPresent(heart.phenology, 1, W) && isPresent(heart.phenology, 26, W));
  assert('wheat has grain in late summer', isPresent(grain.phenology, 30, W));
  assert('and none in spring', !isPresent(grain.phenology, 16, W));

  // Mass follows the season: a part out of season weighs nothing.
  measure('oak leaf mass at midsummer, kg', partMass(OAK, oakLeaf, 200, GOOD, 26, W));
  check('and at midwinter', partMass(OAK, oakLeaf, 200, GOOD, 1, W), 0, 0);

  // COLOUR COMES FROM PIGMENT AND THE CLOCK. A leaf is green when it opens and
  // has turned by the time it falls -- one withdrawal curve, not two colours.
  const spring = partColour(oakLeaf, 16, W);
  const autumn = partColour(oakLeaf, 43, W);
  measure('oak leaf, spring green', spring[1] - spring[0]);
  measure('oak leaf, autumn red-green gap', autumn[1] - autumn[0]);
  assert('a spring leaf is green', spring[1] > spring[0] && spring[1] > spring[2]);
  assert('and an autumn leaf has turned', autumn[0] > spring[0]);
  check('senescence runs from nothing to all',
    senescenceOf(oakLeaf.phenology, 14, W), 0, 0.05);

  // GERMINATION is a distribution, not a date. An acorn needs a winter first,
  // so an autumn crop cannot come up the same month however warm it is.
  check('an acorn will not start without its winter',
    germinationChance(OAK.germination, 12, 2, true), 0, 0);
  assert('and will once it has had one',
    germinationChance(OAK.germination, 12, 10, true) > 0);
  check('nor will anything start dry',
    germinationChance(WHEAT.germination, 15, 0, false), 0, 0);
  check('nor in frozen ground',
    germinationChance(WHEAT.germination, 1, 0, true), 0, 0);

  // Sown seed comes up almost at once; wild seed straggles over years, which
  // is what lets a species survive one bad spring.
  const wheatBy4 = germinatedBy(WHEAT.germination, 4);
  const oakBy8 = germinatedBy(OAK.germination, 8);
  measure('wheat germinated within a month', wheatBy4);
  measure('acorns germinated within a spring', oakBy8);
  assert('a sown field comes up together', wheatBy4 > 0.95);
  assert('and an acorn crop does not', oakBy8 < 0.9 && oakBy8 > 0.3);

  // Every part has a name, so nothing can be labelled as the wrong thing.
  check('every part is named', PART_NAMES.length, 16, 0);
  assert('and the buried ones are the buried ones',
    isBuried(Part.Storage) && isBuried(Part.Root) && !isBuried(Part.Leaf));
});
