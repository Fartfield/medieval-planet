// A week in the economy: produce, trade, eat, decide.
//
// THE ORDER IS THE ARGUMENT, AGAIN
//
//   produce   with the hands and tools you have now
//   trade     so what one town has spare reaches one that has none
//   consume   people eat, tools wear out
//   decide    shift hands between the fields and the mine for next week
//
// Producing before trading is the important one. A settlement cannot spend
// grain it has not grown yet, and letting it would make the market a wish
// rather than a market. Deciding last is the other: the labour split is a
// *plan*, revised from how the year actually went, which is why it is carried
// on the delta rather than recomputed.
//
// THE DECISION THAT MAKES TOWNS SPECIALISE
//
// One rule does all of it, and it turns on a diagnostic the supply model
// already produces:
//
//   short of food and limited by HANDS  -> put more hands on the fields
//   short of food and limited by LAND   -> more hands would not help. Put them
//                                          in the mine and buy grain instead.
//
// A town on bare rock is land-limited from its first week, so it walks its
// farm share down and becomes a mining town that lives on imports. A town on
// good soil is hand-limited, keeps farming, and ends up feeding the miners.
// Neither was told to. It is the same arithmetic reading two different pieces
// of ground.

import * as A from './anchors.ts';
import { woodNeedKgPerYear } from './model/woodland.ts';
import { SOLDIER_GRAIN_KG_PER_DAY } from './derive.ts';
import { fromKey, type Address } from './geo/address.ts';
import { clamp } from './gen/mathx.ts';
import { Mineral } from './model/resources.ts';
import { ironOutputKgPerYear, ironLimit, hectareDays } from './model/labour.ts';
import { clear, stockTarget, spoil, type Trader, type Flow } from './model/trade.ts';
import { navigable } from './gen/hydrology.ts';
import {
  weekOfYear, harvestWindow, inWindow, HARVEST_SPAN_WEEKS,
} from './model/season.ts';
import {
  villageHerdWeek, foundingHerd, type VillageHerd,
} from './model/village_herd.ts';
import { WHEAT } from './model/species.ts';
import { Part } from './model/plant.ts';
import { harvest as harvestPlant, compositionOf } from './model/process.ts';
import { foodKcalPerKg } from './model/material.ts';
import { idleShare } from './expansion.ts';
import type { Harvest, Competitor } from './model/settlement.ts';
import type { World } from './world.ts';
import type { TileDelta } from './model/tile.ts';

/** Grain one person eats in a year, kg. */
export const GRAIN_PER_PERSON_YEAR = SOLDIER_GRAIN_KG_PER_DAY * 365.25;

/** How fast a settlement shifts hands between trades. A tenth a week is about
 *  a season to turn a farming town into a mining one, which is the right
 *  order: people change trade over months, not overnight. */
const SHARE_STEP = 0.1;

/** A town never abandons its fields entirely -- there is always a croft. */
const MIN_FARM_SHARE = 0.05;

/**
 * A kilogramme of bread grain, in kcal, for pricing the herd's food in the
 * granary's own unit. Milk and meat are folded into the ration as
 * grain-equivalent kilogrammes -- a bookkeeping convenience, labelled as one,
 * until the stores carry more goods than grain.
 */
const GRAIN_KCAL_PER_KG = foodKcalPerKg(compositionOf(
  harvestPlant(WHEAT, 0.8, 1, 30, A.TURNS_PER_YEAR, 1)
    .find((p) => p.part === Part.Seed)!,
));

export interface Report {
  key: string;
  address: Address;
  population: number;
  health: number;

  /** The village herd, head of cattle, after this week. */
  herdHead: number;
  /** Its condition, 1 in full flesh. */
  herdCondition: number;
  /** Beasts lost to want this week. */
  herdDied: number;
  /** Beasts slaughtered at the autumn cull this week. */
  herdCulled: number;
  /** Hay in the barn, kg. */
  hayKg: number;
  /** Milk and meat off the herd this week, as grain-equivalent kg. */
  herdFoodKg: number;
  /** The pasture's standing crop, kg dry. */
  standingKg: number;

  farmShare: number;
  /** How much of the iron it wants that it has, 0..1. Drives farm labour. */
  ironSupply: number;

  grainGrown: number;
  grainNeed: number;
  grainStock: number;
  grainIn: number;
  grainOut: number;

  ironMade: number;
  ironNeed: number;
  ironStock: number;
  ironIn: number;
  ironOut: number;
  ironLimitedBy: 'no ore' | 'hands' | 'wood';
  oreRichness: number;
  /** What the woodland in reach GROWS in a year, kg. Not what it stands. */
  timberKgPerYear: number;
  /** What the hearths burn in a year, kg, before any smelting. */
  woodNeedKgPerYear: number;
  /** How much of that the woodland's growth covers, 0..1. */
  woodSupply: number;

  /** Is there anybody else in the world to trade with?
   *
   * A town alone cannot specialise however rich its ore, because there is
   * nobody to buy the iron and nobody to sell it the food it stops growing.
   * This is deliberately "anybody at all" rather than "anybody in reach": the
   * market's own distance limits decide whether a trade actually happens, and
   * a town whose only neighbour is unreachable will still find that out the
   * ordinary way, by watching grain fail to arrive. */
  alone: boolean;

  /** Fraction of what people needed that they actually got. */
  ration: number;
  /** Share of the settlement's hands with nothing to do. Drives spreading
   *  and, when there is nowhere to spread to, emigration. */
  idleShare: number;
  harvest: Harvest;
  trade: 'exporter' | 'importer' | 'self-sufficient';
  speciality: 'farming' | 'ironworking' | 'mixed';
}

export interface EconomyResult {
  reports: Map<string, Report>;
  grainFlows: Flow[];
  ironFlows: Flow[];
  /** Keys whose delta changed and must be broadcast. */
  touched: Set<string>;
}

/**
 * Run one week for every settlement in the world.
 *
 * Iterating the delta list rather than the world, because the world is a
 * trillion tiles and all but a handful of them are empty. This is the payoff
 * of storing only changes: the economy costs what is *played*, not what exists.
 */
export function runEconomy(world: World): EconomyResult {
  const perTurn = 1 / A.TURNS_PER_YEAR;
  const reports = new Map<string, Report>();
  const touched = new Set<string>();

  // --- who is where ---------------------------------------------------------
  //
  // Gathered before anything is produced, because every settlement's harvest
  // depends on where the others are: land goes to whoever is nearest it, and
  // two towns cannot both farm the same field. See settlement.ts:harvest.

  const sites: { key: string; address: Address; population: number; at: Competitor }[] = [];
  for (const delta of world.allDeltas()) {
    const population = delta.population ?? 0;
    if (population <= 0) continue;
    const address = fromKey(delta.key);
    const dir = world.tile(address).dir;
    sites.push({
      key: delta.key,
      address,
      population,
      at: { x: dir[0], y: dir[1], z: dir[2] },
    });
  }
  sites.sort((a, b) => a.key.localeCompare(b.key));

  // --- produce --------------------------------------------------------------

  const settlements: { delta: TileDelta; address: Address; report: Report }[] = [];

  for (const delta of world.allDeltas()) {
    const population = delta.population ?? 0;
    if (population <= 0) continue;
    const address = fromKey(delta.key);
    const tile = world.tile(address);
    const neighbours = sites.filter((s) => s.key !== delta.key).map((s) => s.at);

    const grainNeed = population * GRAIN_PER_PERSON_YEAR;
    const ironNeed = population * A.IRON_PER_PERSON_KG_PER_YEAR;

    // A FOUNDING ARRIVES PROVISIONED. Nobody walks into the wilderness in
    // February without the wagons: a settlement whose granary has never been
    // written starts with the stock target, and every later week reads what
    // the weeks before it left. Without this, any village founded outside the
    // harvest window starved before its first crop could possibly exist.
    const grainStock = delta.grainStock ?? stockTarget(grainNeed);
    const ironStock = delta.ironStock ?? 0;
    const farmShare = clamp(delta.farmShare ?? 1, MIN_FARM_SHARE, 1);

    // Tools in hand decide how hard the farming is. A settlement with a year's
    // iron put by has all its ploughs shod; one with none is scratching.
    const ironSupply = ironNeed <= 0 ? 1 : clamp(ironStock / ironNeed, 0, 1);

    // What it is trying to grow.
    //
    // Not a year's eating -- a bad year's eating. Medieval yields swung 30-50%
    // about their mean, so a village that sowed for an average year starved
    // every time the weather turned. Sowing for the bad year is why there is a
    // surplus in a good one, and that surplus is what feeds a town, fills a
    // granary and pays a tax.
    //
    // Plus whatever the granary is still short, plus what it sold last year.
    // That last term is what keeps a supplier supplying: without it a farming
    // town grows exactly what it needs, its population rises until it eats
    // that, and the grain feeding its neighbour's miners simply stops.
    const sold = (delta.soldKg ?? 0) * A.TURNS_PER_YEAR;
    const target = grainNeed / A.BAD_YEAR_YIELD_FRACTION
      + Math.max(0, stockTarget(grainNeed) - grainStock)
      + sold;
    const harvest = world.harvestFor(
      address, population, ironSupply, farmShare, neighbours, target);
    const alone = neighbours.length === 0;

    // THE GRAIN ARRIVES WHEN IT RIPENS, not by fifty-second every week. The
    // harvest window is derived from the growing season's own end -- late
    // summer at 52 north, the other half of the year south of the line -- and
    // the whole year's crop lands inside it. Between harvests the village
    // lives on the granary, which is what a granary is; a place warm enough to
    // grow all year has no window, crops continuously, and never invented one.
    const ripening = harvestWindow(tile.temperatureC, tile.dir[1]);
    const week = weekOfYear(world.turn);
    const grainGrown = ripening === null
      ? harvest.netKgPerYear * perTurn
      : inWindow(ripening, week)
        ? harvest.netKgPerYear / HARVEST_SPAN_WEEKS
        : 0;

    const catchment = world.catchmentFor(address, population);

    // THE HERD'S WEEK. It grazes the same catchment the fields are cut from,
    // makes its hay in early summer, is culled to the barn at the close of the
    // harvest window, and its milk and cull meat join the village's food as
    // grain-equivalent kilogrammes. A founding's herd walked in on the hoof.
    const herdBefore: VillageHerd = {
      head: delta.herdHead ?? foundingHerd(population),
      condition: delta.herdCondition ?? 1,
      hayKg: delta.hayKg ?? 0,
      standingKg: delta.standingKg ?? 0,
    };
    const herdWeekOut = villageHerdWeek(
      herdBefore, catchment.forageKgPerYear, tile.temperatureC, tile.dir[1], week,
    );
    const herdFoodKg = herdWeekOut.foodKcal / GRAIN_KCAL_PER_KG;

    // Whatever hands are not farming go to the ore, if there is any.
    const ore = tile.deposits.find((d) => d.kind === Mineral.Iron);
    const oreRichness = ore?.richness ?? 0;
    const idleDays =
      (population * A.WORKERS_PER_FAMILY) / 5 * A.WORKING_DAYS_PER_YEAR * (1 - farmShare);

    // THE HEARTHS ARE SERVED BEFORE THE FURNACE, and until now they were not
    // served at all: ironworking had the whole of the woodland's increment to
    // burn while the people living there heated and cooked on nothing.
    //
    // Fuel first is not a rule imposed on the model, it is what a village does.
    // Nobody smelts iron in a cold house. So the domestic demand comes off the
    // top and the smith gets the remainder, which is why a big settlement in
    // thin woodland stops making iron long before it stops being a settlement.
    //
    // It is also a much larger demand than the furnace: measured, a village of
    // 200 burns 204 tonnes a year at its hearths and 4 at its forge.
    const woodNeed = woodNeedKgPerYear(population, 0);
    const woodSupplyRatio = woodNeed <= 0
      ? 1
      : Math.min(1, catchment.timberKgPerYear / woodNeed);
    const woodForIron = Math.max(0, catchment.timberKgPerYear - woodNeed);
    const ironMade =
      ironOutputKgPerYear(idleDays, oreRichness, woodForIron) * perTurn;

    reports.set(delta.key, {
      key: delta.key,
      address,
      population,
      health: delta.populationHealth ?? 1,
      herdHead: herdWeekOut.herd.head,
      herdCondition: herdWeekOut.herd.condition,
      herdDied: herdWeekOut.died,
      herdCulled: herdWeekOut.culled,
      hayKg: herdWeekOut.herd.hayKg,
      herdFoodKg,
      standingKg: herdWeekOut.herd.standingKg,
      farmShare,
      ironSupply,
      grainGrown,
      grainNeed: grainNeed * perTurn,
      // The dairy and the shambles arrive with the harvest: herd food goes
      // into the same stock the ration is eaten from.
      grainStock: grainStock + grainGrown + herdFoodKg,
      grainIn: 0,
      grainOut: 0,
      ironMade,
      ironNeed: ironNeed * perTurn,
      ironStock: ironStock + ironMade,
      ironIn: 0,
      ironOut: 0,
      ironLimitedBy: ironLimit(idleDays, oreRichness, woodForIron),
      oreRichness,
      timberKgPerYear: catchment.timberKgPerYear,
      woodNeedKgPerYear: woodNeed,
      woodSupply: woodSupplyRatio,
      alone,
      ration: 0,
      idleShare: 0,
      harvest,
      trade: 'self-sufficient',
      speciality: farmShare > 0.8 ? 'farming' : farmShare < 0.35 ? 'ironworking' : 'mixed',
    });
    settlements.push({ delta, address, report: reports.get(delta.key)! });
  }

  // --- trade ----------------------------------------------------------------

  const grainFlows = tradeGood(world, settlements, reports, 'grain');
  const ironFlows = tradeGood(world, settlements, reports, 'iron');

  // --- consume and decide ---------------------------------------------------

  for (const { delta, address, report } of settlements) {
    // Spoilage first, so a granary is not a perfect store.
    report.grainStock = Math.max(0, report.grainStock - spoil(report.grainStock));

    const eaten = Math.min(report.grainStock, report.grainNeed);
    report.ration = report.grainNeed <= 0 ? 1 : eaten / report.grainNeed;
    report.grainStock -= eaten;

    // Tools wear out whether or not they were replaced.
    report.ironStock = Math.max(0, report.ironStock - report.ironNeed);

    report.trade = report.grainOut > report.grainIn ? 'exporter'
      : report.grainIn > 0 ? 'importer' : 'self-sufficient';
    report.idleShare = idleShare(report);

    const nextShare = decideFarmShare(report);
    report.speciality = nextShare > 0.8 ? 'farming'
      : nextShare < 0.35 ? 'ironworking' : 'mixed';

    world.setDelta(address, {
      grainStock: round(report.grainStock),
      ironStock: round(report.ironStock),
      farmShare: Math.round(nextShare * 100) / 100,
      soldKg: report.grainOut > 0 ? round(report.grainOut) : undefined,
      // The herd, rounded like the population: the fractional part IS the
      // growth at this scale, and a calf a fortnight is under a thousandth.
      herdHead: Math.round(report.herdHead * 1000) / 1000,
      herdCondition: Math.round(report.herdCondition * 1000) / 1000,
      hayKg: round(report.hayKg),
      standingKg: round(report.standingKg),
    });
    touched.add(delta.key);
  }

  return { reports, grainFlows, ironFlows, touched };
}

/**
 * Which way to move hands for next week.
 *
 * The whole specialisation rule, and it reads the diagnostic the supply model
 * already produces rather than needing one of its own.
 */
function decideFarmShare(r: Report): number {
  const share = r.farmShare;

  // Nothing else the hands could be doing. Farm, and export what is spare.
  if (r.oreRichness <= 0 || r.timberKgPerYear <= 0) return 1;

  const yearGrain = r.grainNeed * A.TURNS_PER_YEAR;
  const yearIron = r.ironNeed * A.TURNS_PER_YEAR;
  const monthsOfFood = yearGrain <= 0 ? 12 : (r.grainStock / yearGrain) * 12;

  // Is anybody actually delivering grain?
  //
  // A town alone in the wilderness must farm, however poor the ground, because
  // there is nothing else to eat. Grain arriving is the observable fact that
  // says a different trade is survivable.
  //
  // This used to be declared inside the hungry branch below, and it guarded
  // only that branch -- so a town that was *fed* could strip its fields with
  // nobody bringing food. Measured: a settlement alone on 169 kg/ha farmed
  // contentedly for ten years, banked a granary, and then, because it wanted
  // iron for its own ploughs and had nine months of food behind it, walked its
  // farm share down to the 0.05 floor. Its ration fell to 0.13 and it was
  // living entirely on stores it had no way to replace. A full granary is a
  // reason to think you can afford to specialise; it is not somebody bringing
  // you food, and only the second one is survivable.
  const someoneFeedsUs = r.grainIn > 0;

  // Hungry, or nearly. This overrides everything.
  if (r.ration < 0.98 || monthsOfFood < 3) {
    // Would farming harder actually fix it?
    //
    // Not if the land is full -- that is the obvious case. But also not if the
    // ground is simply bad: a town on 69 kg/ha runs out of *hands* long before
    // it runs out of ground, so it reads as labour-limited, and an earlier
    // version of this rule therefore told it to farm harder every single week
    // for ever. It never specialised and never could have.
    //
    // The honest test is whether full effort would be enough, and the harvest
    // already answers that: if what the fields yield is well short of what the
    // people need, more hands on them is not the answer.
    const farmingCannotFix = r.harvest.limitedBy === 'land'
      || r.harvest.ration < 0.8;

    return farmingCannotFix && someoneFeedsUs
      ? clamp(share - SHARE_STEP, MIN_FARM_SHARE, 1)
      : clamp(share + SHARE_STEP, MIN_FARM_SHARE, 1);
  }

  // Fed. Now: is anybody actually going to take the iron?
  //
  // There is no price in this project, so a town cannot watch iron get
  // cheaper. It can watch two things instead: whether its own ploughs are
  // shod, and whether anyone came to buy. Those are facts a producer can
  // observe, and they are enough.
  //
  // Requiring a demand signal is what stopped this oscillating. The first
  // version specialised whenever the land was full and pulled back whenever
  // the yard was full, so it flipped every single turn between 90% and 100%
  // farming and settled at neither.
  const wantsItself = r.ironSupply < 0.9;
  const somebodyBought = r.ironOut > 0;
  const glut = r.ironStock > yearIron * 2 && !somebodyBought && !wantsItself;

  if (glut) return clamp(share + SHARE_STEP, MIN_FARM_SHARE, 1);

  // Specialise only with a full granary behind it. A town that puts its hands
  // in a mine before it has a year of food starves in the first bad week.
  // AND there has to be somebody out there.
  //
  // `someoneFeedsUs` is the right test when the town is hungry, because by then
  // grain either is or is not arriving. It is the wrong test for *starting*,
  // and using it here deadlocked the pair: a town will not buy grain until it
  // stops growing its own, and it will not stop growing its own until grain is
  // arriving. Nothing ever moved.
  //
  // What distinguishes the two cases before any trade has happened is simply
  // whether anyone else exists. A town alone in the wilderness has nobody to
  // buy its iron and nobody to sell it food, so its ore is worth nothing to it
  // however rich it is.
  if ((wantsItself || somebodyBought) && monthsOfFood >= 9 && !r.alone) {
    return clamp(share - SHARE_STEP, MIN_FARM_SHARE, 1);
  }
  return share;
}

/** Build the market for one good, clear it, and post the results. */
function tradeGood(
  world: World,
  settlements: { report: Report }[],
  reports: Map<string, Report>,
  good: 'grain' | 'iron',
): Flow[] {
  const traders: Trader[] = [];

  for (const { report } of settlements) {
    const tile = world.tile(report.address);
    const stock = good === 'grain' ? report.grainStock : report.ironStock;
    const need = good === 'grain' ? report.grainNeed : report.ironNeed;
    const target = stockTarget(need * A.TURNS_PER_YEAR);

    traders.push({
      key: report.key,
      address: report.address,
      dir: tile.dir,
      // A boat can reach it if it stands on a navigable channel or a coast.
      navigable: navigable(tile.dischargeM3S) || tile.fauna.fish > 0,
      offered: Math.max(0, stock - target),
      wanted: Math.max(0, target - stock),
    });
  }

  const cleared = clear(traders);

  for (const [key, amount] of cleared.received) {
    const r = reports.get(key);
    if (r === undefined) continue;
    if (good === 'grain') { r.grainStock += amount; r.grainIn += amount; }
    else { r.ironStock += amount; r.ironIn += amount; }
  }
  for (const [key, amount] of cleared.sent) {
    const r = reports.get(key);
    if (r === undefined) continue;
    if (good === 'grain') { r.grainStock -= amount; r.grainOut += amount; }
    else { r.ironStock -= amount; r.ironOut += amount; }
  }
  return cleared.flows;
}

/** Stocks are rounded to the kilogramme. Storing them to fifteen decimal
 *  places would triple the size of the delta log for no reason anybody
 *  could ever measure. */
function round(kg: number): number {
  return Math.round(kg * 10) / 10;
}
