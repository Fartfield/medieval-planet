// The farming year, added up.
//
// How much labour an acre of arable costs is not estimated here. Manorial
// accounts and the husbandry treatises record how much ground each job covered
// in a day -- a reeve had to know that to plan a year -- so the total is a sum
// of measured rates, task by task, and it comes out where the historians say
// it does: about fifteen man-days to a sown acre.
//
// WHAT THIS REPLACED, AND WHY IT WAS WRONG
//
// The first version derived labour from the virgate: twelve hectares to a
// family with two and a half workers giving 250 days each, so 52 man-days a
// hectare. That is arithmetically fine and historically wrong, because it
// assumes a villein family spent all its labour on its own arable. It spent
// nothing like all of it. Week-work on the lord's demesne ran to two or three
// days in seven, and past that there were the beasts, the croft, the woods,
// building, spinning and everything else a household did.
//
// So the number was roughly double what it should be, and settlements starved
// on land that would have fed them. The virgate is now a check on the answer
// rather than the source of it -- and as a check it passes, which is the part
// that makes the whole thing trustworthy: a family's own arable comes out at
// about half its available days, leaving the right amount for the dues and the
// rest of the work.
//
// WHAT IRON BUYS
//
// The plough. An iron share and coulter cut a furrow slice a wooden ard can
// only scratch, so an iron-shod team turns an acre a day where a wooden one
// manages half, and the difference is measured rather than assumed. Add the
// scythe for the spring grains and iron takes about a fifth off the farming
// year. That is the whole reason a town would rather buy iron than grow more
// of its own food, and it is why trade is worth having.

import * as A from '../anchors.ts';
import { clamp } from '../gen/mathx.ts';

/** Man-days for one pass of the plough over an acre, iron-shod or not. */
function ploughDaysPerAcre(iron: boolean): number {
  const rate = iron
    ? A.PLOUGH_ACRES_PER_TEAM_DAY_IRON
    : A.PLOUGH_ACRES_PER_TEAM_DAY_WOOD;
  return A.PLOUGH_TEAM_MEN / rate;
}

/**
 * Man-days to bring one sown acre through the year, threshing excluded.
 *
 * Threshing is the one job that scales with the *harvest* rather than the
 * acreage -- a flail gets through about a quarter a day whatever the field
 * looked like -- so good land costs more to thresh and it is added separately.
 */
export function sownAcreDays(iron: boolean): number {
  const plough = ploughDaysPerAcre(iron) * A.PLOUGHINGS_PER_SOWN_ACRE;
  const harrow = 1 / A.HARROW_ACRES_PER_DAY;
  const sow = 1 / A.SOW_ACRES_PER_DAY;
  const weed = 1 / A.WEED_ACRES_PER_DAY;

  // Reaping: the spring field can be scythed if there are scythes, and the
  // winter wheat is taken with a sickle either way. The sickle is not
  // backwardness -- it cuts high, holds the ear steady, loses far less grain
  // to shattering, and leaves the long straw that thatched the roof.
  const sickle = 1 / A.REAP_ACRES_PER_DAY_SICKLE;
  const scythe = 1 / A.MOW_ACRES_PER_DAY_SCYTHE;
  const cut = iron
    ? (1 - A.SPRING_GRAIN_SHARE) * sickle + A.SPRING_GRAIN_SHARE * scythe
    : sickle;

  const bind = 1 / A.BIND_ACRES_PER_DAY;
  const cart = 1 / A.CART_ACRES_PER_DAY;

  return plough + harrow + sow + weed + cut + bind + cart;
}

/**
 * Man-days to BREAK one hectare of new ground for the plough.
 *
 * The assart price, from the same task rates as everything else: pare and
 * burn the sod by hand, then the first ploughing at the broken-ground factor.
 * It comes to about fourteen man-days an acre against fifteen to raise a
 * crop on it -- so bringing land in costs nearly a year of that land's
 * labour before it yields anything, which is why a founding's first winter
 * was hungry everywhere the sources look.
 */
export function breakingDaysPerHa(iron: boolean): number {
  const perAcre = A.PARE_AND_BURN_DAYS_PER_ACRE
    + ploughDaysPerAcre(iron) * A.FIRST_PLOUGH_FACTOR;
  return perAcre / A.ACRE_HECTARES;
}

/** Man-days to plough a fallow acre through the year, which is not free. */
export function fallowAcreDays(iron: boolean): number {
  return ploughDaysPerAcre(iron) * A.PLOUGHINGS_PER_FALLOW_ACRE;
}

/**
 * Man-days a year for one hectare of *held* arable, threshing excluded.
 *
 * Held, not sown: a third of any holding is lying fallow, and the fallow still
 * gets ploughed. Mixing those two up is the same error as leaving the fallow
 * out of the yield, in the opposite direction.
 */
export function heldHectareDays(iron: boolean): number {
  const sownShare = A.CROPPED_FRACTION_THREE_FIELD;
  const perAcre = sownShare * sownAcreDays(iron)
    + (1 - sownShare) * fallowAcreDays(iron);
  return perAcre / A.ACRE_HECTARES;
}

/** Man-days to thresh and winnow a harvest, which scales with the grain. */
export function threshDays(grainKg: number): number {
  return grainKg / A.THRESH_KG_PER_DAY;
}

/** With iron tools and without. The ratio is what a town is buying. */
export const HELD_HECTARE_DAYS_IRON = heldHectareDays(true);
export const HELD_HECTARE_DAYS_WOOD = heldHectareDays(false);

/** How much of the farming year iron takes off. */
export const IRON_LABOUR_SAVING = 1 - HELD_HECTARE_DAYS_IRON / HELD_HECTARE_DAYS_WOOD;

/**
 * Labour per held hectare for a settlement with `supply` of the iron it wants,
 * 0..1. Interpolated, because a settlement half-supplied has half its ploughs
 * shod and the rest scratching.
 */
export function hectareDays(ironSupply: number): number {
  const s = clamp(ironSupply, 0, 1);
  return HELD_HECTARE_DAYS_WOOD + (HELD_HECTARE_DAYS_IRON - HELD_HECTARE_DAYS_WOOD) * s;
}

// ---------------------------------------------------------------------------
// Iron
// ---------------------------------------------------------------------------

/**
 * Man-days to make one kilogramme of iron, from ore in the ground to a tool.
 *
 * Five stages, each with its own measured rate, and smelting dominates: a
 * bloomery run is a crew of four for a day and yields about fifteen kilos.
 *
 * The check on the total is the village smith. At this cost one man working a
 * full year makes enough iron for a few hundred people's annual needs -- and a
 * few hundred people to a smith is exactly the density the manorial record
 * shows. Nothing was tuned to produce that.
 */
export const IRON_DAYS_PER_KG =
  A.ORE_PER_IRON_KG / A.ORE_DUG_KG_PER_DAY
  + (A.CHARCOAL_PER_IRON_KG * A.WOOD_PER_CHARCOAL_KG) / A.WOOD_FELLED_KG_PER_DAY
  + A.CHARCOAL_PER_IRON_KG / A.WOOD_CHARRED_KG_PER_DAY
  + A.BLOOM_CREW_DAYS / A.BLOOM_YIELD_KG
  + A.SMITHING_DAYS_PER_KG;

/** Standing timber consumed per kilogramme of iron, kg. Twenty times its own
 *  weight, which is why ironworking moved when the woods ran out. */
export const WOOD_PER_IRON_KG = A.CHARCOAL_PER_IRON_KG * A.WOOD_PER_CHARCOAL_KG;

/** Ore consumed per kilogramme of iron, kg. */
export const ORE_PER_IRON_KG = A.ORE_PER_IRON_KG;

/** How many people one full-time ironworker keeps in tools. The village-smith
 *  check, exported so the suite can assert it rather than trust a comment. */
export const PEOPLE_PER_IRONWORKER =
  A.WORKING_DAYS_PER_YEAR / IRON_DAYS_PER_KG / A.IRON_PER_PERSON_KG_PER_YEAR;

/**
 * Iron a settlement can make in a year, kg.
 *
 * Three things bind it and the smallest wins, which is the shape every
 * production chain in this project takes.
 *
 *   HANDS. Days allotted to ironworking, over the days a kilogramme costs.
 *
 *   ORE. A rich seam gives up its ore faster than a poor one, so richness
 *   scales the digging stage rather than capping a reserve. Modelling reserves
 *   would mean inventing a tonnage nothing measures; modelling the rate is
 *   both honest and what actually varied.
 *
 *   WOOD. Twenty kilogrammes of standing timber per kilogramme of iron, as
 *   charcoal, and only the annual increment counts -- cutting more than the
 *   woods grow is deforestation, not forestry. This is usually the binding
 *   one, and it is why ironworking moved when the woods gave out.
 */
export function ironOutputKgPerYear(
  labourDays: number,
  oreRichness: number,
  timberKgPerYear: number,
): number {
  if (labourDays <= 0 || oreRichness <= 0) return 0;

  // The digging stage stretches on a poor seam; the rest of the chain does not.
  const digging = A.ORE_PER_IRON_KG / (A.ORE_DUG_KG_PER_DAY * clamp(oreRichness, 0.05, 1));
  const perKg = IRON_DAYS_PER_KG
    - A.ORE_PER_IRON_KG / A.ORE_DUG_KG_PER_DAY
    + digging;

  const byHands = labourDays / perKg;
  const byWood = timberKgPerYear / WOOD_PER_IRON_KG;
  return Math.max(0, Math.min(byHands, byWood));
}

/** Which of the three ran out first. The diagnostic a player wants. */
export function ironLimit(
  labourDays: number,
  oreRichness: number,
  timberKgPerYear: number,
): 'no ore' | 'hands' | 'wood' {
  if (oreRichness <= 0) return 'no ore';
  const digging = A.ORE_PER_IRON_KG / (A.ORE_DUG_KG_PER_DAY * clamp(oreRichness, 0.05, 1));
  const perKg = IRON_DAYS_PER_KG - A.ORE_PER_IRON_KG / A.ORE_DUG_KG_PER_DAY + digging;
  return labourDays / perKg <= timberKgPerYear / WOOD_PER_IRON_KG ? 'hands' : 'wood';
}
