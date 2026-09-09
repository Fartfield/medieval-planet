// What things are made of, and everything that follows from it.
//
// A material here is not a row of properties. It is a RECIPE -- what fractions
// of it are water, cellulose, lignin, starch, sugar, oil, protein, tannin and
// mineral ash, plus how much of its volume is empty. Density, fuel value, food
// energy, stiffness, crushing strength and rot resistance are then all
// consequences, computed from measured constants for those nine substances.
//
// WHY A RECIPE RATHER THAN A TABLE. Because a table lets a material be dense,
// weak and hot-burning at the same time, and nothing stops it. Oak is stronger
// than pine because it is denser; it is denser because less of its volume is
// empty, not because it is made of anything very different -- both are about
// 45% cellulose and 25% lignin. Put the composition in and that relationship
// holds for free, in the right direction, for every material anyone adds later.
// Put the properties in and it holds only as long as whoever types them is
// careful.
//
// The nine were chosen so each unlocks something nothing else can express:
//
//   water      weight, rot, and why green wood will not burn
//   cellulose  structure, and fibre -- flax into linen
//   lignin     stiffness, rot resistance, and a hotter fire than cellulose
//   starch     the staple calorie, and what brewing starts from
//   sugar      the fruit calorie, and what fermentation finishes on
//   oil        energy density, and lamp fuel
//   protein    the actually limiting nutrient, which is why pulses matter
//   tannin     rot resistance, bitterness, and TANNING -- oak bark to leather
//   ash        what does not burn: potash, and what returns to the soil
//
// WHAT DOES NOT FALL OUT OF THIS, said plainly: colour. Pigments are trace by
// mass -- chlorophyll is under one per cent of a leaf -- so bulk chemistry
// cannot predict them, and a model claiming otherwise would be inventing. A
// part carries its own small colour description, and that is honest.

import { dexp, dpow } from '../gen/mathx.ts';

/**
 * The nine, as mass fractions of the whole. They should sum to one.
 *
 * Fractions of the WET material as it stands, so water is in here with
 * everything else -- a green leaf really is mostly water and that is the fact
 * that decides whether it burns.
 */
export interface Composition {
  water: number;
  cellulose: number;
  lignin: number;
  starch: number;
  sugar: number;
  oil: number;
  protein: number;
  tannin: number;
  ash: number;
}

export const CONSTITUENTS = [
  'water', 'cellulose', 'lignin', 'starch', 'sugar', 'oil', 'protein',
  'tannin', 'ash',
] as const;

export type Constituent = typeof CONSTITUENTS[number];

/**
 * Density of each substance in the solid, kg/m3, with no voids at all.
 *
 * Measured. Cell-wall material is remarkably consistent across species at about
 * 1,500 -- which is the fact behind the whole model: every wood is made of
 * nearly the same stuff, and what differs is how much air is in it.
 */
const SOLID_DENSITY: Record<Constituent, number> = {
  water: 1000,
  cellulose: 1500,
  lignin: 1300,
  starch: 1500,
  sugar: 1590,
  oil: 920,
  protein: 1350,
  tannin: 1300,
  ash: 2500,
};

/**
 * Heat of combustion, MJ per kg of the dry substance.
 *
 * Lignin burns hotter than cellulose, which is why resinous and lignin-rich
 * woods make the better fire, and oil hotter than either, which is why a lamp
 * beats a candle beats a rushlight. Water and ash contribute nothing.
 */
const HEAT_MJ_KG: Record<Constituent, number> = {
  water: 0,
  cellulose: 17.5,
  lignin: 25.0,
  starch: 17.5,
  sugar: 16.5,
  oil: 39.0,
  protein: 23.0,
  tannin: 20.0,
  ash: 0,
};

/**
 * Food energy, kcal per kg, by the Atwater factors.
 *
 * Four a gram for carbohydrate and protein, nine for fat: among the most
 * thoroughly measured numbers in nutrition. Cellulose and lignin are fibre and
 * give a person nothing, which is precisely why bran and straw are not food --
 * and why a ruminant, which CAN ferment cellulose, eats grass and we cannot.
 */
const FOOD_KCAL_KG: Record<Constituent, number> = {
  water: 0,
  cellulose: 0,
  lignin: 0,
  starch: 4000,
  sugar: 4000,
  oil: 9000,
  protein: 4000,
  tannin: 0,
  ash: 0,
};

/** Latent heat of vaporising water, MJ/kg: what wet fuel spends drying itself. */
const VAPORISATION_MJ_KG = 2.44;

/**
 * The porosity a material must have to weigh what it is measured to weigh.
 *
 * THE RIGHT WAY ROUND. Porosity is not a number anybody measures directly and
 * it is not a number to guess: what is published for every timber on earth is
 * its density, and what is published for its chemistry is the composition. Put
 * those together and the void fraction is forced -- oak weighs 700 and its cell
 * wall is 1,364, so oak is 48.7% air and cannot be anything else.
 *
 * Guessing it instead is how the first version of this had oak at 641 kg/m3,
 * which is a hornbeam.
 */
export function porosityFor(c: Composition, bulkDensityKgM3: number): number {
  const solid = solidDensity(c);
  if (solid <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - bulkDensityKgM3 / solid));
}

/** A material: what it is made of, and how much of its volume is nothing. */
export interface Material {
  name: string;
  composition: Composition;
  /**
   * Fraction of the material's volume that is void, 0 to 1.
   *
   * The single most important number about a wood. Cell-wall substance is about
   * 1,500 kg/m3 in every species there is, so a wood at 700 is 53% air and one
   * at 400 is 73% air. Everything that separates oak from pine -- strength,
   * weight, fuel per log, how long it takes to dry -- is this number.
   */
  porosity: number;
}

function sum(c: Composition): number {
  return c.water + c.cellulose + c.lignin + c.starch + c.sugar + c.oil
    + c.protein + c.tannin + c.ash;
}

/** A composition read as a plain record, for weighted sums. */
function fractions(c: Composition): [Constituent, number][] {
  return CONSTITUENTS.map((k) => [k, c[k]] as [Constituent, number]);
}

/** Mass-weighted average of a per-constituent constant. */
function weighted(c: Composition, table: Record<Constituent, number>): number {
  const total = sum(c);
  if (total <= 0) return 0;
  let acc = 0;
  for (const [k, f] of fractions(c)) acc += (f / total) * table[k];
  return acc;
}

/**
 * Density of the solid substance alone, kg/m3, voids excluded.
 *
 * The reciprocal rule: volumes add, so the specific volumes average by mass
 * and the density is the reciprocal of that. Averaging the densities directly
 * is wrong and would flatter anything containing oil.
 */
export function solidDensity(c: Composition): number {
  const total = sum(c);
  if (total <= 0) return 0;
  let volumePerKg = 0;
  for (const [k, f] of fractions(c)) volumePerKg += (f / total) / SOLID_DENSITY[k];
  return volumePerKg > 0 ? 1 / volumePerKg : 0;
}

/** Density as the thing actually weighs, kg/m3, voids included. */
export function density(m: Material): number {
  return solidDensity(m.composition) * (1 - Math.max(0, Math.min(1, m.porosity)));
}

/**
 * Heat from burning a kilogramme of it as it stands, MJ.
 *
 * The dry substance releases its heat of combustion; the water in it takes
 * some of that back as the fire boils it off. This is the whole reason green
 * wood is bad fuel -- not that it will not light, but that half its heat goes
 * into steam -- and why a year in a woodshed is worth as much as a bigger axe.
 */
export function fuelMJPerKg(c: Composition): number {
  const total = sum(c);
  if (total <= 0) return 0;
  const dryHeat = weighted(c, HEAT_MJ_KG);
  const wet = c.water / total;
  return Math.max(0, dryHeat - wet * VAPORISATION_MJ_KG);
}

/** Food energy in a kilogramme, kcal. Fibre counts for nothing. */
export function foodKcalPerKg(c: Composition): number {
  return weighted(c, FOOD_KCAL_KG);
}

/** Protein in a kilogramme, grams -- the nutrient that actually runs short. */
export function proteinGPerKg(c: Composition): number {
  const total = sum(c);
  return total <= 0 ? 0 : (c.protein / total) * 1000;
}

/**
 * Stiffness along the grain, MPa.
 *
 * Timber engineering's oldest and best-supported relationship: modulus of
 * elasticity runs very nearly proportional to density across every species
 * measured, because the cell walls are the same material and there are simply
 * more of them. About 17 MPa of stiffness per kg/m3 of density, which puts oak
 * at 700 kg/m3 near 12 GPa -- the published figure.
 */
export function stiffnessMPa(m: Material): number {
  return 17 * density(m);
}

/** Crushing strength along the grain, MPa. Oak at 700 gives 56; measured ~50. */
export function compressionMPa(m: Material): number {
  return 0.08 * density(m);
}

/** Bending strength, MPa. Oak at 700 gives 98; measured ~100. */
export function bendingMPa(m: Material): number {
  return 0.14 * density(m);
}

/**
 * How fast it rots, as a fraction of its mass lost per year in warm damp
 * ground.
 *
 * Three things decide it and all three are in the composition. Water is what
 * rot needs -- nothing decays dry. Lignin is what fungi find hard, which is
 * why the woody parts outlast the leaves. Tannin poisons them outright, which
 * is why oak heartwood lasts centuries and oak sapwood a few years, though
 * they are the same tree.
 *
 * The rate is per year at 25 C; `rotRate` applies the temperature.
 */
export function rotResistance(c: Composition): number {
  // OF THE DRY MATTER, not of the whole, and this was a real error rather than
  // a refinement. Read against the wet total, soaking a beam lowered its lignin
  // and tannin FRACTIONS and so made it chemically less durable -- while
  // rotRate was separately multiplying by the same wetness. The water was being
  // counted twice, and the size of it was not small: oak heartwood at 30%
  // moisture came out with a half-life of 8.9 years against 20 at 12%, purely
  // from the arithmetic. A wet oak beam rots faster because it is wet, not
  // because it has stopped being oak.
  const dry = sum(c) - c.water;
  if (dry <= 0) return 1;
  const lignin = c.lignin / dry;
  const protein = c.protein / dry;
  const tannin = c.tannin / dry;
  return ROT_BASE * dexp(
    -ROT_LIGNIN * lignin + ROT_NITROGEN * protein - ROT_TANNIN * tannin,
  );
}

/**
 * THE FOUR CONSTANTS ABOVE, SOLVED FROM THREE MEASURED DURABILITIES.
 *
 * They were 1.0, 3.0 and 12.0, and every one of those was a shape rather than a
 * number: they got the ORDER right -- heartwood outlasts sapwood outlasts
 * leaves -- and nothing anchored the absolute rate or the size of the gaps.
 * Nothing noticed until process.ts turned the rates into years and asked how
 * long a beam lasts. Leaf litter came out with a half-life of three years,
 * against a measured one, and oak heartwood with three and a half against a
 * measured twenty.
 *
 * Three unknowns, so three measurements, all of them standard:
 *
 *   Oak LEAF LITTER loses about half its mass in its first year on a temperate
 *   forest floor: the decomposition constant k is near 0.6 a year at 15 C.
 *
 *   Oak SAPWOOD in ground contact is gone in a few years -- durability class 5,
 *   "not durable", a half-life near 3 years at 20 C.
 *
 *   Oak HEARTWOOD in the same ground is class 2, "durable", and lasts a couple
 *   of decades: a half-life near 20 years. This is the gap that makes an oak
 *   gatepost worth cutting and an oak sapwood one worth nothing.
 *
 * NITROGEN IS THE FOURTH TERM AND IT HAD TO BE ADDED. With only lignin and
 * tannin the three anchors could still be hit, but only by constants so steep
 * that a percentage point of lignin swung durability by half -- because a leaf
 * and a plank have nearly the same lignin fraction of their dry matter (0.225
 * against 0.273) and rot twenty-four times differently. What actually separates
 * them is nitrogen: the standard predictor of litter decay is the lignin to
 * nitrogen ratio, and a leaf is thirty times richer in protein than heartwood.
 * With protein in, the constants come out mild and the mechanism is the real
 * one -- lignin slows decay, nitrogen feeds it, tannin poisons it.
 *
 * Solving the three anchors gives 3.08, 6.0, 4.59 and 22.3.
 */
const ROT_BASE = 3.078;
const ROT_LIGNIN = 6.0;
const ROT_NITROGEN = 4.594;
const ROT_TANNIN = 22.26;

/**
 * Mass lost to rot in a year at a given temperature, as a fraction.
 *
 * Decay roughly doubles for every ten degrees, the usual biological Q10, and
 * stops below freezing -- which is why a body in a bog and a beam in a cold
 * dry church both last, for completely different reasons.
 */
export function rotRate(c: Composition, temperatureC: number, wetness: number): number {
  const total = sum(c);
  if (total <= 0) return 0;
  if (temperatureC <= 0) return 0;
  const moisture = Math.max(0, Math.min(1, Math.max(c.water / total, wetness)));
  // Nothing rots dry: below about a fifth water by mass, fungi cannot work.
  if (moisture < 0.2) return 0;
  const q10 = dpow(2, (temperatureC - 25) / 10);
  return rotResistance(c) * moisture * q10;
}

/**
 * Will it take a light, as it stands?
 *
 * A fuel has to give back more heat than it spends boiling its own water, and
 * in practice needs a good deal more than that to sustain a flame. Wood over
 * about a third water will smoke and go out, which is the difference between
 * seasoned and green and is why nobody burns a living tree.
 */
export function burns(c: Composition): boolean {
  const total = sum(c);
  if (total <= 0) return false;
  return c.water / total < 0.35 && fuelMJPerKg(c) > 8;
}

/** A composition with the water changed, the rest rescaled. Drying, or soaking. */
export function atMoisture(c: Composition, water: number): Composition {
  const w = Math.max(0, Math.min(0.99, water));
  const total = sum(c);
  const dry = total - c.water;
  if (dry <= 0) return { ...c, water: w };
  const scale = (1 - w) / (dry / total) / total;
  return {
    water: w,
    cellulose: c.cellulose * scale,
    lignin: c.lignin * scale,
    starch: c.starch * scale,
    sugar: c.sugar * scale,
    oil: c.oil * scale,
    protein: c.protein * scale,
    tannin: c.tannin * scale,
    ash: c.ash * scale,
  };
}
