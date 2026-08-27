// Getting food from where it grows to where it is eaten.
//
// THE ONE IDEA
//
// Hauling food costs food. The driver eats. The oxen eat. What they eat grew
// on land that could have grown something else. Follow that through and the
// cost of transport comes out in the same units as the cargo -- a fraction of
// the load consumed per kilometre -- with no price and no currency anywhere in
// it. That is the whole model, and everything a player will ever notice about
// logistics falls out of it.
//
// WHY IT MATTERS MORE THAN IT SOUNDS
//
// One horse drags about one and a half tonnes on a road and thirty on water.
// Same animal, same day, twenty times the cargo. That single ratio is why
// every great pre-industrial city sits on water and none of them do not, why
// grain from Egypt fed Rome while grain from two hundred miles inland did not,
// and why a river on this map is worth more than a mountain of iron.
//
// The rivers the generator already draws stop being scenery here.
//
// THE RETURN TRIP
//
// A cart fetching a harvest goes out loaded and comes back empty, and the team
// eats on both legs. Costing only the loaded kilometres made haulage 1.6 times
// too cheap -- wheat doubled over 761 km where the Roman evidence says 480.
// Every journey here is therefore round-trip, which is the physically honest
// shape for a settlement fetching its own crop. Long-distance trade is cheaper
// than this, because a cart on an established route carries something back;
// that is not modelled and is noted in docs/known-gaps.md.
//
// TWO INDEPENDENT CHECKS
//
// Nothing below was chosen to hit a target. Diocletian's Price Edict implies
// sea transport cost roughly a fortieth of road, and this gives 43 -- a ratio,
// so the return trip cancels out of it entirely.
//
// Duncan-Jones puts the doubling distance for a wagon-load of wheat near 480
// km, and this gives 380. It *should* come out lower: his figure is a price,
// and a price carries tolls, risk and somebody's profit on top of the food the
// oxen ate. A physical cost above a price-derived one would be the impossible
// result; below it, by about a fifth, is the expected one.

import * as A from '../anchors.ts';
import { SOLDIER_GRAIN_KG_PER_DAY } from '../derive.ts';
import { clamp } from '../gen/mathx.ts';

export const Transport = {
  /** On foot, carrying it. No road, no cart, no animal. */
  Porter: 0,
  /** An ox cart on a track. */
  Cart: 1,
  /** A barge on a river, or a boat along a coast. */
  Water: 2,
} as const;

export type TransportId = (typeof Transport)[keyof typeof Transport];

export const TRANSPORT_NAMES: readonly string[] = ['porter', 'cart', 'water'];

/**
 * What a labourer eats in a day, kg of grain. More than the campaign ration
 * already anchored, because hauling is hard work.
 */
export const LABOURER_GRAIN_KG_PER_DAY =
  SOLDIER_GRAIN_KG_PER_DAY * A.HARD_LABOUR_MULTIPLIER;

/**
 * What an ox eats in a day, expressed in grain-equivalent kg.
 *
 * An ox eats hay, not grain, and this is the step that makes the whole model
 * work: hay and grain are not interchangeable as food but they *are*
 * interchangeable as land. A hectare growing hay is a hectare not growing
 * wheat, so the honest exchange rate between them is the ratio of their yields
 * -- and because meadow out-yields grain several times over, an ox turns out
 * far cheaper to feed than its appetite suggests.
 */
export const HAY_TO_GRAIN_EQUIVALENT =
  A.MEDIEVAL_GRAIN_KG_PER_HA * A.CROPPED_FRACTION_THREE_FIELD / A.HAY_YIELD_KG_PER_HA;

export const OX_GRAIN_EQUIVALENT_KG_PER_DAY =
  A.OX_MASS_KG * A.OX_FODDER_FRACTION * HAY_TO_GRAIN_EQUIVALENT;

/**
 * The cost of a mode, as the fraction of its own cargo it eats per kilometre
 * carried.
 *
 * Everything on the right-hand side is something the movers consume in a day,
 * over the tonne-kilometres they cover in that day. The units cancel to a pure
 * number per kilometre, which is what makes it composable with anything else.
 */
/** Out loaded, home empty: the team is fed for twice the useful distance. */
const ROUND_TRIP = 2;

export function costPerKm(mode: TransportId): number {
  switch (mode) {
    case Transport.Porter: {
      const perDay = LABOURER_GRAIN_KG_PER_DAY;
      return (perDay * ROUND_TRIP) / (A.PORTER_LOAD_KG * A.PORTER_KM_PER_DAY);
    }

    case Transport.Cart: {
      const perDay = LABOURER_GRAIN_KG_PER_DAY
        + A.OXEN_PER_CART * OX_GRAIN_EQUIVALENT_KG_PER_DAY;
      const kmPerDay = A.OX_CART_SPEED_KMH * A.CART_HOURS_PER_DAY;
      return (perDay * ROUND_TRIP) / (A.OX_CART_PAYLOAD_KG * kmPerDay);
    }

    case Transport.Water: {
      // The same horse, the same fodder, thirty times the load. Nothing about
      // the animal changed; the water took the friction away.
      const perDay = A.BARGE_CREW * LABOURER_GRAIN_KG_PER_DAY
        + OX_GRAIN_EQUIVALENT_KG_PER_DAY;
      return (perDay * ROUND_TRIP) / (A.BARGE_PAYLOAD_KG * A.BARGE_KM_PER_DAY);
    }

    default:
      return costPerKm(Transport.Porter);
  }
}

export const COST_PORTER = costPerKm(Transport.Porter);
export const COST_CART = costPerKm(Transport.Cart);
export const COST_WATER = costPerKm(Transport.Water);

/** How much cheaper water is than road. Diocletian implies about 40. */
export const WATER_ROAD_RATIO = COST_CART / COST_WATER;

/** How far a load travels before the journey has eaten all of it. */
export function rangeKm(mode: TransportId): number {
  return 1 / costPerKm(mode);
}

/** Distance at which a load has cost half itself: 381 km by cart. Duncan-Jones
 *  puts the *price* doubling near 480, and physical cost belongs below a price. */
export const CART_DOUBLING_KM = 0.5 / COST_CART;

/**
 * The share of a load that survives a journey.
 *
 * Floors at zero rather than going negative: past its range the load is simply
 * gone, and a settlement that far from its fields gets nothing rather than
 * owing anybody grain.
 */
export function delivered(mode: TransportId, km: number): number {
  return clamp(1 - costPerKm(mode) * km, 0, 1);
}

/**
 * Which mode a route uses.
 *
 * Water wherever the route can follow one -- which on this map means both ends
 * sit on something that carries a boat. A river needs real flow to float a
 * barge, and `drainage` is already the normalised catchment, so the threshold
 * is the same one the renderer draws a channel at.
 *
 * FREE PARAMETER: that a cart track exists at all between any two land tiles.
 * Roads are not modelled yet, and assuming a passable track everywhere is
 * generous -- real terrain has bogs and gorges. It is the optimistic
 * assumption, so a settlement will read as slightly better supplied than it
 * should until roads and terrain cost are in. See docs/known-gaps.md.
 */
export function modeFor(fromDrainage: number, toDrainage: number, navigable: number): TransportId {
  return fromDrainage >= navigable && toDrainage >= navigable
    ? Transport.Water
    : Transport.Cart;
}

/**
 * Labour lost walking to work.
 *
 * A field is worth having while the day spent reaching it is less than the day
 * spent working it. Walking there and back at a person's preferred pace costs
 * `2d/v` hours out of a `WORKING_DAY_HOURS` day, and what is left is what gets
 * farmed.
 *
 * This is the term that actually bounds a settlement, not transport. At two
 * kilometres a farmer still gives nine hours in ten to the field; at twelve he
 * gives half; past twenty-five he never arrives. Historical village
 * territories were far tighter than that -- one to two kilometres -- but they
 * were bounded by the *neighbours*, not by the walk. On a frontier, which is
 * where this game starts, the walk is the only limit there is.
 */
export function labourEfficiency(km: number): number {
  const walkKmPerHour = A.WALK_PREFERRED * 3.6;
  const hoursWalking = (2 * km) / walkKmPerHour;
  return clamp((A.WORKING_DAY_HOURS - hoursWalking) / A.WORKING_DAY_HOURS, 0, 1);
}

/** The distance past which a day is all walking and no work. */
export const COMMUTE_LIMIT_KM =
  (A.WORKING_DAY_HOURS * A.WALK_PREFERRED * 3.6) / 2;

/**
 * What a tile is actually worth to a settlement `km` away: what it grows, less
 * what the walk costs, less what the journey home eats.
 *
 * The two terms have very different shapes and that is the point. Labour falls
 * off fast and linearly -- it is the near limit, and it is why settlements are
 * compact. Transport falls off slowly -- it is the far limit, and it is why a
 * city can be fed from another province as long as a river runs between them.
 */
export function reachFactor(km: number, mode: TransportId): number {
  return labourEfficiency(km) * delivered(mode, km);
}
