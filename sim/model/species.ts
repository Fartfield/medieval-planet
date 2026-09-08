// Five plants, chosen to be as unlike each other as possible.
//
// An oak is a timber tree that takes a century and holds most of its mass in
// dead wood. A hazel is a shrub that is cut down every seven years and grows
// back from the stool. A bramble is a climber that spreads by rooting where it
// touches and defends itself with thorns. Wheat is an annual that lives eight
// months, puts everything into a seed head, and dies. A carrot buries its whole
// crop where nothing can see it.
//
// Between them they use every part in the taxonomy, both composition extremes,
// visible and buried, and all four germination habits. If the machinery handles
// these five it will handle a hundred; if it cannot, the failure shows up now
// rather than after ninety more have been written.
//
// EVERY NUMBER HERE IS MEASURED OR DERIVED FROM SOMETHING MEASURED. Wood
// densities are the published air-dry figures. Compositions are measured
// chemistry. Mature masses are what a mature individual actually weighs.
// Growth rates are set from the age at which each species is known to reach
// half its size -- an oak at eighty years, a hazel at seven, wheat at four
// months -- rather than chosen to look right.

import { type Composition } from './material.ts';
import { type Species, type PartSpec, Part, Habit, PERENNIAL } from './plant.ts';

/** Fill in the nine, leaving out what is absent. */
function mix(parts: Partial<Composition>): Composition {
  return {
    water: 0, cellulose: 0, lignin: 0, starch: 0, sugar: 0,
    oil: 0, protein: 0, tannin: 0, ash: 0, ...parts,
  };
}

const GREEN = { chlorophyll: 1, carotenoid: 0.25, anthocyanin: 0.02, tannin: 0.05 };
const BARK_BROWN = { chlorophyll: 0, carotenoid: 0.1, anthocyanin: 0.05, tannin: 1 };
const WOOD_PALE = { chlorophyll: 0, carotenoid: 0.3, anthocyanin: 0.02, tannin: 0.5 };
const STRAW = { chlorophyll: 0.02, carotenoid: 1, anthocyanin: 0.02, tannin: 0.3 };
const ORANGE = { chlorophyll: 0.02, carotenoid: 1, anthocyanin: 0.08, tannin: 0.02 };
const BLACK_FRUIT = { chlorophyll: 0.02, carotenoid: 0.05, anthocyanin: 1, tannin: 0.3 };
const PALE_FLOWER = { chlorophyll: 0.05, carotenoid: 0.5, anthocyanin: 0.1, tannin: 0.02 };

// Weeks are counted from the northern winter solstice, as season.ts defines.
const SPRING = 14;
const MIDSUMMER = 26;
const AUTUMN = 40;
const LEAF_FALL = 45;

// --- oak ---------------------------------------------------------------------

const OAK_PARTS: PartSpec[] = [
  {
    part: Part.Root, share: 0.19, densityKgM3: 600, pigment: WOOD_PALE,
    phenology: PERENNIAL,
    composition: mix({ water: 0.30, cellulose: 0.34, lignin: 0.22, tannin: 0.04, sugar: 0.09, protein: 0.008, ash: 0.002 }),
  },
  {
    // The dead durable core. Tannin is why it lasts, and why oak bark tans.
    part: Part.Heartwood, share: 0.38, densityKgM3: 700, pigment: WOOD_PALE,
    phenology: PERENNIAL,
    composition: mix({ water: 0.12, cellulose: 0.40, lignin: 0.24, tannin: 0.08, sugar: 0.15, protein: 0.006, ash: 0.004 }),
  },
  {
    // The living outer wood: same tree, same year, a fraction of the life.
    part: Part.Sapwood, share: 0.16, densityKgM3: 660, pigment: WOOD_PALE,
    phenology: PERENNIAL,
    composition: mix({ water: 0.12, cellulose: 0.44, lignin: 0.24, tannin: 0.005, sugar: 0.18, protein: 0.011, ash: 0.004 }),
  },
  {
    part: Part.Bark, share: 0.08, densityKgM3: 550, pigment: BARK_BROWN,
    phenology: PERENNIAL,
    composition: mix({ water: 0.15, cellulose: 0.28, lignin: 0.30, tannin: 0.18, sugar: 0.07, protein: 0.01, ash: 0.02 }),
  },
  {
    part: Part.Branch, share: 0.12, densityKgM3: 680, pigment: WOOD_PALE,
    phenology: PERENNIAL,
    composition: mix({ water: 0.15, cellulose: 0.42, lignin: 0.25, tannin: 0.03, sugar: 0.14, protein: 0.008, ash: 0.004 }),
  },
  {
    // This year's growth: browse for a deer, kindling for a fire.
    part: Part.Twig, share: 0.015, densityKgM3: 620, pigment: BARK_BROWN,
    phenology: { from: SPRING, to: 0 },
    composition: mix({ water: 0.35, cellulose: 0.34, lignin: 0.19, tannin: 0.05, sugar: 0.06, protein: 0.008, ash: 0.002 }),
  },
  {
    part: Part.Bud, share: 0.002, densityKgM3: 700, pigment: BARK_BROWN,
    phenology: { from: AUTUMN, to: SPRING },
    composition: mix({ water: 0.45, cellulose: 0.20, lignin: 0.10, starch: 0.15, protein: 0.05, tannin: 0.03, ash: 0.02 }),
  },
  {
    part: Part.Leaf, share: 0.03, densityKgM3: 400, pigment: GREEN,
    phenology: { from: SPRING, to: LEAF_FALL },
    composition: mix({ water: 0.60, cellulose: 0.14, lignin: 0.09, protein: 0.08, sugar: 0.04, oil: 0.01, ash: 0.04 }),
  },
  {
    part: Part.Flower, share: 0.001, densityKgM3: 350, pigment: PALE_FLOWER,
    phenology: { from: SPRING, to: SPRING + 4 },
    composition: mix({ water: 0.70, cellulose: 0.10, lignin: 0.03, sugar: 0.08, protein: 0.06, ash: 0.03 }),
  },
  {
    // The acorn: starch and tannin, which is why pigs can eat it and we cannot.
    part: Part.Seed, share: 0.002, densityKgM3: 900, pigment: BARK_BROWN,
    phenology: { from: AUTUMN, to: AUTUMN + 8 },
    composition: mix({ water: 0.40, starch: 0.38, oil: 0.05, protein: 0.04, tannin: 0.07, cellulose: 0.04, ash: 0.02 }),
  },
  {
    part: Part.Sap, share: 0.02, densityKgM3: 1020, pigment: PALE_FLOWER,
    phenology: { from: SPRING - 4, to: MIDSUMMER },
    composition: mix({ water: 0.96, sugar: 0.03, protein: 0.005, ash: 0.005 }),
  },
];

export const OAK: Species = {
  name: 'oak',
  habit: Habit.Tree,
  lifespanYears: 400,
  // A mature standard oak: about two tonnes of dry above-ground mass, and the
  // roots again on top of that.
  matureMassKg: 2600,
  // Set so that half its final mass arrives near eighty years, which is what a
  // timber oak actually does.
  growthRate: 0.0245,
  matureSpreadM: 18,
  // A mature standard oak in the open: twenty metres, and about as wide.
  matureHeightM: 20,
  stems: 1,
  germination: {
    // An acorn needs a winter before it will start, which is why an autumn
    // crop comes up the following spring and not the same month.
    minTempC: 8, chillWeeks: 8, weeklyOdds: 0.10, seedlingSurvival: 0.02,
  },
  parts: OAK_PARTS,
};

// --- hazel -------------------------------------------------------------------

export const HAZEL: Species = {
  name: 'hazel',
  habit: Habit.Shrub,
  lifespanYears: 80,
  matureMassKg: 45,
  // Half its mass by about seven years, which is why the coppice cycle is seven
  // years and not a number somebody picked.
  growthRate: 0.28,
  matureSpreadM: 4,
  matureHeightM: 5,
  // A cut stool throws six to ten poles. Seven, and the check is that they come
  // out at the three to five centimetres a hazel rod actually measures.
  stems: 7,
  germination: { minTempC: 8, chillWeeks: 10, weeklyOdds: 0.08, seedlingSurvival: 0.05 },
  parts: [
    { part: Part.Root, share: 0.23, densityKgM3: 560, pigment: WOOD_PALE, phenology: PERENNIAL,
      composition: mix({ water: 0.32, cellulose: 0.34, lignin: 0.21, tannin: 0.03, sugar: 0.09, protein: 0.008, ash: 0.002 }) },
    { part: Part.Rhizome, share: 0.04, densityKgM3: 580, pigment: WOOD_PALE, phenology: PERENNIAL,
      composition: mix({ water: 0.35, cellulose: 0.30, lignin: 0.18, starch: 0.12, tannin: 0.02, protein: 0.01, ash: 0.02 }) },
    { part: Part.Sapwood, share: 0.40, densityKgM3: 600, pigment: WOOD_PALE, phenology: PERENNIAL,
      composition: mix({ water: 0.12, cellulose: 0.45, lignin: 0.23, tannin: 0.01, sugar: 0.175, protein: 0.011, ash: 0.004 }) },
    { part: Part.Bark, share: 0.09, densityKgM3: 520, pigment: BARK_BROWN, phenology: PERENNIAL,
      composition: mix({ water: 0.16, cellulose: 0.30, lignin: 0.28, tannin: 0.14, sugar: 0.08, protein: 0.02, ash: 0.02 }) },
    // SPLIT OUT OF THE TWIG SHARE, and the geometry is what forced it. Hazel
    // carried 0.09 as Twig and no Branch at all, which made the pipe model
    // divide nine per cent of the plant among a single year's shoots and hand
    // back twigs fifteen millimetres thick. Most of that mass is older side
    // wood, which is Branch; a year's shoot is nearer three per cent, and at
    // three per cent the derived twig comes out at three millimetres.
    { part: Part.Branch, share: 0.062, densityKgM3: 590, pigment: BARK_BROWN, phenology: PERENNIAL,
      composition: mix({ water: 0.20, cellulose: 0.40, lignin: 0.22, tannin: 0.03, sugar: 0.13, protein: 0.015, ash: 0.005 }) },
    { part: Part.Twig, share: 0.028, densityKgM3: 580, pigment: BARK_BROWN, phenology: { from: SPRING, to: 0 },
      composition: mix({ water: 0.38, cellulose: 0.33, lignin: 0.18, tannin: 0.04, sugar: 0.05, protein: 0.008, ash: 0.002 }) },
    { part: Part.Bud, share: 0.004, densityKgM3: 700, pigment: BARK_BROWN, phenology: { from: AUTUMN, to: SPRING },
      composition: mix({ water: 0.45, cellulose: 0.20, lignin: 0.10, starch: 0.15, protein: 0.05, tannin: 0.03, ash: 0.02 }) },
    { part: Part.Leaf, share: 0.05, densityKgM3: 380, pigment: GREEN, phenology: { from: SPRING, to: LEAF_FALL },
      composition: mix({ water: 0.62, cellulose: 0.13, lignin: 0.07, protein: 0.09, sugar: 0.04, oil: 0.01, ash: 0.04 }) },
    { part: Part.Flower, share: 0.001, densityKgM3: 350, pigment: PALE_FLOWER, phenology: { from: 4, to: 10 },
      composition: mix({ water: 0.68, cellulose: 0.12, lignin: 0.04, sugar: 0.08, protein: 0.05, ash: 0.03 }) },
    // A hazelnut is oil where an acorn is starch, which is why one keeps a
    // person alive through winter and the other keeps a pig alive.
    { part: Part.Seed, share: 0.07, densityKgM3: 950, pigment: BARK_BROWN, phenology: { from: AUTUMN - 4, to: AUTUMN + 6 },
      composition: mix({ water: 0.06, oil: 0.61, protein: 0.15, starch: 0.07, cellulose: 0.07, sugar: 0.02, tannin: 0.01, ash: 0.01 }) },
    { part: Part.Husk, share: 0.025, densityKgM3: 500, pigment: STRAW, phenology: { from: AUTUMN - 4, to: AUTUMN + 6 },
      composition: mix({ water: 0.12, cellulose: 0.45, lignin: 0.30, tannin: 0.06, protein: 0.02, sugar: 0.03, ash: 0.02 }) },
  ],
};

// --- bramble -----------------------------------------------------------------

export const BRAMBLE: Species = {
  name: 'bramble',
  habit: Habit.Climber,
  lifespanYears: 12,
  matureMassKg: 6,
  growthRate: 1.1,
  matureSpreadM: 3,
  // A cane arches to about waist height before it tips over and roots again,
  // which is the whole of how a bramble travels.
  matureHeightM: 1.2,
  // A mature clump carries about forty canes, built up over several years.
  stems: 40,
  germination: {
    // Passed through a bird, which is what the fruit is for. No chilling
    // needed and long odds, which is why brambles come up everywhere and
    // mostly do not.
    minTempC: 10, chillWeeks: 4, weeklyOdds: 0.04, seedlingSurvival: 0.03,
  },
  parts: [
    { part: Part.Root, share: 0.25, densityKgM3: 520, pigment: WOOD_PALE, phenology: PERENNIAL,
      composition: mix({ water: 0.40, cellulose: 0.30, lignin: 0.16, starch: 0.08, tannin: 0.04, protein: 0.01, ash: 0.01 }) },
    { part: Part.Rhizome, share: 0.10, densityKgM3: 540, pigment: WOOD_PALE, phenology: PERENNIAL,
      composition: mix({ water: 0.42, cellulose: 0.28, lignin: 0.14, starch: 0.12, tannin: 0.02, protein: 0.01, ash: 0.01 }) },
    { part: Part.Branch, share: 0.30, densityKgM3: 480, pigment: WOOD_PALE, phenology: PERENNIAL,
      composition: mix({ water: 0.45, cellulose: 0.30, lignin: 0.15, tannin: 0.03, sugar: 0.05, protein: 0.01, ash: 0.01 }) },
    { part: Part.Thorn, share: 0.01, densityKgM3: 800, pigment: BARK_BROWN, phenology: PERENNIAL,
      composition: mix({ water: 0.15, cellulose: 0.35, lignin: 0.38, tannin: 0.08, protein: 0.02, ash: 0.02 }) },
    { part: Part.Leaf, share: 0.18, densityKgM3: 370, pigment: GREEN, phenology: { from: SPRING - 4, to: 50 },
      composition: mix({ water: 0.63, cellulose: 0.13, lignin: 0.07, protein: 0.08, sugar: 0.04, oil: 0.01, tannin: 0.01, ash: 0.03 }) },
    { part: Part.Flower, share: 0.005, densityKgM3: 340, pigment: PALE_FLOWER, phenology: { from: 22, to: 30 },
      composition: mix({ water: 0.72, cellulose: 0.10, lignin: 0.03, sugar: 0.08, protein: 0.04, ash: 0.03 }) },
    { part: Part.Fruit, share: 0.15, densityKgM3: 1010, pigment: BLACK_FRUIT, phenology: { from: 32, to: 40 },
      composition: mix({ water: 0.85, sugar: 0.05, cellulose: 0.05, protein: 0.014, oil: 0.005, tannin: 0.02, ash: 0.006, starch: 0.01 }) },
    { part: Part.Seed, share: 0.005, densityKgM3: 1100, pigment: BARK_BROWN, phenology: { from: 32, to: 40 },
      composition: mix({ water: 0.10, oil: 0.20, cellulose: 0.40, lignin: 0.20, protein: 0.07, ash: 0.03 }) },
  ],
};

// --- wheat -------------------------------------------------------------------

export const WHEAT: Species = {
  name: 'wheat',
  habit: Habit.Grass,
  // An annual: it lives one season and dies, which is what makes it a crop.
  lifespanYears: 1,
  matureMassKg: 0.006,
  // Half its mass in about four months, which for an annual is most of a life.
  growthRate: 6.0,
  matureSpreadM: 0.15,
  // A landrace wheat stands nearly a metre, which is why its straw was worth
  // as much as its grain and why modern short-strawed wheat is a different
  // bargain entirely.
  matureHeightM: 0.9,
  // Tillers: one sown grain puts up three or four shoots that carry an ear.
  stems: 3,
  germination: {
    // Sown, not scattered, so no chilling and very high odds -- a farmer who
    // sowed seed that came up one time in ten would starve.
    minTempC: 4, chillWeeks: 0, weeklyOdds: 0.85, seedlingSurvival: 0.9,
  },
  parts: [
    { part: Part.Root, share: 0.20, densityKgM3: 450, pigment: WOOD_PALE, phenology: { from: 8, to: 34 },
      composition: mix({ water: 0.55, cellulose: 0.25, lignin: 0.10, protein: 0.03, sugar: 0.04, ash: 0.03 }) },
    // Straw: what is left after threshing, and the reason a village has
    // bedding, thatch and winter fodder at all.
    { part: Part.Branch, share: 0.42, densityKgM3: 380, pigment: STRAW, phenology: { from: 10, to: 34 },
      composition: mix({ water: 0.12, cellulose: 0.40, lignin: 0.20, sugar: 0.19, protein: 0.03, ash: 0.06 }) },
    { part: Part.Leaf, share: 0.10, densityKgM3: 350, pigment: GREEN, phenology: { from: 10, to: 32 },
      composition: mix({ water: 0.60, cellulose: 0.20, lignin: 0.08, protein: 0.06, sugar: 0.02, ash: 0.04 }) },
    { part: Part.Flower, share: 0.005, densityKgM3: 330, pigment: STRAW, phenology: { from: 24, to: 27 },
      composition: mix({ water: 0.65, cellulose: 0.15, lignin: 0.05, sugar: 0.07, protein: 0.05, ash: 0.03 }) },
    { part: Part.Seed, share: 0.20, densityKgM3: 1300, pigment: STRAW, phenology: { from: 28, to: 34 },
      composition: mix({ water: 0.12, starch: 0.68, protein: 0.12, oil: 0.02, cellulose: 0.045, sugar: 0.015, ash: 0.02 }) },
    // Chaff: the husk threshing takes off. Same plant, and not food.
    { part: Part.Husk, share: 0.075, densityKgM3: 300, pigment: STRAW, phenology: { from: 28, to: 34 },
      composition: mix({ water: 0.10, cellulose: 0.40, lignin: 0.22, sugar: 0.18, protein: 0.03, ash: 0.07 }) },
  ],
};

// --- carrot ------------------------------------------------------------------

export const CARROT: Species = {
  name: 'carrot',
  habit: Habit.Herb,
  lifespanYears: 2,
  matureMassKg: 0.12,
  growthRate: 4.0,
  matureSpreadM: 0.25,
  // The leaf rosette. Nothing of the crop shows in it at all.
  matureHeightM: 0.35,
  stems: 1,
  germination: { minTempC: 6, chillWeeks: 0, weeklyOdds: 0.55, seedlingSurvival: 0.7 },
  parts: [
    { part: Part.Root, share: 0.08, densityKgM3: 700, pigment: WOOD_PALE, phenology: { from: 10, to: 44 },
      composition: mix({ water: 0.80, cellulose: 0.10, lignin: 0.04, sugar: 0.02, protein: 0.02, ash: 0.02 }) },
    // The crop, and the whole point: buried, so nothing above ground shows it.
    { part: Part.Storage, share: 0.62, densityKgM3: 1040, pigment: ORANGE, phenology: { from: 14, to: 44 },
      composition: mix({ water: 0.88, sugar: 0.050, starch: 0.010, cellulose: 0.028, protein: 0.009, ash: 0.010, oil: 0.002, lignin: 0.011 }) },
    { part: Part.Leaf, share: 0.28, densityKgM3: 340, pigment: GREEN, phenology: { from: 12, to: 44 },
      composition: mix({ water: 0.85, cellulose: 0.06, lignin: 0.02, protein: 0.03, sugar: 0.01, ash: 0.03 }) },
    { part: Part.Flower, share: 0.01, densityKgM3: 320, pigment: PALE_FLOWER, phenology: { from: 26, to: 32 },
      composition: mix({ water: 0.70, cellulose: 0.12, lignin: 0.04, sugar: 0.07, protein: 0.04, ash: 0.03 }) },
    { part: Part.Seed, share: 0.01, densityKgM3: 800, pigment: BARK_BROWN, phenology: { from: 34, to: 40 },
      composition: mix({ water: 0.08, oil: 0.14, cellulose: 0.42, lignin: 0.18, protein: 0.12, ash: 0.06 }) },
  ],
};

// --- meadow grass ------------------------------------------------------------

/**
 * The sixth, and the one that covers the world.
 *
 * A perennial bunchgrass -- a fescue or a bent, the sward of an ordinary
 * pasture. It is here because everything else needed it: the map's ground
 * between the trees is grass, and until now there was no grass to bake it from.
 *
 * Its mature mass is set by an anchor that already existed. GRASS_TUFT_G says a
 * tuft carries three grammes of standing dry matter above ground, which is what
 * a hand-sized quadrat of sward weighs out at; with roots at 45% -- a grass
 * keeps nearly half its mass below ground, which is the whole reason a sward
 * survives grazing -- the whole plant is about six grammes.
 */
export const GRASS: Species = {
  name: 'grass',
  habit: Habit.Grass,
  lifespanYears: 6,
  matureMassKg: 0.006,
  // A tussock fills out in a season: half its mass in about three months.
  growthRate: 3.0,
  matureSpreadM: 0.12,
  matureHeightM: 0.5,
  // Tillers. A bunchgrass is a crowd of shoots from one crown, which is why it
  // is a tuft and not a stem.
  stems: 25,
  germination: { minTempC: 5, chillWeeks: 2, weeklyOdds: 0.2, seedlingSurvival: 0.15 },
  parts: [
    // Nearly half of it, and out of sight. This is what makes a pasture
    // survive being eaten to the ground every week of the summer.
    { part: Part.Root, share: 0.45, densityKgM3: 420, pigment: WOOD_PALE, phenology: PERENNIAL,
      composition: mix({ water: 0.60, cellulose: 0.22, lignin: 0.08, protein: 0.03, sugar: 0.04, ash: 0.03 }) },
    { part: Part.Rhizome, share: 0.05, densityKgM3: 450, pigment: WOOD_PALE, phenology: PERENNIAL,
      composition: mix({ water: 0.62, cellulose: 0.18, lignin: 0.06, starch: 0.08, protein: 0.02, ash: 0.04 }) },
    { part: Part.Branch, share: 0.12, densityKgM3: 350, pigment: STRAW, phenology: { from: 10, to: 48 },
      composition: mix({ water: 0.55, cellulose: 0.24, lignin: 0.09, sugar: 0.07, protein: 0.02, ash: 0.03 }) },
    { part: Part.Leaf, share: 0.32, densityKgM3: 330, pigment: GREEN, phenology: { from: 8, to: 48 },
      composition: mix({ water: 0.72, cellulose: 0.13, lignin: 0.04, protein: 0.05, sugar: 0.02, oil: 0.01, ash: 0.03 }) },
    { part: Part.Flower, share: 0.02, densityKgM3: 320, pigment: STRAW, phenology: { from: 22, to: 28 },
      composition: mix({ water: 0.60, cellulose: 0.18, lignin: 0.06, sugar: 0.08, protein: 0.05, ash: 0.03 }) },
    { part: Part.Seed, share: 0.03, densityKgM3: 900, pigment: STRAW, phenology: { from: 26, to: 36 },
      composition: mix({ water: 0.12, starch: 0.60, protein: 0.14, oil: 0.03, cellulose: 0.07, sugar: 0.02, ash: 0.02 }) },
    { part: Part.Husk, share: 0.01, densityKgM3: 280, pigment: STRAW, phenology: { from: 26, to: 36 },
      composition: mix({ water: 0.10, cellulose: 0.42, lignin: 0.20, sugar: 0.19, protein: 0.03, ash: 0.06 }) },
  ],
};

export const SPECIES: readonly Species[] = [OAK, HAZEL, BRAMBLE, WHEAT, CARROT, GRASS];
