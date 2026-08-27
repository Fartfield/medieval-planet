// Spreading, kingdoms, and the frontier.
//
// The claim under test is that nobody designs a border. A settlement grows
// until its land will not feed it, throws off a daughter, and stops when
// everywhere in reach belongs to somebody. Political geography is the residue.
//
// The reach that bounds a kingdom is derived from the forty days a feudal levy
// owed and the pace a column marches, so it gets a test of its own: if that
// number ever stops being about 400 km, either the march rate moved or
// somebody typed something in.

import * as A from '../sim/anchors.ts';
import { World } from '../sim/world.ts';
import { resolveTurn } from '../sim/turn.ts';
import { toKey, fromKey } from '../sim/geo/address.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { SUBCELL_COUNT } from '../sim/geo/hexgrid.ts';
import { yieldsFor } from '../sim/gen/submap.ts';
import { Biome } from '../sim/model/biome.ts';
import {
  AUTHORITY_REACH_KM, AUTHORITY_REACH_M, withinReach, nameFor, createPolity,
} from '../sim/model/polity.ts';
import { spacingFor, FOUNDING_PARTY, idleShare } from '../sim/expansion.ts';
import { INFANTRY_MARCH_MS } from '../sim/derive.ts';
import { check, measure, assert, suite } from './harness.ts';

const SEED = 20260826;

/** The same well-watered site every run, so the measurements compare. */
function cradle(w: World): number[] {
  let region = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (w.planet.elevationM[c] > 100 && w.planet.biome[c] === Biome.Savanna) { region = c; break; }
  }
  const map = w.subMap([region, 4959]);
  const ys = yieldsFor(map);
  let best = 0;
  for (let c = 0; c < SUBCELL_COUNT; c++) if (ys[c] > ys[best]) best = c;
  return [region, 4959, best];
}

suite('how far a kingdom reaches', () => {
  // Forty days of service, three eighths of them marching out, at the column
  // pace the supply model derived from what a man carries and how fast he
  // walks under it. Every term measured; none of them chosen.
  measure('authority reach km', AUTHORITY_REACH_KM);
  assert('a kingdom reaches a few hundred kilometres',
    AUTHORITY_REACH_KM > 250 && AUTHORITY_REACH_KM < 600);

  // Recomputed here from the anchors, so the constant cannot drift away from
  // its own derivation without this noticing.
  const byHand = A.FEUDAL_SERVICE_DAYS * A.CAMPAIGN_MARCH_SHARE
    * A.MARCH_HOURS_PER_DAY * 3600 * INFANTRY_MARCH_MS;
  check('reach matches its derivation', AUTHORITY_REACH_M, byHand, 1e-6);

  assert('somewhere close is within reach', withinReach(AUTHORITY_REACH_M * 0.5));
  assert('somewhere far is not', !withinReach(AUTHORITY_REACH_M * 1.5));

  // Names must be stable for the life of a world, or somebody's homeland gets
  // renamed by a refactor.
  check('a polity name is stable', nameFor(3, SEED) === nameFor(3, SEED) ? 1 : 0, 1, 0);
  assert('different polities get different names', nameFor(3, SEED) !== nameFor(4, SEED));
  assert('a different world names them differently', nameFor(3, SEED) !== nameFor(3, SEED + 1));

  const p = createPolity(7, 'a.b.c', 12, SEED, 2);
  check('a founded polity keeps its id', p.id, 7, 0);
  check('and remembers when', p.founded, 12, 0);
  check('and who is steering it', p.player ?? -1, 2, 0);
  assert('and owes tribute to nobody yet', p.tributaryTo === null);
});

suite('where a daughter goes', () => {
  // Twice the parent's radius, because land goes to whoever is nearest and
  // the border between two settlements therefore sits at the MIDPOINT. A
  // daughter placed at the edge of its mother's fields takes half of them.
  const smallParent = spacingFor(50, FOUNDING_PARTY);
  const bigParent = spacingFor(500, FOUNDING_PARTY);
  measure('founding party', FOUNDING_PARTY);
  measure('spacing from a 50 ha parent', smallParent);
  measure('spacing from a 500 ha parent', bigParent);

  assert('a daughter is founded a mile or two from a village',
    smallParent > 500 && smallParent < 3000);
  assert('a bigger parent needs more room', bigParent > smallParent);

  // The midpoint rule, stated directly: the boundary must fall at or beyond
  // the edge of what the parent is farming, or founding a village is an act
  // of self-harm. A town of nine hundred lost seven eighths of its production
  // in a year when this was wrong.
  const parentRadius = Math.sqrt((500 * 10000) / Math.PI);
  assert('the boundary leaves the parent its fields', bigParent / 2 >= parentRadius - 1);

  assert('a bigger party needs at least as much room',
    spacingFor(50, 200) >= spacingFor(50, 20));
});

suite('a kingdom spreading', () => {
  const w = new World({ seed: SEED, cacheSize: 64 });
  const seat = cradle(w);
  const crown = w.foundPolity(toKey(seat), 0);
  check('the world starts with one polity', w.polities.size, 1, 0);

  w.setDelta(seat, {
    owner: crown.id, population: 120, populationHealth: 1,
    grainStock: 120 * 330, farmShare: 1,
  });

  let founded = 0;
  let firstFoundingTurn = -1;
  let everBlocked = 0;
  const t0 = Date.now();
  const TURNS = 4700; // ninety game-years

  for (let t = 1; t <= TURNS; t++) {
    const res = resolveTurn(w, [], 1);
    founded += res.foundings.length;
    everBlocked += res.blocked.length;
    if (firstFoundingTurn < 0 && res.foundings.length > 0) firstFoundingTurn = t;
  }
  const elapsed = Date.now() - t0;

  let towns = 0;
  let people = 0;
  for (const d of w.allDeltas()) {
    if ((d.population ?? 0) > 0) { towns++; people += d.population ?? 0; }
  }

  measure('towns after ninety years', towns);
  measure('people after ninety years', people);
  measure('daughters founded', founded);
  measure('first founding on turn', firstFoundingTurn);
  measure('turns per second', TURNS / (elapsed / 1000));

  // THE ASSERTION THIS FILE EXISTS FOR: one settlement becomes many, without
  // anybody deciding where any of them go.
  assert('one settlement became many', towns > 5);
  assert('by sending out founding parties', founded >= towns - 1);

  // It must not spread from the first week. A settlement with land to spare
  // grows into it first -- triggering on idle hands instead of land pressure
  // made every village throw off a daughter immediately.
  assert('it grows before it spreads', firstFoundingTurn > 52);

  // And it must stop. When everywhere in reach belongs to somebody, expansion
  // is blocked, and that is a frontier rather than a failure.
  assert('expansion eventually runs out of room', everBlocked > 0);

  // All of them stayed one kingdom, because all of them are well inside the
  // 393 km an army can march and return within its forty days.
  check('they are all still one kingdom', w.polities.size, 1, 0);
  check('and the crown holds all of them', w.settlementsOf(crown.id).length, towns, 0);

  // Every settlement must sit in a real polity.
  let orphans = 0;
  for (const d of w.allDeltas()) {
    if ((d.population ?? 0) <= 0) continue;
    if (d.owner === undefined || !w.polities.has(d.owner)) orphans++;
  }
  check('no settlement is orphaned', orphans, 0, 0);

  // Daughters must be spaced, not piled on top of each other.
  const sites = w.allDeltas()
    .filter((d) => (d.population ?? 0) > 0)
    .map((d) => w.tile(fromKey(d.key)).dir);
  let tooClose = 0;
  const minChord = (spacingFor(20, FOUNDING_PARTY) * 0.5) / A.EARTH_RADIUS_M;
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const dx = sites[i][0] - sites[j][0];
      const dy = sites[i][1] - sites[j][1];
      const dz = sites[i][2] - sites[j][2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < minChord) tooClose++;
    }
  }
  check('no two settlements are on top of each other', tooClose, 0, 0);
});

suite('spreading is deterministic', () => {
  // Two worlds, same seed, same opening move, run in lockstep. A world whose
  // political history depended on anything but its seed and its orders could
  // not be persisted, replayed, or shared between two machines.
  function play(): { towns: number; keys: string[]; people: number } {
    const w = new World({ seed: SEED, cacheSize: 64 });
    const seat = cradle(w);
    const crown = w.foundPolity(toKey(seat), 0);
    w.setDelta(seat, {
      owner: crown.id, population: 120, populationHealth: 1,
      grainStock: 120 * 330, farmShare: 1,
    });
    for (let t = 0; t < 1800; t++) resolveTurn(w, [], 1);

    const live = w.allDeltas().filter((d) => (d.population ?? 0) > 0);
    return {
      towns: live.length,
      keys: live.map((d) => d.key).sort(),
      people: live.reduce((n, d) => n + (d.population ?? 0), 0),
    };
  }

  const a = play();
  const b = play();
  check('the same world spreads to the same number of towns', a.towns, b.towns, 0);
  check('in the same places', a.keys.join(',') === b.keys.join(',') ? 1 : 0, 1, 0);
  check('with the same people in them', a.people, b.people, 0);
  measure('towns in the determinism run', a.towns);
});

suite('idleness is only a diagnostic', () => {
  // idleShare was the first spreading trigger and it was wrong: only farming
  // is modelled, so a healthy settlement reads 30-60% "idle" when in truth
  // those hands are building, weaving and carting. Kept as a number a player
  // can look at; it decides nothing.
  const w = new World({ seed: SEED, cacheSize: 32 });
  const seat = cradle(w);
  const crown = w.foundPolity(toKey(seat), 0);
  w.setDelta(seat, {
    owner: crown.id, population: 200, populationHealth: 1,
    grainStock: 200 * 330, farmShare: 1,
  });
  const res = resolveTurn(w, [], 1);
  const report = res.reports.get(toKey(seat));
  assert('a report is produced', report !== undefined);
  if (report === undefined) return;

  measure('idle share of a comfortable settlement', idleShare(report));
  assert('a comfortable settlement has hands to spare',
    idleShare(report) > 0 && idleShare(report) < 1);
  assert('and is not spreading because of it', res.foundings.length === 0);
});
