// Every number the game runs on, solved from anchors.ts.
//
// Nothing in this file is typed in. Where a value genuinely is ours rather
// than the world's, it is marked FREE PARAMETER and the comment says why no
// measurement could settle it. There are four of them at the time of writing;
// if that count grows, something has gone wrong.
//
// The arithmetic here runs once, at module load, in floating point -- and that
// is safe in a way the simulation proper is not, because it uses only + - * /
// and sqrt, all of which IEEE 754 pins to a correctly-rounded result that
// every conforming engine must reproduce exactly. No transcendental is touched
// (see tables.ts for why that matters). Every result is then snapped onto the
// integer grid and frozen, and verify/_baseline.json records the integers. If
// a platform ever does disagree, the baseline diff says so on the first run
// rather than the first tournament.

import { fromFloat, SCALE } from './fixed.ts';
import * as A from './anchors.ts';

// ---------------------------------------------------------------------------
// The stat curve
// ---------------------------------------------------------------------------

/**
 * A capability at a given stat, interpolated between three anchored points:
 * stat 1 is the floor of still being able to do the thing, stat 10 is an
 * average adult, stat 20 is the human record.
 *
 * Piecewise linear rather than smooth because a smooth curve would need a
 * shape parameter, and there is nothing to measure that would settle it.
 */
export function statCurve(stat: number, floor: number, average: number, record: number): number {
  const s = stat < A.STAT_FLOOR ? A.STAT_FLOOR : stat > A.STAT_RECORD ? A.STAT_RECORD : stat;
  if (s <= A.STAT_AVERAGE) {
    const t = (s - A.STAT_FLOOR) / (A.STAT_AVERAGE - A.STAT_FLOOR);
    return floor + (average - floor) * t;
  }
  const t = (s - A.STAT_AVERAGE) / (A.STAT_RECORD - A.STAT_AVERAGE);
  return average + (record - average) * t;
}

/**
 * The stat-1 floor as a fraction of the stat-10 average.
 *
 * Measured for gait and only for gait: 0.6 m/s is the clinical threshold for
 * losing community ambulation, against a 1.40 m/s preferred speed. Applying
 * the same ratio to sprinting, to draw weight, to anything else, is an
 * ASSUMPTION -- it says the distance from "barely functioning" to "average" is
 * proportionally similar across physical capabilities. It is stated here once
 * rather than hidden in each call site so that it can be attacked in one place.
 */
export const FLOOR_FRACTION = A.WALK_FRAIL_THRESHOLD / A.WALK_PREFERRED;

/** Convenience: a curve pinned only at average and record, floor implied. */
function curve(stat: number, average: number, record: number): number {
  return statCurve(stat, average * FLOOR_FRACTION, average, record);
}

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

/** The mounted man plus what he wears, kg. His pack rides on the horse. */
export const RIDER_MASS =
  A.BODY_MASS + A.MAIL_HAUBERK + A.HELM + A.SHIELD + A.ARMS;

export const HORSE_LOAD_FACTOR = loadFactor(A.HORSE_MASS, RIDER_MASS);

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
// FREE PARAMETER 2: the warhorse's place on the gallop curve
// ---------------------------------------------------------------------------
/**
 * A destrier is not a thoroughbred and not a hack. Putting it at stat 13 says
 * it is meaningfully better than an ordinary riding horse and nowhere near a
 * sprint-bred racehorse. Nothing measures where on that line a medieval
 * warhorse sat; the skeletal record gives size, not speed.
 */
export const WARHORSE_STAT = 13;

// ---------------------------------------------------------------------------
// Speeds, in metres per second
// ---------------------------------------------------------------------------

/** One man, average stat, under full campaign load. */
export const INFANTRY_WALK_MS = A.WALK_PREFERRED * INFANTRY_LOAD_FACTOR;

/** The formation he is standing in. */
export const INFANTRY_MARCH_MS = INFANTRY_WALK_MS * COLUMN_DRAG;

/** A charge: all-out, loaded, held for SPRINT_DURATION and then spent. */
export const INFANTRY_CHARGE_MS =
  curve(A.STAT_AVERAGE, A.SPRINT_AVERAGE, A.SPRINT_RECORD) * INFANTRY_LOAD_FACTOR;

/** Distance a charge covers before the men in it are blown. */
export const CHARGE_RANGE_M = INFANTRY_CHARGE_MS * A.SPRINT_DURATION;

/** Mounted gaits, all under the weight of an armoured man. */
export const CAVALRY_WALK_MS = A.HORSE_WALK * HORSE_LOAD_FACTOR;
export const CAVALRY_TROT_MS = A.HORSE_TROT * HORSE_LOAD_FACTOR;
export const CAVALRY_CANTER_MS = A.HORSE_CANTER * HORSE_LOAD_FACTOR;
export const CAVALRY_CHARGE_MS =
  curve(WARHORSE_STAT, A.HORSE_GALLOP_AVERAGE, A.HORSE_GALLOP_RECORD) * HORSE_LOAD_FACTOR;

/** A day's march: eight hours at the column pace. Not used by the tick loop;
 *  kept because it is the number that tells you whether the rest is sane. */
export const DAY_MARCH_M = INFANTRY_MARCH_MS * 8 * 3600;

// ---------------------------------------------------------------------------
// The tick rate, solved rather than picked
// ---------------------------------------------------------------------------

/**
 * A tick must be short enough that the fastest thing in the game cannot cross
 * the smallest thing it has to notice. The fastest thing is a charging
 * warhorse; the smallest is the width of the man it is about to ride down.
 *
 * That gives a floor of CAVALRY_CHARGE_MS / SHOULDER_WIDTH ticks per second.
 * Round up to a power of two so that a tick is an exact binary fraction of a
 * second and the turn boundaries below land on integers.
 */
export const TICK_FLOOR_HZ = CAVALRY_CHARGE_MS / A.SHOULDER_WIDTH;
export const TICK_HZ = nextPowerOfTwo(TICK_FLOOR_HZ);
export const TICK_SECONDS = 1 / TICK_HZ;

function nextPowerOfTwo(v: number): number {
  let p = 1;
  while (p < v) p *= 2;
  return p;
}

/**
 * Speed as fixed-point units of distance per *second*, not per tick.
 *
 * Per-tick would be the obvious form and it is the wrong one. At 32 Hz a
 * marching man covers 116.4 fixed units per tick; rounding that to 116 makes
 * him 0.34% slow, and because the same rounded step is added every tick the
 * error does not cancel -- it accumulates to 89 m over a day's march, and to a
 * visibly late arrival over a battlefield.
 *
 * Storing per-second and integrating with a remainder (see step.ts) makes the
 * motion exact rational arithmetic instead: 32 ticks of a 3724-per-second
 * speed advance exactly 3724 units, with the leftover carried rather than
 * discarded. It costs one integer per unit per axis and removes the drift
 * entirely rather than shrinking it.
 */
export function perSecond(metresPerSecond: number): number {
  return Math.round(metresPerSecond * SCALE);
}

/** Duration in ticks, rounded up so nothing ever completes early. */
export function ticks(seconds: number): number {
  return Math.ceil(seconds * TICK_HZ);
}

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

/**
 * Ballistic range at the optimal 45 degrees, m: v^2 / g in a vacuum, which is
 * a ceiling rather than a range anyone shot at. Drag takes a real heavy war
 * arrow well below it. Aimed range -- the distance at which a man can expect
 * to hit a man -- is a different derivation and is not done yet; see
 * docs/known-gaps.md.
 */
export const ARROW_MAX_RANGE_M = A.WAR_ARROW_SPEED ** 2 / A.GRAVITY;
export const BOLT_MAX_RANGE_M = A.BOLT_SPEED ** 2 / A.GRAVITY;

/** Time of flight to maximum range, s, and the same in ticks. */
// Math.sqrt is IEEE-pinned; Math.SQRT1_2 is only "implementation-approximated"
// by the spec, so it is computed rather than read even here at authoring time.
export const ARROW_MAX_FLIGHT_S =
  (2 * A.WAR_ARROW_SPEED * Math.sqrt(0.5)) / A.GRAVITY;

/** Seconds between aimed shots. */
export const ARCHER_RELOAD_S = 60 / A.ARCHER_RATE_PER_MIN;

// ---------------------------------------------------------------------------
// Supply
// ---------------------------------------------------------------------------

/** Grain a soldier eats per day, kg: his campaign calories, at wheat's
 *  density, for the grain share of the ration. Comes out at 0.87 kg, against
 *  a Roman wheat ration of about 0.85. Nothing was tuned to make that match. */
export const SOLDIER_GRAIN_KG_PER_DAY =
  (A.SOLDIER_KCAL_PER_DAY * A.GRAIN_SHARE_OF_RATION) / A.WHEAT_KCAL_PER_KG;

/** Dry forage a horse eats per day, kg. */
export const HORSE_FORAGE_KG_PER_DAY = A.HORSE_MASS * A.HORSE_FORAGE_FRACTION;

/** Water, litres per day. */
export const SOLDIER_WATER_L_PER_DAY = A.MAN_WATER_PER_DAY;
export const HORSE_WATER_L_PER_DAY = A.HORSE_WATER_PER_DAY;

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
// FREE PARAMETER 5: the bottom of the river scale
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

// ---------------------------------------------------------------------------
// FREE PARAMETER 3: formation spacing
// ---------------------------------------------------------------------------
/**
 * How much room a man needs beyond his own shoulders to march without
 * treading on the man beside him. A close-order shield wall is shoulder to
 * shoulder and cannot be less; an open order is roughly double. 1.25 shoulder
 * widths is ours, for the ordinary line: tight enough to lock shields,
 * loose enough to walk.
 */
export const FORMATION_PITCH_FACTOR = 1.25;

export const FORMATION_PITCH_M = A.SHOULDER_WIDTH * FORMATION_PITCH_FACTOR;

/** Body radius for collision, m: half a shoulder width. */
export const BODY_RADIUS_M = A.SHOULDER_WIDTH / 2;

// ---------------------------------------------------------------------------
// FREE PARAMETER 4: how fast a man turns on the spot
// ---------------------------------------------------------------------------
/**
 * A standing man can spin about as fast as he likes; a man in a formation
 * turns at the pace of the formation, and a man at a walk turns as tightly as
 * his own stride allows. One full turn per second at a standstill is ours --
 * it is not far off what a person does and nobody has measured it under load.
 */
export const TURN_RATE_TURNS_PER_SEC = 1.0;

// ---------------------------------------------------------------------------
// The frozen integer form: this is what the simulation reads
// ---------------------------------------------------------------------------

export const SIM = Object.freeze({
  tickHz: TICK_HZ,

  /** Distance per second, fixed-point. step.ts divides by tickHz with carry. */
  infantryMarch: perSecond(INFANTRY_MARCH_MS),
  infantryCharge: perSecond(INFANTRY_CHARGE_MS),
  cavalryWalk: perSecond(CAVALRY_WALK_MS),
  cavalryTrot: perSecond(CAVALRY_TROT_MS),
  cavalryCanter: perSecond(CAVALRY_CANTER_MS),
  cavalryCharge: perSecond(CAVALRY_CHARGE_MS),
  arrowSpeed: perSecond(A.WAR_ARROW_SPEED),
  boltSpeed: perSecond(A.BOLT_SPEED),

  /** Angle units per second. */
  turnRate: Math.round(TURN_RATE_TURNS_PER_SEC * 1024),

  /** Distances, fixed-point. */
  bodyRadius: fromFloat(BODY_RADIUS_M),
  formationPitch: fromFloat(FORMATION_PITCH_M),
  arrowMaxRange: fromFloat(ARROW_MAX_RANGE_M),
  boltMaxRange: fromFloat(BOLT_MAX_RANGE_M),
  chargeRange: fromFloat(CHARGE_RANGE_M),

  /** Durations, in ticks. */
  archerReload: ticks(ARCHER_RELOAD_S),
  chargeDuration: ticks(A.SPRINT_DURATION),

  /** Consumption per day, in grams and centilitres, so they stay integers. */
  soldierGrainG: Math.round(SOLDIER_GRAIN_KG_PER_DAY * 1000),
  horseForageG: Math.round(HORSE_FORAGE_KG_PER_DAY * 1000),
  soldierWaterCl: Math.round(SOLDIER_WATER_L_PER_DAY * 100),
  horseWaterCl: Math.round(HORSE_WATER_L_PER_DAY * 100),
});

export type SimConstants = typeof SIM;
