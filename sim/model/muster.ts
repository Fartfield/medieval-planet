// What a settlement can put in the field, and what happens when two do.
//
// An army is not a stat. It is fighting men spared from the fields, iron on
// their backs, and grain in the cart -- and every one of those three is a
// number the economy already produces. A village of a hundred cannot field a
// legion; it can field the dozen men it can arm and feed without the harvest
// failing behind them, for the forty days the levy owes and no longer. Take
// any of the three away and the army is not smaller, it is ABSENT: an unfed
// host goes home, an unarmed one is a rabble, and a village with its hands all
// in the fields sends nobody.
//
// THE THREE CONSTRAINTS, each a real limit the record shows:
//
//   HANDS.  Only fighting-age men march, only some of them can leave the
//   fields at once, and only in the campaigning season between the sowing and
//   the harvest. That is the select fyrd -- about a twelfth of a population --
//   and calling more than that is the great fyrd, which won a battle and lost
//   the year's corn.
//
//   IRON.  A spear is a kilogramme of iron; a mail hauberk is thirteen. What a
//   House holds in iron is what arms its men, best-equipped first, and a line
//   of mail beats a rabble of billhooks at odds no numbers make up. This is
//   the whole reason iron was worth more than its weight in anything.
//
//   GRAIN.  A man in the field eats more than a man at the plough, and he
//   carries what he eats. Days in the field are the grain in the baggage over
//   the daily ration, capped at the forty the levy owes -- which is the same
//   forty days that set the kingdom's reach, so an army and a border are the
//   same arithmetic seen twice.

import * as A from '../anchors.ts';
import { SOLDIER_GRAIN_KG_PER_DAY } from '../derive.ts';
import { stableShares } from './hearths.ts';

// --- who marches -------------------------------------------------------------

/**
 * The share of a population that is a fighting-age man.
 *
 * Half are men; of the working hands (fifteen to sixty) about two thirds are
 * of an age to bear a shield (fifteen to forty-five). Against a stable pyramid
 * that is a bit over a sixth of everyone -- the pool, not the levy.
 */
export const MALE_SHARE = 0.5;
export const FIGHTING_AGE_SHARE_OF_MEN = 0.66;

/**
 * The working-age share of a population, from the demography's own pyramid --
 * not a figure typed here. A summer levy is drawn from the hands, so the
 * levy is a share of a share, and it is the pyramid that fixes the first one.
 */
export function workingShare(): number {
  return stableShares().h;
}

/**
 * How many of the fighting-age men can actually leave.
 *
 * The SELECT levy: the rest must hold the settlement and bring in what corn
 * the season allows while the chosen men are away. Half is the figure that
 * lands the callable force at about a twelfth of the whole people, which is
 * what a medieval realm raised for a summer without starving in the winter.
 */
export const CALLABLE_SHARE = 0.5;

/** The fighting-age men a population holds -- the pool the levy is called from. */
export function fightingAgeMen(population: number): number {
  return Math.max(0, population) * workingShare() * MALE_SHARE
    * FIGHTING_AGE_SHARE_OF_MEN;
}

/** The most fighting men a settlement of this many souls can field. */
export function levyCap(population: number): number {
  return fightingAgeMen(population) * CALLABLE_SHARE;
}

// --- what they carry ---------------------------------------------------------

/**
 * Iron in one man's war-gear, kg, from a spearman to a mailed man.
 *
 * A spear-head and a knife are about a kilogramme; a helm and a shield boss
 * add a little; a full mail hauberk is ten to fifteen. These are the measured
 * weights of surviving pieces, and the gulf between them is the gulf between a
 * fyrdman and a housecarl.
 */
export const SPEAR_IRON_KG = 1.5;
export const MAIL_IRON_KG = 13.0;

/**
 * How much a mailed line outfights an unarmed one, per man.
 *
 * Not a small number. Mail turned the cuts that killed the unarmoured, so a
 * mailed man could hold against several without one -- Hastings and Maldon
 * both turned on it. Three is conservative for the man; the LINE of them is
 * worth more again, but that belongs to the clash below and not to the man.
 */
export const MAIL_COMBAT_MULT = 3.0;
/** A man with a spear and no mail is still worth more than a man with a hoe. */
export const SPEAR_COMBAT_MULT = 1.0;
export const UNARMED_COMBAT_MULT = 0.4;

/** What a body of men and a store of iron come to when armed, best first. */
export interface ArmedForce {
  /** Men in the field. */
  men: number;
  /** Of them, in mail. */
  mailed: number;
  /** Days they can stay in the field before the baggage runs out. */
  campaignDays: number;
  /** The force's fighting weight -- men times their gear, times provisioning. */
  power: number;
}

/**
 * Arm a levy from a store of iron and provision it from a store of grain.
 *
 * Iron goes to mail first -- a lord armours his best men fully before he hands
 * out a second spear -- and what is left of the men carry spears or, if the
 * iron is truly gone, nothing. Grain in the baggage over the daily ration is
 * the days they last, and a force that cannot provision even a week's campaign
 * fights at a fraction of its weight: hungry men do not hold a line.
 */
export function arm(
  men: number, ironKg: number, grainKg: number,
): ArmedForce {
  const n = Math.max(0, men);
  if (n <= 0) return { men: 0, mailed: 0, campaignDays: 0, power: 0 };

  // Mail first, to as many as the iron will cover; the rest get spears down to
  // the last of the iron, and anyone past that is unarmed.
  const mailed = Math.min(n, Math.max(0, ironKg) / MAIL_IRON_KG);
  const ironLeft = Math.max(0, ironKg - mailed * MAIL_IRON_KG);
  const speared = Math.min(n - mailed, ironLeft / SPEAR_IRON_KG);
  const unarmed = Math.max(0, n - mailed - speared);

  const gearPower = mailed * MAIL_COMBAT_MULT
    + speared * SPEAR_COMBAT_MULT
    + unarmed * UNARMED_COMBAT_MULT;

  // Days in the field: what the men carry over what they eat, capped at the
  // service owed. A porter's load a man, and a cart per ten if they have carts
  // -- but at the muster we count only what the men themselves bear, which is
  // the pessimistic and the usual case.
  const carried = grainKg;
  const daily = n * SOLDIER_GRAIN_KG_PER_DAY;
  const campaignDays = daily > 0
    ? Math.min(A.FEUDAL_SERVICE_DAYS, carried / daily)
    : 0;

  // Provisioning below a week is a rout waiting to happen: the fraction is a
  // smooth penalty, full weight at a fortnight's food and a third of it at
  // none.
  const provision = 0.33 + 0.67 * Math.min(1, campaignDays / 14);

  return { men: n, mailed, campaignDays, power: gearPower * provision };
}

/**
 * The whole muster of a settlement, from its own books.
 *
 * `ironKg` and `grainKg` are what the settlement can put toward war -- its
 * stores, less what the people at home still need -- and the caller decides
 * how much that is. `population` sets the ceiling on men.
 */
export function muster(
  population: number, ironKg: number, grainKg: number,
): ArmedForce {
  return arm(levyCap(population), ironKg, grainKg);
}

// --- the clash ---------------------------------------------------------------

/**
 * A settlement's own defensibility, over and above the men in it.
 *
 * Even a ditch and a palisade doubled the men needed to take a place, and a
 * stone keep did far more. Zero is open field; the number is the multiplier on
 * the defender's fighting weight. Derived elsewhere from what the settlement
 * has built; passed in here.
 */
export type Fortification = number;

/** What a clash did to both sides. */
export interface Clash {
  /** True if the attacker prevailed. */
  attackerWon: boolean;
  /** How decisive, 0 a bloody draw to 1 a rout. */
  margin: number;
  /** Men the attacker lost. */
  attackerLost: number;
  /** Men the defender lost. */
  defenderLost: number;
}

/**
 * Resolve one clash, deterministically.
 *
 * The stronger fighting weight wins -- numbers times gear times food, plus the
 * defender's works. HOW stronger decides the cost: a rout (one side twice the
 * other) breaks the loser for few of the winner's men, while a near-run thing
 * bleeds both white. This is the aggregate reading of Lanchester's law over a
 * single day, where the winner's losses fall as the square of the odds and the
 * loser's rise toward his whole force.
 *
 * No dice. Two equal hosts on equal ground is a draw that ruins both, every
 * time, which is why nobody sought that battle and why the whole art was to
 * arrive with the odds already won -- more men, better iron, a fed army, a wall.
 */
export function clash(
  attacker: ArmedForce, defender: ArmedForce, fortification: Fortification = 0,
): Clash {
  const ap = attacker.power;
  const dp = defender.power * (1 + Math.max(0, fortification));
  const total = ap + dp;
  if (total <= 0) {
    return { attackerWon: false, margin: 0, attackerLost: 0, defenderLost: 0 };
  }
  const attackerWon = ap > dp;
  const strong = Math.max(ap, dp);
  const weak = Math.min(ap, dp);
  // Odds of the fight, one to (odds): a rout at two, a slaughter above.
  const odds = weak > 0 ? strong / weak : Infinity;
  // The loser loses a share rising with the odds toward his whole force; the
  // winner loses the reciprocal share of his.
  const loserShare = Math.min(1, 1 - 1 / (odds * odds) * 0.5);
  const winnerShare = Math.min(1, (weak / strong) * (weak / strong) * 0.5);
  const margin = Math.min(1, 1 - weak / strong);

  const attackerLost = attacker.men
    * (attackerWon ? winnerShare : loserShare);
  const defenderLost = defender.men
    * (attackerWon ? loserShare : winnerShare);

  return {
    attackerWon,
    margin,
    attackerLost: Math.min(attacker.men, attackerLost),
    defenderLost: Math.min(defender.men, defenderLost),
  };
}
