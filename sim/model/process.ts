// What happens to stuff: burning, rotting, drying, threshing, eating.
//
// ONE RULE PER VERB, and every rule reads the composition rather than asking
// what the thing is. A fire does not know about wood; it knows that a material
// under about a third water gives back more heat than it spends boiling itself,
// and that lignin burns hotter than cellulose. Rot does not know about leaves;
// it knows that fungi are stopped by tannin and slowed by lignin. Threshing does
// not know about wheat; it knows that Seed, Husk and Branch are different parts
// and a beating separates them.
//
// The payoff is that adding barley costs a sheet of numbers and no code, and
// that a rule which is right for oak cannot be quietly wrong for hazel.
//
// A PILE IS THE THING VERBS ACT ON. Two hundred kilogrammes of oak heartwood at
// twelve per cent moisture; forty of wheat grain; three of blackberries. A barn,
// a cart, a fire and a stomach all hold the same type, so moving stuff between
// them is not a conversion. It carries which SPECIES and which PART, not just
// the chemistry, because provenance is worth money -- oak and ash timber are
// not the same plank even where their recipes nearly are.
//
// EVERYTHING IS A RATE PER HOUR, integrated over whatever span the caller has.
// A fire checked once a minute and once a day burns the same wood, and a barn
// can skip a winter in one step. Where a process is exponential -- rot, drying,
// which both are -- the integration is exact rather than a small-step
// approximation, so a long step is not a different answer from many short ones.

import { dexp, dlog, dpow } from '../gen/mathx.ts';
import {
  type Composition, type Material, atMoisture, burns, density, fuelMJPerKg,
  porosityFor, rotResistance,
} from './material.ts';
import {
  type Species, type PartSpec, Part, PART_NAMES, isPresent, isBuried, massAt,
} from './plant.ts';

/** A quantity of one material. */
export interface Pile {
  species: Species;
  part: Part;
  massKg: number;
  /** Water as a mass fraction of the pile as it stands, 0 to 1. */
  moisture: number;
}

const HOURS_PER_YEAR = 8766;

/** The species' sheet for this pile's part. */
export function specOf(p: Pile): PartSpec | undefined {
  return p.species.parts.find((q) => q.part === p.part);
}

/** What the pile is made of, at the moisture it is actually at. */
export function compositionOf(p: Pile): Composition {
  const spec = specOf(p);
  if (spec === undefined) {
    return {
      water: p.moisture, cellulose: 1 - p.moisture, lignin: 0, starch: 0,
      sugar: 0, oil: 0, protein: 0, tannin: 0, ash: 0,
    };
  }
  return atMoisture(spec.composition, p.moisture);
}

/** The pile as a material, so anything that reads materials can read it. */
export function materialOf(p: Pile): Material {
  const spec = specOf(p);
  const c = compositionOf(p);
  return {
    name: `${p.species.name} ${PART_NAMES[p.part]}`,
    composition: c,
    porosity: spec === undefined ? 0 : porosityFor(c, spec.densityKgM3),
  };
}

/** Volume of the pile, m3, from its own density. */
export function volumeM3(p: Pile): number {
  const d = density(materialOf(p));
  return d > 0 ? p.massKg / d : 0;
}

/**
 * The size of the pile, metres, as the side of a cube of the same volume.
 *
 * Crude and load-bearing, so it is worth saying what it is for. Two verbs need
 * a LENGTH rather than a mass -- fire eats inwards from a surface, and drying
 * moves water outwards to one -- and both of them scale with how thick the
 * thing is. A cube is the least assuming shape that gives one: it says a big
 * pile burns and dries more slowly than a small one, in the right proportion,
 * without claiming to know whether it is a log or a stack of billets.
 */
export function thicknessM(p: Pile): number {
  const v = volumeM3(p);
  return v > 0 ? Math.cbrt(v) : 0;
}

/** Exposed surface of that cube, m2. */
export function surfaceM2(p: Pile): number {
  const t = thicknessM(p);
  return 6 * t * t;
}

// --- burn --------------------------------------------------------------------

/**
 * How fast fire eats into solid timber, mm per minute.
 *
 * MEASURED, and unusually well: this is the charring rate that structural fire
 * engineering sizes beams with, because a timber beam fails when the unburnt
 * core gets too thin and the whole method rests on the rate being predictable.
 * Published values run 0.65 to 0.8 mm/min for solid softwood and hardwood
 * alike -- it varies far less with species than anyone expects, which is the
 * same fact the density model rests on: it is all nearly the same substance.
 */
const CHAR_MM_PER_MIN = 0.7;

/** What a fire did in a span. */
export interface Burnt {
  consumedKg: number;
  heatMJ: number;
  ashKg: number;
  /** The pile as it stands afterwards. */
  left: Pile;
  /** False if it would not take a light at all. */
  lit: boolean;
}

/**
 * Burn a pile for a span of hours.
 *
 * The rate is a SURFACE process, which is the whole character of fire and the
 * reason a stack of kindling lights a log and not the other way round: mass
 * goes as the cube of size and burning surface as the square, so a small pile
 * is consumed in minutes and a large one takes all night. Nothing here sets a
 * burn time; the charring rate and the pile's own geometry set it.
 */
export function burn(p: Pile, hours: number): Burnt {
  const c = compositionOf(p);
  const still: Burnt = {
    consumedKg: 0, heatMJ: 0, ashKg: 0, left: { ...p }, lit: false,
  };
  if (hours <= 0 || p.massKg <= 0) return still;
  if (!burns(c)) return still;

  const d = density(materialOf(p));
  // INTEGRATED, not stepped, and the difference is not small. The rate is
  // proportional to surface, surface goes as mass to the two thirds, so
  // dm/dt = -k.m^(2/3) and m^(1/3) falls at a constant k/3. Multiplying an
  // instantaneous rate by the span instead said a ten-kilogramme log was gone
  // in one hour when it actually takes nearly three, and the error grows with
  // the span -- which is the whole thing a rate-per-hour design is for.
  const k = charRate(d);
  const root = dpow(p.massKg, 1 / 3) - (k * hours) / 3;
  const left = root > 0 ? root * root * root : 0;
  const consumed = p.massKg - left;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  return {
    consumedKg: consumed,
    heatMJ: consumed * fuelMJPerKg(c),
    // What does not burn is what was never going to: the mineral fraction.
    ashKg: total > 0 ? (consumed * c.ash) / total : 0,
    left: { ...p, massKg: p.massKg - consumed },
    lit: true,
  };
}

/**
 * The constant in dm/dt = -k.m^(2/3), from the charring rate and the density.
 *
 * Surface is 6.(m/rho)^(2/3), so the mass rate is char.6.rho^(1/3).m^(2/3) and
 * everything but the mass folds into k.
 */
function charRate(densityKgM3: number): number {
  return (CHAR_MM_PER_MIN / 1000) * 60 * 6 * dpow(densityKgM3, 1 / 3);
}

/** Hours to consume the whole pile, if it burns at all. */
export function burnsOutInHours(p: Pile): number {
  if (!burns(compositionOf(p)) || p.massKg <= 0) return Infinity;
  const k = charRate(density(materialOf(p)));
  return k > 0 ? (3 * dpow(p.massKg, 1 / 3)) / k : Infinity;
}

// --- rot ---------------------------------------------------------------------

/** What decay did in a span. */
export interface Rotted {
  lostKg: number;
  left: Pile;
}

/**
 * Rot a pile for a span of hours at a temperature.
 *
 * material.ts gives a fraction lost per year; this integrates it properly, so
 * a beam left for a century is not a beam with a negative mass. Exponential,
 * because decay is proportional to what is left of it.
 */
export function rot(p: Pile, temperatureC: number, wetness: number, hours: number): Rotted {
  const c = compositionOf(p);
  const perYear = rotRateOf(c, temperatureC, wetness);
  if (perYear <= 0 || hours <= 0 || p.massKg <= 0) {
    return { lostKg: 0, left: { ...p } };
  }
  const left = p.massKg * dexp((-perYear * hours) / HOURS_PER_YEAR);
  return { lostKg: p.massKg - left, left: { ...p, massKg: left } };
}

/** The per-year figure, re-exported through here so the verbs read alike. */
function rotRateOf(c: Composition, temperatureC: number, wetness: number): number {
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (total <= 0 || temperatureC <= 0) return 0;
  const moisture = Math.max(0, Math.min(1, Math.max(c.water / total, wetness)));
  if (moisture < 0.2) return 0;
  return rotResistance(c) * moisture * dpow(2, (temperatureC - 25) / 10);
}

/** Years until half of it is gone, at these conditions. Infinity if it does not. */
export function halfLifeYears(p: Pile, temperatureC: number, wetness: number): number {
  const perYear = rotRateOf(compositionOf(p), temperatureC, wetness);
  return perYear > 0 ? 0.6931471805599453 / perYear : Infinity;
}

// --- dry ---------------------------------------------------------------------

/**
 * How long seasoning takes: a year for every inch of thickness.
 *
 * The oldest rule in the timber trade and a good one -- it is the time constant
 * of a diffusion process, and diffusion times go as the square of the distance,
 * so the rule is really "a year per inch" only near an inch. Kept as the
 * measured anchor it is, and applied linearly, which is right within the range
 * anybody seasons wood at. An inch is 25.4 mm, and that number is why a
 * two-inch plank sits in the shed for two years.
 */
const SEASONING_YEARS_PER_M = 1 / 0.0254;

/**
 * The moisture a material settles at, given the air around it.
 *
 * Measured: wood in a heated room at 65% relative humidity comes to rest at
 * about 12% moisture, which is exactly why every published timber figure is
 * quoted air-dry at 12%. The relation is a sorption isotherm and this is a
 * straight line through it, which is close over the range that matters -- 30%
 * humidity gives 5.5% and 90% gives 16.6%, against measured 6% and about 20%.
 * It runs low at the wet end, and that is the honest failing to know about.
 */
export function equilibriumMoisture(humidity: number): number {
  const h = Math.max(0, Math.min(1, humidity));
  // A rational curve through the two ends that matter, rather than the straight
  // line this was: 0.185.h passed through air-dry correctly and then said
  // saturated air leaves wood at 18.5% water, which is drier than a bog log has
  // ever been. Fitted to (0.65, 0.12) -- the air-dry figure every timber table
  // is quoted at -- and (1.0, 0.23), the fibre saturation point on the wet
  // basis this model uses. It reads 0.046 at 30% humidity against a measured
  // 0.057, which is the remaining error and it is at the dry end.
  return Math.max(0, Math.min(0.30, (0.1351 * h) / (1 - 0.4127 * h)));
}

/** Dry (or wet) a pile towards the air's equilibrium, over a span of hours. */
/**
 * The time constant of drying, hours.
 *
 * Two corrections to the rule as stated, both of which the first version got
 * wrong and which together made a firewood round take nine years to season.
 *
 * The DISTANCE is half the thickness, not the thickness: water leaves by the
 * nearest face, and a plank an inch thick has water travelling half an inch.
 *
 * And "a year an inch" is the time to arrive, not the time constant. An
 * exponential is 95% of the way there after three time constants, so tau is a
 * third of the rule's answer. With both, a 24 cm round seasons in about a year,
 * which is what a woodpile does.
 */
function dryingTauHours(p: Pile): number {
  const path = thicknessM(p) / 2;
  return (SEASONING_YEARS_PER_M * path * HOURS_PER_YEAR) / 3;
}

export function dry(p: Pile, humidity: number, hours: number): Pile {
  const emc = equilibriumMoisture(humidity);
  if (thicknessM(p) <= 0 || hours <= 0) return { ...p };
  const tauHours = dryingTauHours(p);
  if (tauHours <= 0) return { ...p, moisture: emc };
  const gap = p.moisture - emc;
  const moisture = emc + gap * dexp(-hours / tauHours);
  // Water leaving takes its mass with it, which is most of what drying a green
  // log achieves and the reason a woodpile gets lighter without getting smaller.
  const dryMass = p.massKg * (1 - p.moisture);
  return { ...p, moisture, massKg: moisture < 1 ? dryMass / (1 - moisture) : p.massKg };
}

/** Hours for a pile to become fuel that will actually take a light. */
export function seasoningHours(p: Pile, humidity: number): number {
  const emc = equilibriumMoisture(humidity);
  // burns() wants under 35% water; below that the wood lights.
  const target = 0.34;
  if (p.moisture <= target) return 0;
  if (emc >= target) return Infinity;
  const tau = dryingTauHours(p);
  // Invert the exponential: t = -tau . ln((target - emc) / (m0 - emc)).
  const ratio = (target - emc) / (p.moisture - emc);
  return ratio <= 0 ? Infinity : -tau * dlog(ratio);
}

// --- harvest and thresh ------------------------------------------------------

/**
 * Everything a plant is carrying this week, as piles.
 *
 * The bridge from the growing plant to the stuff that can be worked. A plant is
 * a pure function of its age and the week; a harvest is that function evaluated
 * and taken away.
 */
export function harvest(
  s: Species, ageYears: number, site: number, week: number, weeksPerYear: number,
  count = 1, includeBuried = false,
): Pile[] {
  const mass = massAt(s, ageYears, site) * count;
  const out: Pile[] = [];
  for (const spec of s.parts) {
    // REAPING LEAVES THE ROOTS, which is not a detail: the roots are a fifth of
    // a wheat plant and a carrot's whole crop, so whether they come up is the
    // difference between a harvest and a different harvest. Cutting is the
    // default because most of a year's work is cutting; digging asks for it.
    if (!includeBuried && isBuried(spec.part)) continue;
    if (!isPresent(spec.phenology, week, weeksPerYear)) continue;
    const kg = mass * spec.share;
    if (kg <= 0) continue;
    const total = Object.values(spec.composition).reduce((a, b) => a + b, 0);
    out.push({
      species: s,
      part: spec.part,
      massKg: kg,
      moisture: total > 0 ? spec.composition.water / total : 0,
    });
  }
  return out;
}

/**
 * How much of the grain a beating actually recovers.
 *
 * Measured: hand threshing with a flail on a barn floor gets most but not all
 * of it, and what is missed stays in the ear or is swept up with the chaff.
 * Ninety-five per cent is the figure for careful work, and the five per cent is
 * why a threshing floor was swept and why gleaning was worth doing.
 */
const THRESHING_RECOVERY = 0.95;

/** A sheaf pulled apart into what it is made of. */
export interface Threshed {
  grain: Pile[];
  chaff: Pile[];
  straw: Pile[];
  /**
   * Everything that is none of those: fruit, thorns, sap, a carrot.
   *
   * Here so that nothing can vanish. The first version silently dropped any
   * part it had no bucket for, and the conservation check caught it as 4.65 kg
   * out of a 5.82 kg sheaf -- the missing kilogramme was the roots, which the
   * harvest should not have pulled up in the first place.
   */
  other: Pile[];
  /** Grain left in the ear or lost in the chaff, kg. */
  lostKg: number;
}

/**
 * Beat a harvest apart.
 *
 * THIS IS NOT A SPECIAL CASE FOR WHEAT. It is a partition by part: what is
 * Seed goes one way, what is Husk another, and everything woody a third. Any
 * plant with those parts threshes, which is why barley will need no code.
 *
 * The grain that is not recovered is not destroyed -- it goes into the chaff,
 * which is why chaff was worth feeding to poultry and why a threshing floor
 * was swept.
 */
export function thresh(piles: readonly Pile[]): Threshed {
  const grain: Pile[] = [];
  const chaff: Pile[] = [];
  const straw: Pile[] = [];
  const other: Pile[] = [];
  let lostKg = 0;
  for (const p of piles) {
    if (p.part === Part.Seed) {
      const got = p.massKg * THRESHING_RECOVERY;
      lostKg += p.massKg - got;
      grain.push({ ...p, massKg: got });
      chaff.push({ ...p, massKg: p.massKg - got });
    } else if (p.part === Part.Husk || p.part === Part.Flower) {
      chaff.push({ ...p });
    } else if (p.part === Part.Branch || p.part === Part.Twig || p.part === Part.Leaf
      || p.part === Part.Sapwood || p.part === Part.Heartwood || p.part === Part.Bark) {
      straw.push({ ...p });
    } else {
      other.push({ ...p });
    }
  }
  return { grain, chaff, straw, other, lostKg };
}

// --- eat ---------------------------------------------------------------------

/**
 * What a gut can get out of what it swallows.
 *
 * ONE NUMBER SEPARATES A COW FROM A PERSON, and it is the whole reason a
 * kingdom can feed itself off grass at all: cellulose. A ruminant's bacteria
 * ferment about half of it; a pig's hindgut manages a fraction of that; a
 * person gets essentially none, which is why grass is not food and bread is.
 *
 * Measured. Cellulose digestibility in cattle runs 40 to 60 per cent depending
 * on how lignified the forage is; monogastric hindgut fermentation is 10 to 20
 * per cent; human colonic fermentation of cellulose is a few per cent and is
 * conventionally counted as zero, which is what the Atwater factors do.
 *
 * `efficiency` is what is absorbed of everything else, and it is lower in a
 * ruminant because a rumen spends some of the energy running itself.
 */
export interface Digestion {
  fibre: number;
  efficiency: number;
}

export const HUMAN: Digestion = { fibre: 0.0, efficiency: 0.95 };
export const PIG: Digestion = { fibre: 0.15, efficiency: 0.90 };
export const RUMINANT: Digestion = { fibre: 0.50, efficiency: 0.75 };

/** Lignin is indigestible to everything alive. Nothing eats a fence post. */
export function digestibleKcalPerKg(c: Composition, d: Digestion): number {
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const f = (x: number): number => x / total;
  const sugars = (f(c.starch) + f(c.sugar) + f(c.protein)) * 4000;
  const fat = f(c.oil) * 9000;
  const fibre = f(c.cellulose) * 4000 * Math.max(0, Math.min(1, d.fibre));
  return (sugars + fat) * d.efficiency + fibre;
}

/** What a mouthful was worth. */
export interface Eaten {
  kcal: number;
  proteinG: number;
  left: Pile;
}

/**
 * Eat some of a pile.
 *
 * The verb that makes a pasture more than a number: a cow eating the Leaf part
 * of a grass plant is the flora model, the material model and the grazing model
 * meeting, and the answer has to be the same whichever of the three you ask.
 */
export function eat(p: Pile, d: Digestion, kg: number): Eaten {
  const take = Math.max(0, Math.min(p.massKg, kg));
  const c = compositionOf(p);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  return {
    kcal: take * digestibleKcalPerKg(c, d),
    proteinG: total > 0 ? take * (c.protein / total) * 1000 * d.efficiency : 0,
    left: { ...p, massKg: p.massKg - take },
  };
}

/** Whether an animal can live on this alone: enough energy in what it can hold. */
export function sustains(
  p: Pile, d: Digestion, kcalNeededPerDay: number, intakeKgPerDay: number,
): boolean {
  return digestibleKcalPerKg(compositionOf(p), d) * intakeKgPerDay >= kcalNeededPerDay;
}
