// One turn: two minutes of real time, one week of game time.
//
// Turns resolve simultaneously. Everyone's orders for a turn are collected,
// sorted into an order that is a property of the orders rather than of who
// pressed send first, and applied together. Nobody gains anything by having a
// better connection, which matters more in a persistent world than in a match:
// here the advantage would compound for months.
//
// A settlement eats from the land it can reach, not from the tile it stands
// on. That distinction is the whole economy: 506 square metres feeds a tenth
// of a person, and thirty-five square kilometres feeds three thousand. See
// sim/model/settlement.ts for how far "can reach" goes and what it costs.

import * as A from './anchors.ts';
import { foundingHerd } from './model/village_herd.ts';
import { SOLDIER_GRAIN_KG_PER_DAY } from './derive.ts';
import { fromKey, toKey, GROUND_DEPTH, type Address } from './geo/address.ts';
import { clamp } from './gen/mathx.ts';
import { Hasher } from './hash.ts';
import { runEconomy, GRAIN_PER_PERSON_YEAR, type Report } from './economy.ts';
import { planExpansion, applyExpansion, type Founding } from './expansion.ts';
import type { World } from './world.ts';
import type { TileDelta } from './model/tile.ts';

export type OrderAction = 'claim' | 'settle' | 'abandon';

export interface Order {
  player: number;
  /** Address key of the tile. */
  target: string;
  action: OrderAction;
  amount?: number;
}

export interface TurnResult {
  turn: number;
  changed: TileDelta[];
  rejected: { order: Order; reason: string }[];
  /** What every settlement did this week. Not persisted -- recomputed from the
   *  deltas every turn, and here for the log and the client. */
  reports: Map<string, Report>;
  grainShippedKg: number;
  ironShippedKg: number;
  tradeRoutes: number;
  /** Daughter settlements founded this week. */
  foundings: Founding[];
  /** Settlements that wanted to spread and had nowhere left. A frontier. */
  blocked: string[];
}

/**
 * Sort orders into a total order every machine agrees on.
 *
 * By player, then action, then target -- never by arrival. Two players racing
 * for the same tile must resolve the same way on a replay as they did live, or
 * the delta log stops being a faithful record of what happened.
 */
export function sortOrders(orders: Order[]): Order[] {
  return orders.slice().sort((a, b) =>
    a.player - b.player
    || a.action.localeCompare(b.action)
    || a.target.localeCompare(b.target)
    || (a.amount ?? 0) - (b.amount ?? 0));
}

/**
 * Grain a settlement gathers in one week, kg.
 *
 * The annual harvest divided by 52, which is a simplification worth naming.
 * Real grain arrives once, and the whole shape of a medieval year is about
 * storing it and not running out before the next one. Averaging it makes
 * famine a slow slide rather than a cliff in March, and that is the wrong
 * shape. Recorded in docs/known-gaps.md as the first thing seasons will fix.
 */
export function weeklyGrainKg(
  world: World,
  address: Address,
  population: number,
  ironSupply = 1,
  farmShare = 1,
): number {
  return world.harvestFor(address, population, ironSupply, farmShare).netKgPerYear
    / A.TURNS_PER_YEAR;
}

/** Grain a population eats in one week, kg. */
export function weeklyNeedKg(population: number): number {
  return population * SOLDIER_GRAIN_KG_PER_DAY * A.DAYS_PER_TURN;
}

/**
 * Resolve a turn.
 *
 * Orders first, then the world's own arithmetic. Order matters: a tile claimed
 * this turn should eat this turn.
 */
export function resolveTurn(world: World, orders: Order[], playerCount: number): TurnResult {
  const rejected: { order: Order; reason: string }[] = [];
  const touched = new Set<string>();

  for (const order of sortOrders(orders)) {
    const reason = applyOrder(world, order, playerCount);
    if (reason !== null) rejected.push({ order, reason });
    else touched.add(order.target);
  }

  // Produce, trade, eat, decide. See economy.ts for why that order.
  const economy = runEconomy(world);
  for (const key of economy.touched) touched.add(key);

  // A settlement whose land cannot feed it sends a party out to found another.
  // This is where kingdoms come from; see expansion.ts. It runs before the
  // population step so that step knows who tried to spread and could not --
  // those are the ones people walk away from.
  const expansion = planExpansion(
    world, economy.reports, world.polities, world.nextPolityId);
  for (const p of expansion.newPolities) world.loadPolities([p]);
  for (const key of applyExpansion(world, expansion)) touched.add(key);
  const blocked = new Set(expansion.blocked);

  // Then people are born, die, arrive or leave, on the ration they got.
  for (const [key, report] of economy.reports) {
    if (stepPopulation(world, report, blocked.has(key))) touched.add(key);
  }

  world.turn++;

  const changed: TileDelta[] = [];
  for (const key of touched) {
    const d = world.getDelta(fromKey(key));
    // A tile emptied this turn -- abandoned, or everyone on it died -- has no
    // delta any more. Send a tombstone so clients drop theirs too.
    changed.push(d ?? { key, turn: world.turn });
  }

  return {
    turn: world.turn,
    changed,
    rejected,
    reports: economy.reports,
    grainShippedKg: economy.grainFlows.reduce((n, f) => n + f.shippedKg, 0),
    ironShippedKg: economy.ironFlows.reduce((n, f) => n + f.shippedKg, 0),
    tradeRoutes: economy.grainFlows.length + economy.ironFlows.length,
    foundings: expansion.foundings,
    blocked: expansion.blocked,
  };
}

function applyOrder(world: World, order: Order, playerCount: number): string | null {
  if (order.player < 0 || order.player >= playerCount) return 'no such player';

  let address: Address;
  try {
    address = fromKey(order.target);
  } catch {
    return 'malformed address';
  }
  if (address.length !== GROUND_DEPTH + 1) {
    return `orders act on layer ${GROUND_DEPTH} tiles`;
  }

  let tile;
  try {
    tile = world.tile(address);
  } catch (err) {
    return (err as Error).message;
  }

  // A player acts through their polity, and founds one on their first claim.
  // Ownership is a kingdom's, not a person's -- which is what lets an NPC
  // kingdom and a player's be the same kind of thing to every other rule.
  let polity = world.polityOf(order.player);

  switch (order.action) {
    case 'claim': {
      if (tile.elevationM < 0) return 'that is open water';
      if (tile.owner >= 0 && tile.owner !== polity?.id) return 'already claimed';
      if (polity === undefined) polity = world.foundPolity(order.target, order.player);
      world.setDelta(address, { owner: polity.id });
      return null;
    }

    case 'settle': {
      if (polity === undefined || tile.owner !== polity.id) return 'claim it first';
      const amount = order.amount ?? 0;
      if (amount <= 0) return 'settle needs people';
      // Nothing stops a player settling more people than the tile can feed.
      // That is the game: they will starve, and the player will have to bring
      // food from somewhere. A cap here would be the population limit this
      // design does not have.
      // Settlers arrive with provisions, and how much is not a design choice:
      // it is what a person can carry. A porter's load is 30 kg, which at
      // 0.87 kg a day is five weeks of food. Enough to get a roof up and a
      // first crop in, and not enough to be lazy with.
      // A porter's load a person -- and a cartload behind each working yoke,
      // because a founding that drives cattle drives carts. Four beasts to a
      // cart: the yoke and its relief.
      const carts = Math.floor(foundingHerd(amount) / 4);
      const provisions = amount * A.PORTER_LOAD_KG + carts * A.CART_LOAD_KG;
      const existing = world.getDelta(address);
      world.setDelta(address, {
        population: tile.population + amount,
        populationHealth: tile.populationHealth,
        grainStock: (existing?.grainStock ?? 0) + provisions,
        farmShare: existing?.farmShare ?? 1,
        // Not an acre is broken. The first year is the assart.
        brokenHa: existing?.brokenHa ?? 0,
      });
      return null;
    }

    case 'abandon':
      if (polity === undefined || tile.owner !== polity.id) return 'not yours';
      world.setDelta(address, {
        owner: undefined, population: undefined, populationHealth: undefined,
      });
      return null;

    default:
      return 'unknown action';
  }
}

/**
 * A week in the life of a settlement.
 *
 * Health is the running record of whether they have been eating. It moves
 * toward the ration they actually got, at a rate set by how long a person can
 * survive on short commons -- about ten weeks, from starvation studies -- so a
 * single bad week is survivable and a bad season is not.
 *
 * Births and deaths run at the rates parish registers record, scaled by
 * health. The natural increase of three per thousand per year is why a
 * pre-industrial population took two centuries to double, and why the way to
 * grow a city is to attract people rather than to wait for them.
 *
 * There is no cap anywhere in here. A settlement grows until it runs out of
 * hands, land or food, and if it sits on a river it can keep going a long way
 * past what a landlocked one can.
 */
function stepPopulation(world: World, r: Report, blocked: boolean): boolean {
  const population = r.population;
  const health = r.health;
  const ration = clamp(r.ration, 0, 1);

  const rate = 1 / A.STARVATION_WEEKS;
  const nextHealth = clamp(health + (ration - health) * rate, 0, 1);

  // Growth needs a surplus, not merely enough. A population exactly at
  // subsistence stays put, which is what pre-industrial populations did for
  // centuries at a time.
  //
  // The surplus that counts is what is in the granary beyond a year's eating,
  // not this week's harvest. A town lives off its store, and a good week in a
  // bad year does not make anybody feel safe enough to marry.
  const annualNeed = r.grainNeed * A.TURNS_PER_YEAR;
  const surplus = annualNeed <= 0 ? 0 : clamp(r.grainStock / annualNeed, 0, 1);

  // The multiplier at full surplus is solved, not chosen: colonial America is
  // the fastest a pre-industrial population ever grew from births alone, at 3%
  // a year, and reaching that against a 32-per-thousand death rate needs
  // births at 62 per thousand -- 1.77 times the baseline.
  const maxMultiplier =
    (A.MAX_NATURAL_INCREASE_PER_YEAR * 1000 + A.DEATH_RATE_PER_1000_YR)
    / A.BIRTH_RATE_PER_1000_YR;

  const births = (population * A.BIRTH_RATE_PER_1000_YR) / 1000 / A.TURNS_PER_YEAR
    * nextHealth * (1 + (maxMultiplier - 1) * surplus);
  // Death rises as health falls: at full health the baseline rate, at zero
  // health the baseline plus everyone starving out over STARVATION_WEEKS.
  const deaths = (population * A.DEATH_RATE_PER_1000_YR) / 1000 / A.TURNS_PER_YEAR
    + population * (1 - nextHealth) * rate;

  // And people move.
  //
  // Both directions, which the first version got only half of. Headroom is
  // measured against what the town can *feed*, and that now includes what it
  // imports -- a mining town with a grain contract is as attractive as a
  // farming town with fields of its own.
  const fedCapacity = r.grainNeed <= 0 ? 0
    : ((r.grainGrown + r.grainIn - r.grainOut) * A.TURNS_PER_YEAR) / GRAIN_PER_PERSON_YEAR;
  const headroom = Math.max(0, fedCapacity - population);
  const migrants = surplus > 0.15 && ration >= 0.98
    ? (headroom * A.MIGRATION_RATE_PER_YEAR) / A.TURNS_PER_YEAR
    : 0;

  // And people leave a place that is full and has nowhere to expand to.
  //
  // This is the third outcome of land pressure, after growing and spreading.
  // A settlement whose ground cannot feed it and which has no free land within
  // reach does not simply starve -- some of it walks away. Historically that
  // is most of what population pressure looked like: not famine, emigration.
  //
  // Only fires when the settlement was actually blocked this turn, so a town
  // with somewhere to send a founding party sends one instead of bleeding.
  const leavers = blocked && r.harvest.limitedBy === 'land'
    ? (population * A.MIGRATION_RATE_PER_YEAR) / A.TURNS_PER_YEAR
    : 0;

  // Population is carried as a fraction, not an integer.
  //
  // Rounding it every turn silently destroyed all growth below one person per
  // turn: five people with an ample surplus gain 0.003 a week, and rounding
  // that away left them at exactly five for a decade. The fractional part IS
  // the growth at this scale. Same reasoning as the movement remainder.
  const next = Math.max(0, population + births - deaths + migrants - leavers);
  const nextPopulation = Math.round(next * 1000) / 1000;

  if (nextPopulation === population && Math.abs(nextHealth - health) < 0.001) return false;

  // Under half a person is nobody. A settlement does not linger at 0.4 people.
  if (nextPopulation < 0.5) {
    world.setDelta(r.address, {
      population: undefined, populationHealth: undefined,
      grainStock: undefined, ironStock: undefined, farmShare: undefined,
      herdHead: undefined, herdCondition: undefined,
      hayKg: undefined, standingKg: undefined, brokenHa: undefined,
    });
  } else {
    world.setDelta(r.address, {
      population: nextPopulation,
      populationHealth: Math.round(nextHealth * 1000) / 1000,
    });
  }
  return true;
}

/**
 * A fingerprint of one region as generated, for catching a client and server
 * that have built different worlds from the same seed.
 *
 * Hashes the realm map's elevation and biome, quantised to a metre. The
 * quantisation is deliberate: Float32 rounding on two different builds could
 * differ in the last bit for reasons that do not matter, and a desync alarm
 * that cries wolf gets switched off. A metre of elevation is far below
 * anything a player can act on and far above any rounding.
 */
export function regionFingerprint(world: World, region: number): number {
  const map = world.subMap([region]);
  const h = new Hasher();
  h.int(region);
  for (let c = 0; c < map.elevationM.length; c++) {
    h.int(Math.round(map.elevationM[c]));
    h.int(map.biome[c]);
  }
  return h.value();
}

export { toKey, fromKey };
