// The people as hearths, checked against the demographic record.
//
// This suite replaces the blob's single growth rate with a life table, so the
// checks are the shape of the record: a third of children dead by fifteen, an
// adult plateau, a crude birth rate in the high thirties, and -- the whole
// reason for the change -- a famine that echoes for a generation, because it
// thins a cohort of children who are missing as hands fifteen years later.
//
// THE STABLE PYRAMID is the anchor: run the rates alone and they settle into
// an age structure, and that structure has to look like a pre-industrial
// village -- broad-based, a third children, a slim crown of elders -- or the
// rates are wrong. It is a fixed point nobody chose, found by iteration.

import {
  synthesiseHearths, hearthsWeek, stableShares, populationOf, effectiveHands,
  drawPeople, addPeople, settleHearths,
  CHILD_MORTALITY, HAND_MORTALITY, ELDER_MORTALITY, BIRTHS_PER_HAND_YEAR,
  CHILD_HANDS, ELDER_HANDS, labourFactor, marriageFactor, rehouse, type Hearth,
} from '../sim/model/hearths.ts';
import { WEEKS_PER_YEAR } from '../sim/model/season.ts';
import { check, measure, assert, suite } from './harness.ts';

const W = WEEKS_PER_YEAR;

suite('the hearths', () => {
  // THE STABLE PYRAMID. The rates' own fixed point, found not chosen.
  const stable = stableShares();
  measure('stable share: children', stable.c);
  measure('stable share: hands', stable.h);
  measure('stable share: elders', stable.e);
  check('the three shares are a whole village', stable.c + stable.h + stable.e, 1, 1e-9);
  assert('a third or so are children, as a growing village is',
    stable.c > 0.25 && stable.c < 0.42);
  assert('half or more are working hands', stable.h > 0.48 && stable.h < 0.65);
  assert('and the elders are a slim crown', stable.e > 0.03 && stable.e < 0.15);

  // A SETTLEMENT SYNTHESISED FROM A COUNT stands in that pyramid, five to a
  // hearth, and adds up to what it was given.
  const village = synthesiseHearths(154);
  measure('hearths for a hundred and fifty-four', village.length);
  check('five souls a hearth', village.length, Math.round(154 / 5), 0);
  check('and the souls add up', populationOf(village), 154, 1);
  // A founding is younger: more children, almost no elders.
  const young = synthesiseHearths(20, true);
  const yc = young.reduce((a, x) => a + x.c, 0) / populationOf(young);
  const ye = young.reduce((a, x) => a + x.e, 0) / populationOf(young);
  measure('a founding party: child share', yc);
  measure('and elder share', ye);
  assert('settlers are young families, not a cross-section',
    yc > stable.c && ye < stable.e);

  // THE MORTALITY IS THE RECORD'S. A third of children gone by fifteen.
  measure('yearly child mortality', CHILD_MORTALITY);
  const survToFifteen = Math.pow(1 - CHILD_MORTALITY, 15);
  measure('share of the born who reach fifteen', survToFifteen);
  assert('about two thirds of children live to be hands',
    survToFifteen > 0.55 && survToFifteen < 0.72);
  assert('a hand is far safer than a child',
    HAND_MORTALITY < CHILD_MORTALITY / 2);
  assert('and an elder far frailer', ELDER_MORTALITY > HAND_MORTALITY * 4);

  // THE CRUDE RATES that emerge, against the parish registers' high thirties
  // per thousand.
  const v = synthesiseHearths(500);
  const wk = hearthsWeek(v, 1, 0);
  const crudeBirth = (wk.born * W) / populationOf(v) * 1000;
  const crudeDeath = (wk.died * W) / populationOf(v) * 1000;
  measure('crude birth rate, per thousand a year', crudeBirth);
  measure('crude death rate, per thousand a year', crudeDeath);
  assert('births in the thirties to forties per thousand',
    crudeBirth > 30 && crudeBirth < 45);
  assert('deaths a little below births, a slowly growing people',
    crudeDeath > 25 && crudeDeath < crudeBirth);

  // CHILDREN AND ELDERS WORK, which is why a village was never only its
  // adults -- and the effective hands sit between the adult count and the
  // whole population.
  measure('effective hands in the village of 154', effectiveHands(village));
  const hands = village.reduce((a, x) => a + x.h, 0);
  assert('the young and the old add real work to the adult hands',
    effectiveHands(village) > hands && effectiveHands(village) < populationOf(village));
  assert('a child is worth a fraction of a hand', CHILD_HANDS > 0 && CHILD_HANDS < 0.4);
  assert('and an elder a little more', ELDER_HANDS > CHILD_HANDS && ELDER_HANDS < 0.5);

  // GROWTH, run for real: an unstressed village grows, slowly, the way a
  // pre-industrial people did -- not the way rabbits do.
  let grow = synthesiseHearths(100);
  for (let t = 0; t < Math.round(25 * W); t++) grow = hearthsWeek(grow, 1, 0).hearths;
  measure('a hundred people after twenty-five years, unstressed', populationOf(grow));
  assert('a healthy village grows but does not explode',
    populationOf(grow) > 105 && populationOf(grow) < 200);

  // THE GENERATIONAL ECHO -- the whole reason for the change. A single hard
  // year thins the children; a decade and a half later the working hands are
  // fewer than an unscarred village would have, though the famine is long
  // over and nobody now alive went hungry.
  const control = synthesiseHearths(200);
  const scarred = synthesiseHearths(200);
  // ONE HARD YEAR, survivable but real: fifteen per cent excess mortality
  // spread across the year -- a bad harvest, not the apocalypse -- and
  // conceptions halved while it lasts. The first version applied that fifteen
  // per cent EVERY WEEK and annihilated the village, so the echo assertion
  // passed against a graveyard: a vacuous pass the measurement caught, since
  // "scarred hands < control hands" is trivially true of a dead village.
  let ctrl = control;
  let scar = scarred;
  const faminePop = populationOf(scarred);
  const weeklyToll = (faminePop * 0.15) / W;
  for (let t = 0; t < Math.round(1 * W); t++) {
    ctrl = hearthsWeek(ctrl, 1, 0).hearths;
    scar = hearthsWeek(scar, 0.5, weeklyToll).hearths;
  }
  measure('the scarred village survives the year', populationOf(scar));
  assert('a hard year is survived, not an extinction',
    populationOf(scar) > faminePop * 0.7);
  const childrenLostShare =
    (control.reduce((a, x) => a + x.c, 0) - scar.reduce((a, x) => a + x.c, 0));
  measure('children the famine took', childrenLostShare);
  assert('the famine fell on the children', childrenLostShare > 0);
  // Now fifteen years of peace for both.
  for (let t = 0; t < Math.round(15 * W); t++) {
    ctrl = hearthsWeek(ctrl, 1, 0).hearths;
    scar = hearthsWeek(scar, 1, 0).hearths;
  }
  const ctrlHands = ctrl.reduce((a, x) => a + x.h, 0);
  const scarHands = scar.reduce((a, x) => a + x.h, 0);
  measure('the unscarred village\'s hands, fifteen years on', ctrlHands);
  measure('the scarred village\'s hands, fifteen years on', scarHands);
  measure('the shortfall the old famine still costs the fields',
    ctrlHands - scarHands);
  assert('the famine is felt in the fields a generation later, but not fatally',
    scarHands < ctrlHands * 0.97 && scarHands > ctrlHands * 0.5);

  // MOVEMENT preserves people. Draw a founding party out, add migrants in.
  const before = populationOf(village);
  const drawn = drawPeople(village, 30);
  measure('a founding party drawn out', drawn.taken);
  check('the party is the size asked', drawn.taken, 30, 0.001);
  check('and what remains is the rest',
    populationOf(drawn.hearths) + drawn.taken, before, 0.01);
  const grown2 = addPeople(village, 20);
  check('migrants arrive whole', populationOf(grown2), before + 20, 0.01);

  // The delta round-trip drops nothing meaningful and prunes the dead.
  const settled = settleHearths(village);
  check('rounding for the delta keeps the village',
    populationOf(settled), before, 1);
  assert('and a dead hearth is pruned',
    settleHearths([{ c: 0, h: 0, e: 0 }]).length === 0);

  // THE LABOUR FACTOR is one for a settled village by construction -- which is
  // what keeps every calibrated holding-size and specialisation figure intact
  // -- and above one for a founding of young families, who are selected
  // working-age and so work more land per head than a cross-section would.
  measure('labour factor of a settled village', labourFactor(village));
  check('a settled village labours at exactly the calibrated rate',
    labourFactor(village), 1, 0.02);
  const founding = synthesiseHearths(20, true);
  measure('labour factor of a fresh founding', labourFactor(founding));
  assert('a young founding is labour-rich per head',
    labourFactor(founding) > 1.02);
  // The famine's echo is in the ABSOLUTE hands (103 against 122, above), not
  // reliably in the per-head factor: fifteen years on the scarred village has
  // rebuilt a near-normal pyramid around its smaller numbers, so its labour
  // RATE per head recovers even while its COUNT of hands stays short. The
  // count is the honest measure of the echo, and it is the one asserted.

  // THE MARRIAGE CHECK. Land with room to spare lets everyone marry; a full
  // land holds the factor down, and with it the births.
  measure('marriage factor with land for twice the hearths',
    marriageFactor(60, 30));
  measure('and with land already full', marriageFactor(30, 30));
  measure('and with land badly overfull', marriageFactor(15, 30));
  check('room to spare means marriage is free', marriageFactor(60, 30), 1, 0);
  assert('a full land begins to bite', marriageFactor(30, 30) <= 1
    && marriageFactor(28, 30) < 1);
  assert('an overfull land bites hard but never to nothing',
    marriageFactor(15, 30) < 0.6 && marriageFactor(15, 30) >= 0.15);

  // HOUSEHOLDS FORM WHERE THE LAND HAS ROOM. A crowded village given land for
  // more hearths grows its count of them toward the ceiling.
  const crowded = synthesiseHearths(50);
  const roomy = rehouse(crowded, crowded.length + 5);
  measure('hearths before, given land for more', crowded.length);
  measure('and after a week of it', roomy.length);
  assert('new couples split off when there is a holding for them',
    roomy.length > crowded.length);
  check('and nobody is lost in the forming',
    populationOf(roomy), populationOf(crowded), 0.01);

  // THE HANDS-LESS ARE TAKEN IN -- inheritance at the bucket's grain: a hearth
  // worn down to orphans and elders is absorbed, its people carried over.
  const withWidow: Hearth[] = [
    { c: 1, h: 2, e: 0 }, { c: 1, h: 2, e: 0 }, { c: 1, h: 0, e: 1 },
  ];
  const merged = rehouse(withWidow, 2);
  measure('hearths after the widowed one is taken in', merged.length);
  assert('a hearth with no hands does not stand alone',
    merged.length < withWidow.length);
  check('and the orphans and elders are kept, not lost',
    populationOf(merged), populationOf(withWidow), 0.01);

  // THE PREVENTIVE CHECK, END TO END. A village pressed against its land holds
  // its numbers down through FEWER BIRTHS, not more deaths -- which is the
  // whole difference between Malthus's two checks, and the reason medieval
  // Europe was not a bare sawtooth of famines.
  const roomyVillage = synthesiseHearths(100);
  const pressedVillage = synthesiseHearths(100);
  const roomyBirths = hearthsWeek(roomyVillage, 1, 0,
    marriageFactor(40, roomyVillage.length)).born;
  const pressedBirths = hearthsWeek(pressedVillage, 1, 0,
    marriageFactor(pressedVillage.length, pressedVillage.length * 1.5)).born;
  measure('weekly births with land to spare', roomyBirths);
  measure('and with the land full', pressedBirths);
  assert('a full land is checked at the cradle, not the grave',
    pressedBirths < roomyBirths * 0.8);
  // And crucially the DEATHS are unchanged -- the check is preventive.
  const roomyDeaths = hearthsWeek(roomyVillage, 1, 0, 1).died;
  const pressedDeaths = hearthsWeek(pressedVillage, 1, 0, 0.5).died;
  check('while the death rate is untouched by land pressure',
    pressedDeaths, roomyDeaths, roomyDeaths * 0.01);

  // DETERMINISM.
  const a = hearthsWeek(synthesiseHearths(300), 1, 0);
  const b = hearthsWeek(synthesiseHearths(300), 1, 0);
  check('the same week lives the same', a.born, b.born, 0);
});
