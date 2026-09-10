// The wild larder: what hungry hands take from the land that nobody sowed.
//
// The fauna model has always known how much game stands on a square
// kilometre; the flora model has always known the mast and the berries. What
// was missing is the verb: nothing turned a hungry village's idle hands into
// venison, and verify_founding measured what that costs -- eighteen of
// twenty dead with the woods around them full of deer. Settlers crossed
// their first winters on exactly this, everywhere the sources look.
//
// THE HUNT IS DERIVED FROM ENCOUNTER, not from a yield table. A hunter
// covers so much ground in a day; the ground holds so many head; some share
// of encounters end in a kill. Take equals sweep times density times
// success, and every term is a measured kind of thing. At temperate-forest
// densities it comes to a deer per hunter every few days, which is what
// pre-firearm subsistence hunting actually returned, and it falls as the
// game does -- the model's whole honesty lives in that.
//
// DEPLETION IS THE POINT. A founding does not get free food; it gets a
// STOCK, and cropping beyond the herd's own increase eats the principal.
// `wildShare` rides the delta: one is an untouched range, and a hard first
// winter can halve it, which is why the second winter is thin where the
// first was fat -- the founder effect on game, as real colonisation records
// it. The stock regrows at the deer's own intrinsic rate when the pressure
// lifts.

import * as A from '../anchors.ts';
import { type BiomeId } from './biome.ts';
import { gameBiomassKgPerKm2 } from './resources.ts';
import { foodKcalPerKg } from './material.ts';
import { CATTLE } from './cattle.ts';

/**
 * How far out a settlement hunts, km.
 *
 * A day's range on foot with a carcass to carry home: subsistence hunting
 * ranges cluster at five to ten kilometres from the hearth in every
 * ethnography that measures them, and the medieval poacher's as much as the
 * forester's beat says the same. Five, because the deer nearest home die
 * first.
 */
export const HUNT_RANGE_KM = 5;

/**
 * Ground one hunter effectively sweeps in a day, km2.
 *
 * A walker covers perhaps fifteen kilometres; game notices a hunter long
 * before a hunter notices game, so the swept STRIP is a few tens of metres
 * wide. Half a square kilometre a day is the middle of what stalking
 * ethnographies work out to.
 */
export const HUNTER_SWEEP_KM2_PER_DAY = 0.5;

/**
 * The share of SIGHTINGS that end in a carcass, before firearms.
 *
 * The first figure here was one in five, and the suite caught it at once: a
 * carcass every 0.86 hunter-days, forty deer a week off one hamlet, which is
 * a hunting return no ethnography has ever recorded. The sweep-times-density
 * term counts sightings, and game sees the hunter first: most sightings are
 * a white tail vanishing at two hundred paces. The measured returns -- Hadza
 * bow hunters at a large kill per hunter-month, medieval accounts of a deer
 * per man-week with snares and drives at good density -- work back to about
 * one sighting in thirty becoming meat.
 */
export const HUNT_SUCCESS = 0.03;

/**
 * The deer herd's own yearly increase, as a share of the standing stock.
 *
 * Measured for wild cervids at about a third a year with room to grow --
 * the same number wildlife management culls to. Cropping under it is
 * sustainable forever; over it eats the principal.
 */
export const GAME_GROWTH_PER_YEAR = 0.35;

/**
 * What a deer yields as food, as a share of live weight.
 *
 * The same butcher's arithmetic as the cow, and the cow's edible tissues
 * give the kcal per kilogramme -- venison and beef are the same nine
 * constituents in nearly the same proportions.
 */
const EDIBLE_SHARE = 0.55;
const MEAT_KCAL_PER_KG = CATTLE.tissues
  .filter((t) => t.edible)
  .reduce((a, t) => a + t.share * foodKcalPerKg(t.composition), 0)
  / CATTLE.tissues.filter((t) => t.edible).reduce((a, t) => a + t.share, 0);

/** The hunting ground's area, km2. */
export function huntRangeKm2(): number {
  return Math.PI * HUNT_RANGE_KM * HUNT_RANGE_KM;
}

/** Head of game standing in a settlement's range, at the given stock share. */
export function gameInRange(biome: BiomeId, npp: number, wildShare: number): number {
  const biomass = gameBiomassKgPerKm2(biome, npp) * Math.max(0, Math.min(1, wildShare));
  return (biomass * huntRangeKm2()) / A.DEER_MASS_KG;
}

/** What one week of hunting brings home and costs the stock. */
export interface Hunt {
  /** Food taken, kcal. */
  foodKcal: number;
  /** Carcasses. */
  kills: number;
  /** The range's stock share afterwards, regrowth included. */
  wildShare: number;
}

/**
 * One week of hunting by this many hands, plus the stock's own regrowth.
 *
 * Take is the SMALLER of what the hunters could kill and a hard share of
 * what stands -- no week takes more than a tenth of the range, because game
 * scatters and yards up long before the last deer is found. Regrowth is
 * logistic at the herd's own rate, so an untouched range stays full and a
 * hammered one climbs back over a few years.
 */
export function huntWeek(
  biome: BiomeId, npp: number, wildShare: number, hunterDays: number,
): Hunt {
  const share = Math.max(0, Math.min(1, wildShare));
  const standing = gameInRange(biome, npp, share);
  const densityPerKm2 = standing / huntRangeKm2();

  const encounters = hunterDays * HUNTER_SWEEP_KM2_PER_DAY * densityPerKm2;
  const kills = Math.min(encounters * HUNT_SUCCESS, standing * 0.1);
  const foodKcal = kills * A.DEER_MASS_KG * EDIBLE_SHARE * MEAT_KCAL_PER_KG;

  // The stock: what was killed leaves it; the herd's own increase returns,
  // logistic, at the weekly share of the yearly rate.
  const full = gameInRange(biome, npp, 1);
  const afterKills = full > 0 ? Math.max(0, share - kills / full) : share;
  const regrown = Math.min(1,
    afterKills + (GAME_GROWTH_PER_YEAR / 52) * afterKills * (1 - afterKills));

  return { foodKcal, kills, wildShare: regrown };
}

/** The stock's own recovery, for weeks nobody hunts. */
export function regrowWeek(wildShare: number): number {
  const share = Math.max(0, Math.min(1, wildShare));
  return Math.min(1, share + (GAME_GROWTH_PER_YEAR / 52) * share * (1 - share));
}
