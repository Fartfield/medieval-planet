// Sweep the climate parameters against Earth's observed land cover.
//
// Not a test -- a measurement tool. Run it when a climate anchor changes, read
// the best row, and put those values in anchors.ts. The fit target is land
// cover rather than rainfall itself, because land cover is what the game
// consumes and what a player can look at and call wrong.
import { generatePlanet, DEFAULT_CLIMATE, type ClimateParams } from '../sim/gen/planet.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { Biome } from '../sim/model/biome.ts';

const EARTH = { forest: 0.31, grass: 0.25, desert: 0.19, tundraIce: 0.20 };
const SEEDS = [20260826, 20268745, 20276664];

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
    for (let c = 0; c < CELL_COUNT; c++) {
      const key = group(p.biome[c]);
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
for (const continentality of [0.10, 0.16, 0.22, 0.28]) {
  for (const backgroundMm of [40, 70]) {
    for (const frontWidth of [0.20, 0.24]) {
      for (const leeFloor of [0.10, 0.22]) {
        const k = { ...DEFAULT_CLIMATE, continentality, backgroundMm, frontWidth, leeFloor };
        const { err, cover } = score(k);
        rows.push({ k, err, cover, label: `cont=${continentality} bg=${backgroundMm} fw=${frontWidth} lee=${leeFloor}` });
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
