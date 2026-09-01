// Every number the RUNNING GAME reads, solved from anchors.ts.
//
// Nothing in this file is typed in. Where a value genuinely is ours rather
// than the world's, it is marked FREE PARAMETER and the comment says why no
// measurement could settle it.
//
// WHAT MOVED, AND WHY THE HEADING ABOVE IS NARROWER THAN IT WAS.
//
// It used to say "every number the game runs on", and 26 of the 37 exports
// underneath were not read by anything. They were derived for a real-time
// battle -- arrow flight, cavalry gaits, formation pitch, a 32 Hz tick -- and
// then the game became a two-minute turn on a hex planet, which needs none of
// them. They sat here sound and unreachable, and the file's first line vouched
// for them as though the simulation depended on them.
//
// They are not deleted. The anchors under them are measured and a combat model
// will want them back; what was wrong was the claim, not the arithmetic. So
// they live in derive_battle.ts, whose own header says plainly that nothing
// reads it yet. This file is now what its first line says it is: every export
// below is imported somewhere that runs.
//
// THE FREE PARAMETERS ARE NUMBERED ACROSS BOTH FILES. There are five, 1 and 2
// here and 3 to 5 in derive_battle.ts, and verify_derive.ts counts them over
// the pair rather than per file -- the count is a property of the derivation
// layer, and splitting the layer in two must not be a way to halve it. Growing
// it is allowed; growing it silently is not.
//
// The arithmetic here runs once, at module load, in floating point -- and that
// is safe in a way the simulation proper is not, because it uses only + - * /
// and sqrt, all of which IEEE 754 pins to a correctly-rounded result that
// every conforming engine must reproduce exactly. No transcendental is touched
// (see tables.ts for why that matters). Every result is then snapped onto the
// integer grid and frozen, and verify/_baseline.json records the integers. If
// a platform ever does disagree, the baseline diff says so on the first run
// rather than the first tournament.

import * as A from './anchors.ts';

// ---------------------------------------------------------------------------
// Carrying load
// ---------------------------------------------------------------------------

/**
 * The speed multiplier for carrying `load` kg on a `mass` kg body.
 *
 * From the observation that the metabolic cost of transport, in joules per
 * kilogram of total mass per metre, is roughly constant over the ordinary
 * range of walking speeds. A man choosing his pace is holding metabolic power
 * near constant, so if total mass rises by a factor, sustainable speed falls
 * by the same factor: v scales as mass / (mass + load).
 *
 * The check that this is not nonsense: an infantryman under INFANTRY_LOAD
 * walks at 1.01 m/s, his column at 0.91, and eight hours of that is 26.2 km.
 * Roman and modern armies both put a day's march at 25-30 km. Nothing was
 * tuned to land there -- it falls out of a hauberk weighing what a hauberk
 * weighs, and it is the strongest evidence we have that the load model holds.
 */
export function loadFactor(mass: number, load: number): number {
  return mass / (mass + load);
}

export const INFANTRY_LOAD_FACTOR = loadFactor(A.BODY_MASS, A.INFANTRY_LOAD);

// ---------------------------------------------------------------------------
// FREE PARAMETER 1: column drag
// ---------------------------------------------------------------------------
/**
 * A body of men moves slower than any of the men in it. The rear ranks
 * accordion -- they must stop and start as the gaps open and close ahead --
 * and the whole column moves at the pace of whoever is currently stumbling.
 *
 * There is no measurement of this that we could find that separates it from
 * terrain, road quality and discipline. 0.9 is ours. It is the one number
 * standing between a derived individual pace and an observed column pace, and
 * if a real figure turns up, this is where to put it.
 */
export const COLUMN_DRAG = 0.9;

// ---------------------------------------------------------------------------
// Speeds, in metres per second
// ---------------------------------------------------------------------------

/** One man, average stat, under full campaign load. */
export const INFANTRY_WALK_MS = A.WALK_PREFERRED * INFANTRY_LOAD_FACTOR;

/** The formation he is standing in. */
export const INFANTRY_MARCH_MS = INFANTRY_WALK_MS * COLUMN_DRAG;

// ---------------------------------------------------------------------------
// Missiles
// ---------------------------------------------------------------------------

/**
 * Energy stored in a drawn warbow, J: the area under the force-draw curve,
 * approximated as a trapezium from the force at brace to the force at full
 * draw, over the powerstroke.
 */
export const WARBOW_STORED_J =
  0.5 *
  (A.WARBOW_DRAW_FORCE * A.WARBOW_BRACE_FORCE_FRACTION + A.WARBOW_DRAW_FORCE) *
  (A.WARBOW_DRAW_LENGTH - A.WARBOW_BRACE_HEIGHT);

/** Kinetic energy actually in the arrow, J, from the chronographed speed. */
export const WAR_ARROW_J = 0.5 * A.WAR_ARROW_MASS * A.WAR_ARROW_SPEED ** 2;

/**
 * The efficiency the two anchors imply, and a place to argue.
 *
 * This comes out near 0.5, which is lower than the 0.7-0.85 usually quoted for
 * a longbow. One of three things is true: the trapezium overstates the area
 * under a real warbow's force-draw curve, the chronograph figures are for
 * arrows heavier than our 80 g anchor, or the quoted efficiencies are from
 * lighter target bows measured differently. We have not resolved it.
 *
 * It is left visible rather than tuned away because it is the honest state of
 * the evidence: WAR_ARROW_SPEED is a direct measurement and is what the sim
 * uses, and this number is the size of the disagreement between it and the
 * bow's mechanics. verify_derive.ts asserts only that it stays inside 0.35-0.9
 * -- outside that band, an anchor is wrong rather than merely disputed.
 */
export const WARBOW_IMPLIED_EFFICIENCY = WAR_ARROW_J / WARBOW_STORED_J;

// ---------------------------------------------------------------------------
// Supply
// ---------------------------------------------------------------------------

/** Grain a soldier eats per day, kg: his campaign calories, at wheat's
 *  density, for the grain share of the ration. Comes out at 0.87 kg, against
 *  a Roman wheat ration of about 0.85. Nothing was tuned to make that match. */
export const SOLDIER_GRAIN_KG_PER_DAY =
  (A.SOLDIER_KCAL_PER_DAY * A.GRAIN_SHARE_OF_RATION) / A.WHEAT_KCAL_PER_KG;

// ---------------------------------------------------------------------------
// How fast the ground wears away
// ---------------------------------------------------------------------------

/**
 * Stream power's erodibility, solved from the one measured denudation rate.
 *
 *     E = K * sqrt(A) * S   ->   K = E / (sqrt(A) * S)
 *     K = 5.0e-5 / (sqrt(1.0e5) * 0.10) = 1.58e-6
 *
 * With m = 0.5 exactly the area term is a square root, so this file's
 * arithmetic stays inside + - * / and sqrt and keeps its IEEE guarantee.
 * Per-rock erodibility multiplies this, and is relative rather than absolute
 * for the same reason: one thing is measured and the rest are ratios to it.
 */
export const EROSION_K_REFERENCE =
  A.DENUDATION_TEMPERATE_M_PER_YR
  / (Math.sqrt(A.DENUDATION_REFERENCE_CATCHMENT_M2) * A.DENUDATION_REFERENCE_SLOPE);

// ---------------------------------------------------------------------------
// Rivers
// ---------------------------------------------------------------------------

/**
 * The discharge a river needs before a barge can work it.
 *
 * Solved, not chosen. Leopold and Maddock's depth law inverted at a laden
 * barge's draught:
 *
 *     d = 0.27 * Q^0.40   ->   Q = (d / 0.27)^2.5
 *     Q = (0.9 / 0.27)^2.5 = 20.3 m3/s
 *
 * Which lands where the history does. The Thames at Teddington runs 66 m3/s
 * and carried barges to London for a thousand years; the Wey at 5 m3/s needed
 * locks and dredging before it would. Twenty is the line between them, and
 * nobody put it there.
 *
 * The exponent is exact rather than approximate: 1/0.40 is 2.5, so this is x
 * squared times the square root of x -- multiplication and sqrt only, which is
 * what keeps this file's IEEE guarantee (see the header).
 */
const BARGE_DEPTH_RATIO = A.BARGE_LADEN_DRAFT_M / A.HYDRAULIC_DEPTH_COEFF;
export const NAVIGABLE_M3_PER_S =
  BARGE_DEPTH_RATIO * BARGE_DEPTH_RATIO * Math.sqrt(BARGE_DEPTH_RATIO);

// ---------------------------------------------------------------------------
// FREE PARAMETER 2: the bottom of the river scale
// ---------------------------------------------------------------------------
/**
 * Discharge spans five orders of magnitude and has to be shown on a log scale,
 * which needs a floor. One cubic metre a second is where we stop caring: a
 * channel below it is a ditch you step over, and no measurement says where
 * "worth drawing" begins. The top of the scale is not free -- it is the
 * Amazon, and a world that produced a bigger river would be lying.
 *
 * Display and soil-model convenience only. Nothing decides anything from it.
 * Navigability is decided from NAVIGABLE_M3_PER_S above in real units, and the
 * soil model reads it only to ask how near a valley floor is.
 */
export const STREAM_M3_PER_S = 1.0;

