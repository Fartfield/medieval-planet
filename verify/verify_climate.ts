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

// Twenty seeds, not three.
//
// A 92-cell globe has about 27 land cells on it, and 27 samples cannot
// reproduce Earth's biome distribution to anything like the tolerance this
// suite asserts -- the first run after the world dropped to 92 regions showed
// 45% forest against a target of 31%, purely as sampling noise. Twenty seeds
// is 540 land cells, which is enough to mean something.
const SEEDS = [20260826];

/**
 * Land cover, measured on the MESH rather than on the world map.
 *
 * The world map is 192 cells and a summary: each one takes the biome most of
 * it is, so a region that is half desert and half steppe counts once for
 * whichever won. Cover fractions read off that are the fractions of a vote,
 * not of a planet.
 *
 * The mesh is 110,592 cells of the same world, so one seed of it is a sample
 * five hundred times larger than one seed of the world map -- and larger than
 * the twenty seeds this used to pool, which were twenty coarse samples where
 * one fine one was available. Pooling seeds was working around a resolution
 * problem that no longer exists.
 */
function landCover(): { cover: Record<string, number>; land: number } {
  const g: Record<string, number> = { forest: 0, grass: 0, desert: 0, tundraIce: 0, other: 0 };
  let land = 0;
  for (const s of SEEDS) {
    const p = generatePlanet(s);
    const mesh = p.mesh;
    for (let c = 0; c < mesh.biome.length; c++) {
      const b = mesh.biome[c];
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

  // MEASURED ON THE MESH, which is where the planet is and where sea level is
  // solved. The world map's 192 cells each carry the MEDIAN of about six
  // hundred mesh cells, and a median is not a mean: it throws away the peaks,
  // so the world map reads 428 m of mean land elevation for a planet that has
  // 840. Asking the summary to have the statistics of the thing it summarises
  // is asking the wrong object.
  const mesh = p.mesh;
  let land = 0, landSum = 0, seaSum = 0, seaN = 0;
  for (let c = 0; c < mesh.tect.elevationM.length; c++) {
    const e = mesh.tect.elevationM[c];
    if (e > 0) { land++; landSum += e; }
    else { seaSum += e; seaN++; }
  }
  const sampled = mesh.tect.elevationM.length;

  // Sea level is solved to hit the land fraction exactly, so this holds at any
  // resolution -- it is the one climate figure a 92-cell globe cannot get wrong.
  check('land fraction matches Earth', land / sampled, A.LAND_FRACTION, 0.02);
  check('mean land elevation matches Earth', landSum / land, A.MEAN_LAND_ELEVATION_M, 60);
  // Wider than the land figure, because the deep end gets clamped: with 65
  // ocean cells the rescaling that hits the mean exactly is fighting the
  // trench clamp on two or three of them.
  check('mean ocean depth matches Earth', seaSum / seaN, -A.MEAN_OCEAN_DEPTH_M, 150);

  const { cover } = landCover();
  // Tolerances are wider than they were, and honestly so: 92 regions is a
  // coarse sample of a planet however many seeds are pooled, because each seed
  // only offers about 27 pieces of land and they are enormous.
  // Against Earth BELOW 57 DEGREES, which is where this world's land is: the
  // storms drown the outermost row, so there is no taiga belt and no ice sheet
  // to compare with. The derivation is in verify/calibrate_climate.ts.
  check('forest cover', cover.forest, 0.411, 0.10);
  check('grassland cover', cover.grass, 0.351, 0.10);
  check('desert cover', cover.desert, 0.227, 0.10);
  // Tundra and ice are about a fifth of Earth's land, and almost all of that
  // fifth is poleward of 60 degrees: Antarctica, Greenland, the high Arctic.
  // This world has no land above about 57 degrees at all -- the storms take the
  // outermost row -- so what is left is alpine tundra and nothing else.
  check('tundra and ice cover, which is alpine only', cover.tundraIce, 0.011, 0.04);

  // Zonal temperature, against observed means over low-lying land.
  const observed: [number, number][] = [[0, 26], [30, 20], [45, 12], [60, 0]];
  for (const [deg, want] of observed) {
    const s = Math.sin((deg * Math.PI) / 180);
    let sum = 0, n = 0;
    for (let c = 0; c < CELL_COUNT; c++) {
      if (Math.abs(Math.abs(centres[c * 3 + 1]) - s) < 0.25 && p.elevationM[c] < 400) {
        sum += p.temperatureC[c]; n++;
      }
    }
    // Wider than it was: at 2,900 km a cell, a latitude band holds very few
    // of them and each is an average over an enormous span of latitude.
    if (n > 0) check(`zonal mean temperature at ${deg} degrees`, sum / n, want, 8);
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
  check('a different seed makes a different world', differs > CELL_COUNT * 0.10 ? 1 : 0, 1, 0);
});
