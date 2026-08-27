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
import { SOLDIER_GRAIN_KG_PER_DAY } from './derive.ts';
import { fromKey, toKey, type Address } from './geo/address.ts';
import { clamp } from './gen/mathx.ts';
import { Hasher } from './hash.ts';
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
export function weeklyGrainKg(world: World, address: Address, population: number): number {
  return world.harvestFor(address, population).netKgPerYear / A.TURNS_PER_YEAR;
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

  // Then everyone who lives anywhere eats. Iterating the delta list rather
  // than the world, because the world is a trillion tiles and all but a
  // handful of them are empty -- this is the payoff of storing only changes.
  for (const delta of world.allDeltas()) {
    if (!delta.population || delta.population <= 0) continue;
    const address = fromKey(delta.key);
    if (stepPopulation(world, address, delta)) touched.add(delta.key);
  }

  world.turn++;

  const changed: TileDelta[] = [];
  for (const key of touched) {
    const d = world.getDelta(fromKey(key));
    // A tile emptied this turn -- abandoned, or everyone on it died -- has no
    // delta any more. Send a tombstone so clients drop theirs too.
    changed.push(d ?? { key, turn: world.turn });
  }
  return { turn: world.turn, changed, rejected };
}

function applyOrder(world: World, order: Order, playerCount: number): string | null {
  if (order.player < 0 || order.player >= playerCount) return 'no such player';

  let address: Address;
  try {
    address = fromKey(order.target);
  } catch {
    return 'malformed address';
  }
  if (address.length !== 3) return 'orders act on ground tiles';

  let tile;
  try {
    tile = world.tile(address);
  } catch (err) {
    return (err as Error).message;
  }

  switch (order.action) {
    case 'claim':
      if (tile.elevationM < 0) return 'that is open water';
      if (tile.owner >= 0 && tile.owner !== order.player) return 'already claimed';
      world.setDelta(address, { owner: order.player });
      return null;

    case 'settle': {
      if (tile.owner !== order.player) return 'claim it first';
      const amount = order.amount ?? 0;
      if (amount <= 0) return 'settle needs people';
      // Nothing stops a player settling more people than the tile can feed.
      // That is the game: they will starve, and the player will have to bring
      // food from somewhere. A cap here would be the population limit this
      // design does not have.
      world.setDelta(address, {
        population: tile.population + amount,
        populationHealth: tile.populationHealth,
      });
      return null;
    }

    case 'abandon':
      if (tile.owner !== order.player) return 'not yours';
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
function stepPopulation(world: World, address: Address, delta: TileDelta): boolean {
  const population = delta.population ?? 0;
  const health = delta.populationHealth ?? 1;

  const gathered = world.harvestFor(address, population);
  const ration = clamp(gathered.ration, 0, 1);

  const rate = 1 / A.STARVATION_WEEKS;
  const nextHealth = clamp(health + (ration - health) * rate, 0, 1);

  // Growth needs a surplus, not merely enough. A population exactly at
  // subsistence stays put, which is what pre-industrial populations did for
  // centuries at a time.
  //
  // The multiplier at full surplus is solved, not chosen: colonial America is
  // the fastest a pre-industrial population ever grew from births alone, at 3%
  // a year, and reaching that against a 32-per-thousand death rate needs
  // births at 62 per thousand -- 1.77 times the baseline.
  const surplus = clamp(gathered.ration - 1, 0, 1);
  const maxMultiplier =
    (A.MAX_NATURAL_INCREASE_PER_YEAR * 1000 + A.DEATH_RATE_PER_1000_YR)
    / A.BIRTH_RATE_PER_1000_YR;

  const births = (population * A.BIRTH_RATE_PER_1000_YR) / 1000 / A.TURNS_PER_YEAR
    * nextHealth * (1 + (maxMultiplier - 1) * surplus);
  // Death rises as health falls: at full health the baseline rate, at zero
  // health the baseline plus everyone starving out over STARVATION_WEEKS.
  const deaths = (population * A.DEATH_RATE_PER_1000_YR) / 1000 / A.TURNS_PER_YEAR
    + population * (1 - nextHealth) * rate;

  // And people move to where there is food. This is how a settlement actually
  // grows -- medieval towns grew by immigration, not by birth, because urban
  // death rates ran ahead of urban birth rates almost everywhere.
  const headroom = Math.max(0, gathered.potentialPopulation - population);
  const migrants = gathered.ration >= A.MIGRATION_MIN_RATION
    ? (headroom * A.MIGRATION_RATE_PER_YEAR) / A.TURNS_PER_YEAR
    : 0;

  // Population is carried as a fraction, not an integer.
  //
  // Rounding it every turn silently destroyed all growth below one person per
  // turn: a settlement of five with an ample surplus gains 0.003 people a week,
  // and rounding that away left it at exactly five for ten game-years. The
  // fractional part IS the growth at this scale, and it has to survive the
  // turn boundary. Same reasoning as the movement remainder in derive.ts.
  const next = Math.max(0, population + births - deaths + migrants);
  const nextPopulation = Math.round(next * 1000) / 1000;

  if (nextPopulation === population && Math.abs(nextHealth - health) < 0.001) return false;

  // Under half a person is nobody. A settlement does not linger at 0.4 people.
  if (nextPopulation < 0.5) {
    world.setDelta(address, { population: undefined, populationHealth: undefined });
  } else {
    world.setDelta(address, {
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
