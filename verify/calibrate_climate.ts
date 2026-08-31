// Sweep the climate parameters against Earth's observed land cover.
//
// Not a test -- a measurement tool. Run it when a climate anchor changes, read
// the best row, and put those values in anchors.ts. The fit target is land
// cover rather than rainfall itself, because land cover is what the game
// consumes and what a player can look at and call wrong.
import { generatePlanet, DEFAULT_CLIMATE, type ClimateParams } from '../sim/gen/planet.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { Biome } from '../sim/model/biome.ts';

/**
 * Earth's land cover, RENORMALISED to the band the grid actually holds.
 *
 * The published figures -- 31% forest, 25% grass, 19% desert, 20% tundra and
 * ice -- are for all land. The world map is a band that stops at 65 degrees,
 * and the land it leaves out is about 13% of Earth's total and almost entirely
 * tundra and ice: Antarctica is 9 points of it, Greenland 1.4, the high Arctic
 * most of the rest. Take that out and renormalise what is left.
 *
 * Comparing against the unrenormalised figures would ask this world to grow
 * tundra where it has no arctic, which it can only do by being too cold
 * everywhere else.
 */
/**
 * Earth's land cover, restricted to the latitudes THIS world has land in.
 *
 * The storms drown the cells that border them, so nothing here lives above
 * about 65 degrees -- see docs/world-lore.md. Comparing against Earth's global
 * shares would ask this world to grow a taiga it has no room for and an ice
 * sheet it has no poles for, so the comparison is made against Earth below 57
 * degrees instead.
 *
 * LAND AREA, in millions of km2:
 *
 *   Earth's land                        149.0
 *     less Antarctica                   -14.0   entirely above 60S
 *     less Greenland                     -2.2   almost entirely above 60N
 *     less other land above 65            -6.0  the high Arctic of Canada,
 *                                               Alaska and Russia
 *   land at or below 65 degrees         126.8
 *
 * and within it:
 *
 *   forest    46.2 global (FAO: 31% of land) less ~4.0 of boreal
 *             lying above 65                                       42.2
 *   grass     savanna and temperate grassland                      32.5
 *   desert    subtropical desert, nearly all of it below 65        21.0
 *   tundra    alpine, plus the little that lies between 57 and 65   2.5
 *                                                                 -----
 *                                                                  98.2
 *
 * RENORMALISED OVER THOSE FOUR, which is the fair comparison rather than a
 * convenience: Earth's remaining 28 million km2 is cropland, wetland,
 * mediterranean scrub and montane mosaic, and this model's classifier has no
 * bucket for any of them -- it puts about 98% of its land in the same four. So
 * the two are made to sum to the same thing before they are compared, instead
 * of charging this world for categories it cannot produce.
 *
 * The soft part is the taiga and tundra split at 57 degrees; everything else is
 * kept whole because it lies well south of the cut. The tolerance downstream is
 * wide for exactly that reason.
 *
 * This has now been done three times, for three grids: the wrapped band ending
 * at 65 degrees (0.356 / 0.287 / 0.218 / 0.080), the same band once the storm
 * margin took everything above 57 (0.411 / 0.351 / 0.227 / 0.011), and now the
 * geodesic, whose uniform cells put the margin back up at 65. The numbers move
 * because the world's LATITUDES move, not because the model does -- which is
 * the argument for deriving them each time rather than nudging them.
 */
const EARTH = { forest: 0.430, grass: 0.331, desert: 0.214, tundraIce: 0.025 };

/**
 * One seed, and that is an increase in sample size rather than a cut.
 *
 * The cover is read off the MESH now -- 110,592 cells of one world -- where it
 * used to be read off 192 cells of three. Pooling seeds was working around a
 * resolution problem that no longer exists.
 */
const SEEDS = [20260826];

function group(b: number): string {
  if (b === Biome.Ocean) return 'ocean';
  if (b === Biome.TemperateForest || b === Biome.TemperateRainforest || b === Biome.Taiga
    || b === Biome.TropicalSeasonalForest || b === Biome.TropicalRainforest) return 'forest';
  if (b === Biome.TemperateGrassland || b === Biome.Savanna) return 'grass';
  if (b === Biome.Desert) return 'desert';
  if (b === Biome.Tundra || b === Biome.Ice) return 'tundraIce';
  return 'other';
}

function score(k: ClimateParams): { err: number; cover: Record<string, number> } {
  const g: Record<string, number> = {};
  let land = 0;
  for (const s of SEEDS) {
    const p = generatePlanet(s, undefined, k);
    const mesh = p.mesh;
    for (let c = 0; c < mesh.biome.length; c++) {
      const key = group(mesh.biome[c]);
      if (key === 'ocean') continue;
      g[key] = (g[key] ?? 0) + 1;
      land++;
    }
  }
  const cover: Record<string, number> = {};
  let err = 0;
  for (const key of Object.keys(EARTH) as (keyof typeof EARTH)[]) {
    cover[key] = (g[key] ?? 0) / land;
    err += Math.abs(cover[key] - EARTH[key]);
  }
  return { err, cover };
}

const rows: { k: ClimateParams; err: number; cover: Record<string, number>; label: string }[] = [];
// Continentality is PER KILOMETRE. The sweep used to run 0.10 to 0.28, which
// were the per-cell units it had before that anchor was fixed, and at a mesh
// spacing of 65 km a value of 0.1/km wrings the air dry ten kilometres inland
// -- so every row came back 88% desert and the sweep reported them all as
// equally, uselessly bad.
//
// EXTENDED DOWNWARD after the re-grid. Every one of the eight best rows came
// back at 8.0e-4, which was the bottom of the range -- and a sweep whose winner
// sits on its own boundary has not found a minimum, it has run out of room.
// This world's land is confined below 57 degrees, so it has proportionally more
// ground in the dry subtropics and less under the polar front than the old band
// did, and it wants wetter interiors to balance that.
for (const continentality of [2.0e-4, 3.5e-4, 5.0e-4, 8.0e-4, 1.2e-3, 1.8e-3, 2.6e-3]) {
  for (const backgroundMm of [10, 25, 40]) {
    for (const frontWidth of [0.20, 0.24]) {
      for (const leeFloor of [0.10, 0.22]) {
        const k = { ...DEFAULT_CLIMATE, continentality, backgroundMm, frontWidth, leeFloor };
        const { err, cover } = score(k);
        rows.push({ k, err, cover, label: `cont=${continentality.toExponential(2)} bg=${backgroundMm} fw=${frontWidth} lee=${leeFloor}` });
      }
    }
  }
}
rows.sort((a, b) => a.err - b.err);
console.log('best fits to Earth land cover (lower error is better):\n');
console.log('  err   forest  grass  desert  tundra   parameters');
for (const r of rows.slice(0, 8)) {
  const c = r.cover;
  console.log(`  ${r.err.toFixed(3)}  ${(c.forest * 100).toFixed(1).padStart(5)}%  ${(c.grass * 100).toFixed(1).padStart(5)}%  ${(c.desert * 100).toFixed(1).padStart(5)}%  ${(c.tundraIce * 100).toFixed(1).padStart(5)}%   ${r.label}`);
}
console.log(`\nEarth:        31.0%   25.0%   19.0%   20.0%`);
