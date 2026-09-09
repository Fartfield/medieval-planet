// The crafts, checked against the trades they were.
//
// Tanning and hewing are the first two making-verbs, and each is one rule
// reading the material model. The checks below are the tradesman's own
// numbers: a hide takes about its own weight in oak bark; sole leather lay in
// the pit a year; a hewn beam keeps six tenths of its log; an oak floor beam
// carries a loaded wagon at breaking and a fifth of one in use.
//
// THE CHECK THAT MATTERS is the leather's half-life, because nobody told the
// rot model about leather. Its constants were solved from timber durability
// and leaf litter; the tannin that tanning binds into the hide is simply IN
// the composition it reads; and if the craft was worth a year of a pit's
// time, the model has to say so on its own.

import { tan, hew, beamBreaksAtKg, beamCarriesKg, frameTimberKg, timberDensityKgM3, TANNING_DAYS, HEWN_YIELD } from '../sim/model/craft.ts';
import { slaughter } from '../sim/model/animal.ts';
import { CATTLE } from '../sim/model/cattle.ts';
import { harvest, compositionOf, halfLifeYears, burn } from '../sim/model/process.ts';
import { stemDiameterM } from '../sim/model/form.ts';
import { OAK } from '../sim/model/species.ts';
import { Part } from '../sim/model/plant.ts';
import { WEEKS_PER_YEAR } from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;

suite('the tannery and the saw pit', () => {
  // THE HIDE AND THE BARK, from the models that already make them: the hide
  // off a slaughtered beast, the bark off a harvested oak.
  const hide = slaughter(CATTLE, 450).find((p) => p.what === 'hide')!;
  const bark = harvest(OAK, 120, 1, 30, W, 4).find((p) => p.part === Part.Bark)!;
  measure('one ox hide, kg', hide.massKg);
  measure('bark off four oaks, kg', bark.massKg);

  const pit = tan(hide, bark);
  assert('the pit had bark enough', !pit.short && pit.leather !== null);
  const leather = pit.leather!;
  measure('bark the hide took, kg', pit.barkUsedKg);
  // The tanner's rule of thumb: a hide takes about its own weight in bark.
  // Nothing was told this; it is the hide's protein wanting its measured share
  // of tannin, through the bark's measured tannin fraction.
  check('a hide takes about its own weight in bark',
    pit.barkUsedKg / hide.massKg, 1.0, 0.4);
  measure('leather from the hide, kg', leather.massKg);
  assert('leather weighs less than the hide, the water being gone',
    leather.massKg < hide.massKg * 0.8);
  measure('the pit stands this many days', TANNING_DAYS);

  // THE POINT OF THE WHOLE CRAFT, found by a model that has never heard of it.
  const rawHalf = halfLifeYears(hide, 15, 0.6);
  const tannedHalf = halfLifeYears(leather, 15, 0.6);
  measure('a raw hide in damp air: half-life, days', rawHalf * 365);
  measure('tanned leather: half-life, years', tannedHalf);
  measure('tanning multiplied its life by', tannedHalf / rawHalf);
  assert('a raw hide rots in days', rawHalf * 365 < 30);
  assert('and leather lasts years', tannedHalf > 3);
  assert('a hundredfold and more, which is what the year in the pit buys',
    tannedHalf / rawHalf > 100);

  // THE BEAM. A 150-year oak's bole, hewn square.
  const bole = harvest(OAK, 150, 1, 30, W, 1)
    .filter((p) => p.part === Part.Heartwood || p.part === Part.Sapwood)
    .reduce((a, p) => ({ ...p, massKg: a.massKg + p.massKg }));
  const d = stemDiameterM(OAK, 150, 1);
  measure('the bole, kg', bole.massKg);
  measure('and its diameter, m', d);
  const beam = hew(bole, d, 6);
  measure('the beam, kg', beam.beam.massKg);
  measure('offcut for the woodshed, kg', beam.offcutKg);
  check('hewing keeps six tenths', beam.beam.massKg / bole.massKg, HEWN_YIELD, 0);
  measure('the beam section, m', beam.sectionM);
  assert('a bole a half-metre through squares to a third of a metre',
    beam.sectionM > 0.3 && beam.sectionM < 0.4);

  // What it carries: a six-metre floor beam of oak.
  measure('the beam breaks at mid-span under, tonnes', beamBreaksAtKg(beam) / 1000);
  measure('and is trusted with, tonnes', beamCarriesKg(beam) / 1000);
  assert('a great oak beam breaks under tens of tonnes',
    beamBreaksAtKg(beam) > 20000 && beamBreaksAtKg(beam) < 120000);
  assert('and carries a loaded wagon in service',
    beamCarriesKg(beam) > 2000);

  // The offcut burns, because the woodshed is where offcuts go, and nothing
  // about being an offcut changed the wood.
  const scraps = { ...bole, massKg: beam.offcutKg };
  assert('the offcut is fuel', burn(scraps, 1).lit);

  // THE HOUSE BILL. A cottage's frame, in the wood the timber model prices.
  const rho = timberDensityKgM3(bole);
  measure('the beam wood weighs, kg/m3', rho);
  const cottage = frameTimberKg(30, rho);
  measure('a thirty-square-metre cottage frame, kg of oak', cottage);
  measure('which is this many 150-year boles', cottage / beam.beam.massKg);
  // A cruck cottage took a good oak or two for its frame -- the offcuts and
  // the smallwood of the same trees did the rest of the house.
  assert('a cottage is a tree or two, not a forest',
    cottage / beam.beam.massKg > 0.5 && cottage / beam.beam.massKg < 4);
});
