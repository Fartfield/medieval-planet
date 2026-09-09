// One animal, carried all the way through.
//
// A medieval cow, and not a modern one: 450 kg against a Holstein's 700, and
// 600 litres of milk a year against nine thousand. The difference is five
// centuries of breeding and it matters more than anything else on this sheet --
// a model that gave a fourteenth-century village modern dairy yields would have
// it exporting cheese instead of struggling for winter fat.
//
// Everything except four numbers falls out of the mass. What she eats, how fast
// she grows, how long she carries a calf, how long she lives, how much she
// drinks and how much dung she drops are all in animal.ts and are all powers of
// 450. What is here is the mass itself, the birth weight, the litter she bears,
// the milk, and what she is made of.
//
// THE TISSUES USE THE SAME NINE CONSTITUENTS AS THE PLANTS, and that is a claim
// worth testing rather than an economy. Beef is protein and fat and water; bone
// is protein and mineral ash; tallow is nearly all oil; milk is water with
// lactose in it, which the sugar constituent already describes. If nine
// substances chosen for wood and grain also describe an ox, they were the right
// nine -- and if they were not, this is where it shows.

import { type Composition } from './material.ts';
import { RUMINANT } from './process.ts';
import { type Animal, type Tissue } from './animal.ts';

function mix(parts: Partial<Composition>): Composition {
  return {
    water: 0, cellulose: 0, lignin: 0, starch: 0, sugar: 0,
    oil: 0, protein: 0, tannin: 0, ash: 0, ...parts,
  };
}

/**
 * What a beast is made of, by share of live weight.
 *
 * Measured, and it is the butcher's arithmetic. A bullock dresses out at 55%
 * of live weight -- meat, fat and bone on the hook -- and the other 45% is gut
 * fill, hide, head, feet, blood and offal. Within the carcass it is about 65%
 * meat, 15% fat and 20% bone, which is where the three shares come from.
 *
 * The shares sum to one because an animal is all of itself, and that is the
 * same check the plants get.
 */
const TISSUES: readonly Tissue[] = [
  {
    // Lean meat. Published at about 1,400 kcal/kg and 20% protein, which the
    // Atwater factors have to reproduce from this recipe or something is wrong.
    name: 'beef',
    share: 0.360,
    densityKgM3: 1050,
    edible: true,
    carcass: true,
    composition: mix({ water: 0.72, protein: 0.21, oil: 0.06, ash: 0.01 }),
  },
  {
    // Fat, and the most valuable part of a medieval carcass by a long way: it
    // is the only concentrated energy a village has, it makes candles, it
    // waterproofs leather, and it keeps.
    name: 'tallow',
    share: 0.083,
    densityKgM3: 900,
    edible: true,
    carcass: true,
    composition: mix({ water: 0.10, oil: 0.88, protein: 0.015, ash: 0.005 }),
  },
  {
    // Collagen and mineral. Not food, and not nothing: bone is glue, buttons,
    // handles, and -- burnt -- the phosphate that goes back on the field.
    name: 'bone',
    share: 0.112,
    densityKgM3: 1900,
    edible: false,
    carcass: true,
    composition: mix({ water: 0.20, protein: 0.25, oil: 0.05, ash: 0.50 }),
  },
  {
    // Raw hide: collagen and water, and the whole reason oak bark is worth
    // stripping. Tanning is the tannin in the bark crosslinking this protein,
    // which is a process the material model can already express.
    name: 'hide',
    share: 0.070,
    densityKgM3: 1100,
    edible: false,
    carcass: false,
    composition: mix({ water: 0.64, protein: 0.33, oil: 0.02, ash: 0.01 }),
  },
  {
    name: 'offal',
    share: 0.195,
    densityKgM3: 1050,
    edible: true,
    carcass: false,
    composition: mix({ water: 0.75, protein: 0.17, oil: 0.06, ash: 0.02 }),
  },
  {
    // GUT FILL, and it is on the sheet because it is the difference between
    // live weight and everything a butcher can use. A ruminant carries fifteen
    // per cent of itself as half-digested grass, which is why dressing
    // percentage is barely over half and why a beast is weighed after a fast.
    name: 'gut fill',
    share: 0.150,
    densityKgM3: 1000,
    edible: false,
    carcass: false,
    composition: mix({ water: 0.85, cellulose: 0.08, lignin: 0.02, protein: 0.02, ash: 0.03 }),
  },
  {
    // Blood: mostly water and protein, and food where nothing is wasted.
    name: 'blood',
    share: 0.030,
    densityKgM3: 1060,
    edible: true,
    carcass: false,
    composition: mix({ water: 0.80, protein: 0.18, ash: 0.02 }),
  },
  {
    // Milk is not part of the carcass; it is here so that `milk()` has a recipe
    // and so the same nine constituents describe it. Zero share.
    // Whole milk is published at about 650 kcal a litre, and lactose is the
    // sugar constituent doing a job it was never chosen for.
    name: 'milk',
    share: 0,
    densityKgM3: 1030,
    edible: true,
    carcass: false,
    composition: mix({ water: 0.872, oil: 0.040, protein: 0.033, sugar: 0.048, ash: 0.007 }),
  },
];

export const CATTLE: Animal = {
  name: 'cattle',
  // A medieval ox or cow: about 450 kg, against a modern beef animal's 700.
  matureMassKg: 450,
  // A calf is about 40 kg, which is a twelfth of its mother and does not scale
  // from her by any clean power -- birth weight is set by the pelvis.
  birthMassKg: 40,
  digestion: RUMINANT,
  litterSize: 1,
  littersPerYear: 1,
  // SIX HUNDRED LITRES A YEAR, which is a landrace cow suckling a calf and
  // giving what is left. A modern Holstein gives nine thousand. This is the
  // single number on the sheet that five centuries of breeding moved most, and
  // getting it wrong would give a village a dairy industry it never had.
  milkLitresPerYear: 600,
  // Dun and red-brown, which is what the landraces were before anybody bred
  // for a colour. Not derivable from anything, and said so on the sheet.
  coat: [124, 88, 62],
  // Horned, as every beast was: polling is a modern convenience and a
  // medieval ox worked in a yoke that its horns held.
  horned: true,
  tissues: TISSUES,
};
