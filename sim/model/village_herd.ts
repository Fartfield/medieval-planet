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
import { harvest, compositionOf, digestibleKcalPerKg } from './process.ts';
import { GRASS } from './species.ts';
import { Part } from './plant.ts';
import {
  herdWeek, herdMeanMassKg, weeklyGrowthKg, hayFromKg, HAYMAKING_LOSS,
  STANDING_LOSS_PER_WEEK,
} from './husbandry.ts';
import {
  growingWeeks, harvestWindow, inWindow, isGrowing, WEEKS_PER_YEAR,
} from './season.ts';

/** The herd's feeds, from the plant models rather than written here. */
const GRASS_C = compositionOf(
  harvest(GRASS, 3, 1, 30, WEEKS_PER_YEAR, 1).find((p) => p.part === Part.Leaf)!,
);
const HAY_C = atMoisture(GRASS_C, 0.15);
const HAY_KCAL_PER_KG = digestibleKcalPerKg(HAY_C, CATTLE.digestion);

/**
 * What a kilogramme of live beast yields as food, kcal, across the edible
 * tissues at their sheet shares. About 1,560 for cattle -- the whole-carcass
 * figure the slaughter suite measures per beast, per kilogramme.
 */
const EDIBLE_KCAL_PER_LIVE_KG = CATTLE.tissues
  .filter((t) => t.edible)
  .reduce((a, t) => a + t.share * foodKcalPerKg(t.composition), 0);

const HIDE_SHARE = CATTLE.tissues.find((t) => t.name === 'hide')?.share ?? 0;
const MILK_KCAL_PER_KG = foodKcalPerKg(
  CATTLE.tissues.find((t) => t.name === 'milk')!.composition,
);

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

/** Births per head per year at full condition, from the herd model's shares. */
const BIRTHS_PER_HEAD_YEAR = 0.5 * 0.6 * CATTLE.littersPerYear * CATTLE.litterSize;

/**
 * Whether this week is in the mowing half of the growing season.
 *
 * The season's START is found directly -- the growing week whose predecessor
 * is dead -- because deriving it from the harvest window's end put the mowing
 * season in the first weeks of WINTER, which is a scythe in the snow.
 */
function inMowingSeason(
  annualMeanC: number, sinLat: number, week: number, growing: number,
): boolean {
  const W = Math.floor(WEEKS_PER_YEAR);
  let seasonStart = -1;
  for (let w = 0; w < W; w++) {
    if (isGrowing(annualMeanC, sinLat, w)
      && !isGrowing(annualMeanC, sinLat, (w - 1 + W) % W)) {
      seasonStart = w;
      break;
    }
  }
  if (seasonStart < 0) return false;
  const into = (((week - seasonStart) % W) + W) % W;
  return into < growing / 2;
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

/**
 * One week of the village's herd.
 *
 * `annualForageKg` is the catchment's grazeable growth for a year, dry -- the
 * figure the catchment already computes. Competition for pasture between
 * neighbouring settlements is not yet subtracted the way it is for fields;
 * that is a known gap, honest here rather than hidden.
 */
export function villageHerdWeek(
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
  const meanMass = herdMeanMassKg(CATTLE) * state.condition;

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
    CATTLE,
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
    head += (head * BIRTHS_PER_HEAD_YEAR) / WEEKS_PER_YEAR;
  }
  head -= head / (lifespanYears(CATTLE.matureMassKg) * WEEKS_PER_YEAR);

  // MILK, through the growing season: calves come with the grass and the
  // cows dry off when it stops, which is what a landrace herd did.
  let foodKcal = 0;
  if (isGrowing(annualMeanC, sinLat, week) && growing > 0) {
    const inMilk = head * 0.5 * 0.6 * Math.min(1, condition);
    const kgThisWeek = (inMilk * CATTLE.milkLitresPerYear * 1.03) / growing;
    foodKcal += kgThisWeek * MILK_KCAL_PER_KG;
  }

  // THE CULL, in the last week of the harvest window: slaughter down to what
  // the barn can winter. The reeve's October arithmetic, at the week the
  // derived calendar puts it, and the reason autumn was the season of meat.
  let culled = 0;
  let hidesKg = 0;
  if (ripening !== null && week === ripening.to && winterWeeks > 0) {
    const perHeadWinterKcal = needKcalPerDay(herdMeanMassKg(CATTLE)) * 7 * winterWeeks;
    const winterable = (hayKg * HAY_KCAL_PER_KG) / Math.max(1, perHeadWinterKcal);
    culled = Math.max(0, head - winterable);
    if (culled > 0) {
      const liveKg = culled * herdMeanMassKg(CATTLE) * condition;
      foodKcal += liveKg * EDIBLE_KCAL_PER_LIVE_KG;
      hidesKg = liveKg * HIDE_SHARE;
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
