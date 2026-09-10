// What a realm can field, and who wins when two do, against the record.
//
// The army is derived from the same three stores the economy already keeps --
// men, iron, grain -- so every figure here is a prediction, and the ones that
// matter are the ones the sources pin: a realm raised about a twelfth of its
// people for a summer levy; a spearman needs a kilogramme of iron and a mailed
// man thirteen; a mailed line beat a rabble at odds no numbers made up; and an
// army in the field carried its forty days and no more, which is the same
// forty days that set the kingdom's reach.

import {
  levyCap, fightingAgeMen, arm, muster, clash, CALLABLE_SHARE,
  SPEAR_IRON_KG, MAIL_IRON_KG,
} from '../sim/model/muster.ts';
import { SOLDIER_GRAIN_KG_PER_DAY } from '../sim/derive.ts';
import * as A from '../sim/anchors.ts';
import { check, measure, assert, suite } from './harness.ts';

suite('the muster', () => {
  // THE LEVY, against the historical share. A realm of a thousand fields about
  // eighty fighting men for a summer -- the select fyrd, not the whole rabble.
  const levy1000 = levyCap(1000);
  measure('fighting men a realm of a thousand can raise', levy1000);
  measure('which is this share of the people', levy1000 / 1000);
  assert('a summer levy is about a twelfth of the people',
    levy1000 / 1000 > 0.06 && levy1000 / 1000 < 0.12);
  check('and it scales with the people', levyCap(4000), levy1000 * 4, 1e-9);
  check('nobody comes from nowhere', levyCap(0), 0, 0);
  // The pool it is drawn from is the fighting-age men -- itself a share of the
  // pyramid's working hands -- and the levy is the callable half of them.
  measure('fighting-age men in a realm of a thousand', fightingAgeMen(1000));
  check('the levy is the callable share of the fighting-age men',
    levy1000, fightingAgeMen(1000) * CALLABLE_SHARE, 1e-9);

  // IRON ARMS THEM, mail first. A store of iron enough for ten hauberks puts
  // ten men in mail and the rest in spears until the iron runs out.
  const men = 80;
  const bigIron = men * MAIL_IRON_KG; // enough to mail everyone
  const armed = arm(men, bigIron, men * SOLDIER_GRAIN_KG_PER_DAY * 40);
  measure('men in mail when iron is plentiful', armed.mailed);
  assert('plenty of iron mails the whole line',
    armed.mailed > men - 1);

  const thinIron = 10 * MAIL_IRON_KG; // ten hauberks' worth
  const half = arm(men, thinIron, men * SOLDIER_GRAIN_KG_PER_DAY * 40);
  measure('men in mail on ten hauberks of iron', half.mailed);
  check('the iron mails ten and no more', half.mailed, 10, 0.01);
  assert('and the rest still take spears while any iron is left',
    half.men === men);

  const noIron = arm(men, 0, men * SOLDIER_GRAIN_KG_PER_DAY * 40);
  measure('a rabble\'s fighting weight, per man', noIron.power / men);
  const mailedForce = arm(men, bigIron, men * SOLDIER_GRAIN_KG_PER_DAY * 40);
  measure('a mailed host\'s weight, per man', mailedForce.power / men);
  // Mail against a spearman is threefold; against an unarmed mob it is more
  // again -- 7.5, the ratio of the two per-man weights -- which is why an
  // armed retinue could scatter a peasant rising many times its size.
  assert('mail is worth multiples of a bare man',
    mailedForce.power / noIron.power > 5 && mailedForce.power / noIron.power < 9);

  // GRAIN KEEPS THEM. Days in the field are the baggage over the ration,
  // capped at the forty the levy owes -- and an unfed host barely fights.
  const dayNeed = SOLDIER_GRAIN_KG_PER_DAY;
  measure('a soldier eats this much grain a day, kg', dayNeed);
  assert('a soldier out-eats a ploughman', dayNeed > 0.7);
  const wellFed = arm(men, thinIron, men * dayNeed * 40);
  const starving = arm(men, thinIron, men * dayNeed * 2);
  measure('a well-victualled force\'s campaign days', wellFed.campaignDays);
  measure('and a near-empty baggage\'s', starving.campaignDays);
  check('full baggage is the forty days owed and no more',
    wellFed.campaignDays, A.FEUDAL_SERVICE_DAYS, 0.01);
  assert('and an army cannot campaign past its service',
    arm(men, thinIron, men * dayNeed * 100).campaignDays <= A.FEUDAL_SERVICE_DAYS);
  assert('the hungry host fights at a fraction of the fed one',
    starving.power < wellFed.power * 0.7);

  // THE WHOLE MUSTER from a settlement's books.
  const m = muster(1000, 50 * MAIL_IRON_KG, 1000 * dayNeed * 5);
  measure('a thousand-soul realm musters this many men', m.men);
  measure('of them in mail', m.mailed);
  assert('the muster is the levy, armed and fed', m.men > 60 && m.men < 90);

  // THE CLASH. The heavier force wins, and how heavy decides the butcher's
  // bill.
  const big = arm(120, 120 * MAIL_IRON_KG, 120 * dayNeed * 40);
  const small = arm(60, 0, 60 * dayNeed * 40);
  const rout = clash(big, small);
  measure('a mailed 120 against a bare 60: attacker won', rout.attackerWon ? 1 : 0);
  measure('the loser\'s dead', rout.defenderLost);
  measure('the winner\'s dead', rout.attackerLost);
  assert('the heavier, better-armed host wins', rout.attackerWon);
  assert('a rout breaks the loser', rout.defenderLost > small.men * 0.5);
  assert('and costs the winner little', rout.attackerLost < big.men * 0.2);
  assert('a rout is decisive', rout.margin > 0.7);

  // TWO EQUAL HOSTS ruin each other -- which is why nobody sought that battle.
  const evenA = arm(80, 80 * SPEAR_IRON_KG, 80 * dayNeed * 40);
  const evenB = arm(80, 80 * SPEAR_IRON_KG, 80 * dayNeed * 40);
  const draw = clash(evenA, evenB);
  measure('two equal hosts: the attacker\'s dead', draw.attackerLost);
  measure('and the defender\'s', draw.defenderLost);
  assert('an even fight bleeds both far worse than a rout does the winner',
    draw.attackerLost > rout.attackerLost * 2
    && draw.defenderLost > rout.attackerLost * 2);
  assert('and it is close', draw.margin < 0.2);

  // A WALL is worth men. The same defender behind works turns a loss into a
  // hold.
  const attackerForce = arm(100, 100 * SPEAR_IRON_KG, 100 * dayNeed * 40);
  const defenderForce = arm(70, 70 * SPEAR_IRON_KG, 70 * dayNeed * 40);
  const openField = clash(attackerForce, defenderForce, 0);
  const behindWalls = clash(attackerForce, defenderForce, 1.0);
  measure('70 hold against 100 in the open: they lose', openField.attackerWon ? 1 : 0);
  measure('and behind a wall: the attacker is thrown back', behindWalls.attackerWon ? 1 : 0);
  assert('in the open the bigger host takes the place', openField.attackerWon);
  assert('a wall turns the same fight', !behindWalls.attackerWon);

  // NEITHER SIDE FIGHTS WITH NOBODY. An empty muster loses without a blow.
  const none = arm(0, 0, 0);
  const someone = arm(50, 0, 50 * dayNeed * 40);
  const walkover = clash(someone, none);
  assert('a force meeting no defender simply takes the field',
    walkover.attackerWon && walkover.attackerLost < 1);
  check('and spends no men doing it', walkover.attackerLost, 0, 1);

  // DETERMINISM, because this runs in the lockstep turn.
  const c1 = clash(big, small, 0.5);
  const c2 = clash(big, small, 0.5);
  check('the same clash resolves the same', c1.defenderLost, c2.defenderLost, 0);
});
