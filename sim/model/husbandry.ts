// A herd through the year: it eats, gains, breeds, and starves.
//
// Everything before this was a rate or a capacity; this is the loop that runs
// them against each other, week by week, and the thing it exists to produce is
// the WINTER. A temperate pasture grows for thirty weeks and a herd eats for
// fifty-two, and the whole architecture of medieval husbandry -- hay meadows,
// autumn slaughter, the desperate lightness of beasts in April -- is the gap
// between those two numbers. None of it is coded here. The season model says
// when grass grows, the pasture model says how much, the intake model says what
// a beast can get through, and the winter emerges.
//
// CONDITION IS A MASS, not a flag. A starving beast is losing weight, and the
// weight it loses is computed from the energy it is short of at the measured
// cost of body tissue. When it has lost a third of what it should weigh, it is
// dead -- the figure a stockman would give, and the reason a hard winter kills
// the young and the old first: they have the least to lose.
//
// THE STATE IS SMALL ON PURPOSE: head count, mean condition, and a store of
// fodder. A herd is not sixty tracked animals; it is a population with an age
// structure the herd model already derives. What the week loop moves is the
// aggregate, and the aggregate is what the village cares about.

import { dexp, dlog } from '../gen/mathx.ts';
import { type Composition } from './material.ts';
import {
  type Animal, basalKcalPerDay, needKcalPerDay, maxDryIntakeKgPerDay, massAtAge,
} from './animal.ts';
import { digestibleKcalPerKg } from './process.ts';
import { meanHerdAgeYears } from './herd.ts';
import { isGrowing, WEEKS_PER_YEAR } from './season.ts';

/**
 * Energy exchanged per kilogramme of live weight, kcal.
 *
 * Measured, and the first figure here was wrong in an instructive way: 4,400
 * -- the tissue's own calorie content -- said a starving beast loses 4.3% of
 * itself a week, and the measured figure is 1 to 2. Live-weight change does
 * not trade at the carcass's food value. Loss is fat-dominated (9,400 kcal a
 * kilogramme, and mobilised at a cost), and gain in cattle is measured at 25
 * to 35 MJ of feed energy per kilogramme put on. Both ends land near 7,000,
 * which is what a weighing scale actually reads against a feed ledger.
 */
const TISSUE_KCAL_PER_KG = 7000;

/**
 * What a starving beast spends, as a multiple of basal.
 *
 * NOT the pasture maintenance figure, and the difference is most of why the
 * first version starved herds three times too fast. The 1.7x maintenance
 * multiple is an animal walking its grazing; a starving beast stands in the
 * byre and its metabolism is depressed besides -- prolonged underfeeding
 * measurably lowers fasting heat production. What it burns of itself is the
 * gap between this depressed spend and what it is given, not the gap between
 * a working ration and what it is given.
 */
const STARVING_OVER_BASAL = 1.3;

/**
 * How far below its proper weight a beast can fall and live.
 *
 * A third. Condition scoring puts death from starvation at 60 to 70 per cent
 * of healthy weight across cattle, sheep and horses alike -- the margin is the
 * fat and the muscle that can be spent, and it is about the same share of any
 * mammal.
 */
const STARVATION_FRACTION = 0.67;

/**
 * The spread of condition within one herd, as a fraction of proper weight.
 *
 * The old, the young and the poorly sit below the herd's mean, and how far
 * below decides when the first deaths come. Condition scoring puts a normal
 * herd across about one score unit of five -- a spread of a twentieth of body
 * weight either side -- and a starving herd wider.
 */
const CONDITION_SPREAD = 0.045;

/** A herd, as the village counts it. */
export interface HerdState {
  head: number;
  /**
   * Mean weight as a share of what the age structure says it should be, 1 for
   * a herd in full condition. The scale a stockman's eye reads.
   */
  condition: number;
}

/** What one week did to the herd. */
export interface WeekOutcome {
  state: HerdState;
  /** Fresh forage actually eaten, kg. */
  ateKg: number;
  /** Fodder taken from the store, kg dry. */
  fodderKg: number;
  /** Beasts lost to starvation this week. */
  died: number;
  /** Kcal short per head per day, zero when fed. */
  deficit: number;
}

/**
 * One week of a herd on a piece of ground.
 *
 * `forageKg` is the fresh feed standing available this week -- the caller owns
 * the sward and debits it. `fodderKg` is the barn, dry matter; it is drawn on
 * only when grazing falls short, which is what a barn is for.
 *
 * The energy budget is per head at the herd's mean weight, which the age
 * structure gives. Underfed, the herd burns tissue at the measured rate;
 * condition falls; and when a share of the herd crosses the starvation line
 * that share dies -- the aggregate reading of "the weakest die first".
 */
export function herdWeek(
  a: Animal,
  state: HerdState,
  forage: Composition,
  forageKg: number,
  fodder: Composition,
  fodderKg: number,
): WeekOutcome {
  if (state.head <= 0) {
    return { state: { head: 0, condition: 1 }, ateKg: 0, fodderKg: 0, died: 0, deficit: 0 };
  }
  const meanMass = herdMeanMassKg(a) * state.condition;
  const needPerHead = needKcalPerDay(meanMass) * 7;

  // What the pasture offers, capped by what rumens can physically process.
  const forageTotal = Object.values(forage).reduce((x, y) => x + y, 0);
  const forageDryShare = forageTotal > 0 ? 1 - forage.water / forageTotal : 0;
  const maxFreshKg = forageDryShare > 0
    ? (maxDryIntakeKgPerDay(a, meanMass, forage) * 7 * state.head) / forageDryShare
    : 0;
  const ateKg = Math.max(0, Math.min(forageKg, maxFreshKg));
  let got = ateKg * digestibleKcalPerKg(forage, a.digestion);

  // The barn makes up what grazing did not, to appetite's limit.
  let fodderUsed = 0;
  const wanted = needPerHead * state.head;
  if (got < wanted && fodderKg > 0) {
    const maxFodder = maxDryIntakeKgPerDay(a, meanMass, fodder) * 7 * state.head;
    const perKg = digestibleKcalPerKg(fodder, a.digestion);
    if (perKg > 0) {
      fodderUsed = Math.min(fodderKg, maxFodder, (wanted - got) / perKg);
      got += fodderUsed * perKg;
    }
  }

  const deficit = Math.max(0, wanted - got) / state.head / 7;

  // TISSUE IS BURNT AGAINST THE STARVING SPEND, not the full ration. An
  // underfed beast stops walking and turns itself down, so weight is lost only
  // when intake falls below that floor -- fed at nine tenths of the pasture
  // ration, a byre-kept beast holds its weight, which is precisely what made
  // wintering on hay possible at all.
  const starvingNeed = Math.min(
    wanted, basalKcalPerDay(meanMass) * STARVING_OVER_BASAL * 7 * state.head,
  );
  const deficitTotal = Math.max(0, starvingNeed - got);

  // Condition is weight over proper weight, spread across the herd.
  const properMass = herdMeanMassKg(a);
  const lostKgPerHead = deficitTotal / state.head / TISSUE_KCAL_PER_KG;
  let condition = Math.min(1.1, state.condition - lostKgPerHead / properMass);

  // Refeeding: a surplus rebuilds condition at the same exchange rate, capped
  // just above proper weight because a beast fattens and then stops.
  const surplus = Math.max(0, got - wanted);
  if (surplus > 0 && condition < 1.1) {
    condition = Math.min(1.1, condition + surplus / state.head / TISSUE_KCAL_PER_KG / properMass);
  }

  // DEATH IS THE TAIL CROSSING THE LINE. Condition here is the herd's mean, and
  // around any mean there is a spread -- the old, the young, the beast that was
  // poorly already. As the mean falls towards the line the share beneath it
  // grows, and half of that share dies this week.
  let died = 0;
  if (condition < STARVATION_FRACTION + 3 * CONDITION_SPREAD) {
    const gap = condition - STARVATION_FRACTION;
    const shareBelow = gap <= 0 ? 0.5 : 0.5 * dexp(-gap / CONDITION_SPREAD);
    died = Math.min(state.head, state.head * shareBelow * 0.5);
    // The survivors are, by construction, the ones above the line, so culling
    // the tail lifts the mean -- BY THE RIGHT AMOUNT. This was a flat +0.02 a
    // week, and a flat lift is a hidden immortality: a herd starving at 2% a
    // week and lifting 2% a death-week hung at the line for ever, dying at a
    // trickle. Removing the bottom share d of a distribution with spread s
    // lifts the mean by about d.s, which for a trickle is nearly nothing.
    if (died > 0) {
      condition = Math.min(1.1, condition + (died / state.head) * CONDITION_SPREAD * 2);
    }
  }

  return {
    state: { head: Math.max(0, state.head - died), condition },
    ateKg,
    fodderKg: fodderUsed,
    died,
    deficit,
  };
}

/** The proper weight of the mean beast in a self-replacing herd, kg. */
export function herdMeanMassKg(a: Animal): number {
  // The same quantile average herd.ts draws individuals from.
  const mean = meanHerdAgeYears(a);
  let total = 0;
  const Q = 64;
  for (let i = 0; i < Q; i++) {
    const u = (i + 0.5) / Q;
    total += massAtAge(a, Math.min(20, -mean * dlog(1 - u)));
  }
  return total / Q;
}

/**
 * What the sward GROWS this week, kg. Zero in a dead week, by definition.
 *
 * The first version of this handed out a quarter of a growing week's forage
 * every dead week of the winter, for free and for ever -- a number invented on
 * the spot, and it quietly kept a threefold-overstocked herd alive to spring.
 * Winter grazing is real, but it is the STANDING CROP being eaten down, not new
 * growth; the caller carries that stock and this function only ever adds to it.
 */
export function weeklyGrowthKg(
  annualForageKg: number, annualMeanC: number, sinLat: number, week: number,
): number {
  const growing = countGrowingWeeks(annualMeanC, sinLat);
  if (growing <= 0) return 0;
  return isGrowing(annualMeanC, sinLat, week) ? annualForageKg / growing : 0;
}

function countGrowingWeeks(annualMeanC: number, sinLat: number): number {
  let n = 0;
  for (let w = 0; w < WEEKS_PER_YEAR; w++) {
    if (isGrowing(annualMeanC, sinLat, w)) n++;
  }
  return n;
}

/**
 * What a week of standing does to unmown, ungrazed grass.
 *
 * Standing dead forage weathers: leaching, shattering, the wet. Measured at 10
 * to 15 per cent of the standing mass a month over winter in temperate
 * grassland, which is about 3 per cent a week -- and it is why February
 * grazing is bare even where October's grass stood thick.
 */
export const STANDING_LOSS_PER_WEEK = 0.03;

/**
 * Hay: the surplus of the growing season, cut and dried into the barn.
 *
 * A meadow shut up for hay yields what it grows while shut; the loss in making
 * -- rain, respiration, the bits the rake misses -- is measured at about a
 * quarter. What comes out is standing grass turned into dry matter at 15%
 * moisture, which is the state hay keeps at.
 */
export const HAYMAKING_LOSS = 0.25;

export function hayFromKg(freshForageKg: number, forageWater: number): number {
  const dry = freshForageKg * (1 - forageWater);
  return (dry * (1 - HAYMAKING_LOSS)) / (1 - 0.15);
}
