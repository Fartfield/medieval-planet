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
const EARTH = { forest: 0.356, grass: 0.287, desert: 0.218, tundraIce: 0.080 };

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
// equally, uselessly bad. The range now brackets the anchor: half-lives from
// about 4,600 km down to 870.
for (const continentality of [8.0e-4, 1.2e-3, 1.8e-3, 2.6e-3, 4.0e-3]) {
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
