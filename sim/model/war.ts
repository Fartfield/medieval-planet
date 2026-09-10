// When two Houses meet: raid, tribute, and conquest.
//
// Kingdoms have spread into each other for the whole life of the project and
// simply stopped at the border. This is what happens instead. It reads the
// muster each settlement can raise -- men, iron, grain, all from stores the
// economy already keeps -- and where a House stands next to a weaker rival it
// takes what a stronger House took: the raid that carries off the stores, the
// tribute that follows, and, when the rout is total and the ground is within a
// day's hold of the victor's seat, the conquest that moves a border.
//
// WHAT MAKES THIS NOT A WAR-GAME. There is no army unit to move and no battle
// to fight by hand. A settlement that can beat its neighbour and is pressed for
// land does what land-hunger did for a thousand years -- it takes the
// neighbour's -- and the outcome is the clash the muster model already
// resolves, deterministically, no dice. The young men who fall are gone from
// the pyramid, so a hard border bleeds a generation the way a hard winter does,
// and a House that overreaches loses the harvest behind its levy.
//
// WHAT IS DERIVED AND WHAT IS A STAND-IN. The levy, the arming, the
// provisioning and the clash are all derived in muster.ts. The RAID REACH is a
// few days' march, out and back, from the same pace the border was drawn with.
// Fortification is the one stand-in, labelled: a settlement's works scale with
// its size until there is a buildings model to derive them from.

import * as A from '../anchors.ts';
import { INFANTRY_MARCH_MS } from '../derive.ts';
import { muster, clash, type ArmedForce } from './muster.ts';

/**
 * How far a raiding party strikes, metres.
 *
 * Not the forty-day authority reach that draws a kingdom's whole border -- a
 * raid is out and back in a few days. Six days, three each way, at the column
 * pace the border and the supply chain were both drawn with. It comes to about
 * fifty kilometres, which is a hard week's work and the range a real border war
 * was fought at.
 */
export const RAID_DAYS = 6;
export const RAID_REACH_M =
  (RAID_DAYS / 2) * A.MARCH_HOURS_PER_DAY * 3600 * INFANTRY_MARCH_MS;

/**
 * How much of its stores a settlement can put toward war.
 *
 * A House does not send its whole granary to the field -- the people at home
 * still eat, and the seed corn is sacred. A third of the grain over what a
 * campaign itself needs, and most of the iron, is the raiding chest. Labelled
 * as a judgement, not a measured constant.
 */
export const WARCHEST_GRAIN_SHARE = 0.33;
export const WARCHEST_IRON_SHARE = 0.8;

/**
 * What tribute a beaten settlement yields: the raider carries off a share of
 * the stores and, unless it was conquered outright, owes the like again.
 *
 * Measured against nothing -- this is the plunder a chevauchee took, which the
 * chronicles put at "all they could carry". Half the movable stores is the
 * figure that hurts without emptying, so the beaten place can recover and be
 * raided again, which is what a tributary was for.
 */
export const PLUNDER_SHARE = 0.5;

/**
 * A settlement's own defensibility, the multiplier on its defenders' weight.
 *
 * THE ONE STAND-IN in this file. A ditch and a palisade doubled the men needed
 * to storm a place and a stone wall did far more, and those works scaled with
 * the burh -- so until a buildings model derives them, fortification rises with
 * population: nothing for a hamlet, a palisade's worth by a market town, a
 * wall's by a city. Capped, because even a great wall could be starved out.
 */
export function fortification(population: number): number {
  return Math.min(2.0, Math.max(0, population - 100) / 500);
}

/** One settlement as a combatant. */
export interface Combatant {
  key: string;
  polity: number;
  x: number;
  y: number;
  z: number;
  population: number;
  ironKg: number;
  grainKg: number;
  /** Distance in metres from its own polity's capital, for the hold test. */
  fromCapitalM: number;
}

/** What one clash between settlements did, for the turn to apply. */
export interface Battle {
  attacker: string;
  defender: string;
  attackerWon: boolean;
  /** Men lost, to be taken from each population. */
  attackerDead: number;
  defenderDead: number;
  /** Grain and iron plundered from the loser to the winner. */
  grainTaken: number;
  ironTaken: number;
  /** Set when the defender's ground changes hands. */
  conqueredBy: number | null;
}

/** The muster a combatant can field from its warchest. */
export function forceOf(c: Combatant): ArmedForce {
  return muster(
    c.population,
    c.ironKg * WARCHEST_IRON_SHARE,
    c.grainKg * WARCHEST_GRAIN_SHARE,
  );
}

/** Squared chord between two combatants on the unit sphere. */
function chord2(a: Combatant, b: Combatant): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Resolve every raid this turn.
 *
 * Each settlement looks for the nearest enemy within raid reach that it can
 * BEAT -- a House does not march on a stronger neighbour -- and strikes it. A
 * settlement is raided at most once a turn (the first, strongest aggressor to
 * reach it), and a settlement that was itself beaten this turn does not also
 * raid, so a rout does not rampage. Deterministic throughout: the settlements
 * are taken in key order and every tie breaks on the key.
 *
 * `planetR` turns the raid reach into the squared chord the distance test uses.
 */
export function resolveRaids(
  combatants: readonly Combatant[], planetR: number,
): Battle[] {
  const reachChord = RAID_REACH_M / planetR;
  const reach2 = reachChord * reachChord;
  const sorted = [...combatants].sort((a, b) => a.key.localeCompare(b.key));
  const forces = new Map<string, ArmedForce>();
  for (const c of sorted) forces.set(c.key, forceOf(c));

  const raidedThisTurn = new Set<string>();
  const actedThisTurn = new Set<string>();
  const battles: Battle[] = [];

  for (const a of sorted) {
    if (actedThisTurn.has(a.key)) continue;
    const af = forces.get(a.key)!;
    if (af.power <= 0) continue;

    // The nearest enemy within reach that this House can beat.
    let target: Combatant | null = null;
    let best = Infinity;
    for (const b of sorted) {
      if (b.polity === a.polity) continue;
      if (raidedThisTurn.has(b.key)) continue;
      const d2 = chord2(a, b);
      if (d2 > reach2 || d2 >= best) continue;
      const df = forces.get(b.key)!;
      // Can A win? Weigh the defender's walls, as the clash will.
      if (af.power <= df.power * (1 + fortification(b.population))) continue;
      target = b;
      best = d2;
    }
    if (target === null) continue;

    const df = forces.get(target.key)!;
    const c = clash(af, df, fortification(target.population));
    raidedThisTurn.add(target.key);
    actedThisTurn.add(a.key);
    actedThisTurn.add(target.key);

    // PLUNDER FLOWS ONLY ON A WON RAID. If the defender holds, the raiders
    // retreat bloodied and carry off nothing -- the defender does not march on
    // the attacker's undefended home in turn, which is a second campaign
    // nobody launched. Both sides always spend the men the clash took.
    const grainTaken = c.attackerWon ? target.grainKg * PLUNDER_SHARE : 0;
    const ironTaken = c.attackerWon ? target.ironKg * PLUNDER_SHARE : 0;

    // Conquest: only on a rout, and only if the ground is within a day's hold
    // of the victor's own seat -- a border cannot move past what a House can
    // keep. Otherwise it is a raid the border survives.
    let conqueredBy: number | null = null;
    if (c.attackerWon && c.margin > 0.6) {
      const held = target.fromCapitalM <= RAID_REACH_M
        || chord2(a, target) <= reach2;
      if (held) conqueredBy = a.polity;
    }

    battles.push({
      attacker: a.key,
      defender: target.key,
      attackerWon: c.attackerWon,
      attackerDead: c.attackerLost,
      defenderDead: c.defenderLost,
      grainTaken,
      ironTaken,
      conqueredBy,
    });
  }

  return battles;
}
