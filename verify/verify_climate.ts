// The planet has to look like a planet.
//
// These assertions are the calibration made permanent. If a change to
// tectonics, temperature or rainfall pushes the land cover away from Earth's,
// this is what says so -- and the failure is a question, not a verdict: either
// the change was wrong, or Earth is no longer the right target and this file
// should say so out loud rather than have its thresholds quietly widened.

import { generatePlanet } from '../sim/gen/planet.ts';
import { CELL_COUNT, centres } from '../sim/geo/sphere.ts';
import { Biome, aridityIndex, biotemperature, miamiNPP } from '../sim/model/biome.ts';
import * as A from '../sim/anchors.ts';
import { check, suite } from './harness.ts';

const SEEDS = [20260826, 20268745, 20276664];

function landCover(): { cover: Record<string, number>; land: number } {
  const g: Record<string, number> = { forest: 0, grass: 0, desert: 0, tundraIce: 0, other: 0 };
  let land = 0;
  for (const s of SEEDS) {
    const p = generatePlanet(s);
    for (let c = 0; c < CELL_COUNT; c++) {
      const b = p.biome[c];
      if (b === Biome.Ocean) continue;
      land++;
      if (b === Biome.TemperateForest || b === Biome.TemperateRainforest || b === Biome.Taiga
        || b === Biome.TropicalSeasonalForest || b === Biome.TropicalRainforest) g.forest++;
      else if (b === Biome.TemperateGrassland || b === Biome.Savanna) g.grass++;
      else if (b === Biome.Desert) g.desert++;
      else if (b === Biome.Tundra || b === Biome.Ice) g.tundraIce++;
      else g.other++;
    }
  }
  const cover: Record<string, number> = {};
  for (const k of Object.keys(g)) cover[k] = g[k] / land;
  return { cover, land };
}

suite('climate', () => {
  const p = generatePlanet(SEEDS[0]);

  let land = 0, landSum = 0, seaSum = 0, seaN = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (p.elevationM[c] > 0) { land++; landSum += p.elevationM[c]; }
    else { seaSum += p.elevationM[c]; seaN++; }
  }

  check('land fraction matches Earth', land / CELL_COUNT, A.LAND_FRACTION, 0.005);
  check('mean land elevation matches Earth', landSum / land, A.MEAN_LAND_ELEVATION_M, 30);
  check('mean ocean depth matches Earth', seaSum / seaN, -A.MEAN_OCEAN_DEPTH_M, 30);

  const { cover } = landCover();
  check('forest cover', cover.forest, 0.31, 0.05);
  check('grassland cover', cover.grass, 0.25, 0.05);
  check('desert cover', cover.desert, 0.19, 0.05);
  check('tundra and ice cover', cover.tundraIce, 0.20, 0.05);

  // Zonal temperature, against observed means over low-lying land.
  const observed: [number, number][] = [[0, 26], [30, 20], [45, 12], [60, 0]];
  for (const [deg, want] of observed) {
    const s = Math.sin((deg * Math.PI) / 180);
    let sum = 0, n = 0;
    for (let c = 0; c < CELL_COUNT; c++) {
      if (Math.abs(Math.abs(centres[c * 3 + 1]) - s) < 0.06 && p.elevationM[c] < 200) {
        sum += p.temperatureC[c]; n++;
      }
    }
    if (n > 0) check(`zonal mean temperature at ${deg} degrees`, sum / n, want, 3.5);
  }

  // Aridity has to actually discriminate: the same rainfall must read
  // differently at different temperatures, or the cold deserts vanish again.
  const hot = aridityIndex(200, 25, 0.1);
  const cold = aridityIndex(200, 0, 0.9);
  check('200 mm is arid when hot', hot < A.ARIDITY_DESERT ? 1 : 0, 1, 0);
  check('200 mm is not arid when cold', cold > A.ARIDITY_DESERT ? 1 : 0, 1, 0);

  // Biotemperature must ignore the frozen half of a cold year.
  check('biotemperature exceeds the annual mean in a cold seasonal place',
    biotemperature(-5, 0.85) > -5 ? 1 : 0, 1, 0);

  // Productivity: a rainforest should out-produce a steppe several times over.
  const rainforest = miamiNPP(26, 2600);
  const steppe = miamiNPP(8, 320);
  check('rainforest out-produces steppe', rainforest / steppe > 3 ? 1 : 0, 1, 0);
  check('productivity is capped below the Miami maximum', rainforest < A.MIAMI_MAX_NPP ? 1 : 0, 1, 0);
});

suite('planet reproducibility', () => {
  const a = generatePlanet(4242);
  const b = generatePlanet(4242);
  let elevDiff = 0, biomeDiff = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (a.elevationM[c] !== b.elevationM[c]) elevDiff++;
    if (a.biome[c] !== b.biome[c]) biomeDiff++;
  }
  check('same seed gives identical elevation', elevDiff, 0, 0);
  check('same seed gives identical biomes', biomeDiff, 0, 0);

  const c2 = generatePlanet(4243);
  let differs = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (c2.biome[c] !== a.biome[c]) differs++;
  check('a different seed makes a different world', differs > CELL_COUNT * 0.15 ? 1 : 0, 1, 0);
});
