// The second animal, and the one the export economy stood on.
//
// A medieval sheep is small: thirty-five kilogrammes against a modern
// mule's seventy, which matters because ALL the allometry runs off the mass
// and this sheet is where the machinery gets its first test on a second
// species. The predictions were checked before the sheet was trusted:
// gestation at thirty-five kilogrammes comes out at 149 days against a
// measured 147, and lifespan at 10.6 years against a shepherd's ten to
// twelve -- the same quarter-power clock that placed the cow, hitting a
// beast a thirteenth her size.
//
// THE FLEECE IS WHY SHE EXISTS. Wool was England's export economy for three
// centuries, and the customs rolls that taxed it recorded what a fleece
// weighed: a pound to two pounds off a medieval ewe, call it 1.4 kg of
// greasy wool a year. The fleece is not a tissue -- it is a crop the animal
// grows annually and the shears take without harm -- so it is a rate on the
// sheet beside the milk, and shearing is a verb in craft.ts.
//
// Ewe's milk is on the sheet too, because the medieval dairy was as much
// sheep as cow: richer milk -- seven per cent fat against the cow's four --
// and forty-odd litres a season after the lamb is weaned.

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
 * Greasy wool off one ewe in one year, kg.
 *
 * The customs rolls' own figure: medieval fleeces ran one to two pounds of
 * washed wool, 1.2 to 1.8 kg in the grease. Selective breeding has since
 * tripled it, which is the same caution as the cow's milk: give a
 * fourteenth-century flock modern fleeces and the wool trade loses its
 * entire point of scarcity.
 */
export const FLEECE_KG_PER_YEAR = 1.4;

/**
 * What a sheep is made of, by share of live weight.
 *
 * The butcher again: a sheep dresses at about half -- mutton, fat and bone
 * on the hook -- and the pelt comes off wool-on, which is why a sheepskin
 * is a warmer thing than a cowhide and a bigger share of the beast.
 */
const TISSUES: readonly Tissue[] = [
  {
    name: 'mutton',
    share: 0.32,
    densityKgM3: 1050,
    edible: true,
    carcass: true,
    composition: mix({ water: 0.72, protein: 0.20, oil: 0.07, ash: 0.01 }),
  },
  {
    name: 'tallow',
    share: 0.08,
    densityKgM3: 900,
    edible: true,
    carcass: true,
    composition: mix({ water: 0.10, oil: 0.88, protein: 0.015, ash: 0.005 }),
  },
  {
    name: 'bone',
    share: 0.10,
    densityKgM3: 1900,
    edible: false,
    carcass: true,
    composition: mix({ water: 0.20, protein: 0.25, oil: 0.05, ash: 0.50 }),
  },
  {
    // The pelt, wool on: skin's collagen under a season's fleece and its
    // lanolin. A sheepskin tans into the warmest thing a cottage owns.
    name: 'pelt',
    share: 0.12,
    densityKgM3: 900,
    edible: false,
    carcass: false,
    composition: mix({ water: 0.45, protein: 0.42, oil: 0.10, ash: 0.03 }),
  },
  {
    name: 'offal',
    share: 0.21,
    densityKgM3: 1050,
    edible: true,
    carcass: false,
    composition: mix({ water: 0.75, protein: 0.17, oil: 0.06, ash: 0.02 }),
  },
  {
    name: 'gut fill',
    share: 0.14,
    densityKgM3: 1000,
    edible: false,
    carcass: false,
    composition: mix({ water: 0.85, cellulose: 0.08, lignin: 0.02, protein: 0.02, ash: 0.03 }),
  },
  {
    name: 'blood',
    share: 0.03,
    densityKgM3: 1060,
    edible: true,
    carcass: false,
    composition: mix({ water: 0.80, protein: 0.18, ash: 0.02 }),
  },
  {
    // Ewe's milk: nearly twice the cow's fat, which is why it cheesed so
    // well and why the dairy flock outlived the wool slump.
    name: 'milk',
    share: 0,
    densityKgM3: 1035,
    edible: true,
    carcass: false,
    composition: mix({ water: 0.818, oil: 0.070, protein: 0.055, sugar: 0.048, ash: 0.009 }),
  },
];

export const SHEEP: Animal = {
  name: 'sheep',
  // A medieval ewe. The mule and the merino are centuries of breeding away.
  matureMassKg: 35,
  birthMassKg: 3.5,
  digestion: RUMINANT,
  // Twins are common enough to lift the average above one.
  litterSize: 1.1,
  littersPerYear: 1,
  milkLitresPerYear: 45,
  // Undyed fleece: the greys and near-whites every landrace flock carried.
  coat: [206, 196, 176],
  horned: true,
  tissues: TISSUES,
};

/**
 * The raw fleece as a material: keratin in its grease.
 *
 * Wool is protein -- keratin -- carrying a quarter of its weight in lanolin
 * and suint, which scouring takes out. The nine constituents describe it the
 * way they described the ox: protein for the fibre, oil for the grease.
 */
export const GREASY_WOOL: Composition = mix({
  water: 0.12, protein: 0.60, oil: 0.25, ash: 0.03,
});

/** Fleece as it lies in the sack, kg/m3. Mostly air, like everything warm. */
export const FLEECE_BULK_KG_M3 = 100;
