// The shape of a plant, checked against the shape of a plant.
//
// Everything in form.ts is solved rather than drawn, so every number below is a
// prediction that can be wrong -- and the good ones here are wrong loudly. Feed
// the same formula a two-tonne oak, a seven-year hazel pole, a bramble cane and
// a wheat straw and it has to come back with half a metre, three centimetres,
// nine millimetres and two and a half millimetres. That is four orders of
// magnitude out of one line of arithmetic, and no part of it is a table.
//
// THE ONE CHECK THAT MATTERS MOST is the twig, because it is the one where the
// count cancels. Leonardo's rule says a trunk ends in (D/d)^2 twigs; the sheet
// says how many kilogrammes of twig there are. Those two facts together fix the
// size of a twig with nothing else added, and if the fix is wrong an oak twig
// comes out the thickness of a wrist. It did, the first time -- see the hazel
// comment in species.ts, where the geometry caught a part share that had been
// wrong since the sheet was written and nothing else would ever have noticed.

import {
  stemDiameterM, twigDiameterM, twigCount, branchOrders, heightM,
  crownAreaM2, leafAreaIndex, crownOpacity, boleVolumeM3, formOf,
} from '../sim/model/form.ts';
import { OAK, HAZEL, BRAMBLE, WHEAT, CARROT, SPECIES } from '../sim/model/species.ts';
import { Part, Habit, isBuried, massAt } from '../sim/model/plant.ts';
import { WEEKS_PER_YEAR } from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;
const GOOD = 1.0;
const MIDSUMMER = 26;
const MIDWINTER = 1;

// The age each is a grown specimen at. An oak at 150 is a timber tree; a hazel
// at its seven-year cut; a bramble and a wheat plant at the end of their run.
const OLD_OAK = 150;
const CUT_HAZEL = 7;

suite('the shape of a plant', () => {
  // DERIVATION 1, across four orders of magnitude. One formula, four plants,
  // and the answers are checked against what a person with a tape would read.
  const oakStem = stemDiameterM(OAK, OLD_OAK, GOOD);
  const hazelStem = stemDiameterM(HAZEL, CUT_HAZEL, GOOD);
  const brambleStem = stemDiameterM(BRAMBLE, 8, GOOD);
  const wheatStem = stemDiameterM(WHEAT, 0.75, GOOD);
  measure('oak bole at 150 years, m', oakStem);
  measure('hazel pole at its seven-year cut, m', hazelStem);
  measure('bramble cane, m', brambleStem);
  measure('wheat straw, m', wheatStem);
  assert('an oak bole is about half a metre through',
    oakStem > 0.3 && oakStem < 0.75);
  assert('a hazel rod is a few centimetres',
    hazelStem > 0.02 && hazelStem < 0.07);
  assert('a bramble cane is a few millimetres',
    brambleStem > 0.004 && brambleStem < 0.014);
  assert('and a wheat straw is thinner still',
    wheatStem > 0.0012 && wheatStem < 0.005);
  assert('and they are in that order, which is the point',
    oakStem > hazelStem && hazelStem > brambleStem && brambleStem > wheatStem);

  // The volume they were solved from is mass over density and nothing else.
  measure('oak bole volume at 150 years, m3', boleVolumeM3(OAK, OLD_OAK, GOOD));
  const boleMass = massAt(OAK, OLD_OAK, GOOD) * (0.38 + 0.16);
  measure('oak bole mass at 150 years, kg', boleMass);

  // DERIVATION 3, the one where the count cancels.
  const oakTwig = twigDiameterM(OAK, OLD_OAK, GOOD);
  const hazelTwig = twigDiameterM(HAZEL, CUT_HAZEL, GOOD);
  measure('oak twig, m', oakTwig);
  measure('hazel twig, m', hazelTwig);
  assert('an oak twig is five millimetres or so',
    oakTwig > 0.003 && oakTwig < 0.009);
  assert('a hazel twig likewise', hazelTwig > 0.0015 && hazelTwig < 0.006);

  // DERIVATION 2. Nothing anywhere says how many twigs a tree has.
  const oakTwigs = twigCount(OAK, OLD_OAK, GOOD);
  const hazelTwigs = twigCount(HAZEL, CUT_HAZEL, GOOD);
  measure('twigs on a 150-year oak', oakTwigs);
  measure('twigs on a hazel stool', hazelTwigs);
  assert('an oak carries thousands of twigs',
    oakTwigs > 2000 && oakTwigs < 40000);
  assert('a hazel stool far fewer', hazelTwigs < oakTwigs / 3);
  measure('forks between an oak bole and a twig', branchOrders(OAK, OLD_OAK, GOOD));
  assert('which is a dozen or so orders of branching',
    branchOrders(OAK, OLD_OAK, GOOD) > 8 && branchOrders(OAK, OLD_OAK, GOOD) < 18);

  // A young tree has fewer, because it has less trunk to supply them from --
  // and that is the rule working rather than a rule about young trees.
  assert('a sapling carries fewer twigs than a standard',
    twigCount(OAK, 20, GOOD) < oakTwigs);

  // HEIGHT, and the reason it is here at all: it is what divides the volume.
  measure('oak height at 150 years, m', heightM(OAK, OLD_OAK, GOOD));
  measure('hazel height at its cut, m', heightM(HAZEL, CUT_HAZEL, GOOD));
  measure('wheat height in the ear, m', heightM(WHEAT, 0.75, GOOD));
  assert('a timber oak is a house tall',
    heightM(OAK, OLD_OAK, GOOD) > 12 && heightM(OAK, OLD_OAK, GOOD) < 21);
  assert('and wheat is waist to shoulder',
    heightM(WHEAT, 0.75, GOOD) > 0.5 && heightM(WHEAT, 0.75, GOOD) < 0.95);

  // DERIVATION 4. A crown's own density, and the season in it.
  const lai = leafAreaIndex(OAK, OLD_OAK, GOOD, MIDSUMMER, W);
  measure('oak leaf area index in June', lai);
  measure('oak crown opacity in June', crownOpacity(OAK, OLD_OAK, GOOD, MIDSUMMER, W));
  measure('oak crown opacity in January', crownOpacity(OAK, OLD_OAK, GOOD, MIDWINTER, W));
  assert('an oak canopy runs about four leaf layers deep', lai > 2.5 && lai < 6);
  assert('and hides most of the ground under it',
    crownOpacity(OAK, OLD_OAK, GOOD, MIDSUMMER, W) > 0.7);
  check('and hides none of it in winter',
    crownOpacity(OAK, OLD_OAK, GOOD, MIDWINTER, W), 0, 0);
  // A wheat field is thinner from above than its leaf area says, because its
  // leaves stand up. This is the only place the two extinction figures differ.
  measure('wheat crown opacity in June', crownOpacity(WHEAT, 0.75, GOOD, MIDSUMMER, W));

  measure('oak crown area at 150 years, m2', crownAreaM2(OAK, OLD_OAK, GOOD));

  // POOR GROUND makes a thinner tree as well as a smaller one, and neither was
  // told to: the mass falls, so the volume falls, so the diameter falls.
  const poorStem = stemDiameterM(OAK, OLD_OAK, 0.4);
  measure('oak bole on poor ground, m', poorStem);
  // GEOMETRIC SIMILARITY, and it is checked three ways because the first way
  // was mute. Every linear dimension scales as the cube root of the mass, so
  // whatever the mass ratio turns out to be, the trunk, the height and the
  // spread must all be its cube root and must all agree with each other.
  //
  // The first version asked only whether the stunted trunk came to 0.74 of the
  // thriving one -- the cube root of the site ratio -- and got 0.58. That is
  // not the rule failing: at 150 years the poor tree is at a fifth of the good
  // tree's mass, not two fifths, because a poor site slows growth as well as
  // capping it. Reading a saturated ratio off an unsaturated pair is the same
  // mistake the mass ceiling check made, in a different file.
  const massRatio = massAt(OAK, OLD_OAK, 0.4) / massAt(OAK, OLD_OAK, GOOD);
  const heightRatio = heightM(OAK, OLD_OAK, 0.4) / heightM(OAK, OLD_OAK, GOOD);
  measure('a stunted oak, mass ratio at 150 years', massRatio);
  measure('its trunk ratio', poorStem / oakStem);
  measure('its height ratio', heightRatio);
  check('every dimension of a stunted oak is the cube root of its mass',
    poorStem / oakStem, Math.cbrt(massRatio), 0.001);
  check('and the trunk and the height agree exactly',
    poorStem / oakStem, heightRatio, 1e-9);
  // At saturation, where the pace has finished mattering, it is the site ratio.
  check('and given long enough it is the cube root of the site itself',
    stemDiameterM(OAK, 4000, 0.4) / stemDiameterM(OAK, 4000, GOOD),
    Math.cbrt(0.4), 0.005);
});

suite('the picture', () => {
  // A form is a ground plan in metres, and what is in it is decided by the
  // week. These are the checks that the picture and the plant agree.
  const summerOak = formOf(OAK, {
    ageYears: OLD_OAK, site: GOOD, week: MIDSUMMER, weeksPerYear: W, seed: 1, detail: 5,
  });
  const winterOak = formOf(OAK, {
    ageYears: OLD_OAK, site: GOOD, week: MIDWINTER, weeksPerYear: W, seed: 1, detail: 5,
  });
  measure('strokes in a drawn oak', summerOak.strokes.length);
  measure('blobs in a summer oak', summerOak.blobs.length);
  measure('blobs in a winter oak', winterOak.blobs.length);
  assert('a winter oak is branches and no leaves',
    winterOak.blobs.every((b) => b.part !== Part.Leaf)
    && summerOak.blobs.some((b) => b.part === Part.Leaf));
  assert('and it still has all its branches',
    winterOak.strokes.length === summerOak.strokes.length);
  assert('the drawn tree reaches its own spread',
    Math.max(...summerOak.strokes.map((s) => Math.hypot(s.x1, s.y1)))
      <= summerOak.spreadM / 2 * 1.001);
  assert('and most of the way there',
    Math.max(...summerOak.strokes.map((s) => Math.hypot(s.x1, s.y1)))
      > summerOak.spreadM / 2 * 0.6);

  // DETERMINISM. The same seed is the same tree, on every machine, forever.
  const again = formOf(OAK, {
    ageYears: OLD_OAK, site: GOOD, week: MIDSUMMER, weeksPerYear: W, seed: 1, detail: 5,
  });
  assert('the same seed draws the same tree',
    JSON.stringify(again.strokes) === JSON.stringify(summerOak.strokes));
  const other = formOf(OAK, {
    ageYears: OLD_OAK, site: GOOD, week: MIDSUMMER, weeksPerYear: W, seed: 2, detail: 5,
  });
  assert('and a different seed a different one',
    JSON.stringify(other.strokes) !== JSON.stringify(summerOak.strokes));

  // THE CROP IS CONSERVED ACROSS DETAIL. Draw the same tree coarse and fine and
  // the acorns on it weigh the same, because the blobs are shares of one crop
  // rather than a count somebody chose. This is what lets the map draw a wood
  // at four levels of zoom without the harvest changing.
  const autumnCoarse = formOf(OAK, {
    ageYears: OLD_OAK, site: GOOD, week: 42, weeksPerYear: W, seed: 3, detail: 3,
  });
  const autumnFine = formOf(OAK, {
    ageYears: OLD_OAK, site: GOOD, week: 42, weeksPerYear: W, seed: 3, detail: 6,
  });
  const acornVolume = (f: typeof autumnCoarse): number => f.blobs
    .filter((b) => b.part === Part.Seed)
    .reduce((a, b) => a + (4 / 3) * Math.PI * b.radiusM ** 3, 0);
  measure('acorn volume drawn at detail 3, m3', acornVolume(autumnCoarse));
  measure('acorn volume drawn at detail 6, m3', acornVolume(autumnFine));
  check('the same crop however coarsely it is drawn',
    acornVolume(autumnFine) / Math.max(1e-12, acornVolume(autumnCoarse)), 1, 0.02);
  assert('though the fine one is drawn with far more of them',
    autumnFine.blobs.length > autumnCoarse.blobs.length * 4);

  // GRAIN AND CHAFF ARE SEPARATE OBJECTS IN THE PICTURE, which is what makes
  // threshing something you can draw rather than a state flag.
  const ripeWheat = formOf(WHEAT, {
    ageYears: 0.75, site: GOOD, week: 30, weeksPerYear: W, seed: 4, detail: 4,
  });
  const greenWheat = formOf(WHEAT, {
    ageYears: 0.5, site: GOOD, week: 20, weeksPerYear: W, seed: 4, detail: 4,
  });
  assert('ripe wheat carries grain and husk',
    ripeWheat.blobs.some((b) => b.part === Part.Seed)
    && ripeWheat.blobs.some((b) => b.part === Part.Husk));
  assert('and green wheat carries neither',
    !greenWheat.blobs.some((b) => b.part === Part.Seed || b.part === Part.Husk));
  measure('grain blob radius, m',
    ripeWheat.blobs.find((b) => b.part === Part.Seed)!.radiusM);

  // WHAT YOU CANNOT SEE. A carrot's whole crop is one buried blob, and the
  // check is that it comes out the size of a carrot -- which nothing told it.
  const carrot = formOf(CARROT, {
    ageYears: 0.6, site: GOOD, week: 36, weeksPerYear: W, seed: 5, detail: 3,
  });
  const root = carrot.blobs.find((b) => b.part === Part.Storage)!;
  // As an equivalent sphere: a real carrot is a cone, so the same volume reads
  // wider here than a tape would across the shoulder. The volume is the claim.
  measure('the carrot itself, m across as a sphere of its volume', root.radiusM * 2);
  assert('a carrot is a few centimetres of root',
    root.radiusM * 2 > 0.02 && root.radiusM * 2 < 0.09);
  assert('and it is buried', root.buried);
  assert('nothing above ground is', carrot.blobs
    .filter((b) => !isBuried(b.part)).every((b) => !b.buried));
  assert('while the top is all leaf',
    carrot.blobs.some((b) => b.part === Part.Leaf && !b.buried));

  // A BRAMBLE IS CANES AND FRUIT, and its crop is not buried at all -- the
  // opposite case to the carrot, checked so neither can quietly become the
  // other.
  const bramble = formOf(BRAMBLE, {
    ageYears: 8, site: GOOD, week: 36, weeksPerYear: W, seed: 6, detail: 4,
  });
  measure('canes drawn on a bramble', bramble.strokes.length);
  assert('a bramble in September is in fruit',
    bramble.blobs.some((b) => b.part === Part.Fruit && !b.buried));
  assert('and in June it is in flower, not fruit', (() => {
    const june = formOf(BRAMBLE, {
      ageYears: 8, site: GOOD, week: 26, weeksPerYear: W, seed: 6, detail: 4,
    });
    return june.blobs.some((b) => b.part === Part.Flower)
      && !june.blobs.some((b) => b.part === Part.Fruit);
  })());

  // AUTUMN. The same leaf blobs, a different colour, from senescence alone.
  const june = formOf(OAK, {
    ageYears: OLD_OAK, site: GOOD, week: 20, weeksPerYear: W, seed: 7, detail: 4,
  });
  const october = formOf(OAK, {
    ageYears: OLD_OAK, site: GOOD, week: 43, weeksPerYear: W, seed: 7, detail: 4,
  });
  const junLeaf = june.blobs.find((b) => b.part === Part.Leaf)!.rgb;
  const octLeaf = october.blobs.find((b) => b.part === Part.Leaf)!.rgb;
  measure('oak leaf in June, red', junLeaf[0]);
  measure('oak leaf in October, red', octLeaf[0]);
  assert('the leaves turn without anything drawing a second tree',
    octLeaf[0] > junLeaf[0] + 30);

  // EVERY SPECIES DRAWS. The cheapest check in the file and the one most likely
  // to catch the next species somebody adds.
  let empty = 0;
  for (const s of SPECIES) {
    const f = formOf(s, {
      ageYears: s.lifespanYears * 0.5, site: GOOD, week: 30, weeksPerYear: W,
      seed: 11, detail: 4,
    });
    measure(`${s.name}: strokes`, f.strokes.length);
    measure(`${s.name}: blobs`, f.blobs.length);
    measure(`${s.name}: stem diameter, m`, f.stemDiameterM);
    if (f.strokes.length === 0 || f.blobs.length === 0) empty++;
  }
  check('every species has a picture', empty, 0, 0);

  // Habits are what decide which parts carry the load, so a species with the
  // wrong one solves the wrong stem. Cheap to state, and it caught the bramble.
  assert('the habits are what they should be',
    OAK.habit === Habit.Tree && HAZEL.habit === Habit.Shrub
    && BRAMBLE.habit === Habit.Climber && WHEAT.habit === Habit.Grass
    && CARROT.habit === Habit.Herb);
});
