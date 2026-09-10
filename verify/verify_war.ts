// Two Houses that meet, and what the border does.
//
// Every other suite spreads one kingdom into empty land, so none of them ever
// fights -- which is why the whole economy could be built without a war model
// and why adding one moved no baseline. This suite is the one that puts two
// rival crowns within a march of each other and runs the turn, so the raid,
// the plunder, the casualties and the conquest all happen against a real world
// rather than a hand-made muster.
//
// THE CLAIM is that a stronger House takes from a weaker neighbour and the
// border moves toward the strong -- but not without cost, and not past what a
// House can hold. A war bleeds the young men of both sides, so it echoes in the
// pyramid; and two evenly matched Houses grind at each other without either
// swallowing the other, which is the stalemate most medieval borders were.

import { World } from '../sim/world.ts';
import { resolveTurn } from '../sim/turn.ts';
import { toKey } from '../sim/geo/address.ts';
import {
  RAID_REACH_M, fortification, forceOf, resolveRaids, type Combatant,
} from '../sim/model/war.ts';
import { populationOf } from '../sim/model/hearths.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

const SEED = 20260826;

/** A land tile in a named region, deep to the plot layer. */
function plot(world: World, region: number, cell: number): number[] {
  return [region, 45, 45, 45, 45, cell];
}

suite('the border', () => {
  // THE RAID REACH is a few days' march, derived from the same pace as the
  // border -- shorter than the forty-day authority reach, longer than a walk.
  measure('a raid strikes this far, km', RAID_REACH_M / 1000);
  assert('a raid is days of march, not the whole realm\'s reach',
    RAID_REACH_M / 1000 > 20 && RAID_REACH_M / 1000 < 90);

  // FORTIFICATION rises with the town and caps.
  measure('a hamlet\'s works', fortification(80));
  measure('a market town\'s', fortification(600));
  measure('a city\'s', fortification(2000));
  check('a hamlet has no walls worth the name', fortification(80), 0, 0);
  assert('a town has a palisade', fortification(600) > 0.5 && fortification(600) < 1.5);
  assert('and the works cap, for even a wall can be starved',
    fortification(100000) <= 2.01);

  // TWO RIVALS, ONE STRONG ONE WEAK, a few km apart on good ground. Built as
  // combatants directly so the clash is read without the whole turn.
  const strong: Combatant = {
    key: 'S', polity: 0, x: 0.30, y: 0.50, z: Math.sqrt(1 - 0.09 - 0.25),
    population: 800, ironKg: 800, grainKg: 400000, fromCapitalM: 1000,
  };
  const weak: Combatant = {
    key: 'W', polity: 1, x: 0.3005, y: 0.5004, z: Math.sqrt(1 - 0.30055 ** 2 - 0.5004 ** 2),
    population: 200, ironKg: 40, grainKg: 60000, fromCapitalM: 1000,
  };
  measure('the strong House\'s fighting weight', forceOf(strong).power);
  measure('the weak House\'s', forceOf(weak).power);
  assert('the greater House is the greater force',
    forceOf(strong).power > forceOf(weak).power);

  const battles = resolveRaids([strong, weak], A.EARTH_RADIUS_M);
  measure('raids fought', battles.length);
  assert('the strong House raids the weak', battles.length === 1
    && battles[0].attacker === 'S' && battles[0].defender === 'W');
  const b = battles[0];
  assert('and wins', b.attackerWon);
  measure('the weak House\'s dead', b.defenderDead);
  measure('the strong House\'s dead', b.attackerDead);
  assert('the loser bleeds far worse than the winner',
    b.defenderDead > b.attackerDead * 2);
  measure('grain plundered', b.grainTaken);
  assert('and is plundered of its stores', b.grainTaken > 0 && b.ironTaken > 0);
  measure('the weak ground is conquered', b.conqueredBy ?? -1);
  assert('a rout on ground the victor can hold moves the border',
    b.conqueredBy === 0);

  // A WON RAID PLUNDERS; A REPULSE DOES NOT. Turn the odds around: the weak
  // House cannot raid the strong, so no blow falls the other way.
  const noBattle = resolveRaids([weak, strong], A.EARTH_RADIUS_M);
  assert('the weak House does not march on the strong',
    noBattle.length === 1 && noBattle[0].attacker === 'S');

  // TWO EQUAL HOUSES do not settle it: neither can beat the other behind its
  // works, so no raid is even launched -- the stalemate a border was.
  const evenA: Combatant = { ...strong, key: 'A', polity: 0, population: 500, ironKg: 200 };
  const evenB: Combatant = {
    ...weak, key: 'B', polity: 1, population: 500, ironKg: 200, grainKg: 400000,
  };
  const stalemate = resolveRaids([evenA, evenB], A.EARTH_RADIUS_M);
  measure('raids between two equal Houses', stalemate.length);
  assert('evenly matched Houses do not raid, the walls deciding it',
    stalemate.length === 0);

  // OUT OF REACH, NO WAR. Move the weak House far off and the strong cannot
  // touch it.
  const far: Combatant = { ...weak, key: 'F', x: -0.3, y: -0.5 };
  const none = resolveRaids([strong, far], A.EARTH_RADIUS_M);
  check('a House beyond the raid reach is not raided', none.length, 0, 0);

  // DETERMINISM.
  const again = resolveRaids([strong, weak], A.EARTH_RADIUS_M);
  check('the same border fights the same war',
    again[0].defenderDead, b.defenderDead, 0);

  // END TO END THROUGH THE REAL TURN. Two crowns a few tiles apart, run for a
  // few years, and the strong should take ground and men from the weak.
  const world = new World({ seed: SEED });
  let land: number[] | null = null;
  let region = -1;
  outer:
  for (let r = 0; r < 240; r += 3) {
    if (world.tile([r, 45]).elevationM < 50) continue;
    for (let c = 40; c < 46; c++) {
      const t = world.tile(plot(world, r, c));
      if (t.elevationM > 20 && t.nppGm2 > 400 && t.slope < 0.05) { land = plot(world, r, c); region = r; break outer; }
    }
  }
  if (land !== null) {
    const strongSeat = land;
    const weakSeat = [region, 45, 45, 45, 45, land[5] === 45 ? 46 : 45];
    const cS = world.foundPolity(toKey(strongSeat), 0);
    const cW = world.foundPolity(toKey(weakSeat), 1);
    world.setDelta(strongSeat, {
      owner: cS.id, population: 600, populationHealth: 1,
      grainStock: 600 * 330, ironStock: 3000, farmShare: 1,
    });
    world.setDelta(weakSeat, {
      owner: cW.id, population: 120, populationHealth: 1,
      grainStock: 120 * 330, ironStock: 60, farmShare: 1,
    });
    let raidsSeen = 0;
    let weakDeadTotal = 0;
    for (let t = 0; t < Math.round(6 * A.TURNS_PER_YEAR); t++) {
      const res = resolveTurn(world, [], 1);
      raidsSeen += res.battles.length;
      for (const bt of res.battles) if (bt.defender === toKey(weakSeat)) weakDeadTotal += bt.defenderDead;
    }
    measure('raids over six years on the border', raidsSeen);
    measure('men the weak seat lost to raids', Math.round(weakDeadTotal));
    assert('the border was fought over', raidsSeen > 0);
    // The weak seat is either conquered (owner flipped to the strong crown) or
    // bled -- either way the strong House prevailed on the border.
    const weakNow = world.getDelta(weakSeat);
    const conquered = (weakNow?.owner ?? cW.id) === cS.id;
    measure('the weak seat was conquered', conquered ? 1 : 0);
    assert('the strong House took ground or blood from the weak',
      conquered || weakDeadTotal > 0);
    // Determinism of the whole run.
    const w2 = new World({ seed: SEED });
    w2.foundPolity(toKey(strongSeat), 0);
    w2.foundPolity(toKey(weakSeat), 1);
    w2.setDelta(strongSeat, { owner: 0, population: 600, populationHealth: 1, grainStock: 600 * 330, ironStock: 3000, farmShare: 1 });
    w2.setDelta(weakSeat, { owner: 1, population: 120, populationHealth: 1, grainStock: 120 * 330, ironStock: 60, farmShare: 1 });
    let raids2 = 0;
    for (let t = 0; t < Math.round(6 * A.TURNS_PER_YEAR); t++) raids2 += resolveTurn(w2, [], 1).battles.length;
    check('the same two crowns fight the same war', raids2, raidsSeen, 0);
  }
});
