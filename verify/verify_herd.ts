// Cattle on the ground, and the ground says how many.
//
// The picture and the model have to agree here as they do for the trees, and
// the check is the same in shape: count the beasts drawn on a hectare and they
// must be the beasts pasture.ts says that hectare carries. What is different is
// that the number goes through a herd's age structure first, because a herd is
// not a set of mature cows -- most of it is young, and the mean beast is well
// under a livestock unit.

import {
  herdOn, beastsPerHa, meanHerdAgeYears, meanHerdMassKg, type Pasture,
} from '../sim/model/herd.ts';
import { CATTLE } from '../sim/model/cattle.ts';
import { massAtAge } from '../sim/model/animal.ts';
import { buildOf, beastOf } from '../sim/model/beastform.ts';
import { stockingUnitsPerHa } from '../sim/model/pasture.ts';
import { Biome } from '../sim/model/biome.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

const EARTH_R = 6371000;
const HA_SIDE = 100;
const MEADOW_NPP = 700;

function ground(dirX: number, dirY: number, dirZ: number, spacingM: number): Pasture {
  return {
    biome: Biome.TemperateGrassland, nppGm2: MEADOW_NPP,
    dirX, dirY, dirZ, radiusM: EARTH_R, spacingM,
  };
}

suite('a herd', () => {
  // THE AGE STRUCTURE IS DERIVED FROM REPLACEMENT. Half a herd is female, three
  // fifths of those breed, a cow has one calf a year -- so 0.3 births a head a
  // year, and a stationary population's mean age is the inverse of that.
  measure('mean age of a self-replacing herd, years', meanHerdAgeYears(CATTLE));
  check('a herd averages about three years old', meanHerdAgeYears(CATTLE), 3.33, 0.2);
  measure('mean live weight of such a herd, kg', meanHerdMassKg(CATTLE));
  measure('against a mature cow, kg', CATTLE.matureMassKg);
  assert('most of a herd is young, so the mean beast is well under a cow',
    meanHerdMassKg(CATTLE) < CATTLE.matureMassKg * 0.95);
  assert('and well over a calf', meanHerdMassKg(CATTLE) > CATTLE.birthMassKg * 4);

  // BEASTS A HECTARE, from the units the pasture model already derives.
  const units = stockingUnitsPerHa(Biome.TemperateGrassland, MEADOW_NPP);
  const beasts = beastsPerHa(CATTLE, Biome.TemperateGrassland, MEADOW_NPP);
  measure('livestock units a hectare of meadow carries', units);
  measure('which is this many actual beasts', beasts);
  // A livestock unit is 500 kg by definition and the mean beast is lighter, so
  // there are always MORE animals than units -- which is the whole reason the
  // unit exists and the thing a count of animals would get wrong.
  assert('there are more beasts than units, the unit being a big abstraction',
    beasts > units);
  check('and the two agree through the mean beast exactly',
    (units * A.LIVESTOCK_UNIT_KG) / meanHerdMassKg(CATTLE), beasts, 1e-9);
  assert('a good meadow carries a couple of beasts a hectare',
    beasts > 0.5 && beasts < 6);

  // THE PICTURE AGREES WITH THE MODEL, counted over a hundred hectares.
  let total = 0;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const a = 0.21 + i * 0.0033;
    const b = 0.39 + i * 0.0019;
    const c = Math.sqrt(Math.max(1e-9, 1 - a * a - b * b));
    total += herdOn(ground(a, b, c, HA_SIDE), CATTLE, 256).beasts.length;
  }
  measure('beasts drawn over a hundred hectares', total);
  measure('which is this many a hectare', total / N);
  check('the herd you can count is the herd the pasture carries',
    total / N / beasts, 1, 0.12);

  // A FRACTION OF A BEAST IS A FRACTION OF THE PATCHES. At the lattice's own
  // spacing a patch holds a twentieth of a cow.
  const patch = 18;
  const perPatch = (beasts * patch * patch) / 10000;
  measure('beasts on an 18 m patch', perPatch);
  assert('which is well under one', perPatch < 0.5 && perPatch > 0);
  let withOne = 0;
  // FOUR THOUSAND, not four hundred. At a probability of a fortieth, four
  // hundred trials have a standard deviation of three quarters of a per cent on
  // an expected eleven -- so a perfectly correct model reads anywhere from 0.75
  // to 1.25 of the truth, and the first run of this read 1.39 and looked like a
  // fault. The sample has to be large enough to see what is being asked about.
  const TRIES = 4000;
  for (let i = 0; i < TRIES; i++) {
    const a = 0.13 + i * 0.00017;
    const b = 0.41 + i * 0.00011;
    const c = Math.sqrt(Math.max(1e-9, 1 - a * a - b * b));
    if (herdOn(ground(a, b, c, patch), CATTLE, 8).beasts.length > 0) withOne++;
  }
  measure('share of patches with a beast on them', withOne / TRIES);
  check('a fraction of a beast is that fraction of the patches',
    withOne / TRIES / perPatch, 1, 0.25);

  // NOTHING GRAZES THE SEA OR THE ICE.
  check('no cattle on the ocean',
    herdOn({ ...ground(0.3, 0.4, 0.866, HA_SIDE), biome: Biome.Ocean, nppGm2: 0 }).beasts.length,
    0, 0);
  const desert = herdOn({
    ...ground(0.3, 0.4, 0.866, HA_SIDE), biome: Biome.Desert, nppGm2: 60,
  }, CATTLE, 256);
  measure('beasts a hectare of desert carries', desert.beastsPerHa);
  assert('a desert carries far fewer than a meadow', desert.beastsPerHa < beasts / 4);

  // DETERMINISM.
  const g = ground(0.3, 0.5, Math.sqrt(1 - 0.09 - 0.25), HA_SIDE);
  const one = herdOn(g, CATTLE, 256);
  const two = herdOn(g, CATTLE, 256);
  assert('the same ground grazes the same herd',
    JSON.stringify(one.beasts.map((x) => [x.x, x.y, x.ageYears]))
      === JSON.stringify(two.beasts.map((x) => [x.x, x.y, x.ageYears])));
});

suite('the shape of a beast', () => {
  // ONE FORMULA, AND THE ANIMALS ARE FOUR ORDERS OF MAGNITUDE APART. Flesh is
  // water, so a body's volume is its mass in litres and there is no density to
  // look up: everything below is that volume and three measured proportions.
  const cow = buildOf(450);
  const calf = buildOf(40);
  const hen = buildOf(2);
  measure('a 450 kg cow: trunk length, m', cow.trunkLengthM);
  measure('trunk width, m', cow.trunkWidthM);
  measure('trunk depth, m', cow.trunkDepthM);
  measure('leg, m', cow.legLengthM);
  measure('height at the shoulder, m', cow.shoulderHeightM);
  measure('nose to rump, m', cow.overallLengthM);
  assert('a cow is about a metre and a half in the body',
    cow.trunkLengthM > 1.3 && cow.trunkLengthM < 1.9);
  assert('and about two thirds of a metre across',
    cow.trunkWidthM > 0.55 && cow.trunkWidthM < 0.8);
  assert('and stands about waist to chest high on a person',
    cow.shoulderHeightM > 1.1 && cow.shoulderHeightM < 1.6);

  measure('a 40 kg calf: trunk length, m', calf.trunkLengthM);
  measure('and a 2 kg hen', hen.trunkLengthM);
  measure('the hen leg, m', hen.legLengthM);
  assert('a hen is a quarter of a metre in the body',
    hen.trunkLengthM > 0.18 && hen.trunkLengthM < 0.35);
  assert('with a leg of about fifteen centimetres',
    hen.legLengthM > 0.12 && hen.legLengthM < 0.22);
  // The mass ratio is 225 and the length ratio is its cube root, because a body
  // is a volume. Nothing states that; it is what dividing by a density does.
  measure('cow over hen, by body length', cow.trunkLengthM / hen.trunkLengthM);
  check('length goes as the cube root of mass',
    cow.trunkLengthM / hen.trunkLengthM, Math.cbrt(225), 0.01);

  // A BEAST IS DRAWN OUT OF THE SAME PIECES AS A TREE, so one renderer draws
  // both -- strokes for the legs, the neck, the tail and the horns, and blobs
  // down the spine for the body.
  const drawn = beastOf(CATTLE, 5, 12345);
  measure('strokes in a drawn cow', drawn.strokes.length);
  measure('blobs in a drawn cow', drawn.blobs.length);
  assert('four legs, a tail, a neck and two horns',
    drawn.strokes.length === 8);
  assert('and a body of discs plus a head', drawn.blobs.length === 6);
  const reach = Math.max(...drawn.blobs.map((b) => Math.hypot(b.x, b.y) + b.radiusM));
  measure('how far the drawing reaches, m', reach);
  assert('which is within what the build says it is',
    reach <= drawn.build.overallLengthM);

  // A calf is a smaller cow and not a differently shaped thing, which is true
  // enough of a calf and would not be of a caterpillar.
  const young = beastOf(CATTLE, 0.2, 12345);
  measure('a calf at ten weeks: nose to rump, m', young.build.overallLengthM);
  assert('a calf is drawn smaller than its mother',
    young.build.overallLengthM < drawn.build.overallLengthM);
  assert('and is the same set of pieces',
    young.strokes.length === drawn.strokes.length
    && young.blobs.length === drawn.blobs.length);

  // Determinism, and variety between individuals.
  const again = beastOf(CATTLE, 5, 12345);
  const other = beastOf(CATTLE, 5, 999);
  assert('the same seed draws the same beast',
    JSON.stringify(again.strokes) === JSON.stringify(drawn.strokes));
  assert('and a different seed a different one',
    JSON.stringify(other.strokes) !== JSON.stringify(drawn.strokes));

  // The build is the mass, so a beast that has grown is drawn bigger without
  // anything being told it has grown.
  measure('mass at ten weeks, kg', massAtAge(CATTLE, 0.2));
  measure('and at five years', massAtAge(CATTLE, 5));
  check('the drawing follows the growth curve by the cube root',
    drawn.build.trunkLengthM / young.build.trunkLengthM,
    Math.cbrt(massAtAge(CATTLE, 5) / massAtAge(CATTLE, 0.2)), 0.01);
});
