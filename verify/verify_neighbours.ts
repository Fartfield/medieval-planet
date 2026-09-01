// Several maps in one picture, and whether they land where they should.
//
// The map view used to draw exactly one map, centred, so a cell's position was
// its own layout and nothing else. It now draws the tile you are looking at
// AND its neighbours, and neighbouring maps do not share a layout: each one's
// basis faces its own first neighbour, so its lattice is turned; a pentagon's
// cells are 0.824 of the mean radius and its children divide by sqrt(76); and
// over the ground a region map covers the projection is not affine.
//
// A rotation-and-shift per map was tried first because it is cheap. Measured
// against exact placement it was worst by 11.0 pixels at the region layer with
// a 60-pixel cell -- a fifth of a cell, plainly visible -- and it did not
// improve with depth, sitting at a 2.04-pixel floor that is the cell-size
// difference rather than the curvature. So every cell is placed by its own
// direction through the frame's inverse projection, and this suite is what
// says so: it measures the error rather than the comment asserting it.

import { World } from '../sim/world.ts';
import { CELL_COUNT, neighbours as globeNeighbours } from '../sim/geo/sphere.ts';
import { RADIUS } from '../sim/geo/hexgrid.ts';
import { toDirection, toLocal } from '../sim/gen/submap.ts';
import { equals } from '../sim/geo/address.ts';
import { placeCells, pickAmong } from '../client/src/render.ts';
import { check, measure, assert, suite } from './harness.ts';

const SEED = 20260826;
/** About what flatView gives a radius-5 map in a normal window. */
const SIZE = 60;

suite('a tile is drawn with its neighbours round it', () => {
  const w = new World({ seed: SEED });

  let region = -1;
  for (let c = 0; c < CELL_COUNT && region < 0; c++) {
    if (w.planet.elevationM[c] > 0) region = c;
  }
  assert('found a land region to open', region >= 0);
  if (region < 0) return;

  // A LONE MAP IS DRAWN EXACTLY AS IT WAS, which is the regression this
  // refactor could most easily have caused. With the frame set to the map
  // itself, placing a cell by projection has to reproduce its own flat layout
  // to the last pixel, and its on-screen radius has to be the size asked for.
  const solo = w.subMap([region]);
  const selfPlaced = placeCells(solo, solo, SIZE);
  let worstSelf = 0;
  let worstRadius = 0;
  for (let c = 0; c < solo.patch.count; c++) {
    const p = solo.patch.centre(c, SIZE);
    worstSelf = Math.max(worstSelf, Math.hypot(selfPlaced[c].x - p.x, selfPlaced[c].y - p.y));
    worstRadius = Math.max(worstRadius, Math.abs(selfPlaced[c].r - SIZE));
  }
  measure('a lone map moves, px', worstSelf);
  measure('a lone cell changes radius by, px', worstRadius);
  check('a map drawn alone is where it always was', worstSelf, 0, 0.01);
  check('and drawn at the size it was asked for', worstRadius, 0, 0.01);

  // THE ROUND TRIP, which is what picking rides on. A pixel in the picture is
  // turned back into a direction on the sphere to ask the world what was
  // clicked, so screen -> sphere -> screen has to close. If it does not, a
  // click lands on a different tile from the one under the cursor, and at the
  // rim of a neighbour map that is a different MAP.
  const frames: { label: string; addr: number[]; nbs: number[][] }[] = [];
  const regionNbs: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const nb = globeNeighbours[region * 6 + i];
    if (nb >= 0) regionNbs.push([nb]);
  }
  frames.push({ label: 'region', addr: [region], nbs: regionNbs });

  let a = [region];
  for (let d = 1; d <= 3; d++) {
    a = [...a, 40];
    frames.push({ label: `depth ${a.length}`, addr: [...a], nbs: w.neighboursOf(a) as number[][] });
  }

  let worstTrip = 0;
  let worstOwn = 0;
  let placedCells = 0;
  for (const fr of frames) {
    const frame = w.subMap(fr.addr);
    const perUnit = SIZE / frame.cellRadiusRad;
    assert(`${fr.label} has neighbours to draw`, fr.nbs.length > 0);

    for (const nbAddr of fr.nbs) {
      const other = w.subMap(nbAddr);
      const placed = placeCells(other, frame, SIZE);
      const dir = new Float64Array(3);
      for (let c = 0; c < other.patch.count; c++) {
        // Pixel back to a direction, the way a click is resolved.
        toDirection(frame.basis, placed[c].x / perUnit, placed[c].y / perUnit, dir, 0);
        const dot = dir[0] * other.dirs[c * 3]
          + dir[1] * other.dirs[c * 3 + 1]
          + dir[2] * other.dirs[c * 3 + 2];
        // Angle between where the pixel says the cell is and where it is,
        // expressed as a fraction of one cell so it means something.
        const off = Math.acos(Math.min(1, dot)) / other.cellRadiusRad;
        worstTrip = Math.max(worstTrip, off);

        // And the placement is not merely self-consistent: it agrees with the
        // frame's own inverse projection of the cell's direction.
        const e = toLocal(frame.basis, other.dirs[c * 3], other.dirs[c * 3 + 1], other.dirs[c * 3 + 2]);
        worstOwn = Math.max(worstOwn,
          Math.hypot(placed[c].x - e.x * perUnit, placed[c].y - e.y * perUnit));
        placedCells++;
      }
    }
  }

  measure('neighbour cells placed', placedCells);
  measure('worst screen-sphere round trip, cell widths', worstTrip);
  measure('worst placement against the frame projection, px', worstOwn);
  check('a pixel resolves to the cell that was drawn there', worstTrip, 0, 0.01);
  check('neighbours are placed by the projection, not near it', worstOwn, 0, 0.01);

  // PICKING, END TO END AND AT EVERY ZOOM.
  //
  // This check used to live in verify_render and invert one map's flat hex
  // lattice, which is exactly what the view can no longer do: with neighbours
  // on screen, a lattice inverse can only ever name a cell of the middle map.
  //
  // It is checked against `pickAmong`, the rule the app uses, and NOT against
  // World.addressAt -- which was tried and is the interesting part. addressAt
  // names the tile whose territory holds a point, descending from the globe;
  // the view builds addresses by walking down from the map the player opened.
  // The two disagree, because a hexagon of 91 hexagons covers about 91% of the
  // hexagon holding it, so a map's outer rings lie outside their own parent.
  // Measured: 67 of 104 sampled cells resolved to a DIFFERENT map, at every
  // ring including the middle one -- the centre cell of the map at [6,40] sits
  // in region 11. Both answers are true; they answer different questions, and
  // the one the picture is drawn from is the one a click must agree with.
  for (const zoom of [0.5, 1, 4, 12]) {
    const size = SIZE * zoom;
    let wrongMap = 0;
    let wrongCell = 0;
    let tried = 0;
    for (const fr of frames) {
      const frame = w.subMap(fr.addr);
      const perUnit = size / frame.cellRadiusRad;
      const dir = new Float64Array(3);
      const maps = [frame, ...fr.nbs.map((a) => w.subMap(a))];
      // Every cell of the map in the middle: clicking one of these has to name
      // that cell, in that map, always. It is the tile drawn on top.
      const placed = placeCells(frame, frame, size);
      for (let c = 0; c < frame.patch.count; c++) {
        toDirection(frame.basis, placed[c].x / perUnit, placed[c].y / perUnit, dir, 0);
        const hit = pickAmong(maps, dir[0], dir[1], dir[2]);
        tried++;
        if (hit === null || hit.map !== 0) wrongMap++;
        else if (hit.cell !== c) wrongCell++;
      }
    }
    measure(`cells picked at zoom ${zoom}`, tried);
    check(`the middle map keeps its own cells at zoom ${zoom}`, wrongMap, 0, 0);
    check(`and names the one that was clicked at zoom ${zoom}`, wrongCell, 0, 0);
  }

  // A NEIGHBOUR'S OWN GROUND IS REACHABLE, which is the other half: if the
  // middle map claimed everything, drawing neighbours would be decoration and
  // scrolling onto one would never hand it the middle.
  {
    const frame = w.subMap([region]);
    const nbAddrs = regionNbs;
    const maps = [frame, ...nbAddrs.map((a) => w.subMap(a))];
    const perUnit = SIZE / frame.cellRadiusRad;
    const dir = new Float64Array(3);
    let reached = 0;
    let far = 0;
    for (let m = 1; m < maps.length; m++) {
      const placed = placeCells(maps[m], frame, SIZE);
      for (let c = 0; c < maps[m].patch.count; c++) {
        toDirection(frame.basis, placed[c].x / perUnit, placed[c].y / perUnit, dir, 0);
        const hit = pickAmong(maps, dir[0], dir[1], dir[2]);
        if (hit === null) { far++; continue; }
        if (hit.map === m && hit.cell === c) reached++;
        // Whatever it named, it must be somewhere near what was clicked.
        const got = maps[hit.map];
        const dot = dir[0] * got.dirs[hit.cell * 3]
          + dir[1] * got.dirs[hit.cell * 3 + 1]
          + dir[2] * got.dirs[hit.cell * 3 + 2];
        if (Math.acos(Math.min(1, dot)) > got.cellRadiusRad * 1.5) far++;
      }
    }
    measure('neighbour cells that pick as themselves', reached);
    measure('picks landing more than a cell away', far);
    assert('a neighbour map owns ground of its own', reached > 100);
    check('and no pick lands far from where it was made', far, 0, 0);
  }

  // THE MOSAIC SHOWS THE GROUND WHERE THE GROUND IS.
  //
  // A cell is drawn out of its own children, and those children used to be laid
  // out as a flat hex grid stamped inside the parent's hexagon and turned
  // thirty degrees. The thirty was reasoned from the shape -- ninety-one
  // pointy-top hexes arrange flat-top, so a turn puts the grain in register --
  // and it is right for a hexagon of hexagons drawn on a page. It is not right
  // here: a child map's basis faces its OWN first neighbour, which is thirty
  // degrees from its parent's only by accident, and the ground is a sphere.
  //
  // So the layer above drew a tile in one place and opening it put the tile
  // somewhere else. This measures both: what the old layout was out by, and
  // that the new one is not out at all.
  {
    const CHILD_SCALE = 1 / (Math.sqrt(3) * RADIUS);
    const frame = w.subMap([region]);
    const perUnit = SIZE / frame.cellRadiusRad;
    const parent = placeCells(frame, frame, SIZE);
    const dir = new Float64Array(3);
    let worstNow = 0;
    let worstBefore = 0;
    let checked = 0;

    // A handful of parent cells spread across the map rather than all 91: the
    // question is whether the layout is right, not whether it is right 8,281
    // times.
    for (const c of [45, 0, 17, 60, 88]) {
      const kids = w.subMap([region, c]);
      const kplace = placeCells(kids, frame, SIZE);
      const g = parent[c];

      // The turn the old code guessed at, rebuilt here so the number it was
      // wrong by is on the record rather than in a commit message.
      const cos30 = Math.cos(Math.PI / 6);
      const sin30 = 0.5;
      const kidCos = g.cos * cos30 - g.sin * sin30;
      const kidSin = g.sin * cos30 + g.cos * sin30;
      const kidR = g.r * CHILD_SCALE;

      for (let k = 0; k < kids.patch.count; k++) {
        // Where the child truly is, as a pixel, then back to a direction.
        toDirection(frame.basis, kplace[k].x / perUnit, kplace[k].y / perUnit, dir, 0);
        const dot = dir[0] * kids.dirs[k * 3]
          + dir[1] * kids.dirs[k * 3 + 1]
          + dir[2] * kids.dirs[k * 3 + 2];
        worstNow = Math.max(worstNow, Math.acos(Math.min(1, dot)) / kids.cellRadiusRad);

        // And where the flat layout would have put it, in child widths.
        const q = kids.patch.centre(k, kidR);
        const ox = g.x + q.x * kidCos - q.y * kidSin;
        const oy = g.y + q.x * kidSin + q.y * kidCos;
        worstBefore = Math.max(worstBefore,
          Math.hypot(ox - kplace[k].x, oy - kplace[k].y) / (kidR || 1));
        checked++;
      }
    }

    measure('mosaic children checked', checked);
    measure('the flat layout was out by, child widths', worstBefore);
    measure('the projected layout is out by, child widths', worstNow);
    check('a tile in the mosaic is drawn where the sphere puts it',
      worstNow, 0, 0.02);
    assert('and the layout it replaced was not',
      worstBefore > 0.5);
  }

  // The neighbours actually surround the middle rather than piling on it,
  // which is what a missed rotation or a wrong scale would look like.
  //
  // How far out, derived. Adjacent parents are one parent-spacing apart, and a
  // parent holds `count` children, so that spacing is sqrt(count) CHILD
  // SPACINGS -- and a spacing is sqrt(3) circumradii, which is the step this
  // check first got wrong. It asked for under 16 and measured 15.5 to 17.7,
  // because sqrt(91) is 9.54 and 9.54 x sqrt(3) is 16.5. The measurement was
  // right and the bound was arithmetic done in the wrong unit.
  //
  // The tolerance is wide because the ends are real: cells are not all the
  // same size, and the projection stretches slightly across ten degrees.
  const frame = w.subMap([region]);
  let nearest = Infinity;
  let furthest = 0;
  for (const nbAddr of regionNbs) {
    const other = w.subMap(nbAddr);
    const o = toLocal(frame.basis, other.basis.ox, other.basis.oy, other.basis.oz);
    const d = Math.hypot(o.x, o.y) * (SIZE / frame.cellRadiusRad) / SIZE;
    nearest = Math.min(nearest, d);
    furthest = Math.max(furthest, d);
  }
  const expected = Math.sqrt(3 * frame.patch.count);
  measure('neighbour map centres expected at, cell radii', expected);
  measure('nearest neighbour map centre, cell radii', nearest);
  measure('furthest neighbour map centre, cell radii', furthest);
  assert('neighbour maps sit beside the middle one, not on it',
    nearest > expected * 0.8 && furthest < expected * 1.25);
});
