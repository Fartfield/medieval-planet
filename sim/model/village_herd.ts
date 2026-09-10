// The village herd: the husbandry loop wired to a settlement's own ground.
//
// husbandry.ts knows how a herd eats, gains and starves; this knows how a
// VILLAGE keeps one. The pasture is the settlement's real catchment, the hay
// is mown from that pasture's own summer growth, the cull is at the close of
// the harvest window -- the Michaelmas slaughter, at the week the derived
// calendar puts it -- and what comes off the herd goes to the people: milk
// through the summer, meat and hides at the cull, all of it counted in the
// same energy the grain is.
//
// THE HERD IS NOW STATE. Head count, condition, the barn and the standing
// crop ride on the tile's delta like the granary does, which makes the drawn
// cattle the settlement's ACTUAL beasts rather than a picture of what the
// ground could carry -- and makes a hard winter something that happens to
// your herd, on your screen, at the week it would have.
//
// WHAT IS SOCIAL FACT AND NOT PHYSICS, said plainly: the founding herd (a
// yoke of two beasts per family, driven in on the hoof, which is how stock
// travelled); the fertility floor (a cow below condition does not cycle,
// measured in every husbandry text); and the cull rule (slaughter down to
// what the barn can winter, which is the decision every October reeve made).
// Everything else -- what they eat, what the hay is worth, what a carcass
// yields -- is the models already on the shelf.

import * as A from '../anchors.ts';
import { atMoisture, foodKcalPerKg } from './material.ts';
import { needKcalPerDay, lifespanYears } from './animal.ts';
import { CATTLE } from './cattle.ts';
import { SHEEP } from './sheep.ts';
import { type Animal } from './animal.ts';
import { harvest, compositionOf, digestibleKcalPerKg } from './process.ts';
import { GRASS } from './species.ts';
import { Part } from './plant.ts';
import {
  herdWeek, herdMeanMassKg, weeklyGrowthKg, hayFromKg, HAYMAKING_LOSS,
  STANDING_LOSS_PER_WEEK,
} from './husbandry.ts';
import {
  growingWeeks, harvestWindow, inWindow, isGrowing, isWeek, WEEKS_PER_YEAR,
} from './season.ts';

/** The herd's feeds, from the plant models rather than written here. */
const GRASS_C = compositionOf(
  harvest(GRASS, 3, 1, 30, WEEKS_PER_YEAR, 1).find((p) => p.part === Part.Leaf)!,
);
const HAY_C = atMoisture(GRASS_C, 0.15);
const HAY_KCAL_PER_KG = digestibleKcalPerKg(HAY_C, CATTLE.digestion);

/**
 * What a kilogramme of live beast yields as food, kcal, across the edible
 * tissues at their sheet shares -- about 1,560 for cattle, and asked of the
 * sheet rather than remembered, so the sheep answers for herself.
 */
function ediblePerLiveKg(a: Animal): number {
  return a.tissues
    .filter((t) => t.edible)
    .reduce((x, t) => x + t.share * foodKcalPerKg(t.composition), 0);
}

/** The skin, whatever the species calls it: the tanner takes both. */
function skinShare(a: Animal): number {
  return a.tissues.find((t) => t.name === 'hide' || t.name === 'pelt')?.share ?? 0;
}

function milkKcalPerKg(a: Animal): number {
  const spec = a.tissues.find((t) => t.name === 'milk');
  return spec === undefined ? 0 : foodKcalPerKg(spec.composition);
}

/** Births per head per year at full condition, from the sheet's own shares. */
function birthsPerHeadYear(a: Animal): number {
  return 0.5 * 0.6 * a.littersPerYear * a.litterSize;
}

/**
 * The founding herd: a yoke per family, driven in on the hoof.
 *
 * A social fact, labelled as one. Stock walked to a new settlement -- it is
 * the one store that carries itself -- and two beasts a household is the
 * plough team without which the first field does not get broken.
 */
export const FOUNDING_BEASTS_PER_FAMILY = 2;

export function foundingHerd(population: number): number {
  return Math.max(0, (population / 5) * FOUNDING_BEASTS_PER_FAMILY);
}

/**
 * And the flock walks in beside them: five ewes a family, which is what a
 * smallholder actually kept -- the Domesday cottar's handful, enough for
 * the household's cloth with a fleece or two over.
 */
export const FOUNDING_EWES_PER_FAMILY = 5;

export function foundingFlock(population: number): number {
  return Math.max(0, (population / 5) * FOUNDING_EWES_PER_FAMILY);
}

/**
 * The share of the pasture shut up for hay while the mowing season runs.
 *
 * A SOCIAL FACT, and the oldest one in the manor: the meadow was fenced off
 * from the beasts in spring and the herd summered on the common, because hay
 * mown where the herd grazes is hay the herd eats out of the barn the same
 * week. The first version of this file mowed the whole growth and discovered
 * exactly that -- the barn filled at the scythe's rate and drained at the
 * herd's, and the village wintered on the difference. Half and half is the
 * classic division; the manor court argued the margins.
 */
const MEADOW_SHARE = 0.5;

/**
 * A cow below this share of her proper weight does not come into calf.
 *
 * Measured: fertility in cattle collapses below body condition score two
 * and a half of five, which is about eighty-five per cent of proper weight.
 * It is why a famine echoes into the herd for years after it ends.
 */
const FERTILE_CONDITION = 0.85;

/**
 * Whether this week is in the mowing half of the growing season.
 *
 * The season's START is found directly -- the growing week whose predecessor
 * is dead -- because deriving it from the harvest window's end put the mowing
 * season in the first weeks of WINTER, which is a scythe in the snow.
 */
export function seasonStartWeek(annualMeanC: number, sinLat: number): number {
  const W = Math.floor(WEEKS_PER_YEAR);
  for (let w = 0; w < W; w++) {
    if (isGrowing(annualMeanC, sinLat, w)
      && !isGrowing(annualMeanC, sinLat, (w - 1 + W) % W)) {
      return w;
    }
  }
  return -1;
}

function inMowingSeason(
  annualMeanC: number, sinLat: number, week: number, growing: number,
): boolean {
  const seasonStart = seasonStartWeek(annualMeanC, sinLat);
  if (seasonStart < 0) return false;
  const W = Math.floor(WEEKS_PER_YEAR);
  const into = (((week - seasonStart) % W) + W) % W;
  return into < growing / 2;
}

/** Non-growing weeks between this week and the next green one. */
export function winterWeeksLeft(
  annualMeanC: number, sinLat: number, week: number,
): number {
  const W = Math.floor(WEEKS_PER_YEAR);
  let n = 0;
  for (let i = 0; i < W; i++) {
    const w = (((week + i) % W) + W) % W;
    if (isGrowing(annualMeanC, sinLat, w)) break;
    n++;
  }
  return n;
}

/**
 * The barn an established farm holds at this week of the year: the winter
 * that remains, priced at the herd's need and the hay's worth.
 *
 * This is the established-settlement convention -- missing means the season
 * left things as a farm would have them -- extended to fodder, and it was
 * extended the hard way: a suite seeded an "established" village in
 * mid-winter, the old default gave it an empty barn and a dead sward, and
 * both its herds starved for fifteen weeks in front of a full granary. The
 * sheep died fastest, being smallest, which is real and was still wrong.
 */
export function establishedBarnKg(
  headNeedKcalPerDay: number, annualMeanC: number, sinLat: number, week: number,
): number {
  const left = winterWeeksLeft(annualMeanC, sinLat, week);
  return (headNeedKcalPerDay * 7 * left) / Math.max(1, HAY_KCAL_PER_KG);
}

/**
 * The shearing, a third of the way through the growing season: the flock
 * was washed in the June stream and shorn when the weather could be trusted
 * not to kill a naked ewe -- after the cold, before the harvest wanted
 * every hand.
 */
export function shearingWeek(annualMeanC: number, sinLat: number): number {
  const start = seasonStartWeek(annualMeanC, sinLat);
  if (start < 0) return -1;
  const growing = growingWeeks(annualMeanC, sinLat);
  return (start + Math.round(growing / 3)) % Math.floor(WEEKS_PER_YEAR);
}

/** The herd's state as the delta carries it. */
export interface VillageHerd {
  head: number;
  condition: number;
  /** The barn, kg of hay. */
  hayKg: number;
  /** The standing crop of the settlement's pasture, kg dry. */
  standingKg: number;
}

/** What one week did, for the report and the stores. */
export interface VillageHerdWeek {
  herd: VillageHerd;
  /** Beasts lost to want. */
  died: number;
  /** Beasts slaughtered at the cull. */
  culled: number;
  /** Food off the herd this week -- milk and cull meat together, kcal. */
  foodKcal: number;
  /** Raw hides off the cull, kg, for the tannery when there is one. */
  hidesKg: number;
  /** Hay mown this week, kg. */
  hayMownKg: number;
}

/** What a hungry village took from its own byre. */
export interface Distress {
  herd: VillageHerd;
  /** Beasts killed for the pot. */
  eaten: number;
  foodKcal: number;
  hidesKg: number;
}

/**
 * DISTRESS SLAUGHTER: a starving village eats its herd.
 *
 * The mechanism the first temperate founding probe showed was missing:
 * eighteen of twenty people starved through a winter while eight cattle --
 * five and a half million kilocalories -- walked past the window. Settlers
 * everywhere in the sources ate into their stock in a bad year, and the herd
 * is precisely the store that walks in with a founding, so this is the bridge
 * a first winter was actually crossed on.
 *
 * It takes what covers the want and no more, down to the last beast if the
 * want is that bad -- a starving family does not spare the plough ox, which
 * is why a famine year echoes for a decade: the team and the breeding stock
 * go into the pot, and condition gates the calves that would have replaced
 * them.
 */
export function distressSlaughter(
  a: Animal, state: VillageHerd, kcalWanted: number,
): Distress {
  const none: Distress = { herd: { ...state }, eaten: 0, foodKcal: 0, hidesKg: 0 };
  if (kcalWanted <= 0 || state.head <= 0) return none;
  const perBeastKg = herdMeanMassKg(a) * Math.max(0.3, state.condition);
  const perBeastKcal = perBeastKg * ediblePerLiveKg(a);
  if (perBeastKcal <= 0) return none;
  const eaten = Math.min(state.head, kcalWanted / perBeastKcal);
  return {
    herd: { ...state, head: state.head - eaten },
    eaten,
    foodKcal: eaten * perBeastKcal,
    hidesKg: eaten * perBeastKg * skinShare(a),
  };
}

/**
 * One week of the village's herd.
 *
 * `annualForageKg` is the catchment's grazeable growth for a year, dry -- the
 * figure the catchment already computes. Competition for pasture between
 * neighbouring settlements is not yet subtracted the way it is for fields;
 * that is a known gap, honest here rather than hidden.
 */
export function villageHerdWeek(
  a: Animal,
  state: VillageHerd,
  annualForageKg: number,
  annualMeanC: number,
  sinLat: number,
  week: number,
): VillageHerdWeek {
  const none: VillageHerdWeek = {
    herd: { ...state }, died: 0, culled: 0, foodKcal: 0, hidesKg: 0, hayMownKg: 0,
  };
  if (state.head <= 0) return none;

  const growing = growingWeeks(annualMeanC, sinLat);
  const winterWeeks = Math.max(0, WEEKS_PER_YEAR - growing);
  const meanMass = herdMeanMassKg(a) * state.condition;

  // THE SWARD. Growth lands in growing weeks; the standing crop weathers.
  let standing = state.standingKg
    + weeklyGrowthKg(annualForageKg, annualMeanC, sinLat, week);

  // THE HAY, mown from the week's own growth before it joins the sward, up to
  // the barn target -- which is the winter, priced: what the whole herd needs
  // from the last growing week to the first, at the hay's own worth. Mowing
  // runs through the first half of the growing season, as it did.
  let hayKg = state.hayKg;
  let hayMownKg = 0;
  const ripening = harvestWindow(annualMeanC, sinLat);
  if (isGrowing(annualMeanC, sinLat, week) && growing > 0 && winterWeeks > 0
    && inMowingSeason(annualMeanC, sinLat, week, growing)) {
    const winterNeedKcal =
      needKcalPerDay(meanMass) * 7 * winterWeeks * state.head;
    const targetKg = winterNeedKcal / Math.max(1, HAY_KCAL_PER_KG);
    const deficit = Math.max(0, targetKg - hayKg);
    if (deficit > 0) {
      const growth = weeklyGrowthKg(annualForageKg, annualMeanC, sinLat, week);
      // The dry grass that makes the missing hay: the barn's shortfall at
      // hay's own moisture, grossed up by the making loss, never more than
      // the SHUT-UP MEADOW grew -- the herd keeps the common's half.
      const mowDry = Math.min(
        growth * MEADOW_SHARE,
        (deficit * (1 - 0.15)) / (1 - HAYMAKING_LOSS),
      );
      const made = hayFromKg(mowDry / (1 - GRASS_C.water), GRASS_C.water);
      hayKg += made;
      hayMownKg = made;
      standing -= mowDry;
    }
  }

  // THE HERD EATS: the sward first through the utilisation the pasture model
  // measures, the barn for what grazing leaves short.
  const offeredFresh = (Math.max(0, standing) * A.PASTURE_UTILISATION)
    / (1 - GRASS_C.water);
  const out = herdWeek(
    a,
    { head: state.head, condition: state.condition },
    GRASS_C,
    offeredFresh,
    HAY_C,
    hayKg,
  );
  const ateDry = out.ateKg * (1 - GRASS_C.water);
  standing = Math.max(0, standing - ateDry / A.PASTURE_UTILISATION);
  standing *= 1 - STANDING_LOSS_PER_WEEK;
  hayKg -= out.fodderKg;

  let head = out.state.head;
  let condition = out.state.condition;
  const died = out.died;

  // BIRTHS, gated on condition -- a thin cow does not cycle -- and OLD AGE,
  // at the lifespan's own hazard. Both weekly shares of annual rates.
  if (condition >= FERTILE_CONDITION) {
    head += (head * birthsPerHeadYear(a)) / WEEKS_PER_YEAR;
  }
  head -= head / (lifespanYears(a.matureMassKg) * WEEKS_PER_YEAR);

  // MILK, through the growing season: calves come with the grass and the
  // cows dry off when it stops, which is what a landrace herd did.
  let foodKcal = 0;
  if (isGrowing(annualMeanC, sinLat, week) && growing > 0) {
    const inMilk = head * 0.5 * 0.6 * Math.min(1, condition);
    const kgThisWeek = (inMilk * a.milkLitresPerYear * 1.03) / growing;
    foodKcal += kgThisWeek * milkKcalPerKg(a);
  }

  // THE CULL, in the last week of the harvest window: slaughter down to what
  // the barn can winter. The reeve's October arithmetic, at the week the
  // derived calendar puts it, and the reason autumn was the season of meat.
  let culled = 0;
  let hidesKg = 0;
  if (ripening !== null && isWeek(week, ripening.to) && winterWeeks > 0) {
    const perHeadWinterKcal = needKcalPerDay(herdMeanMassKg(a)) * 7 * winterWeeks;
    const winterable = (hayKg * HAY_KCAL_PER_KG) / Math.max(1, perHeadWinterKcal);
    culled = Math.max(0, head - winterable);
    if (culled > 0) {
      const liveKg = culled * herdMeanMassKg(a) * condition;
      foodKcal += liveKg * ediblePerLiveKg(a);
      hidesKg = liveKg * skinShare(a);
      head -= culled;
    }
  }

  return {
    herd: {
      head: Math.max(0, head),
      condition,
      hayKg: Math.max(0, hayKg),
      standingKg: Math.max(0, standing),
    },
    died,
    culled,
    foodKcal,
    hidesKg,
    hayMownKg,
  };
}
