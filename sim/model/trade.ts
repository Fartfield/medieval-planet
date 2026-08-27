// Moving goods between settlements.
//
// WHAT THIS UNLOCKS
//
// A town that cannot feed itself. Until now every settlement had to grow its
// own food, which meant the only viable sites were farmland and the ore in the
// mountains was decoration. With a route to a grain surplus, a mining town on
// bare rock is a perfectly good idea -- and that is the entire point of
// specialisation. It is also why the rivers matter: water carries grain
// forty-three times more cheaply than a cart, so a settlement on a river can
// be fed from a very long way off and a landlocked one cannot.
//
// HOW IT CLEARS
//
// A greedy nearest-source match, not a price. Each settlement short of a good
// draws from whichever supplier delivers most cheaply, until it is satisfied or
// the suppliers are dry. There is no money anywhere in this project and this is
// where it would usually appear; it does not need to, because transport cost is
// already denominated in the cargo itself.
//
// The match is deterministic. Deficits are served worst-first and suppliers are
// ranked by delivered fraction, with every tie broken down to the address key,
// so the same world clears the same way on every machine and on a replay.
//
// WHAT IT IS NOT
//
// Not an optimal allocation. Greedy nearest-source can strand a supplier behind
// a nearer but smaller one, and a proper transportation solve would do better.
// It is deterministic, it is O(deficits x suppliers), and it produces the
// behaviour that matters: goods flow downhill from surplus to shortage, cheaply
// along water and expensively over land.

import * as A from '../anchors.ts';
import { toKey, type Address } from '../geo/address.ts';
import { Transport, delivered, type TransportId } from './supply.ts';

export const Good = {
  Grain: 0,
  Iron: 1,
} as const;

export type GoodId = (typeof Good)[keyof typeof Good];

export const GOOD_NAMES: readonly string[] = ['grain', 'iron'];

/** A settlement as the market sees it. */
export interface Trader {
  key: string;
  address: Address;
  /** Unit vector on the sphere. */
  dir: readonly [number, number, number];
  /**
   * Whether goods can reach it by water: on a navigable river, or on a coast.
   * This is the single most valuable thing about a site and it is why the
   * client draws rivers.
   */
  navigable: boolean;
  /** Surplus available to send, in kg. Zero if it has none. */
  offered: number;
  /** Shortfall it would like filled, in kg. Zero if it has none. */
  wanted: number;
}

export interface Flow {
  from: string;
  to: string;
  /** Loaded at the source. */
  shippedKg: number;
  /** Arrived, after the haul ate its share. */
  deliveredKg: number;
  km: number;
  mode: TransportId;
}

export interface Clearing {
  flows: Flow[];
  /** Delivered into each settlement, by key. */
  received: Map<string, number>;
  /** Shipped out of each settlement, by key. */
  sent: Map<string, number>;
  /** Total that left a barn, and total that reached one. */
  totalShipped: number;
  totalDelivered: number;
}

/** Great-circle distance between two traders, in metres. */
export function distanceM(a: Trader, b: Trader): number {
  const dx = a.dir[0] - b.dir[0];
  const dy = a.dir[1] - b.dir[1];
  const dz = a.dir[2] - b.dir[2];
  // Chord rather than arc: within 0.002% at any range a cart would attempt,
  // and it needs no trigonometry, which the simulation is not allowed anyway.
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * A.EARTH_RADIUS_M;
}

/**
 * Which way goods travel between two places.
 *
 * Water only if both ends can take a boat. That is a real simplification --
 * two settlements on different rivers cannot actually barge to each other, and
 * this model lets them -- and it is generous in the same direction as the
 * missing roads. Recorded in docs/known-gaps.md; the fix is river network
 * topology, which needs the cross-boundary work first.
 */
export function modeBetween(a: Trader, b: Trader): TransportId {
  return a.navigable && b.navigable ? Transport.Water : Transport.Cart;
}

/** The fraction of a load that survives the journey from `a` to `b`. */
export function routeYield(a: Trader, b: Trader): number {
  return delivered(modeBetween(a, b), distanceM(a, b) / 1000);
}

/**
 * Clear the market for one good.
 *
 * Worst shortage first, because a settlement about to starve should get the
 * grain before one that merely wants to top up its granary. Within that, the
 * cheapest route wins -- which on this map means whoever is on the same water.
 */
export function clear(traders: Trader[]): Clearing {
  const flows: Flow[] = [];
  const received = new Map<string, number>();
  const sent = new Map<string, number>();

  // Working copies, so the caller's numbers are not mutated under it.
  const supply = new Map<string, number>();
  for (const t of traders) if (t.offered > 0) supply.set(t.key, t.offered);

  const buyers = traders
    .filter((t) => t.wanted > 0)
    .sort((a, b) => b.wanted - a.wanted || a.key.localeCompare(b.key));

  const sellers = traders.filter((t) => t.offered > 0);
  if (sellers.length === 0 || buyers.length === 0) {
    return { flows, received, sent, totalShipped: 0, totalDelivered: 0 };
  }

  let totalShipped = 0;
  let totalDelivered = 0;

  for (const buyer of buyers) {
    let outstanding = buyer.wanted;

    // Cheapest delivery first. Ranking by the fraction that *arrives* rather
    // than by distance is what makes water win: a river supplier three hundred
    // kilometres away beats a cart supplier at fifty.
    const ranked = sellers
      .filter((s) => s.key !== buyer.key && (supply.get(s.key) ?? 0) > 0)
      .map((s) => ({ seller: s, fraction: routeYield(s, buyer) }))
      .filter((r) => r.fraction > 0)
      .sort((a, b) => b.fraction - a.fraction || a.seller.key.localeCompare(b.seller.key));

    for (const { seller, fraction } of ranked) {
      if (outstanding <= 0) break;
      const available = supply.get(seller.key) ?? 0;
      if (available <= 0) continue;

      // Ship enough that the *arriving* amount covers the shortfall, capped by
      // what the seller actually has. Sending only what is wanted would leave
      // the buyer short by whatever the journey ate.
      const shipped = Math.min(available, outstanding / fraction);
      if (shipped <= 0) continue;
      const arrived = shipped * fraction;

      supply.set(seller.key, available - shipped);
      outstanding -= arrived;
      totalShipped += shipped;
      totalDelivered += arrived;

      received.set(buyer.key, (received.get(buyer.key) ?? 0) + arrived);
      sent.set(seller.key, (sent.get(seller.key) ?? 0) + shipped);

      flows.push({
        from: seller.key,
        to: buyer.key,
        shippedKg: shipped,
        deliveredKg: arrived,
        km: distanceM(seller, buyer) / 1000,
        mode: modeBetween(seller, buyer),
      });
    }
  }

  // A stable order, so a replay and a live turn produce the same log.
  flows.sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from));
  return { flows, received, sent, totalShipped, totalDelivered };
}

/**
 * How much a settlement wants to hold, in kg.
 *
 * A year of eating, because the gap between harvests is the whole problem and
 * a failed harvest has to be survivable. It is also what makes trade
 * *stabilising* rather than merely useful: a town with a full granary can lose
 * a supplier for a season and not notice.
 */
export function stockTarget(annualNeedKg: number): number {
  return annualNeedKg * A.GRAIN_STOCK_TARGET_YEARS;
}

/** What a stock loses over a turn to damp, rats and weevils. */
export function spoil(stockKg: number): number {
  return stockKg * (A.GRAIN_SPOILAGE_PER_YEAR / A.TURNS_PER_YEAR);
}

export { Transport, type TransportId };
export { toKey };
