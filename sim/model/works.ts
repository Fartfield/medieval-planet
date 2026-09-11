// What a settlement builds to defend itself, and what it is worth in a fight.
//
// This is the model that retires the last typed-in number in the whole stack.
// war.ts has carried one labelled stand-in since the border first had a war on
// it: fortification(population), a curve that said a bigger town has better
// walls because bigger towns did. That is a correlation standing in for a
// cause. The cause is that a town raised walls -- earth, then timber, then
// stone -- out of the labour and the materials it had to spare, over years, and
// what it had built is what turned the fight. This file is that cause.
//
// EVERYTHING HERE IS A VOLUME OVER A RATE. A ditch is so many cubic metres of
// earth per metre of circuit, moved at so many cubic metres a man-day; a
// palisade is a row of logs felled and set; a stone wall is quarried, dressed
// and laid rubble. The person-days each costs are the volume over the hand
// rate, and the circuit is the perimeter of the ground the people stand on --
// which grows as the square root of how many they are, so a city walls itself
// at a fraction of the per-head cost a hamlet would pay. That, not a curve, is
// why cities had stone and hamlets had a hedge.
//
// WHAT A WALL IS WORTH is the one place a judgement enters, and it is anchored
// to the oldest rule in siege warfare: the force ratio an assault needs. An
// attacker storming a prepared position needed to outnumber its holders, and by
// how much is what each kind of work bought -- about three to two at a ditch
// and bank, two to one once it is palisaded, three to one at a stone wall, past
// which even a great wall was taken by starving it, which is the cap the clash
// model already knew. The fortification multiplier is that ratio less one: the
// extra attackers each defender behind the works is worth.

import * as A from '../anchors.ts';

// --- the circuit -------------------------------------------------------------

/**
 * How densely the defended people stand, per square metre.
 *
 * Not the fields -- the walls enclose the dwellings, and a medieval walled town
 * ran a hundred and fifty souls to the hectare within its circuit, packed tight
 * behind the one thing that cost by the metre. 150/ha is 0.015 a square metre,
 * and it is what the enclosed areas of known town walls come to against their
 * populations.
 */
export const DEFENDED_PER_M2 = 0.015;

/**
 * The length of wall a settlement of this many people must circle itself with.
 *
 * The people occupy an area set by their number and the density; the circuit is
 * the circumference of that area taken as a circle (the shape of least wall for
 * the most ground). Perimeter grows as the square root of population, so the
 * per-head length -- and thus the per-head cost of every wall -- falls the
 * bigger a place is.
 */
export function defendedPerimeterM(population: number): number {
  if (population <= 0) return 0;
  const areaM2 = population / DEFENDED_PER_M2;
  return 2 * Math.sqrt(Math.PI * areaM2);
}

// --- what each work costs, in man-days per metre of circuit ------------------

/**
 * The earthwork: a ditch dug and its spoil thrown up as a bank.
 *
 * A defensive ditch of a few metres' width and depth is about five cubic metres
 * of earth moved per metre of its length, the bank being the spoil and costing
 * no second digging. Hand excavation with barrow and shovel moved earth at
 * something like two and a half cubic metres a day once hauling and piling are
 * counted -- navvies managed more on open cuttings, less on a rampart.
 */
export const EARTH_M3_PER_M = 5.0;
export const DIG_M3_PER_DAY = 2.5;
export const RAMPART_DAYS_PER_M = EARTH_M3_PER_M / DIG_M3_PER_DAY;

/**
 * The palisade: a wall of logs felled, hauled, trimmed and set along the bank.
 *
 * A man-day and a half a metre covers felling the timber, dragging it in, and
 * digging the posts deep enough to stand to a spear -- the felling labour folds
 * in here rather than being billed to the woodland, because a wall's timber is
 * cut for the wall. It needs woodland within reach; a treeless place skips it.
 */
export const PALISADE_DAYS_PER_M = 1.5;

/**
 * The stone wall: quarried, dressed, hauled and laid as a rubble-cored curtain.
 *
 * Six cubic metres of masonry per metre of circuit -- a wall a metre and a half
 * thick and some four high, rubble between dressed faces. Stone is the slow
 * material: quarrying, dressing, carting and laying come to about three tenths
 * of a cubic metre a man-day all told, which is why a stone circuit was the
 * work of years and only a wealthy, stone-bearing town ever finished one.
 */
export const STONE_M3_PER_M = 6.0;
export const MASONRY_M3_PER_DAY = 0.3;
export const WALL_DAYS_PER_M = STONE_M3_PER_M / MASONRY_M3_PER_DAY;

// --- what each work is worth, from the assault ratio -------------------------

/**
 * The force ratio an assault needs, by what it is storming, and the multiplier
 * that follows.
 *
 * The attacker had to outnumber the holders of a prepared position: about
 * three to two at a ditch and bank, two to one once it carries a palisade,
 * three to one at a stone wall. The fortification multiplier the clash uses is
 * that ratio less one -- the extra attackers each defender behind the works is
 * worth -- so the works add 0.5, then 0.5 more, then 1.0, to a cap of 2.0 where
 * the clash model already put the limit of what a wall can do before it is
 * simply starved out.
 */
export const RAMPART_FORT = 0.5;
export const PALISADE_FORT = 0.5;
export const WALL_FORT = 1.0;
export const FORT_CAP = 2.0;

/** The three works, in the order a settlement raises them. */
export interface TierCosts {
  /** Man-days to dig the ditch and throw up the bank. */
  rampart: number;
  /** Man-days to fell and set the palisade, once the bank is up. */
  palisade: number;
  /** Man-days to quarry and lay the stone curtain. */
  wall: number;
}

/** The labour each work costs a settlement of this size, in man-days. */
export function tierCosts(population: number): TierCosts {
  const p = defendedPerimeterM(population);
  return {
    rampart: p * RAMPART_DAYS_PER_M,
    palisade: p * PALISADE_DAYS_PER_M,
    wall: p * WALL_DAYS_PER_M,
  };
}

/**
 * The most labour worth sinking into works, given the materials to hand.
 *
 * Beyond this the walls are finished; more labour is wasted on them. A place
 * without woodland cannot raise the palisade and a place without quarriable
 * rock cannot raise the stone, so each missing material strikes its tier's
 * labour from the total a settlement can usefully build.
 */
export function maxWorksDays(
  population: number, hasTimber: boolean, hasStone: boolean,
): number {
  const c = tierCosts(population);
  return c.rampart
    + (hasTimber ? c.palisade : 0)
    + (hasStone ? c.wall : 0);
}

/**
 * Raise the works by a year's spare labour.
 *
 * `worksDays` is the labour invested in defences so far; the year adds what
 * labour the settlement could spare from field and furnace, up to the point the
 * walls the materials allow are finished. Nothing here chooses how much to
 * spare -- the economy does that -- this only turns spared days into standing
 * wall.
 */
export function buildWorks(
  worksDays: number, spareDays: number,
  population: number, hasTimber: boolean, hasStone: boolean,
): number {
  const max = maxWorksDays(population, hasTimber, hasStone);
  return Math.min(max, Math.max(0, worksDays) + Math.max(0, spareDays));
}

/**
 * The fortification multiplier the works have earned.
 *
 * Labour fills the works in the order they are raised -- rampart, then palisade
 * where there is timber, then stone where there is rock -- and each contributes
 * its share of the multiplier as it is completed, a half-built rampart giving
 * half its worth. A tier whose material is absent is skipped: its labour is not
 * spent and its share is not earned, and the labour flows on to the next work
 * the settlement can actually build. Capped where a wall stops helping and a
 * siege becomes a blockade.
 */
export function fortificationOf(
  worksDays: number, population: number, hasTimber: boolean, hasStone: boolean,
): number {
  const c = tierCosts(population);
  let left = Math.max(0, worksDays);
  let fort = 0;

  // Rampart, always.
  fort += RAMPART_FORT * clampFrac(left, c.rampart);
  left -= Math.min(left, c.rampart);

  // Palisade, where there is wood to build it.
  if (hasTimber) {
    fort += PALISADE_FORT * clampFrac(left, c.palisade);
    left -= Math.min(left, c.palisade);
  }

  // Stone, where there is rock to quarry.
  if (hasStone) {
    fort += WALL_FORT * clampFrac(left, c.wall);
    left -= Math.min(left, c.wall);
  }

  return Math.min(FORT_CAP, fort);
}

/** The fraction of a work done: how much of `cost` the `have` covers, 0 to 1. */
function clampFrac(have: number, cost: number): number {
  if (cost <= 0) return 1;
  return Math.min(1, Math.max(0, have) / cost);
}

/** Names for the standing works, for the chronicle and the panel. */
export const WORKS_NONE = 'open';
export const WORKS_RAMPART = 'a ditch and bank';
export const WORKS_PALISADE = 'a palisade';
export const WORKS_WALL = 'a stone wall';

/** What stands, in words, for a settlement's current works. */
export function worksName(
  worksDays: number, population: number, hasTimber: boolean, hasStone: boolean,
): string {
  const c = tierCosts(population);
  if (worksDays < c.rampart * 0.5) return WORKS_NONE;
  let left = worksDays - c.rampart;
  if (hasStone && left - (hasTimber ? c.palisade : 0) >= c.wall * 0.5) return WORKS_WALL;
  if (hasTimber && left >= c.palisade * 0.5) return WORKS_PALISADE;
  return WORKS_RAMPART;
}
