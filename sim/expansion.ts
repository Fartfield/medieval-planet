// Spreading, and where kingdoms come from.
//
// THE RULE
//
// A settlement with more hands than work sends some of them away to found
// another. That is the whole of it, and everything a player will recognise as
// politics is downstream of it:
//
//   more workforce than work  ->  a party leaves and founds a daughter
//   the daughter is in reach  ->  it stays part of the same kingdom
//   the daughter is too far   ->  it cannot be held, and is its own kingdom
//   nowhere free to go        ->  expansion stops, and there is a frontier
//
// Nobody decides where a border goes. A border is where two expansions met.
//
// WHY IT WORKS WITHOUT AN AI
//
// The trigger is a diagnostic the supply model already produced for a
// completely different reason. `limitedBy: 'land'` was there to tell a player
// whether more settlers would help; it turns out to be exactly the condition
// under which a real settlement throws off a daughter. The same is true of the
// territory partition -- it exists so two towns cannot farm one field, and it
// is also, unchanged, the thing that makes expansion stop at a frontier.
//
// So there is no settlement AI in this file. There is a rule, and it is the
// same rule for a player's town and an NPC one. The player can override it;
// nobody else needs to.

import * as A from './anchors.ts';
import { fromKey, toKey, type Address } from './geo/address.ts';
import { SUBCELL_COUNT } from './geo/hexgrid.ts';
import { yieldsFor } from './gen/submap.ts';
import { IRON_DAYS_PER_KG, HELD_HECTARE_DAYS_IRON } from './model/labour.ts';
import { createPolity, withinReach, AUTHORITY_REACH_M, type Polity } from './model/polity.ts';
import type { Report } from './economy.ts';
import type { World } from './world.ts';

/** People in a founding party. */
export const FOUNDING_PARTY =
  A.FOUNDING_PARTY_FAMILIES * A.PEOPLE_PER_FAMILY;

export interface Founding {
  /** Key of the settlement that sent them. */
  parent: string;
  site: Address;
  settlers: number;
  polity: number;
  /** True if the daughter was too far from the capital to be held. */
  broke: boolean;
  distanceM: number;
}

export interface ExpansionResult {
  foundings: Founding[];
  /** Settlements that wanted to spread and had nowhere to go. A frontier. */
  blocked: string[];
  newPolities: Polity[];
}

/**
 * The share of a settlement's hands with nothing to do.
 *
 * Both trades count. Farming hands with no unworked land left are idle, and so
 * are hands set aside for ironworking in a place with no ore or no wood. A
 * settlement is overfull when the total gets past a fifth.
 */
export function idleShare(report: Report): number {
  const total = (report.population * A.WORKERS_PER_FAMILY) / 5 * A.WORKING_DAYS_PER_YEAR;
  if (total <= 0) return 0;

  const farmIdle = Math.max(0, report.harvest.labourAvailable - report.harvest.labourUsed);
  const nonFarm = total * (1 - report.farmShare);
  const ironUsed = report.ironMade * A.TURNS_PER_YEAR * IRON_DAYS_PER_KG;
  const nonFarmIdle = Math.max(0, nonFarm - ironUsed);

  return (farmIdle + nonFarmIdle) / total;
}

/** The radius of a circle holding this much land, in metres. */
function radiusOfHectares(hectares: number): number {
  return Math.sqrt((Math.max(1, hectares) * 10000) / Math.PI);
}

/** Land a party of this size can work in a year, hectares. */
export function landForSettlers(settlers: number): number {
  return ((settlers * A.WORKERS_PER_FAMILY) / A.PEOPLE_PER_FAMILY * A.WORKING_DAYS_PER_YEAR)
    / HELD_HECTARE_DAYS_IRON;
}

/**
 * How far apart two settlements have to be for BOTH to have land.
 *
 * Twice the parent's radius, because of how the boundary actually falls. Land
 * goes to whoever is nearest, so the border between two settlements sits at
 * the MIDPOINT between them -- and a daughter placed at the edge of its
 * mother's fields therefore takes half of them. To leave the parent the ground
 * it is farming, the daughter has to go twice that far out.
 *
 * Three versions of this were wrong before the midpoint was the thing that
 * fixed it, and each failed differently:
 *
 *   Twice the parent's *potential* reach: 6.2 km around a town of two
 *   thousand, wider than the search area, so expansion never happened at all.
 *
 *   The founding party's needs alone, 1.2 km: the daughter got its ground and
 *   left the parent a circle 600 m across. A town of nine hundred lost seven
 *   eighths of its production in a year to its own children.
 *
 *   Parent radius plus daughter radius: still short, because the midpoint of
 *   that distance is inside the parent's fields.
 *
 * What made the first version workable was not this formula at all -- it was
 * settlements learning to farm what they need rather than every hectare they
 * can reach. That cut the parent's worked area fivefold, and a rule that
 * demanded 6.2 km now asks for 2.6.
 */
export function spacingFor(parentHectaresWorked: number, settlers: number): number {
  const parent = radiusOfHectares(parentHectaresWorked);
  const daughter = radiusOfHectares(landForSettlers(settlers));
  return Math.max(2 * parent, parent + daughter);
}

/**
 * Find somewhere for a founding party to go.
 *
 * Searched over the parent's own catchment, which already covers seven ground
 * maps around it, ranked by what the ground actually grows rather than by what
 * it would be worth *to the parent* -- a daughter does not care how far the
 * tile is from its mother's hall, only what it can grow where it stands.
 *
 * Returns null when everywhere in reach is somebody's already. That is not a
 * failure; it is a frontier, and it is reported as one.
 */
export function findSite(
  world: World,
  parent: Address,
  parentPopulation: number,
  spacingM: number,
  occupied: readonly { x: number; y: number; z: number }[],
): { address: Address; distanceM: number; yieldKgPerHa: number } | null {
  // Searched over a wider area than the parent farms.
  //
  // Using the catchment was the obvious thing and it deadlocked: a town that
  // had filled its seven maps could see no ground but its own, so it could
  // never place a daughter, and expansion stopped dead at exactly the moment
  // population pressure was highest. A founding party walks further than a
  // farmer does, because it is not coming back tonight.
  const searchM = Math.max(spacingM * 2.0, 4000);
  // An annulus starting at the spacing: everywhere nearer is the parent's own
  // fields, and asking for a disc got the search handed a thousand tiles from
  // inside them and told there was nowhere to go.
  const { maps, addresses } = world.mapsWithin(parent, searchM, spacingM * 0.9);

  const here = world.tile(parent).dir;
  const spacingChord = spacingM / A.EARTH_RADIUS_M;
  const spacingSq = spacingChord * spacingChord;
  const searchChord = searchM / A.EARTH_RADIUS_M;
  const searchSq = searchChord * searchChord;

  // Only settlements near enough to rule a site out are worth testing against.
  const reach = searchChord + spacingChord;
  const reachSq = reach * reach;
  const nearby: { x: number; y: number; z: number }[] = [];
  for (const o of occupied) {
    const dx = here[0] - o.x;
    const dy = here[1] - o.y;
    const dz = here[2] - o.z;
    if (dx * dx + dy * dy + dz * dz <= reachSq) nearby.push(o);
  }

  let best: { address: Address; distanceM: number; yieldKgPerHa: number } | null = null;

  for (let m = 0; m < maps.length; m++) {
    const map = maps[m];
    const yields = yieldsFor(map);
    for (let c = 0; c < map.patch.count; c++) {
      if (map.elevationM[c] < 0) continue;
      const y = yields[c];
      if (y <= 0) continue;
      if (best !== null && y <= best.yieldKgPerHa) continue;

      const x = map.dirs[c * 3];
      const yy = map.dirs[c * 3 + 1];
      const z = map.dirs[c * 3 + 2];

      const hx = x - here[0];
      const hy = yy - here[1];
      const hz = z - here[2];
      const fromParentSq = hx * hx + hy * hy + hz * hz;
      if (fromParentSq > searchSq) continue;

      let clear = true;
      for (const o of nearby) {
        const dx = x - o.x;
        const dy = yy - o.y;
        const dz = z - o.z;
        if (dx * dx + dy * dy + dz * dz < spacingSq) { clear = false; break; }
      }
      if (!clear) continue;

      best = {
        address: [...addresses[m], c],
        distanceM: Math.sqrt(fromParentSq) * A.EARTH_RADIUS_M,
        yieldKgPerHa: y,
      };
    }
  }
  return best;
}

/**
 * How hard a settlement is pressing on its land: mouths over what it will feed.
 *
 * Above one means the ground cannot support the people on it, which is exactly
 * the condition that makes a town throw off a daughter. A town at 1.4 has been
 * over its land's capacity longer than one at 1.05 and its party would have set
 * out sooner.
 */
function landPressure(r: Report): number {
  const capacity = Math.max(1, r.harvest.potentialPopulation);
  return r.population / capacity;
}

/**
 * Work out who spreads where, this turn.
 *
 * Settlements are considered in order and the occupied list grows as they go,
 * so two towns cannot both send a party to the same valley in the same week.
 * Something has to decide which of them gets it.
 *
 * IT USED TO BE THE ALPHABET. The order was `a.key.localeCompare(b.key)`, which
 * is deterministic and means nothing: an address is not a fact about a town, so
 * a player whose settlement happened to sort late lost every tie it was ever in
 * and there was nothing it could do about that.
 *
 * It is land pressure now -- population over what the ground will feed. The
 * most crowded town sends its party first, which is the closest this can get to
 * the race that ought to happen without simulating two parties walking: the
 * town with the most mouths it cannot feed is the one whose people leave
 * soonest. It is also the same quantity that decides whether a town wants to
 * spread at all, so the trigger and the tie-break now agree with each other
 * instead of one being physics and the other being spelling.
 *
 * Key order survives as the final fallback, because two towns with identical
 * pressure to the last bit still have to be separated somehow and determinism
 * is not negotiable. In practice it never gets that far.
 */
export function planExpansion(
  world: World,
  reports: Map<string, Report>,
  polities: Map<number, Polity>,
  nextPolityId: number,
): ExpansionResult {
  const foundings: Founding[] = [];
  const blocked: string[] = [];
  const newPolities: Polity[] = [];

  // Everywhere anybody already is. Grows as parties are dispatched.
  const occupied: { x: number; y: number; z: number }[] = [];
  for (const report of reports.values()) {
    const dir = world.tile(report.address).dir;
    occupied.push({ x: dir[0], y: dir[1], z: dir[2] });
  }

  const ordered = [...reports.values()].sort((a, b) => {
    const pa = landPressure(a);
    const pb = landPressure(b);
    if (pa !== pb) return pb - pa;
    return a.key.localeCompare(b.key);
  });

  for (const report of ordered) {
    // Land pressure is the trigger, not idle hands.
    //
    // Idle hands looked like the right reading of "more workforce than work",
    // and it is not: only farming is modelled, so a normal settlement shows
    // 60% of its labour unused when in truth that labour is building, weaving,
    // carting and doing everything this simulation does not have. Triggering on
    // it made every village want to spread from its first week.
    //
    // `limitedBy: 'land'` is the honest version. It means the ground could not
    // grow what they set out to grow, however many hands they put on it -- and
    // that is precisely when a real settlement threw off a daughter.
    if (report.harvest.limitedBy !== 'land') continue;
    if (report.population < FOUNDING_PARTY * 2) continue;
    if (report.grainStock < FOUNDING_PARTY * A.PORTER_LOAD_KG) continue;

    // Deliberately NO test that the settlement is comfortable.
    //
    // A guard requiring a ration of one was added when parents were being
    // strangled by their own daughters, and it was patching the wrong thing --
    // the spacing was at fault. It is also backwards historically: population
    // pressure is exactly when people leave, and a town short of food is
    // better off by twenty mouths the moment the party walks out of the gate.
    // Colonisation is what hunger looks like when there is somewhere to go.

    const spacing = spacingFor(report.harvest.hectaresWorked, FOUNDING_PARTY);
    const site = findSite(world, report.address, report.population, spacing, occupied);
    if (site === null) { blocked.push(report.key); continue; }

    // Which kingdom does it belong to? Whichever one can reach it.
    const tile = world.tile(report.address);
    const owner = tile.owner >= 0 ? polities.get(tile.owner) : undefined;
    let polityId = tile.owner;
    let broke = false;

    if (owner !== undefined) {
      const capital = world.tile(fromKey(owner.capital));
      const dx = world.tile(site.address).dir[0] - capital.dir[0];
      const dy = world.tile(site.address).dir[1] - capital.dir[1];
      const dz = world.tile(site.address).dir[2] - capital.dir[2];
      const fromCapital = Math.sqrt(dx * dx + dy * dy + dz * dz) * A.EARTH_RADIUS_M;

      if (!withinReach(fromCapital)) {
        // Too far to be held. Forty days of service does not stretch that far,
        // so it is nobody's but its own from the day it is founded.
        broke = true;
        polityId = nextPolityId + newPolities.length;
        newPolities.push(createPolity(
          polityId, toKey(site.address), world.turn, world.seed, null));
      }
    }

    foundings.push({
      parent: report.key,
      site: site.address,
      settlers: FOUNDING_PARTY,
      polity: polityId,
      broke,
      distanceM: site.distanceM,
    });

    const dir = world.tile(site.address).dir;
    occupied.push({ x: dir[0], y: dir[1], z: dir[2] });
  }

  return { foundings, blocked, newPolities };
}

/** Carry out the foundings: people and provisions leave, a village appears. */
export function applyExpansion(world: World, result: ExpansionResult): Set<string> {
  const touched = new Set<string>();

  for (const f of result.foundings) {
    const parentAddress = fromKey(f.parent);
    const parent = world.getDelta(parentAddress);
    if (parent === undefined) continue;

    const provisions = f.settlers * A.PORTER_LOAD_KG;
    const remaining = (parent.population ?? 0) - f.settlers;
    if (remaining < 1) continue;

    world.setDelta(parentAddress, {
      population: Math.round(remaining * 1000) / 1000,
      grainStock: Math.round(((parent.grainStock ?? 0) - provisions) * 10) / 10,
    });
    touched.add(f.parent);

    world.setDelta(f.site, {
      owner: f.polity,
      population: f.settlers,
      populationHealth: parent.populationHealth ?? 1,
      grainStock: provisions,
      // A daughter starts by farming. It will work out what it is for the
      // same way its mother did.
      farmShare: 1,
    });
    touched.add(toKey(f.site));
  }
  return touched;
}

export { AUTHORITY_REACH_M };
