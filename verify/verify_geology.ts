// Rock, erosion, soil depth, and whether the hillside stays where it is.
//
// Two of these suites are regression tests for bugs that had been in the world
// for its whole life and that nothing could see:
//
//   * `terrain is not a staircase` -- the sub-map sampler was nearest-
//     neighbour for seven layers, so every child rebuilt its parent's cell
//     boundaries as vertical cliffs. Relief measured 756 m at the 3 km layer
//     and still 756 m at the 41 cm layer. It hid because it produces a
//     plausible median: most of a child's cells sit inside one parent cell and
//     are perfectly flat.
//
//   * `relief matches real landscapes` -- once the staircase was out, nothing
//     in the world was steeper than six degrees, because the detail amplitude
//     was a bare 420 m divided down rather than anchored to anything. A bare
//     number cannot be wrong, which is the problem with it; local relief over
//     a ten-kilometre baseline is a thing people measure and publish, and a
//     generated world can be held against it.
//
// Both were found by asking a question neither had been asked before -- how
// fast does this world wear away -- and getting an answer two orders of
// magnitude out.

import { World } from '../sim/world.ts';
import { SUBCELL_COUNT, RADIUS, ringOf } from '../sim/geo/hexgrid.ts';
import { GROUND_DEPTH } from '../sim/geo/address.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import * as A from '../sim/anchors.ts';
import {
  Rock, ROCK_NAMES, ROCK_ERODIBILITY, ROCK_FRICTION_DEG,
  rockAt, erosionRateM, soilDepthM, factorOfSafety, rootCohesionKPa,
  maxStableSoilM, rootCohesionAfterClearing,
} from '../sim/model/rock.ts';
import { check, measure, assert, suite } from './harness.ts';

const SEED = 20260826;
const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180);

/** Sample plot-layer maps spread across the planet, the same way every run. */
function plotMaps(w: World, limit = 24): ReturnType<World['subMap']>[] {
  const out: ReturnType<World['subMap']>[] = [];
  for (let region = 0; region < CELL_COUNT && out.length < limit; region++) {
    if (w.planet.elevationM[region] <= 0) continue;
    let a = [region];
    while (a.length < 5) {
      const map = w.subMap(a);
      let pick = 0;
      for (let c = 0; c < SUBCELL_COUNT; c++) {
        if (map.elevationM[c] > map.elevationM[pick]) pick = c;
      }
      // Stepped rather than always-steepest, so the sample is not all ridges.
      a = [...a, (pick * 7 + a.length * 13) % SUBCELL_COUNT];
    }
    out.push(w.subMap(a));
  }
  return out;
}

suite('terrain is not a staircase', () => {
  // Descend the steepest path and watch the relief. Each layer covers ONE cell
  // of the layer above, so its relief must fall by roughly the same factor the
  // cell size does. A sampler that reads its parent as a step function does
  // not: it reproduces the parent's full cell-to-cell difference at every
  // depth, forever, and that is what this measures.
  const w = new World({ seed: SEED });
  let region = -1;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (w.planet.elevationM[c] > 500) { region = c; break; }
  }
  assert('found a mountainous region to descend', region >= 0);

  let a = [region];
  const relief: number[] = [];
  const maxSlopeDeg: number[] = [];
  for (let d = 1; d <= 7; d++) {
    const map = w.subMap(a);
    let lo = Infinity, hi = -Infinity, worst = 0;
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      lo = Math.min(lo, map.elevationM[c]);
      hi = Math.max(hi, map.elevationM[c]);
      worst = Math.max(worst, map.slope[c]);
    }
    relief.push(hi - lo);
    maxSlopeDeg.push((Math.atan(worst) * 180) / Math.PI);
    let pick = 0;
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      if (map.slope[c] > map.slope[pick] && map.elevationM[c] > 0) pick = c;
    }
    a = [...a, pick];
  }

  for (let d = 0; d < relief.length; d++) measure(`relief at layer ${d + 1} m`, relief[d]);

  // The headline: relief must never RISE going down the ladder. Each layer
  // covers one cell of the one above, so it can only ever hold a part of what
  // its parent held, and a rise means something is manufacturing ground.
  //
  // Asserted down to the plot layer, which is where the game is played and
  // where the economy reads. Below it -- the yard and pace layers, 2 m and
  // 20 cm cells, with no economy on them -- relief flattens out instead of
  // continuing to fall, because the rim-sampling disagreement between
  // neighbouring maps stops shrinking while the true signal keeps going. That
  // is a real limitation and it is written down in known-gaps.md rather than
  // asserted away.
  let rises = 0;
  for (let d = 1; d <= GROUND_DEPTH; d++) if (relief[d] > relief[d - 1] * 1.02) rises++;
  measure('layers where relief rises, down to the plot', rises);
  check('relief never rises down to the plot layer', rises, 0, 0);

  measure('relief ratio, layer 1 to the plot layer', relief[0] / Math.max(relief[4], 1e-9));
  assert('the plot layer is not carrying the region\u2019s relief',
    relief[4] < relief[0] / 20);

  // Nothing should approach vertical at any scale a landscape is read at. The
  // staircase produced 90 degrees at four layers running.
  //
  // Asked down to the plot layer and measured below it. Terrain is self-affine,
  // so gradient RISES as the scale shrinks -- that is what a Hurst exponent
  // under one means -- and by the finest layer a cell is 22 cm across, where a
  // near-vertical step is a stream bank or a rock and not a cliff at all. The
  // claim is about landscapes, so it is asserted at landscape scales.
  const steepest = Math.max(...maxSlopeDeg.slice(0, 5));
  measure('steepest slope down to the plot layer, degrees', steepest);
  measure('steepest slope at the finest layer, degrees', maxSlopeDeg[6]);
  assert('no cliff is near vertical at any landscape scale', steepest < 70);
});

suite('relief matches real landscapes', () => {
  // Local relief over a ten-kilometre baseline is the published way of saying
  // how rough a landscape is. The generator is anchored to it at both ends, so
  // what comes out at every OTHER scale is a prediction and can be checked.
  const w = new World({ seed: SEED });
  let region = -1;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (w.planet.elevationM[c] > 500) { region = c; break; }
  }

  let a = [region];
  const spans: { spacing: number; relief: number }[] = [];
  for (let d = 1; d <= 7; d++) {
    const map = w.subMap(a);
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      lo = Math.min(lo, map.elevationM[c]);
      hi = Math.max(hi, map.elevationM[c]);
    }
    spans.push({ spacing: map.spacingM, relief: hi - lo });
    let pick = 0;
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      if (map.slope[c] > map.slope[pick] && map.elevationM[c] > 0) pick = c;
    }
    a = [...a, pick];
  }

  // A mountain descent, so the answers should sit at the mountainous end. The
  // bounds are an order of magnitude wide on purpose: this is asserting that
  // the world is in the right universe, not fitting it.
  const plot = spans[4];
  measure('relief across a plot map of mountainside, m', plot.relief);
  assert('a mountainside has real relief across a plot map',
    plot.relief > 3 && plot.relief < 300);

  const finest = spans[6]; // ~41 cm cells, a map about 4.5 m across
  measure('relief across 4.5 m of ground, m', finest.relief);
  assert('the ground a person stands on has centimetres to metres of texture',
    finest.relief > 0.1 && finest.relief < 6);

  // And the exponent itself: relief over cell size, across four decades.
  // Measured between the region and the plot -- the span the game is played
  // across -- rather than down to the finest layer, where the rim artefact
  // noted above flattens the curve and would make the exponent look smaller
  // than the terrain's.
  const coarse = spans[1];
  const ratioRelief = coarse.relief / Math.max(plot.relief, 1e-9);
  const ratioScale = coarse.spacing / plot.spacing;
  const impliedHurst = Math.log(ratioRelief) / Math.log(ratioScale);
  measure('Hurst exponent implied by the generated world', impliedHurst);
  assert('the generated world is self-affine within the measured band',
    impliedHurst > 0.35 && impliedHurst < 1.05);
});

suite('rock', () => {
  const w = new World({ seed: SEED });
  const maps = plotMaps(w);
  assert('sampled some plot maps', maps.length > 8);

  const count = new Array(6).fill(0);
  let cells = 0;
  for (const map of maps) {
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      if (map.elevationM[c] < 0) continue;
      count[map.rock[c]]++;
      cells++;
    }
  }
  measure('land cells sampled for rock', cells);
  for (let r = 0; r < 6; r++) measure(`${ROCK_NAMES[r]} share`, count[r] / cells);

  assert('more than one rock type exists', count.filter((n) => n > 0).length >= 3);
  // Ocean floor is basalt and there is a great deal of ocean, so the ceiling
  // is set above the ocean's share rather than below it. What this is guarding
  // against is a world made of ONE rock, which is what a broken uplift field
  // produces.
  assert('no single rock is the whole world',
    Math.max(...count) < cells * 0.9);

  // Ordering, which is the part that is measured rather than generated.
  assert('shale erodes faster than granite',
    ROCK_ERODIBILITY[Rock.Shale] > ROCK_ERODIBILITY[Rock.Granite] * 10);
  assert('granite holds a steeper slope than shale',
    ROCK_FRICTION_DEG[Rock.Granite] > ROCK_FRICTION_DEG[Rock.Shale]);

  // The sea floor is basalt and nothing else, which is not a rule with
  // exceptions -- it is what the crust is.
  const sea = rockAt({
    x: 1, y: 0, z: 0, upliftM: 0, elevationM: -3000,
    oceanic: true, sinLat: 0, seed: SEED,
  });
  check('ocean floor is basalt', sea, Rock.Basalt, 0);
});

suite('erosion and soil depth', () => {
  // The calibration point, restated as a test: the reference geometry on
  // ordinary sedimentary rock must come back at the measured denudation rate.
  const ref = erosionRateM(
    Rock.Sandstone,
    A.DENUDATION_REFERENCE_CATCHMENT_M2,
    A.DENUDATION_REFERENCE_SLOPE,
  );
  measure('reference denudation mm per year', ref * 1000);
  check('the calibration point reproduces itself',
    ref, A.DENUDATION_TEMPERATE_M_PER_YR, A.DENUDATION_TEMPERATE_M_PER_YR * 1e-6);

  // And the settings it predicts rather than fits.
  //
  // The rock is half the answer and it is easy to forget which half. A first
  // version of this test called granite at a square kilometre and 50% an
  // "active mountain front" and expected 0.1 to 5 mm a year; it returned 0.08
  // and the test was the thing that was wrong. Granite is the most resistant
  // rock there is, and a granite massif at 0.08 mm/yr is the Sierra Nevada,
  // measured. An active front means weaker rock and a bigger catchment.
  const massif = erosionRateM(Rock.Granite, 1e6, 0.5) * 1000;
  const front = erosionRateM(Rock.Gneiss, 1e7, 0.4) * 1000;
  const lowland = erosionRateM(Rock.Sandstone, 1e7, 0.002) * 1000;
  measure('resistant granite massif mm per year', massif);
  measure('active mountain front mm per year', front);
  measure('lowland basin mm per year', lowland);
  assert('a granite massif is inside the measured 0.02 to 0.2 mm a year',
    massif > 0.02 && massif < 0.2);
  assert('an active front is inside the measured 0.1 to 5 mm a year',
    front > 0.1 && front < 5);
  assert('a lowland basin is inside the measured 0.001 to 0.05',
    lowland > 0.001 && lowland < 0.05);

  // Soil depth is self-limiting, and where erosion beats production it is zero.
  const gentle = soilDepthM(Rock.Sandstone, 1e-6);
  const hard = soilDepthM(Rock.Sandstone, 1e-3);
  measure('soil on slowly eroding ground m', gentle);
  measure('soil where erosion outruns production m', hard);
  assert('slow erosion leaves deep soil', gentle > 1);
  check('fast erosion leaves bare rock', hard, 0, 0);
  assert('deeper soil forms more slowly',
    soilDepthM(Rock.Sandstone, 2e-5) > soilDepthM(Rock.Sandstone, 4e-5));

  // Limestone dissolves rather than crumbling, so karst is thin however wet.
  assert('limestone makes less soil than sandstone at the same erosion rate',
    soilDepthM(Rock.Limestone, 1e-5) < soilDepthM(Rock.Sandstone, 1e-5));

  // Across the world: bare rock has to exist and soil has to be bounded.
  const w = new World({ seed: SEED });
  const maps = plotMaps(w);
  let cells = 0, bare = 0, deep = 0;
  const depths: number[] = [];
  for (const map of maps) {
    if (!map.hillslopesResolved) continue;
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      if (map.elevationM[c] < 0) continue;
      cells++;
      depths.push(map.regolithM[c]);
      if (map.regolithM[c] <= 0) bare++;
      if (map.regolithM[c] > 6) deep++;
    }
  }
  depths.sort((x, y) => x - y);
  measure('median soil depth m', depths[Math.floor(depths.length / 2)]);
  measure('bare rock share of land', bare / cells);
  assert('bare rock exists somewhere', bare > 0);
  assert('bare rock is not most of the world', bare < cells * 0.4);
  check('no cell has absurdly deep soil', deep, 0, 0);
});

suite('what holds a hillside up', () => {
  // The free check: on cohesionless soil the factor of safety is tan(phi) over
  // tan(theta) whatever the depth, so at the friction angle it is exactly one.
  // Granite's residual sand is nearly cohesionless, and a deep column makes
  // what cohesion there is negligible, so this converges on the identity.
  const atAngle = factorOfSafety({
    slope: tan(ROCK_FRICTION_DEG[Rock.Granite]),
    soilDepthM: 40,
    rock: Rock.Granite,
    rootCohesionKPa: 0,
    saturation: 0,
  });
  measure('factor of safety at the friction angle', atAngle);
  check('a bare slope at its friction angle sits at one', atAngle, 1, 0.02);

  assert('steeper is worse', factorOfSafety({
    slope: tan(45), soilDepthM: 40, rock: Rock.Granite, rootCohesionKPa: 0, saturation: 0,
  }) < atAngle);

  // Flat ground and bare rock cannot slide, and must not divide by zero.
  assert('flat ground never slides', factorOfSafety({
    slope: 0, soilDepthM: 2, rock: Rock.Shale, rootCohesionKPa: 0, saturation: 1,
  }) > 10);
  assert('bare rock is not a soil slide', factorOfSafety({
    slope: tan(60), soilDepthM: 0, rock: Rock.Shale, rootCohesionKPa: 0, saturation: 1,
  }) > 10);

  // THE MECHANIC. A thirty-degree shale hillside under old forest holds. The
  // same hillside fifteen years after it was felled comes down in a wet
  // season, because root strength decays with a measured half-life and the
  // pore pressure subtracts from the friction term. Nobody scripted a
  // landslide; the factor of safety crossed one.
  // Twenty-five degrees, not thirty. At thirty a residual clay whose friction
  // angle is twenty-four cannot stand up at all without something holding it:
  // tan(24)/tan(30) is 0.77 before any water is involved, so the slope fails
  // dry as well as wet and there is no trigger to demonstrate. That is the
  // model being right, and the first version of this test was asking it to be
  // wrong. At twenty-five the cover and the water are what decide.
  const slope = tan(25);
  const shale = (roots: number, sat: number): number => factorOfSafety({
    slope, soilDepthM: 1.2, rock: Rock.Shale, rootCohesionKPa: roots, saturation: sat,
  });

  const forest = shale(rootCohesionKPa(1, 0), 1);
  const felled3 = shale(rootCohesionKPa(1, 3), 1);
  const felled15 = shale(rootCohesionKPa(1, 15), 1);
  const bare = shale(0, 1);
  measure('wet FS under old forest', forest);
  measure('wet FS three years after felling', felled3);
  measure('wet FS fifteen years after felling', felled15);
  measure('wet FS bare', bare);

  assert('forest holds a slope that bare ground does not', forest > 1 && bare < 1);
  assert('it does not fail the year it is cleared', felled3 > 1);
  assert('it fails years later, which is when it really does', felled15 < 1);

  // Dry, the same cleared slope stands. Water is the trigger, and that is the
  // pore-pressure term doing it rather than a rule about rain.
  const dry15 = shale(rootCohesionKPa(1, 15), 0);
  measure('dry FS fifteen years after felling', dry15);
  assert('the slope that fails wet stands dry', dry15 > 1);

  // Rock matters as much as cover. Shale is the classic landslide lithology
  // and has to come out as one: least friction, and residual clay cohesion
  // near zero. When it was given peak cohesion instead it measured MORE stable
  // than granite, which is backwards and is in fix-attempts.md.
  const graniteBare = factorOfSafety({
    slope, soilDepthM: 1.2, rock: Rock.Granite, rootCohesionKPa: 0, saturation: 1,
  });
  measure('wet FS bare, on granite', graniteBare);
  assert('granite holds better than shale on the same hillside', graniteBare > bare);

  // Root decay is exponential at the measured half-life.
  const full = rootCohesionKPa(1, 0);
  const oneHalf = rootCohesionKPa(1, A.ROOT_DECAY_HALFLIFE_YR);
  measure('root cohesion kPa under closed forest', full);
  check('root strength halves at the measured half-life', oneHalf, full / 2, full * 0.01);
});

suite('a slope holds only so much soil', () => {
  // Below the friction angle there is no limit: friction scales with weight
  // exactly as the driving stress does, so the slope does not care how much is
  // on it. Above it, only cohesion holds the soil on and cohesion does not
  // scale with depth, so there is a ceiling and it falls away fast.
  //
  // Without this the production-against-erosion balance put 0.73 m of soil on
  // a 74-degree granite face, because stream power with a ridge-top catchment
  // says erosion there is slow -- which is true and beside the point. A
  // 74-degree slope does not wear away, it lets go.
  const tanPhi = tan(ROCK_FRICTION_DEG[Rock.Granite]);
  assert('below the friction angle there is no limit',
    maxStableSoilM(Rock.Granite, tanPhi * 0.7) === Infinity);
  assert('flat ground has no limit',
    maxStableSoilM(Rock.Granite, 0) === Infinity);

  const at45 = maxStableSoilM(Rock.Granite, tan(45));
  const at60 = maxStableSoilM(Rock.Granite, tan(60));
  measure('soil a 45 degree granite slope holds, m', at45);
  measure('soil a 60 degree granite slope holds, m', at60);
  assert('a steep slope holds only centimetres', at45 < 1 && at45 > 0);
  assert('steeper holds less', at60 < at45);

  // Shale starts losing its soil at a much gentler angle, because its friction
  // angle is the lowest of any of them. That is the same property that makes
  // it the landslide lithology, showing up as thin soil.
  assert('shale sheds soil on gentler ground than granite',
    maxStableSoilM(Rock.Shale, tan(30)) < maxStableSoilM(Rock.Granite, tan(30)));

  // And it feeds through: the same erosion rate leaves less soil on a steep
  // slope than a flat one, whatever stream power says about the wearing.
  const flat = soilDepthM(Rock.Granite, 1e-6, 0);
  const steep = soilDepthM(Rock.Granite, 1e-6, tan(55));
  measure('soil at a given erosion rate, flat', flat);
  measure('soil at the same rate, 55 degrees', steep);
  assert('a steep slope keeps less of it', steep < flat / 3);
});

suite('clearing a hillside is a decision with a delay', () => {
  // The loop closed: a tile knows what has been cut off it and when, so its
  // factor of safety is what the ground is doing today rather than what the
  // biome would imply. Two populations of root, kept apart -- what still grows
  // holds at full strength, what was cut is dead and rotting at the measured
  // half-life.
  const full = rootCohesionAfterClearing(1, 0, 0);
  const justCut = rootCohesionAfterClearing(1, 1, 0);
  const later = rootCohesionAfterClearing(1, 1, 12);
  const partial = rootCohesionAfterClearing(1, 0.5, 12);
  measure('root cohesion under standing forest kPa', full);
  measure('root cohesion the day it is felled kPa', justCut);
  measure('root cohesion twelve years later kPa', later);
  measure('root cohesion twelve years after half of it kPa', partial);

  check('felling costs nothing the day it happens', justCut, full, full * 1e-9);
  assert('and most of it a decade later', later < full * 0.15);
  assert('half-clearing keeps half of it', partial > full * 0.4 && partial < full * 0.6);

  // On a real tile in the generated world.
  // THE STEEPEST hillside with soil on it, not the first one over a threshold.
  //
  // This used to take the first cell steeper than 0.2 and stop, which meant the
  // test ran on whatever gentle slope the scan happened to reach first. Root
  // cohesion is a fixed number of kilopascals, so what fraction of stability it
  // represents depends entirely on how steep the ground is: on a shallow slope
  // friction dominates and losing the roots barely registers. The first cell
  // found came out at a 16% loss, and the assertion below wants 20%.
  //
  // That is not a reason to relax the assertion. Felling trees is a landslide
  // question, so it should be asked of ground where landslides happen, and
  // searching for the steepest soil-covered hillside finds 29.5 degrees -- a
  // real mountainside. There the factor of safety falls from 4.48 to 1.82,
  // which is both a 60% loss and a slope that has come within sight of failing.
  // The `outer:` label went with the early break.
  const w = new World({ seed: SEED });
  let found: number[] | null = null;
  let steepest = 0.2;
  for (let region = 0; region < CELL_COUNT; region++) {
    if (w.planet.elevationM[region] <= 200) continue;
    let a = [region];
    while (a.length < 5) {
      const map = w.subMap(a);
      let pick = 0;
      for (let c = 0; c < SUBCELL_COUNT; c++) {
        if (map.slope[c] > map.slope[pick] && map.elevationM[c] > 0) pick = c;
      }
      a = [...a, pick];
    }
    const map = w.subMap(a);
    for (let c = 0; c < SUBCELL_COUNT; c++) {
      if (map.elevationM[c] > 0 && map.regolithM[c] > 0.2 && map.slope[c] > steepest) {
        steepest = map.slope[c];
        found = [...a, c];
      }
    }
  }
  measure('felled hillside, degrees', (Math.atan(steepest) * 180) / Math.PI);
  assert('found a hillside with soil on it', found !== null);
  if (found === null) return;

  const before = w.tile(found).stability;
  w.setDelta(found, { cleared: 1 });
  w.turn = 0;
  const sameYear = w.tile(found).stability;
  w.turn = Math.round(12 * A.TURNS_PER_YEAR);
  const twelveYears = w.tile(found).stability;

  measure('hillside FS with its trees', before);
  measure('hillside FS the year it is felled', sameYear);
  measure('hillside FS twelve years later', twelveYears);
  check('felling does not change it that year', sameYear, before, before * 1e-6);
  assert('it is weaker a decade later', twelveYears < before * 0.8);
});

suite('a map edge is no different from its middle', () => {
  // A map's rim cells are missing two or three neighbours, because those live
  // in a sibling map under a different grandparent. For most of this project's
  // life the sampler gave up on them and used the containing cell's own value,
  // which is nearest-neighbour -- so the staircase this codebase has now
  // fought three times survived on EVERY MAP EDGE at every layer, and a rim is
  // 30 cells of 91.
  //
  // It showed as a 987 m step across one 306 m cell, inherited rather than
  // added by noise, and as relief that would not fall from one layer to the
  // next. The fix is the same one cellsWithin uses: the World descends from
  // the globe to find the sibling that holds the missing neighbour, because a
  // map cannot reach sideways and the world can.
  //
  // If it ever regresses, the rim gets steeper than the middle. That is the
  // whole test.
  const w = new World({ seed: SEED });
  let rimSum = 0, rimN = 0, midSum = 0, midN = 0, worstRim = 0, worstMid = 0;

  for (let region = 0; region < CELL_COUNT; region += 2) {
    if (w.planet.elevationM[region] <= 0) continue;
    for (let k = 0; k < SUBCELL_COUNT; k += 17) {
      const map = w.subMap([region, k]);
      for (let c = 0; c < SUBCELL_COUNT; c++) {
        if (ringOf(c) === RADIUS) {
          rimSum += map.slope[c]; rimN++;
          worstRim = Math.max(worstRim, map.slope[c]);
        } else {
          midSum += map.slope[c]; midN++;
          worstMid = Math.max(worstMid, map.slope[c]);
        }
      }
    }
  }

  assert('sampled enough cells to mean anything', rimN > 500 && midN > 500);
  const rim = rimSum / rimN;
  const mid = midSum / midN;
  measure('mean slope on rim cells', rim);
  measure('mean slope on interior cells', mid);
  measure('rim to interior slope ratio', rim / mid);
  measure('steepest rim cell', worstRim);
  measure('steepest interior cell', worstMid);

  // Generous, because the two are not identical for an honest reason: a rim
  // cell has fewer neighbours to take a maximum over, so it reads slightly
  // GENTLER. What is being caught is the other direction, and it was large.
  assert('the rim is not systematically steeper than the middle',
    rim < mid * 2);
  assert('and the worst cliff is not on an edge',
    worstRim < worstMid * 3);
});

suite('a coastline survives the descent', () => {
  // Sea level is solved once, at the planet, so that the land fraction matches
  // Earth's. Every layer below inherits that coastline and adds detail to it,
  // and the AREA it encloses must not drift -- coastlines are fractal in
  // length, not in area.
  //
  // It drifted badly. Land could drown freely while sea could not rise,
  // because the rule that guarded the coastline ran one way only -- its own
  // comment said "or the reverse" and the code did not -- and because the
  // guard read metres, which are not symmetric about a coast: land stands
  // 840 m up on average and the sea floor lies 3,688 m down, so a threshold in
  // metres protects the ocean far more strictly than the land. A planet solved
  // for 29.2% came out at 12.1% one layer down and 8.8% the next.
  const w = new World({ seed: SEED });

  let land0 = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (w.planet.elevationM[c] >= 0) land0++;
  const f0 = land0 / CELL_COUNT;

  let land1 = 0, all1 = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const map = w.subMap([c]);
    for (let k = 0; k < SUBCELL_COUNT; k++) { all1++; if (map.elevationM[k] >= 0) land1++; }
  }
  const f1 = land1 / all1;

  let land2 = 0, all2 = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    for (let k = 0; k < SUBCELL_COUNT; k += 13) {
      const map = w.subMap([c, k]);
      for (let j = 0; j < SUBCELL_COUNT; j++) { all2++; if (map.elevationM[j] >= 0) land2++; }
    }
  }
  const f2 = land2 / all2;

  measure('land fraction, planet', f0);
  measure('land fraction, march layer', f1);
  measure('land fraction, shire layer', f2);

  check('the planet is solved to Earth land fraction', f0, A.LAND_FRACTION, 0.05);
  assert('the march layer keeps most of it', f1 > f0 * 0.65);
  assert('the shire layer keeps most of that', f2 > f1 * 0.8);
  assert('and no layer invents land', f1 < f0 * 1.35 && f2 < f1 * 1.35);
});
