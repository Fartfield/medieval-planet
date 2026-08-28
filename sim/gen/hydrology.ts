// Where the water goes, and why it no longer stops at the edge of a map.
//
// THE BUG THIS EXISTS TO FIX
//
// Drainage used to be computed inside one sub-map with every cell starting at
// one unit of flow. That is a self-contained answer to a question that is not
// self-contained: the water crossing a map arrived from somewhere uphill, and
// most of the uphill is in a different map. So a river ran to the edge of a
// sub-map and stopped, the map next door started its own rivers from nothing,
// and the two did not meet. Worse, each map normalised against its own biggest
// channel, so a brook in a flat map painted as boldly as a trunk river in a
// mountainous one.
//
// THE FIX: CASCADE, DO NOT CONSULT
//
// A map cannot ask its neighbours what they are sending it -- they would have
// to ask theirs, and the regress crosses the planet. It can ask its *parent*,
// which already routed water at its own resolution and is generated on the way
// down anyway. The parent knows which of its neighbours drain into this cell
// and how much each brings, and that is the whole boundary condition.
//
// Water then enters at THE LOWEST CELL OF THE EDGE IT CROSSES. Nothing tells
// the two maps to agree on that point; they agree because elevation is a
// continuous function of position on the sphere and both are sampling the same
// function along the same line. A river leaves one map through its valley and
// enters the next through the same valley, one cell away at worst.
//
// ABSOLUTE, NOT NORMALISED
//
// Catchment is carried in square metres and discharge in cubic metres a
// second, all the way down. A river is then the same river at every layer, and
// the total leaving a map equals what entered it plus what fell on it -- which
// is a conservation law, so it can be tested rather than eyeballed.
//
// WHAT THIS DOES NOT CLAIM
//
// Flow accumulation on a 2,922 km cell is not a river. It is a *divide*: it
// says which way a continent tilts, which is true at that scale and is the
// only thing needed as a boundary condition. Channels become real once cells
// are narrower than a valley. The catchment number is right at every layer;
// the channel's position is only meaningful in the lower ones.

import * as A from '../anchors.ts';
import { NAVIGABLE_M3_PER_S, STREAM_M3_PER_S } from '../derive.ts';
import { dlog, dpow, clamp } from './mathx.ts';

/** Water across one map, in units that mean the same thing on every map. */
export interface Flow {
  /** Upstream area draining through each cell, in square metres, its own included. */
  catchmentM2: Float64Array;
  /** Mean discharge, cubic metres a second. Runoff accumulated along the same paths. */
  dischargeM3S: Float64Array;
  /** Standing water where a hollow filled, metres. Zero on draining ground. */
  lakeDepthM: Float32Array;
  /** The surface water runs across: elevation with its pits filled. */
  filledM: Float32Array;
  /** Cell each cell drains into. -1 leaves the map or has reached the sea. */
  downstream: Int32Array;
  /** The inflows, with the cell each was resolved to. Passed on downward. */
  injected: readonly Boundary[];
}

/**
 * Water arriving from outside a map.
 *
 * `dir` points from the map's centre toward wherever the water is coming from,
 * in world space, and is kept after the inflow has been resolved to a cell.
 * That is what lets the inheritance continue: when this map's own child covers
 * the rim cell the water entered at, the child needs the same direction again
 * to find its own edge, and reconstructing it from the cell index would put it
 * one layer out of date.
 */
export interface Boundary {
  /** The rim cell it enters at. -1 until the receiving map resolves it. */
  cell: number;
  dir: readonly [number, number, number];
  areaM2: number;
  dischargeM3S: number;
}

export interface RouteRequest {
  count: number;
  /** Neighbours packed count by degree, with -1 where there is none. */
  neighbours: Int32Array;
  degree: number;
  elevationM: Float32Array;
  /** Area of one cell in square metres. Uniform within a map by construction. */
  cellAreaM2: number;
  /** Depth of water leaving each cell in a year, metres. */
  runoffM: Float32Array;
  /** Cells water may leave the map through: the rim, and anything below sea. */
  isOutlet: Uint8Array;
  /** Water arriving from other maps. */
  inflow: readonly Boundary[];
}

/**
 * Runoff depth, by Turc-Pike.
 *
 *     AET = P / sqrt(1 + (P/PET)^2),   runoff = P - AET
 *
 * A measured relation rather than a fraction anyone picked, and it is right at
 * both ends without being told to be. Where rain falls far below demand almost
 * none of it runs off: 200 mm against a PET of 1,500 yields 2 mm. Where it
 * falls far above, evaporation saturates near PET and the remainder leaves:
 * 2,000 mm against a PET of 1,000 evaporates 894 and runs off 1,106.
 *
 * This is what makes a desert river shrink as it goes. Discharge accumulates
 * runoff and not area, so a channel crossing ground that yields nothing gains
 * nothing -- which is the Nile below its last tributary.
 */
export function runoffM(precipMm: number, petMm: number): number {
  if (precipMm <= 0) return 0;
  if (petMm <= 0) return precipMm / 1000;
  const ratio = precipMm / petMm;
  const aet = precipMm / Math.sqrt(1 + ratio * ratio);
  return Math.max(0, precipMm - aet) / 1000;
}

/**
 * Route water across a map and accumulate what flows through every cell.
 *
 * Three passes: fill the depressions, decide where each cell sends its water,
 * then add it up from the ridges down.
 */
export function routeWater(req: RouteRequest): Flow {
  const { count, neighbours, degree, elevationM, isOutlet } = req;

  const filledM = new Float32Array(count);
  const downstream = new Int32Array(count).fill(-1);
  const lakeDepthM = new Float32Array(count);
  const catchmentM2 = new Float64Array(count);
  const dischargeM3S = new Float64Array(count);

  // --- 1. Fill the depressions (priority flood, Barnes 2014) ---------------
  //
  // Water does not stop in a hollow. It fills it and goes on over the lip, and
  // a router that lets flow die in a pit loses the whole river below it.
  // Flooding inward from every outlet, always at the lowest level available,
  // raises each cell to the height of the lowest rim it could escape over --
  // which is the level a lake would actually stand at. So LAKES FALL OUT OF
  // THE FILL rather than being a separate feature anybody placed.
  //
  // The pass also builds a spanning tree back to the outlets, and that tree is
  // what gives the flat surface of a lake a flow direction.
  // A rim cell is where water LEAVES. A rim cell that water arrives at is not
  // -- if it kept its outlet flag the inflow would enter the map and leave it
  // in the same step, and the river the parent handed down would never cross
  // the map at all. It showed as a trunk river losing two thirds of its
  // discharge on every descent while the catchment area stayed exactly right,
  // which is what area conservation alone cannot catch. Below sea level the
  // flag stands: water arriving at the sea really has stopped.
  const outlet = Uint8Array.from(isOutlet);
  for (const b of req.inflow) {
    if (b.cell >= 0 && b.cell < count && elevationM[b.cell] >= 0) outlet[b.cell] = 0;
  }

  const heap = new Heap(count);
  const seen = new Uint8Array(count);
  const floodParent = new Int32Array(count).fill(-1);
  for (let c = 0; c < count; c++) {
    if (outlet[c] === 0) continue;
    seen[c] = 1;
    filledM[c] = elevationM[c];
    heap.push(elevationM[c], c);
  }

  // Pop order is the topological order the accumulation needs, reversed: a
  // cell always leaves the heap after whatever it drains into, so walking the
  // record backwards visits every cell before its downstream neighbour.
  const popped = new Int32Array(count);
  let popCount = 0;

  while (heap.size > 0) {
    const c = heap.pop();
    popped[popCount++] = c;
    for (let d = 0; d < degree; d++) {
      const n = neighbours[c * degree + d];
      if (n < 0 || seen[n] === 1) continue;
      seen[n] = 1;
      // The lip rule: a cell can be no lower than the lowest way out of it.
      filledM[n] = Math.max(elevationM[n], filledM[c]);
      lakeDepthM[n] = filledM[n] - elevationM[n];
      floodParent[n] = c;
      heap.push(filledM[n], n);
    }
  }

  // --- 2. Where each cell sends its water ----------------------------------
  //
  // Steepest descent on the filled surface where there is a descent, and the
  // flood tree where there is not. That fallback is what carries flow across a
  // lake: every cell of a flat filled surface points back the way the flood
  // came, which is by construction the way to the outlet.
  for (let c = 0; c < count; c++) {
    let best = -1;
    let bestDrop = 0;
    for (let d = 0; d < degree; d++) {
      const n = neighbours[c * degree + d];
      if (n < 0) continue;
      const drop = filledM[c] - filledM[n];
      // Ties broken by index, so no answer depends on neighbour order.
      if (drop > bestDrop || (drop === bestDrop && drop > 0 && n < best)) {
        bestDrop = drop;
        best = n;
      }
    }
    downstream[c] = best >= 0 ? best : floodParent[c];
    // At an outlet the water leaves the map rather than circling back into it.
    if (outlet[c] === 1) downstream[c] = -1;
  }

  // --- 3. Add it up --------------------------------------------------------
  for (let c = 0; c < count; c++) {
    catchmentM2[c] = req.cellAreaM2;
    dischargeM3S[c] = (req.cellAreaM2 * req.runoffM[c]) / A.SECONDS_PER_YEAR;
  }
  for (const b of req.inflow) {
    if (b.cell < 0 || b.cell >= count) continue;
    catchmentM2[b.cell] += b.areaM2;
    dischargeM3S[b.cell] += b.dischargeM3S;
  }
  for (let i = popCount - 1; i >= 0; i--) {
    const c = popped[i];
    const to = downstream[c];
    if (to < 0) continue;
    catchmentM2[to] += catchmentM2[c];
    dischargeM3S[to] += dischargeM3S[c];
  }

  return {
    catchmentM2, dischargeM3S, lakeDepthM, filledM, downstream,
    injected: req.inflow,
  };
}

/**
 * Discharge as the 0..1 figure the rest of the game reads.
 *
 * Measured against a fixed reference at both ends -- a cubic metre a second is
 * the smallest thing worth calling a stream, the Amazon's 209,000 is the
 * largest river there is -- so the number means the same on every map at every
 * layer. That is exactly the property the old per-map normalisation lacked,
 * and lacking it is why a ditch and a trunk river painted the same colour on
 * two screens the player could put side by side.
 *
 * Logarithmic because discharge spans five orders of magnitude, and on a
 * linear scale everything that is not the Amazon is zero.
 */
const DRAINAGE_DENOM = dlog(1 + A.AMAZON_M3_PER_S / STREAM_M3_PER_S);

export function drainageOf(dischargeM3S: number): number {
  if (dischargeM3S <= 0) return 0;
  return clamp(dlog(1 + dischargeM3S / STREAM_M3_PER_S) / DRAINAGE_DENOM, 0, 1);
}

/**
 * A binary heap of key and cell, smallest key first, ties by cell index.
 *
 * Written out rather than sorting, because the flood pushes and pops in an
 * order it discovers as it goes. The index tie-break is not cosmetic: without
 * it the pop order would depend on sift details, and so would every downstream
 * direction in the world.
 */
class Heap {
  keys: Float64Array;
  vals: Int32Array;
  size: number;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity + 1);
    this.vals = new Int32Array(capacity + 1);
    this.size = 0;
  }

  before(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b]
      || (this.keys[a] === this.keys[b] && this.vals[a] < this.vals[b]);
  }

  swap(a: number, b: number): void {
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
    const v = this.vals[a]; this.vals[a] = this.vals[b]; this.vals[b] = v;
  }

  push(key: number, val: number): void {
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.vals[0];
    this.size--;
    this.keys[0] = this.keys[this.size];
    this.vals[0] = this.vals[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && this.before(l, m)) m = l;
      if (r < this.size && this.before(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

/** True when a barge can work this channel. Real units, no normalisation. */
export function navigable(dischargeM3S: number): boolean {
  return dischargeM3S >= NAVIGABLE_M3_PER_S;
}

/**
 * Mean channel depth in metres, from Leopold and Maddock. What a ford costs
 * and what a bridge has to span both come off this.
 */
export function channelDepthM(dischargeM3S: number): number {
  if (dischargeM3S <= 0) return 0;
  return A.HYDRAULIC_DEPTH_COEFF * dpow(dischargeM3S, A.HYDRAULIC_DEPTH_EXPONENT);
}

/** Channel width in metres, the width half of Leopold and Maddock. */
export function channelWidthM(dischargeM3S: number): number {
  if (dischargeM3S <= 0) return 0;
  return A.CHANNEL_WIDTH_COEFF * dpow(dischargeM3S, A.CHANNEL_WIDTH_EXPONENT);
}

/**
 * How much of a tile is floodplain, 0..1.
 *
 * A river builds a floodplain as wide as the belt its meanders sweep, which is
 * fifteen channel widths, which is fixed by the discharge. Compare that with
 * the tile's own width and the answer is the fraction of the tile that is
 * valley floor -- one on a plot beside a great river, a few per cent on a
 * parish crossed by a brook.
 *
 * THIS IS THE FIELD THE SOIL MODEL WANTS, and getting it wrong is what made
 * every farm in the world yield 153 kg a hectare for one commit. Soil depth
 * asks "is this a valley floor", and the old code answered it with the tile's
 * *rank in its own map* -- a number that reached 1.0 somewhere in every map,
 * including maps with no river in them at all. Absolute discharge broke that
 * accidental calibration by being honest, and the repair is not to restore the
 * ranking but to ask the real question, which needs the real discharge and the
 * tile's real size. It could not have been asked before the cascade existed.
 */
export function alluvialFraction(dischargeM3S: number, cellWidthM: number): number {
  if (dischargeM3S <= 0 || cellWidthM <= 0) return 0;
  return clamp((A.MEANDER_BELT_WIDTHS * channelWidthM(dischargeM3S)) / cellWidthM, 0, 1);
}
