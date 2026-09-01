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
import { bestFarmSite, siblingIn } from './sites.ts';
import { check, measure, assert, suite, timing } from './harness.ts';

const SEED = 20260826;

/** The same well-watered site every run, so the measurements compare. */
function cradle(w: World): number[] {
  return bestFarmSite(w);
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
  const w = new World({ seed: SEED });
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
  // Forty game-years. The cradle fills its land around year fifteen and has
  // thrown off seven daughters by year twenty, so this is long enough to show
  // the whole cycle -- grow, fill, spread, run out of room -- without paying
  // for fifty more years of a world that is already doing it.
  const TURNS = 2088;

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

  measure('towns after forty years', towns);
  measure('people after forty years', people);
  measure('daughters founded', founded);
  measure('first founding on turn', firstFoundingTurn);
  timing('turns per second', TURNS / (elapsed / 1000));

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

suite('who spreads first is earned, not alphabetical', () => {
  // Settlements are considered in order and the occupied list grows as they go,
  // so when two want the same valley in the same week the order decides it. It
  // used to be `a.key.localeCompare(b.key)` -- an address, which is not a fact
  // about a town. A player whose settlement sorted late lost every tie it was
  // ever in and could do nothing about it. It is land pressure now.
  //
  // WITHIN THE TURN is where this has to be measured. A first attempt compared
  // the TURN each town founded on and passed without testing anything: both
  // found on the same turn, so every `<=` was trivially true and the old
  // alphabetical rule would have passed it too. What discriminates is the
  // position in that turn's founding list, which is the order itself.
  function order(crowded: 'seat' | 'sibling'): { seat: number; sibling: number } {
    const w = new World({ seed: SEED });
    const seat = cradle(w);
    const crown = w.foundPolity(toKey(seat), 0);
    // The best OTHER ground on the same map. Scoring by yield alone returns
    // the seat itself -- it is the best ground, that is why it is the seat --
    // and the two "towns" were then one tile, which is how a first version of
    // this test found both of them sitting at index 0.
    const seatCell = seat[seat.length - 1];
    const sibling = siblingIn(w, seat, (y, cell) => (cell === seatCell ? -Infinity : y));
    if (sibling === null) return { seat: -1, sibling: -1 };

    const heavy = 260;
    const light = 130;
    const seatPop = crowded === 'seat' ? heavy : light;
    const sibPop = crowded === 'sibling' ? heavy : light;
    w.setDelta(seat, {
      owner: crown.id, populationHealth: 1, farmShare: 1,
      population: seatPop, grainStock: seatPop * 330,
    });
    w.setDelta(sibling, {
      owner: crown.id, populationHealth: 1, farmShare: 1,
      population: sibPop, grainStock: sibPop * 330,
    });

    // The first turn in which BOTH send a party, and where each sat in it.
    for (let t = 0; t < 900; t++) {
      const res = resolveTurn(w, [], 1);
      const si = res.foundings.findIndex((f) => f.parent === toKey(seat));
      const bi = res.foundings.findIndex((f) => f.parent === toKey(sibling));
      if (si >= 0 && bi >= 0) return { seat: si, sibling: bi };
    }
    return { seat: -1, sibling: -1 };
  }

  const seatCrowded = order('seat');
  const sibCrowded = order('sibling');

  measure('seat’s place in the turn when the seat is crowded', seatCrowded.seat);
  measure('sibling’s place in the same turn', seatCrowded.sibling);
  measure('seat’s place when the SIBLING is crowded', sibCrowded.seat);
  measure('sibling’s place in that turn', sibCrowded.sibling);

  assert('there are two towns, not one twice',
    seatCrowded.seat >= 0 && sibCrowded.seat >= 0);

  // THE CLAIM: whichever town is crowded is considered first, whichever way the
  // keys sort. Under the old rule the same key led both times.
  assert('the crowded town is considered first',
    seatCrowded.seat < seatCrowded.sibling && sibCrowded.sibling < sibCrowded.seat);
});

suite('spreading is deterministic', () => {
  // Two worlds, same seed, same opening move, run in lockstep. A world whose
  // political history depended on anything but its seed and its orders could
  // not be persisted, replayed, or shared between two machines.
  function play(): { towns: number; keys: string[]; people: number } {
    const w = new World({ seed: SEED });
    const seat = cradle(w);
    const crown = w.foundPolity(toKey(seat), 0);
    w.setDelta(seat, {
      owner: crown.id, population: 120, populationHealth: 1,
      grainStock: 120 * 330, farmShare: 1,
    });
    for (let t = 0; t < 1044; t++) resolveTurn(w, [], 1);

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
  const w = new World({ seed: SEED });
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
