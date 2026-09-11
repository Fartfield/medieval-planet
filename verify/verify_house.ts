// Why the great houses die out, against Galton's own question.
//
// In 1874 Galton and Watson asked why so many distinguished families vanished
// despite their wealth and fertility, and founded the theory of branching
// processes to answer it. The answer: a male line is a branch that, on average,
// just barely replaces itself each generation, and a branch that barely
// replaces itself dies with certainty given time. This suite runs the house
// model forward over three centuries and reads that death off it -- the
// extinction of the line is not a number written into the model, it is what the
// demography's own fertility and life table do to a single thread of descent.
//
// THE RECORD IT IS MEASURED AGAINST. Hollingsworth's study of the British
// peerage found about a quarter of male holders left no son to follow them --
// and the model, told only the married birth rate and the mortality table,
// lands a lord's no-heir share there without being asked to. The reigns run
// long, because the only death here is natural death: a ruler who could also
// fall in battle or to a murderer's knife reigned shorter, and that is the war
// the next increment lets reach the throne. And the extinction runs fast,
// because a house holding one seat has only its brothers for collateral, not
// the landed cadet branches that kept the real great dynasties alive -- the one
// labelled stand-in in house.ts, and the thing verify measures the cost of.

import {
  foundHouse, houseYear, lordFalls, successionLine, mortalityAt,
  SONS_PER_LORD_YEAR, ADULT_AGE, ELDER_AGE,
  type House, type Person,
} from '../sim/model/house.ts';
import {
  BIRTHS_PER_MARRIED_WOMAN_YEAR, HAND_MORTALITY, ELDER_MORTALITY,
} from '../sim/model/hearths.ts';
import { hash3 } from '../sim/gen/noise.ts';
import { check, measure, assert, suite } from './harness.ts';

const SEED = 20260911;

suite('the house', () => {
  // THE RATES ARE THE DEMOGRAPHY'S, not this model's. If hearths.ts ever
  // re-prices fertility or mortality, these move and the baseline says so.
  measure('sons a reigning lord gets per year', SONS_PER_LORD_YEAR);
  check('a lord\'s sons are half the married birth rate',
    SONS_PER_LORD_YEAR, BIRTHS_PER_MARRIED_WOMAN_YEAR * 0.5, 1e-12);
  check('an adult lord dies at the hand rate', mortalityAt(30), HAND_MORTALITY, 0);
  check('an old lord dies at the elder rate', mortalityAt(70), ELDER_MORTALITY, 0);
  assert('a man may rule and breed from fifteen, and breed until sixty',
    ADULT_AGE === 15 && ELDER_AGE === 60);

  // THE SUCCESSION LAW, proven structurally on hand-built lines rather than
  // read from the aggregate. Ranks are the immutable place in the succession:
  // the founder is [0], a lord's k-th son is [...lord.rank, k].
  const line = (members: Person[]): number[] =>
    successionLine({
      id: 0, salt: 0, foundedYear: 0, members, lordId: members[0]?.id ?? -1,
      lordSinceYear: 0, nextId: 100, extinctYear: null,
    } as House);

  // A lord with two sons and a younger brother: lord, then his sons eldest
  // first, then the brother -- the sons come before the uncle.
  const withSons = line([
    { id: 1, bornYear: 0, sons: 2, rank: [0, 0] },       // the lord
    { id: 2, bornYear: 20, sons: 0, rank: [0, 0, 0] },   // his elder son
    { id: 3, bornYear: 22, sons: 0, rank: [0, 0, 1] },   // his younger son
    { id: 4, bornYear: 5, sons: 0, rank: [0, 1] },       // the lord's brother
  ]);
  assert('a lord\'s sons inherit before his brother, eldest son first',
    withSons[0] === 1 && withSons[1] === 2 && withSons[2] === 3 && withSons[3] === 4);

  // REPRESENTATION: a dead heir's son stands in his father's place. The elder
  // son died (not in the living set) but left a grandson; that grandson
  // inherits before the lord's younger son.
  const byRepresentation = line([
    { id: 10, bornYear: 40, sons: 0, rank: [0, 0, 0] },  // grandson via elder son
    { id: 11, bornYear: 22, sons: 0, rank: [0, 1] },     // the lord's younger son
  ]);
  assert('a dead heir\'s son inherits before the heir\'s younger brother',
    byRepresentation[0] === 10 && byRepresentation[1] === 11);

  // THE LONG RUN. Many houses, founded together with a lord of twenty-five,
  // run three centuries. Everything below is read off the run.
  const N = 2000;
  const YEARS = 300;
  const houses: House[] = [];
  for (let i = 0; i < N; i++) houses.push(foundHouse(i, SEED, 0, 25));

  const reignLengths: number[] = [];
  const lordStart = houses.map(() => 0);
  let lordsTotal = 0;
  let lordsLeftHeir = 0;
  let sonsBorn = 0;
  const extinctBy: Record<number, number> = {};
  const marks = [50, 100, 200, 300];

  for (let y = 1; y <= YEARS; y++) {
    for (let i = 0; i < N; i++) {
      const h = houses[i];
      if (h.extinctYear !== null) continue;
      const ev = houseYear(h, y);
      if (ev.bornId !== null) sonsBorn++;
      if (ev.lordDied) {
        reignLengths.push(y - lordStart[i]);
        lordStart[i] = y;
        lordsTotal++;
        if (!ev.extinct) lordsLeftHeir++;
      }
    }
    if (marks.includes(y)) {
      let ex = 0;
      for (const h of houses) if (h.extinctYear !== null && h.extinctYear <= y) ex++;
      extinctBy[y] = ex / N;
    }
  }

  const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const noHeir = 1 - lordsLeftHeir / Math.max(1, lordsTotal);

  // A LORD'S NO-HEIR SHARE -- the Hollingsworth figure, reached from the birth
  // rate and the life table alone.
  measure('reigns that ended in three centuries', lordsTotal);
  measure('a lord\'s chance of leaving no male heir', noHeir);
  assert('about a quarter of lords leave no son, as the peerage did',
    noHeir > 0.2 && noHeir < 0.32);

  // MEAN REIGN, the natural-death reign -- long, because no lord here dies by
  // violence. Labelled so the figure is not mistaken for the historical ~20
  // years, which counts the battlefield and the assassin this model does not.
  measure('mean reign, natural death only (yr)', mean(reignLengths));
  assert('a reign of natural death runs a generation or more',
    mean(reignLengths) > 25 && mean(reignLengths) < 45);

  // SONS BORN per reign -- the raw fertility, before the life table thins them.
  measure('sons born per completed reign', sonsBorn / Math.max(1, lordsTotal));
  assert('a reign fathers two or three sons',
    sonsBorn / lordsTotal > 1.5 && sonsBorn / lordsTotal < 3);

  // THE EXTINCTION CURVE. The headline: the share of houses whose male line has
  // failed, rising with every generation, as Galton said it must.
  measure('lines extinct by year 50', extinctBy[50]);
  measure('lines extinct by year 100', extinctBy[100]);
  measure('lines extinct by year 200', extinctBy[200]);
  measure('lines extinct by year 300', extinctBy[300]);
  assert('extinction only grows with time',
    extinctBy[50] < extinctBy[100] && extinctBy[100] < extinctBy[200]
    && extinctBy[200] < extinctBy[300]);
  assert('most single-seat lines have failed within three centuries',
    extinctBy[300] > 0.8 && extinctBy[300] < 0.98);
  assert('but a few great houses endure the whole span',
    extinctBy[300] < 1);
  // Half gone within a century is the pace a single-title line died at, and the
  // reason a medieval baronage turned over so fast.
  assert('roughly half the lines are gone within a century',
    extinctBy[100] > 0.4 && extinctBy[100] < 0.6);

  // ONCE EXTINCT, STAYS EXTINCT: a failed line is not raised by a later year,
  // and living another year does nothing to it.
  const dead = houses.find((h) => h.extinctYear !== null)!;
  const deadAt = dead.extinctYear;
  const after = houseYear(dead, YEARS + 1);
  assert('a dead line stays dead and its year of death stands',
    dead.extinctYear === deadAt && dead.members.length === 0
    && after.bornId === null && !after.lordDied);

  // DETERMINISM, because a house lives inside the lockstep turn: the same seed
  // buries the same lords and ends the same lines on the same years.
  const again: House[] = [];
  for (let i = 0; i < N; i++) again.push(foundHouse(i, SEED, 0, 25));
  for (let y = 1; y <= YEARS; y++) {
    for (const h of again) if (h.extinctYear !== null) continue; else houseYear(h, y);
  }
  let exA = 0; for (const h of houses) if (h.extinctYear !== null) exA++;
  let exB = 0; for (const h of again) if (h.extinctYear !== null) exB++;
  check('the same seed ends the same number of lines', exB, exA, 0);

  // WAR TAKES A LORD. lordFalls kills the reigning lord outright -- the clash
  // decided it, no coin -- and seats the heir, or ends the line if none lives.
  const withHeir: House = {
    id: 0, salt: 0, foundedYear: 0, lordId: 1, lordSinceYear: 0, nextId: 3,
    extinctYear: null,
    members: [
      { id: 1, bornYear: 0, sons: 1, rank: [0] },       // the lord
      { id: 2, bornYear: 20, sons: 0, rank: [0, 0] },    // his heir
    ],
  };
  const fell = lordFalls(withHeir, 30);
  assert('a lord who falls in war is dead and his heir takes the seat',
    fell.lordDied && fell.succeeded === 2 && !fell.extinct && withHeir.lordId === 2);
  const soleLord: House = {
    id: 0, salt: 0, foundedYear: 0, lordId: 1, lordSinceYear: 0, nextId: 2,
    extinctYear: null,
    members: [{ id: 1, bornYear: 0, sons: 0, rank: [0] }],
  };
  const lastStand = lordFalls(soleLord, 30);
  assert('a lord with no heir who falls ends the line',
    lastStand.lordDied && lastStand.extinct && soleLord.lordId < 0
    && soleLord.extinctYear === 30);
  // lordFalls on an extinct or vacant house does nothing.
  const none = lordFalls(soleLord, 31);
  assert('the fallen cannot fall again', !none.lordDied && !none.extinct);

  // WAR SHORTENS THE REIGN. Run houses that, besides the life table, face an
  // annual chance of losing their lord in battle -- a realm that fights. The
  // reign falls from the long natural-death span toward the twenty years the
  // medieval crowns averaged, which is the whole point of letting war reach the
  // throne. The annual rate is illustrative, standing in for how often a realm
  // is in a losing fight; the real rate is the battle's own casualty fraction,
  // measured end to end in verify_war.
  const meanReignUnderWar = (warYearly: number): number => {
    const K = 2000; const Y = 300;
    const hs: House[] = [];
    for (let i = 0; i < K; i++) hs.push(foundHouse(i, SEED + 1, 0, 25));
    const reigns: number[] = [];
    const start = hs.map(() => 0);
    for (let y = 1; y <= Y; y++) {
      for (let i = 0; i < K; i++) {
        const h = hs[i];
        if (h.extinctYear !== null) continue;
        if ((hash3(y, i, 9, SEED + 1) >>> 0) / 4294967296 < warYearly) {
          const ev = lordFalls(h, y);
          if (ev.lordDied) { reigns.push(y - start[i]); start[i] = y; }
        }
        const ev2 = houseYear(h, y);
        if (ev2.lordDied) { reigns.push(y - start[i]); start[i] = y; }
      }
    }
    return reigns.reduce((s, x) => s + x, 0) / Math.max(1, reigns.length);
  };
  const peace = meanReignUnderWar(0);
  const war = meanReignUnderWar(0.03);
  measure('mean reign with no war (yr)', peace);
  measure('mean reign for a realm that fights (yr)', war);
  assert('war shortens the reign', war < peace);
  assert('war brings a fighting realm\'s reign into the span a medieval crown had',
    war > 14 && war < 24);
});
